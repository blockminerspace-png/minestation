import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { JwtPayload } from 'jsonwebtoken';
import { getJwtAuthConfig } from './config.js';

export function signAccessToken(userId: number | string): string {
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

export type VerifiedAccess = { userId: number; jti: string | undefined; exp: number | undefined };

export function verifyAccessToken(token: string): VerifiedAccess {
  const c = getJwtAuthConfig();
  const payload = jwt.verify(token, c.secret, {
    algorithms: ['HS256'],
    issuer: c.issuer,
    audience: c.audience
  }) as JwtPayload;
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
  return { userId: id, jti: typeof payload.jti === 'string' ? payload.jti : undefined, exp: payload.exp };
}
