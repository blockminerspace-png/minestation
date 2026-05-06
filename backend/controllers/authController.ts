import type { Express, Request, Response } from 'express';
import type bcryptjs from 'bcryptjs';
import crypto from 'node:crypto';
import {
  findUserByEmail,
  insertSession,
  loadSessionUser,
  listUserAccessLevelIds,
  recordLoginIp,
  ensureUserReferralCode,
  updateUserPasswordHash,
  updateUserPolygonAndAccess
} from '../models/authModel.js';
import { insertDeviceFingerprintLog, sanitizeDeviceFingerprint } from '../models/deviceFingerprintModel.js';
import { logUserAction } from '../lib/mongoLogs.js';
import { sendInternalErrorSafeMessage } from '../utils/apiErrorResponse.js';
import { resolveIsSuperAdminFromUserRow } from '../utils/legacySuperAdmin.js';
import {
  validateLoginEmail,
  validateLoginFieldsPresent,
  validateLoginPassword
} from '../models/registrationValidation.js';

export type AuthControllerDeps = {
  bcrypt: typeof bcryptjs;
  parseCookies: (req: Request) => Record<string, string>;
  getClientIp: (req: Request) => string;
};

function parseAdminPermissions(raw: unknown): unknown {
  if (raw == null) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (pe) {
    console.error('[Auth] Failed to parse admin_permissions:', pe);
    return null;
  }
}

function buildSessionUserJson(u: Record<string, unknown>, session: Record<string, unknown>, accessLevelIds: string[]) {
  const adminPerms = parseAdminPermissions(u.admin_permissions);
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    isAdmin: !!u.is_admin,
    isSuperAdmin: resolveIsSuperAdminFromUserRow({
      is_super_admin: (u as { is_super_admin?: unknown }).is_super_admin,
      is_admin: (u as { is_admin?: unknown }).is_admin,
      email: u.email
    }),
    adminPermissions: adminPerms,
    isBlocked: !!u.is_blocked,
    polygonWallet: u.polygon_wallet,
    accessLevelId: u.access_level_id,
    accessLevelIds,
    referralCode: u.referral_code,
    referredBy: u.referred_by,
    isImpersonating: !!session.original_user_id
  };
}

export function registerAuthRoutes(app: Express, deps: AuthControllerDeps): void {
  const { bcrypt, parseCookies, getClientIp } = deps;

  app.post('/api/login', async (req: Request, res: Response) => {
    const { email, password, deviceFingerprint } = (req.body || {}) as {
      email?: string;
      password?: string;
      deviceFingerprint?: unknown;
    };
    const emailStr = typeof email === 'string' ? email : '';
    const passwordStr = typeof password === 'string' ? password : '';
    const present = validateLoginFieldsPresent(email, password);
    if (!present.ok) return res.status(400).json({ error: present.error });
    const emailCheck = validateLoginEmail(emailStr);
    if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });
    const passwordCheck = validateLoginPassword(passwordStr);
    if (!passwordCheck.ok) return res.status(400).json({ error: passwordCheck.error });
    try {
      const normalizedEmail = emailStr.trim().toLowerCase();
      let u = await findUserByEmail(normalizedEmail);

      if (!u) {
        await bcrypt.compare(passwordStr, '$2b$10$abcdefghijklmnopqrstuvwxyz123456');
        return res.status(401).json({ error: 'E-mail ou palavra-passe incorretos.' });
      }

      if (u.is_blocked) return res.status(403).json({ error: 'Este usuário está bloqueado.' });

      if (!u.password) {
        const hashedPassword = await bcrypt.hash(passwordStr, 10);
        await updateUserPasswordHash(u.id as string | number, hashedPassword);
        u = { ...u, password: hashedPassword };
      }

      let isMatch = false;
      const pwd = String(u.password ?? '');
      if (pwd && (pwd.startsWith('$2a$') || pwd.startsWith('$2b$'))) {
        try {
          isMatch = await bcrypt.compare(passwordStr, pwd);
        } catch (bcError: unknown) {
          console.error('[Login] bcrypt:', bcError instanceof Error ? bcError.message : bcError);
        }
      } else if (pwd === passwordStr) {
        isMatch = true;
        const hashedPassword = await bcrypt.hash(passwordStr, 10);
        await updateUserPasswordHash(u.id as string | number, hashedPassword);
      }

      if (!isMatch) {
        // Mesma mensagem que email inexistente — evita enumeração de contas.
        return res.status(401).json({ error: 'E-mail ou palavra-passe incorretos.' });
      }

      const currentIp = getClientIp(req);
      try {
        await recordLoginIp(u.id as string | number, currentIp);
      } catch (ipErr: unknown) {
        console.error('[Login] Erro ao registrar histórico de IP:', ipErr instanceof Error ? ipErr.message : ipErr);
      }

      const referralCode = await ensureUserReferralCode(
        u.id as string | number,
        String(u.username ?? ''),
        u.referral_code as string | null | undefined
      );
      u = { ...u, referral_code: referralCode };

      const sid = crypto.randomUUID();
      const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
      await insertSession(sid, u.id as string | number, Date.now(), expiresAt);

      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${30 * 24 * 3600}`);

      const userLvlIds = await listUserAccessLevelIds(u.id as string | number, u.access_level_id);

      const fp = sanitizeDeviceFingerprint(deviceFingerprint);
      if (fp) {
        const ip = getClientIp(req);
        const ua = String(req.get('user-agent') || '');
        void insertDeviceFingerprintLog({
          userId: Number(u.id),
          eventType: 'login',
          fingerprintHash: fp.fingerprintHash,
          payloadJson: fp.payloadJson,
          ip,
          userAgent: ua
        }).catch((err: unknown) => {
          console.warn('[Fingerprint] login:', err instanceof Error ? err.message : err);
        });
      }

      const uidNum = Number(u.id);
      logUserAction(Number.isFinite(uidNum) ? uidNum : null, 'login', { auth: 'password' });

      res.json({
        id: String(u.id),
        email: u.email,
        username: u.username,
        isAdmin: !!u.is_admin,
        isSuperAdmin: resolveIsSuperAdminFromUserRow({
          is_super_admin: (u as { is_super_admin?: unknown }).is_super_admin,
          is_admin: (u as { is_admin?: unknown }).is_admin,
          email: u.email
        }),
        isBlocked: !!u.is_blocked,
        adminPermissions: parseAdminPermissions(u.admin_permissions),
        polygonWallet: u.polygon_wallet,
        accessLevelId: u.access_level_id,
        accessLevelIds: userLvlIds,
        referralCode: u.referral_code,
        referredBy: u.referred_by
      });
    } catch (e: unknown) {
      sendInternalErrorSafeMessage(res, 'POST /api/login', e, 'Erro ao iniciar sessão.');
    }
  });

  app.get('/api/session', async (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const sid = cookies.sid;
    if (!sid) return res.status(401).json({ error: 'No session' });
    try {
      const loaded = await loadSessionUser(sid);
      if (!loaded) return res.status(401).json({ error: 'Session expired' });
      const { session: s, user: u } = loaded;
      const userLvlIds = await listUserAccessLevelIds(u.id as string | number, u.access_level_id);
      res.json(buildSessionUserJson(u, s, userLvlIds));
    } catch (e: unknown) {
      sendInternalErrorSafeMessage(res, 'GET /api/session', e, 'Erro ao carregar sessão.');
    }
  });

  app.post('/api/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  app.post('/api/session', async (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const sid = cookies.sid;
    if (!sid) return res.status(401).json({ error: 'No session' });
    try {
      const loaded = await loadSessionUser(sid);
      if (!loaded) return res.status(401).json({ error: 'No session' });
      const { polygonWallet } = (req.body || {}) as { polygonWallet?: unknown };
      await updateUserPolygonAndAccess(loaded.user.id as string | number, polygonWallet);
      const wid = Number(loaded.user.id);
      logUserAction(Number.isFinite(wid) ? wid : null, 'wallet_link', {});
      res.json({ ok: true });
    } catch (e: unknown) {
      sendInternalErrorSafeMessage(res, 'POST /api/session', e, 'Erro ao atualizar sessão.');
    }
  });
}
