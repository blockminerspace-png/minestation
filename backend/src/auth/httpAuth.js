import crypto from 'crypto';
import { COOKIE_ACCESS, COOKIE_REFRESH, getJwtAuthConfig } from './config.js';
import { signAccessToken, verifyAccessToken } from './jwtService.js';
import { revokeAllRefreshForUser, insertRefreshToken, rotateRefreshToken } from './refreshTokenStore.js';
import { appendAccessCookie, appendRefreshCookie, clearAuthCookies } from './cookies.js';
import { writeJwtRefreshSnapshot } from './storageMirror.js';

export function readCookie(parseCookies, req, name) {
  const c = parseCookies(req);
  return c[name] || null;
}

/**
 * Resolve utilizador: 1) access JWT válido 2) opcionalmente sessão legacy `sid`.
 * Ordem permite access curto + refresh; impersonação via sid remove cookies JWT no servidor.
 */
export function createResolveAuthMiddleware({ db, parseCookies, allowLegacySession = true }) {
  return async function resolveAuth(req, res, next) {
    req.userId = undefined;
    req.auth = undefined;

    const accessRaw = readCookie(parseCookies, req, COOKIE_ACCESS);
    if (accessRaw) {
      try {
        const v = verifyAccessToken(accessRaw);
        req.userId = v.userId;
        req.auth = { kind: 'jwt', jti: v.jti, exp: v.exp };
        return next();
      } catch (e) {
        const ign = ['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError'];
        if (!ign.includes(e.name)) {
          console.warn('[JWT] Validação access:', e.name, e.message);
        }
      }
    }

    if (!allowLegacySession) return next();

    const sid = parseCookies(req).sid;
    if (sid) {
      try {
        const sRes = await db.query('SELECT user_id, expires_at FROM sessions WHERE session_id = $1', [sid]);
        const s = sRes.rows[0];
        if (s && Number(s.expires_at) > Date.now()) {
          req.userId = s.user_id;
          req.auth = { kind: 'session' };
        }
      } catch (e) {
        console.warn('[JWT] Sessão legacy:', e.message);
      }
    }
    next();
  };
}

export async function issueJwtAuthCookies(db, res, userId, req) {
  const cfg = getJwtAuthConfig();
  await revokeAllRefreshForUser(db, userId);
  const familyId = crypto.randomUUID();
  const rawRefresh = crypto.randomBytes(48).toString('base64url');
  const expMs = Date.now() + cfg.refreshTtlSec * 1000;
  await insertRefreshToken(db, {
    userId,
    rawToken: rawRefresh,
    familyId,
    expiresAt: expMs,
    userAgent: req.headers['user-agent'] || null,
    ip: req.ip || req.socket?.remoteAddress || null
  });
  const access = signAccessToken(userId);
  appendAccessCookie(res, access, cfg.accessTtlSec);
  appendRefreshCookie(res, rawRefresh, cfg.refreshTtlSec);
  await writeJwtRefreshSnapshot(db);
}

export async function handleJwtRefresh(req, res, db, parseCookies) {
  const raw = readCookie(parseCookies, req, COOKIE_REFRESH);
  if (!raw) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Refresh token em falta.', code: 'AUTH_REFRESH_MISSING' });
  }
  try {
    const rotated = await rotateRefreshToken(db, raw, {
      userAgent: req.headers['user-agent'] || null,
      ip: req.ip || req.socket?.remoteAddress || null
    });
    if (!rotated.ok) {
      clearAuthCookies(res);
      return res.status(401).json({
        error: rotated.code === 'expired' ? 'Sessão expirada. Inicie sessão novamente.' : 'Refresh inválido ou revogado.',
        code: 'AUTH_REFRESH_INVALID'
      });
    }
    const cfg = getJwtAuthConfig();
    const access = signAccessToken(rotated.userId);
    appendAccessCookie(res, access, cfg.accessTtlSec);
    appendRefreshCookie(res, rotated.newRefreshRaw, cfg.refreshTtlSec);
    await writeJwtRefreshSnapshot(db);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[JWT] /auth/refresh:', e);
    clearAuthCookies(res);
    return res.status(500).json({ error: 'Erro ao renovar sessão.', code: 'AUTH_REFRESH_ERROR' });
  }
}

export async function revokeJwtRefreshForUser(db, userId) {
  await revokeAllRefreshForUser(db, userId);
  await writeJwtRefreshSnapshot(db);
}

export function sendAuthUnauthorized(res, message = 'Não autenticado.', code = 'AUTH_REQUIRED') {
  res.status(401).json({ error: message, code });
}

/**
 * Exige JWT de acesso válido (rejeita apenas sessão sid) — usar em rotas de máxima exigência.
 */
export function createRequireJwtAccessMiddleware({ parseCookies }) {
  return function requireJwtAccess(req, res, next) {
    const raw = readCookie(parseCookies, req, COOKIE_ACCESS);
    if (!raw) {
      return sendAuthUnauthorized(res, 'Token de acesso em falta.', 'AUTH_ACCESS_MISSING');
    }
    try {
      const v = verifyAccessToken(raw);
      req.userId = v.userId;
      req.auth = { kind: 'jwt', jti: v.jti, exp: v.exp };
      return next();
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return sendAuthUnauthorized(res, 'Access token expirado. Utilize POST /api/auth/refresh.', 'AUTH_ACCESS_EXPIRED');
      }
      return sendAuthUnauthorized(res, 'Access token inválido.', 'AUTH_ACCESS_INVALID');
    }
  };
}
