import type { Express, Request, Response } from 'express';
import type bcryptjs from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { executeUserPutCoreTransaction } from '../models/userPutCoreTransaction.js';
import {
  assertPublicSignupEmailAllowed,
  getConflictingUserIdByEmail,
  getConflictingUserIdByUsername,
  EMAIL_ADDRESS_MAX_LENGTH,
  SIGNUP_EMAIL_MAX_TOTAL,
  validateAccessLevelIdsArray,
  validateOptionalAccessLevelId,
  validateOptionalPolygonWallet,
  validateOptionalReferralCodeInput,
  validateSignupPassword,
  validateSignupUsername
} from '../models/registrationValidation.js';
import { EmailPolicyError, getUserIdByEmail, IpLimitError } from '../models/userModel.js';
import { insertDeviceFingerprintLog, sanitizeDeviceFingerprint } from '../models/deviceFingerprintModel.js';
import { logUserAction } from '../lib/mongoLogs.js';
import { sendInternalErrorSafeMessage } from '../utils/apiErrorResponse.js';

export type UserRegistrationDeps = {
  bcrypt: typeof bcryptjs;
  getClientIp: (req: Request) => string;
};

export function registerUserRoutes(app: Express, deps: UserRegistrationDeps): void {
  const { bcrypt, getClientIp } = deps;

  app.put('/api/user', async (req: Request, res: Response) => {
    const isAuthenticatedRequest = Boolean((req as Request & { userId?: number }).userId);
    const u = req.body as Record<string, unknown>;
    const normalizedEmail = String(u.email || '')
      .toLowerCase()
      .trim();
    console.log(`[UserUpdate] Payload received for email: ${normalizedEmail}, userId: ${req.userId}`);
    try {
      let uid: string | number;
      let usernameForDb: string | unknown = u.username;
      let polygonForDb: unknown = u.polygonWallet ?? null;
      let accessLevelForDb: unknown = u.accessLevelId ?? null;
      let referredByForDb: unknown = u.referredBy ?? null;

      if (req.userId) {
        const adminRow = await prisma.users.findUnique({
          where: { id: Number(req.userId) },
          select: { is_admin: true }
        });
        const isAdminUser = adminRow?.is_admin;

        if (isAdminUser && (u.id || u.email)) {
          if (u.id) {
            uid = u.id as string | number;
          } else {
            uid = await getUserIdByEmail(normalizedEmail, getClientIp(req), { allowAnyDomain: true });
          }
        } else {
          uid = req.userId;
        }

        if (typeof u.username === 'string' && u.username.trim().length > 0) {
          const vu = validateSignupUsername(u.username);
          if (!vu.ok) {
            return res.status(400).json({ error: vu.error });
          }
          const taken = await getConflictingUserIdByUsername(vu.username, uid);
          if (taken != null) {
            return res.status(409).json({
              error: 'Este nome de utilizador já está em uso. Escolha outro.',
              code: 'USERNAME_TAKEN'
            });
          }
          usernameForDb = vu.username;
        }

        if (normalizedEmail.length > 0) {
          if (!normalizedEmail.includes('@') || normalizedEmail.length > EMAIL_ADDRESS_MAX_LENGTH) {
            return res.status(400).json({ error: 'E-mail inválido.' });
          }
          const emailTaken = await getConflictingUserIdByEmail(normalizedEmail, uid);
          if (emailTaken != null) {
            return res.status(409).json({
              error: 'Este e-mail já está associado a outra conta.',
              code: 'EMAIL_TAKEN'
            });
          }
        }

        const pw = validateOptionalPolygonWallet(u.polygonWallet);
        if (pw && typeof pw === 'object' && 'error' in pw) {
          return res.status(400).json({ error: (pw as { error: string }).error });
        }
        polygonForDb = typeof pw === 'string' ? pw : u.polygonWallet ?? null;

        const al = validateOptionalAccessLevelId(u.accessLevelId);
        if (al && typeof al === 'object' && 'error' in al) {
          return res.status(400).json({ error: (al as { error: string }).error });
        }
        accessLevelForDb = typeof al === 'string' ? al : u.accessLevelId ?? null;

        {
          const ref = validateOptionalReferralCodeInput(u.referredBy);
          if (!ref.ok) {
            return res.status(400).json({ error: ref.error });
          }
          referredByForDb = ref.code;
        }

      } else {
        if (!u.email) {
          return res.status(400).json({ error: 'Email é obrigatório para o registro.' });
        }
        if (!normalizedEmail.includes('@') || normalizedEmail.length > SIGNUP_EMAIL_MAX_TOTAL) {
          return res.status(400).json({ error: 'E-mail inválido.' });
        }

        const userVu = validateSignupUsername(u.username);
        if (!userVu.ok) {
          return res.status(400).json({ error: userVu.error });
        }
        const nickname = userVu.username;

        const existing = await prisma.users.findFirst({
          where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
          select: { id: true, password: true }
        });

        if (existing?.password) {
          return res.status(403).json({ error: 'Este email já está cadastrado. Por favor, faça login.' });
        }

        if (existing && !existing.password) {
          const pwdPresent = typeof u.password === 'string' && u.password.trim().length > 0;
          if (!pwdPresent) {
            return res.status(400).json({ error: 'Defina uma palavra-passe para concluir o registo.' });
          }
        }

        const hasPassword = typeof u.password === 'string' && u.password.trim().length > 0;
        if (!existing && !hasPassword) {
          return res.status(400).json({ error: 'Defina uma palavra-passe para o registo.' });
        }
        if (hasPassword) {
          const pv = validateSignupPassword(u.password, true);
          if (!pv.ok) {
            return res.status(400).json({ error: pv.error });
          }
        }

        const pw = validateOptionalPolygonWallet(u.polygonWallet);
        if (pw && typeof pw === 'object' && 'error' in pw) {
          return res.status(400).json({ error: (pw as { error: string }).error });
        }
        polygonForDb = typeof pw === 'string' ? pw : null;

        const al = validateOptionalAccessLevelId(u.accessLevelId);
        if (al && typeof al === 'object' && 'error' in al) {
          return res.status(400).json({ error: (al as { error: string }).error });
        }
        accessLevelForDb = typeof al === 'string' ? al : null;

        {
          const ref = validateOptionalReferralCodeInput(u.referredBy);
          if (!ref.ok) {
            return res.status(400).json({ error: ref.error });
          }
          referredByForDb = ref.code;
        }

        if (!existing) {
          const ev = assertPublicSignupEmailAllowed(normalizedEmail);
          if (!ev.ok) {
            return res.status(400).json({ ok: false, error: ev.error });
          }

          const userTaken = await getConflictingUserIdByUsername(nickname, null);
          if (userTaken != null) {
            return res.status(409).json({
              error: 'Este nome de utilizador já está em uso. Escolha outro.',
              code: 'USERNAME_TAKEN'
            });
          }

          uid = (await getUserIdByEmail(normalizedEmail, getClientIp(req), {
            preferredUsername: nickname
          })) as number;
        } else {
          const userTaken = await getConflictingUserIdByUsername(nickname, existing.id);
          if (userTaken != null) {
            return res.status(409).json({
              error: 'Este nome de utilizador já está em uso. Escolha outro.',
              code: 'USERNAME_TAKEN'
            });
          }
          uid = existing.id;
        }

        usernameForDb = nickname;
      }

      let allowAccessLevelFromBody = !req.userId;
      if (req.userId) {
        const gateRow = await prisma.users.findUnique({
          where: { id: Number(req.userId) },
          select: { is_admin: true }
        });
        allowAccessLevelFromBody = !!gateRow?.is_admin;
      }
      if (!allowAccessLevelFromBody) {
        const curRow = await prisma.users.findUnique({
          where: { id: Number(uid) },
          select: { access_level_id: true }
        });
        accessLevelForDb = curRow?.access_level_id ?? null;
      }

      let accessLevelIdsValidated: string[] | null = null;
      if (allowAccessLevelFromBody && Array.isArray(u.accessLevelIds)) {
        const av = validateAccessLevelIdsArray(u.accessLevelIds);
        if (!av.ok) {
          return res.status(400).json({ error: av.error });
        }
        accessLevelIdsValidated = av.ids;
      }

      const hasPassword = typeof u.password === 'string' && u.password.trim().length > 0;
      if (hasPassword) {
        const pv = validateSignupPassword(u.password, true);
        if (!pv.ok) {
          return res.status(400).json({ error: pv.error });
        }
      }

      const passwordHash = hasPassword ? await bcrypt.hash(u.password as string, 10) : null;
      const clientIp = getClientIp(req);

      await prisma.$transaction(async (tx) => {
        await executeUserPutCoreTransaction(tx, {
          uid: Number(uid),
          usernameForUpdate: String(usernameForDb ?? ''),
          normalizedEmail,
          passwordHash,
          polygonForUpdate:
            polygonForDb == null || polygonForDb === ''
              ? null
              : String(polygonForDb),
          accessLevelIdForUpdate:
            accessLevelForDb == null || accessLevelForDb === ''
              ? null
              : String(accessLevelForDb),
          referredByForUpdate:
            referredByForDb == null || referredByForDb === ''
              ? null
              : String(referredByForDb),
          allowAccessLevelFromBody,
          accessLevelIdsValidated,
          clientIpReferral: clientIp
        });
      });
      console.log(`[UserUpdate] Success for uid: ${uid}`);

      if (!isAuthenticatedRequest) {
        const fp = sanitizeDeviceFingerprint(u.deviceFingerprint);
        if (fp) {
          const ip = getClientIp(req);
          const ua = String(req.get('user-agent') || '');
          void insertDeviceFingerprintLog({
            userId: Number(uid),
            eventType: 'register',
            fingerprintHash: fp.fingerprintHash,
            payloadJson: fp.payloadJson,
            ip,
            userAgent: ua
          }).catch((err: unknown) => {
            console.warn('[Fingerprint] registo:', err instanceof Error ? err.message : err);
          });
        }
      }

      const uidForLog = Number(uid);
      if (Number.isFinite(uidForLog)) {
        logUserAction(uidForLog, isAuthenticatedRequest ? 'profile_update' : 'signup_complete', {});
      }

      res.json({ ok: true });
    } catch (e: unknown) {
      console.error('[UserUpdate] Error:', e);
      if (e instanceof IpLimitError) {
        return res.status(403).json({
          error: e.message,
          code: 'IP_LIMIT_REACHED',
          accounts: e.existingAccounts
        });
      }
      if (e instanceof EmailPolicyError) {
        return res.status(400).json({ ok: false, error: e.message });
      }
      const pg = e as { code?: string; constraint?: string; existingAccounts?: unknown; message?: string; stack?: string };
      if (pg.code === '23505') {
        return res.status(409).json({
          error: 'Este e-mail ou nome de utilizador já está em uso.',
          code: 'DUPLICATE'
        });
      }
      if (pg.existingAccounts) {
        return res.status(403).json({
          error: pg.message,
          code: 'IP_LIMIT_REACHED',
          accounts: pg.existingAccounts
        });
      }
      if (pg.code === 'EMAIL_POLICY') {
        return res.status(400).json({ ok: false, error: pg.message });
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return res.status(409).json({
          error: 'Este e-mail ou nome de utilizador já está em uso.',
          code: 'DUPLICATE'
        });
      }
      sendInternalErrorSafeMessage(
        res,
        'PUT /api/user',
        e,
        'Erro interno no servidor durante o registro.'
      );
    }
  });
}
