import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getJwtAuthConfig } from './config.js';

export function signAccessToken(userId) {
  const c = getJwtAuthConfig();
  const sub = String(userId);
  if (!/^\d+$/.test(sub)) {
    const e = new Error('Identificador de utilizador inválido para token.');
    e.name = 'ValidationError';
    throw e;
  }
  return jwt.sign(
    { typ: 'access', ver: 1 },
    c.secret,
    {
      subject: sub,
      algorithm: 'HS256',
      expiresIn: c.accessTtlSec,
      issuer: c.issuer,
      audience: c.audience,
      jwtid: crypto.randomUUID()
    }
  );
}

/**
 * @param {string} token
 * @returns {{ userId: number, jti: string|undefined, exp: number|undefined }}
 */
export function verifyAccessToken(token) {
  const c = getJwtAuthConfig();
  const payload = jwt.verify(token, c.secret, {
    algorithms: ['HS256'],
    issuer: c.issuer,
    audience: c.audience
  });
  if (payload.typ !== 'access') {
    const e = new Error('Tipo de token inválido');
    e.name = 'JsonWebTokenError';
    throw e;
  }
  const id = parseInt(String(payload.sub), 10);
  if (!Number.isFinite(id) || id <= 0) {
    const e = new Error('Subject inválido');
    e.name = 'JsonWebTokenError';
    throw e;
  }
  return { userId: id, jti: payload.jti, exp: payload.exp };
}
