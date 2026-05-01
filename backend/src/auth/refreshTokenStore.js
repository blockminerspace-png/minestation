import crypto from 'crypto';
import { getJwtAuthConfig } from './config.js';

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

export async function revokeAllRefreshForUser(db, userId) {
  const now = Date.now();
  await db.query('UPDATE jwt_refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL', [now, userId]);
}

export async function insertRefreshToken(db, { userId, rawToken, familyId, expiresAt, userAgent, ip }) {
  const tokenHash = hashToken(rawToken);
  await db.query(
    `INSERT INTO jwt_refresh_tokens (user_id, token_hash, family_id, expires_at, created_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, tokenHash, familyId, expiresAt, Date.now(), userAgent || null, ip || null]
  );
}

/**
 * Rotação de refresh token (uso único do token antigo).
 * @returns {{ ok: true, userId: number, newRefreshRaw: string } | { ok: false, code: string }}
 */
export async function rotateRefreshToken(db, rawOld, { userAgent, ip }) {
  const oldHash = hashToken(rawOld);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT * FROM jwt_refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL FOR UPDATE`,
      [oldHash]
    );
    const row = r.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'invalid' };
    }
    if (Number(row.expires_at) < Date.now()) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'expired' };
    }
    const cfg = getJwtAuthConfig();
    const newRaw = crypto.randomBytes(48).toString('base64url');
    const newHash = hashToken(newRaw);
    const expMs = Date.now() + cfg.refreshTtlSec * 1000;
    await client.query('DELETE FROM jwt_refresh_tokens WHERE id = $1', [row.id]);
    await client.query(
      `INSERT INTO jwt_refresh_tokens (user_id, token_hash, family_id, expires_at, created_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.user_id, newHash, row.family_id, expMs, Date.now(), userAgent || null, ip || null]
    );
    await client.query('COMMIT');
    return { ok: true, userId: row.user_id, newRefreshRaw: newRaw };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
