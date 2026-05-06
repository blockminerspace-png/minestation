import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../config/prisma.js';
import { COOKIE_ACCESS, COOKIE_REFRESH, getJwtAuthConfig } from './config.js';
import { signAccessToken, verifyAccessToken } from './jwtService.js';
import { revokeAllRefreshForUser, insertRefreshToken, rotateRefreshToken } from './refreshTokenStore.js';
import { appendAccessCookie, appendRefreshCookie, clearAuthCookies } from './cookies.js';
import { writeJwtRefreshSnapshot } from './storageMirror.js';

export type ParseCookiesFn = (req: Request) => Record<string, string>;

export function readCookie(parseCookies: ParseCookiesFn, req: Request, name: string): string | null {
  const c = parseCookies(req);
  return c[name] || null;
}

export type ResolveAuthDeps = {
  parseCookies: ParseCookiesFn;
  allowLegacySession?: boolean;
};

/**
 * Resolve utilizador: 1) access JWT válido 2) opcionalmente sessão legacy `sid`.
 * Ordem permite access curto + refresh; impersonação via sid remove cookies JWT no servidor.
 */
export function createResolveAuthMiddleware({ parseCookies, allowLegacySession = true }: ResolveAuthDeps) {
  return async function resolveAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    req.userId = undefined;
    req.auth = undefined;

    const accessRaw = readCookie(parseCookies, req, COOKIE_ACCESS);
    if (accessRaw) {
      try {
        const v = verifyAccessToken(accessRaw);
        req.userId = v.userId;
        req.auth = { kind: 'jwt', jti: v.jti, exp: v.exp };
        return next();
      } catch (e: unknown) {
        const name = e instanceof Error ? e.name : '';
        const ign = ['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError'];
        if (!ign.includes(name)) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn('[JWT] Validação access:', name, msg);
        }
      }
    }

    if (!allowLegacySession) {
      next();
      return;
    }

    const sid = parseCookies(req).sid;
    if (sid) {
      try {
        const s = await prisma.sessions.findUnique({
          where: { session_id: sid },
          select: { user_id: true, expires_at: true }
        });
        if (s && Number(s.expires_at) > Date.now()) {
          req.userId = s.user_id;
          req.auth = { kind: 'session' };
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[JWT] Sessão legacy:', msg);
      }
    }
    next();
  };
}

export async function issueJwtAuthCookies(res: Response, userId: number, req: Request): Promise<void> {
  const cfg = getJwtAuthConfig();
  await revokeAllRefreshForUser(userId);
  const familyId = crypto.randomUUID();
  const rawRefresh = crypto.randomBytes(48).toString('base64url');
  const expMs = Date.now() + cfg.refreshTtlSec * 1000;
  await insertRefreshToken({
    userId,
    rawToken: rawRefresh,
    familyId,
    expiresAt: expMs,
    userAgent: (req.headers['user-agent'] as string | undefined) || null,
    ip: req.ip || req.socket?.remoteAddress || null
  });
  const access = signAccessToken(userId);
  appendAccessCookie(res, access, cfg.accessTtlSec);
  appendRefreshCookie(res, rawRefresh, cfg.refreshTtlSec);
  await writeJwtRefreshSnapshot();
}

export async function handleJwtRefresh(req: Request, res: Response, parseCookies: ParseCookiesFn): Promise<Response | void> {
  const raw = readCookie(parseCookies, req, COOKIE_REFRESH);
  if (!raw) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Refresh token em falta.', code: 'AUTH_REFRESH_MISSING' });
  }
  try {
    const rotated = await rotateRefreshToken(raw, {
      userAgent: (req.headers['user-agent'] as string | undefined) || null,
      ip: req.ip || req.socket?.remoteAddress || null
    });
    if (!rotated.ok) {
      clearAuthCookies(res);
      return res.status(401).json({
        error:
          rotated.code === 'expired' ? 'Sessão expirada. Inicie sessão novamente.' : 'Refresh inválido ou revogado.',
        code: 'AUTH_REFRESH_INVALID'
      });
    }
    const cfg = getJwtAuthConfig();
    const access = signAccessToken(rotated.userId);
    appendAccessCookie(res, access, cfg.accessTtlSec);
    appendRefreshCookie(res, rotated.newRefreshRaw, cfg.refreshTtlSec);
    await writeJwtRefreshSnapshot();
    return res.json({ ok: true });
  } catch (e: unknown) {
    console.error('[JWT] /auth/refresh:', e);
    clearAuthCookies(res);
    return res.status(500).json({ error: 'Erro ao renovar sessão.', code: 'AUTH_REFRESH_ERROR' });
  }
}

export async function revokeJwtRefreshForUser(userId: number): Promise<void> {
  await revokeAllRefreshForUser(userId);
  await writeJwtRefreshSnapshot();
}

export function sendAuthUnauthorized(res: Response, message = 'Não autenticado.', code = 'AUTH_REQUIRED'): void {
  res.status(401).json({ error: message, code });
}

export type RequireJwtAccessDeps = { parseCookies: ParseCookiesFn };

/**
 * Exige JWT de acesso válido (rejeita apenas sessão sid) — usar em rotas de máxima exigência.
 */
export function createRequireJwtAccessMiddleware({ parseCookies }: RequireJwtAccessDeps) {
  return function requireJwtAccess(req: Request, res: Response, next: NextFunction): void {
    const raw = readCookie(parseCookies, req, COOKIE_ACCESS);
    if (!raw) {
      sendAuthUnauthorized(res, 'Token de acesso em falta.', 'AUTH_ACCESS_MISSING');
      return;
    }
    try {
      const v = verifyAccessToken(raw);
      req.userId = v.userId;
      req.auth = { kind: 'jwt', jti: v.jti, exp: v.exp };
      next();
    } catch (e: unknown) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'TokenExpiredError') {
        sendAuthUnauthorized(res, 'Access token expirado. Utilize POST /api/auth/refresh.', 'AUTH_ACCESS_EXPIRED');
        return;
      }
      sendAuthUnauthorized(res, 'Access token inválido.', 'AUTH_ACCESS_INVALID');
    }
  };
}
