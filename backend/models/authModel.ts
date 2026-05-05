import type { Pool } from 'pg';
import { generateReferralCode } from './signupPolicy.js';

export type DbUserRow = Record<string, unknown>;

export async function findUserByEmail(pool: Pool, normalizedEmail: string): Promise<DbUserRow | undefined> {
  const uRes = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
  return uRes.rows[0];
}

export async function updateUserPasswordHash(pool: Pool, userId: string | number, hash: string): Promise<void> {
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, userId]);
}

export async function recordLoginIp(pool: Pool, userId: string | number, currentIp: string): Promise<void> {
  await pool.query('UPDATE users SET registration_ip = $1 WHERE id = $2 AND registration_ip IS NULL', [
    currentIp,
    userId
  ]);
  await pool.query(
    `INSERT INTO user_history_ips (user_id, ip, last_used_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, ip) DO UPDATE SET last_used_at = $3`,
    [userId, currentIp, Date.now()]
  );
}

export async function ensureUserReferralCode(
  pool: Pool,
  userId: string | number,
  username: string,
  existingCode: string | null | undefined
): Promise<string> {
  if (existingCode) return existingCode;
  let code = generateReferralCode(username);
  let tries = 0;
  while (tries < 10) {
    const existsRes = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
    if (existsRes.rowCount === 0) break;
    code = generateReferralCode(username);
    tries++;
  }
  await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, userId]);
  return code;
}

export async function insertSession(
  pool: Pool,
  sessionId: string,
  userId: string | number,
  createdAt: number,
  expiresAt: number
): Promise<void> {
  await pool.query('INSERT INTO sessions (session_id,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)', [
    sessionId,
    userId,
    createdAt,
    expiresAt
  ]);
}

export async function loadSessionUser(
  pool: Pool,
  sessionId: string
): Promise<{ session: Record<string, unknown>; user: DbUserRow } | null> {
  const sRes = await pool.query('SELECT * FROM sessions WHERE session_id = $1', [sessionId]);
  const s = sRes.rows[0];
  if (!s || Number(s.expires_at) < Date.now()) return null;
  const uRes = await pool.query('SELECT * FROM users WHERE id = $1', [s.user_id]);
  const u = uRes.rows[0];
  if (!u) return null;
  return { session: s, user: u };
}

export async function listUserAccessLevelIds(pool: Pool, userId: string | number, primaryLevelId: unknown): Promise<string[]> {
  const userLvlsRes = await pool.query('SELECT access_level_id FROM user_access_levels WHERE user_id = $1', [userId]);
  const userLvlIds = userLvlsRes.rows.map((l: { access_level_id: string }) => l.access_level_id);
  if (primaryLevelId && !userLvlIds.includes(primaryLevelId as string)) {
    userLvlIds.push(primaryLevelId as string);
  }
  return userLvlIds;
}

/** Atualiza só a carteira Polygon; níveis de acesso vêm de compras/admin no servidor (não do body). */
export async function updateUserPolygonAndAccess(
  pool: Pool,
  userId: string | number,
  polygonWallet: unknown
): Promise<void> {
  if (polygonWallet !== undefined) {
    await pool.query('UPDATE users SET polygon_wallet = $1 WHERE id = $2', [polygonWallet, userId]);
  }
}
