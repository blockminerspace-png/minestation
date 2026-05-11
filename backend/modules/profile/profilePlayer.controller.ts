import type { Express, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import {
  respondIfHttpControlledError,
  sendInternalErrorSafeMessageOrPrisma
} from '../../utils/apiErrorResponse.js';
import { buildProfileStatePayload } from './profileState.service.js';
import { patchProfileIdentity } from './profileIdentity.service.js';
import { changeProfilePassword } from './profilePassword.service.js';
import {
  createWalletConnectChallenge,
  removeProfileWallet,
  verifyWalletConnectSignature
} from './profileWallet.service.js';
import { bindProfileReferralCode } from './profileReferralBind.service.js';
import { buildReferralOverview } from './profileReferralOverview.service.js';
import { listProfileSecurityEvents } from './profileAudit.service.js';

function requestId(req: Request): string {
  const h = req.headers['x-request-id'];
  if (typeof h === 'string' && h.trim()) return h.trim().slice(0, 64);
  return crypto.randomUUID();
}

function inviteBaseUrlFromRequest(req: Request): string {
  const env =
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_URL ||
    process.env.SITE_URL ||
    process.env.VITE_APP_URL ||
    '';
  if (typeof env === 'string' && env.trim()) return env.trim();
  const origin = req.get('origin');
  if (origin && /^https?:\/\//i.test(origin)) return origin.trim();
  return '';
}

function uidRequired(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const profileIdentityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${(req as Request).ip || 'ip'}:profile_identity:${uidRequired(req as Request) ?? 'anon'}`,
  message: { error: 'Demasiadas alterações de nome. Tente mais tarde.', code: 'RATE_LIMIT' }
});

const profilePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${(req as Request).ip || 'ip'}:profile_password:${uidRequired(req as Request) ?? 'anon'}`,
  message: { error: 'Demasiadas tentativas de alteração de senha.', code: 'RATE_LIMIT' }
});

const profileWalletMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${(req as Request).ip || 'ip'}:profile_wallet:${uidRequired(req as Request) ?? 'anon'}`,
  message: { error: 'Demasiadas operações de carteira.', code: 'RATE_LIMIT' }
});

export type ProfilePlayerControllerDeps = {
  authenticateToken: RequestHandler;
  getClientIp: (req: Request) => string;
  revokeJwtRefreshForUser: (userId: number) => Promise<void>;
  referralClaimSensitiveLimiter: RequestHandler;
};

export function registerProfilePlayerRoutes(app: Express, deps: ProfilePlayerControllerDeps): void {
  const { authenticateToken, getClientIp, revokeJwtRefreshForUser, referralClaimSensitiveLimiter } = deps;

  app.get('/api/profile/state', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
    try {
      const payload = await buildProfileStatePayload({
        userId: uid,
        inviteBaseUrl: inviteBaseUrlFromRequest(req)
      });
      res.json(payload);
    } catch (e) {
      console.error('[GET /api/profile/state]', e);
      sendInternalErrorSafeMessageOrPrisma(res, '[GET /api/profile/state]', e, 'Erro ao carregar o perfil.');
    }
  });

  app.patch('/api/profile/identity', authenticateToken, profileIdentityLimiter, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
    const rid = requestId(req);
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const displayUsername = body.username ?? body.displayName;
      const out = await patchProfileIdentity({
        userId: uid,
        displayUsername,
        requestId: rid,
        route: '/api/profile/identity'
      });
      res.json({ ok: true, username: out.username });
    } catch (e) {
      if (respondIfHttpControlledError(res, e)) return;
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
        res.status(409).json({ error: 'Este nome de utilizador já está em uso.', code: 'USERNAME_TAKEN' });
        return;
      }
      sendInternalErrorSafeMessageOrPrisma(res, '[PATCH /api/profile/identity]', e, 'Erro ao atualizar o perfil.');
    }
  });

  app.post(
    '/api/profile/password/change',
    authenticateToken,
    profilePasswordLimiter,
    async (req: Request, res: Response) => {
      const uid = uidRequired(req);
      if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      const rid = requestId(req);
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        await changeProfilePassword({
          userId: uid,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
          confirmPassword: body.confirmPassword,
          revokeJwtRefreshForUser,
          requestId: rid,
          route: '/api/profile/password/change'
        });
        res.json({ ok: true, message: 'Palavra-passe atualizada. Em dispositivos com sessão antiga pode ser necessário iniciar sessão novamente.' });
      } catch (e) {
        if (respondIfHttpControlledError(res, e)) return;
        sendInternalErrorSafeMessageOrPrisma(
          res,
          '[POST /api/profile/password/change]',
          e,
          'Erro ao alterar a palavra-passe.'
        );
      }
    }
  );

  app.post(
    '/api/profile/referral/bind',
    authenticateToken,
    referralClaimSensitiveLimiter,
    async (req: Request, res: Response) => {
      const uid = uidRequired(req);
      if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      const rid = requestId(req);
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        await bindProfileReferralCode({
          userId: uid,
          codeRaw: body.code,
          clientIp: getClientIp(req),
          requestId: rid,
          route: '/api/profile/referral/bind'
        });
        res.json({ ok: true });
      } catch (e) {
        if (respondIfHttpControlledError(res, e)) return;
        sendInternalErrorSafeMessageOrPrisma(
          res,
          '[POST /api/profile/referral/bind]',
          e,
          'Erro ao vincular o código.'
        );
      }
    }
  );

  app.get('/api/profile/referral/state', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
    try {
      const st = await buildProfileStatePayload({
        userId: uid,
        inviteBaseUrl: inviteBaseUrlFromRequest(req)
      });
      const ref = (st as { referral?: Record<string, unknown> }).referral;
      res.json({ ok: true, referral: ref ?? null });
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(res, '[GET /api/profile/referral/state]', e, 'Erro ao carregar indicações.');
    }
  });

  app.get('/api/profile/referral/overview', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
    try {
      const overview = await buildReferralOverview({
        userId: uid,
        inviteBaseUrl: inviteBaseUrlFromRequest(req),
        historyLimit: 80
      });
      res.json(overview);
    } catch (e) {
      console.error('[Referral] /api/profile/referral/overview', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        '[GET /api/profile/referral/overview]',
        e,
        'Erro ao carregar histórico de indicações.'
      );
    }
  });

  app.post(
    '/api/profile/wallet/connect/challenge',
    authenticateToken,
    profileWalletMutationLimiter,
    async (req: Request, res: Response) => {
      const uid = uidRequired(req);
      if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      try {
        const out = await createWalletConnectChallenge(uid);
        res.json({ ok: true, ...out });
      } catch (e) {
        sendInternalErrorSafeMessageOrPrisma(
          res,
          '[POST /api/profile/wallet/connect/challenge]',
          e,
          'Erro ao criar desafio de carteira.'
        );
      }
    }
  );

  app.post(
    '/api/profile/wallet/connect/verify',
    authenticateToken,
    profileWalletMutationLimiter,
    async (req: Request, res: Response) => {
      const uid = uidRequired(req);
      if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      const rid = requestId(req);
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const out = await verifyWalletConnectSignature({
          userId: uid,
          challengeId: body.challengeId,
          address: body.address,
          signature: body.signature,
          chainId: body.chainId,
          requestId: rid,
          route: '/api/profile/wallet/connect/verify'
        });
        res.json({ ok: true, address: out.address });
      } catch (e) {
        if (respondIfHttpControlledError(res, e)) return;
        sendInternalErrorSafeMessageOrPrisma(
          res,
          '[POST /api/profile/wallet/connect/verify]',
          e,
          'Erro ao verificar a carteira.'
        );
      }
    }
  );

  app.delete('/api/profile/wallet', authenticateToken, profileWalletMutationLimiter, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
    const rid = requestId(req);
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      await removeProfileWallet({
        userId: uid,
        currentPassword: body.currentPassword,
        requestId: rid,
        route: 'DELETE /api/profile/wallet'
      });
      res.json({ ok: true });
    } catch (e) {
      if (respondIfHttpControlledError(res, e)) return;
      sendInternalErrorSafeMessageOrPrisma(res, '[DELETE /api/profile/wallet]', e, 'Erro ao remover a carteira.');
    }
  });

  app.get('/api/profile/badges', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
    try {
      const st = await buildProfileStatePayload({
        userId: uid,
        inviteBaseUrl: inviteBaseUrlFromRequest(req)
      });
      const badges = (st as { badges?: unknown[] }).badges ?? [];
      res.json({ ok: true, badges });
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(res, '[GET /api/profile/badges]', e, 'Erro ao listar emblemas.');
    }
  });

  app.get('/api/profile/security-events', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
    try {
      const events = await listProfileSecurityEvents(uid, 50);
      res.json({ ok: true, events });
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(
        res,
        '[GET /api/profile/security-events]',
        e,
        'Erro ao listar eventos de segurança.'
      );
    }
  });
}
