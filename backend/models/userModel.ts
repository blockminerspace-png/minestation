import type { Pool } from 'pg';
import { assertPublicSignupEmailAllowed } from './registrationValidation.js';
import { generateReferralCode } from './signupPolicy.js';

export type GetUserIdOpts = { allowAnyDomain?: boolean; preferredUsername?: string | null };

export class EmailPolicyError extends Error {
  readonly code = 'EMAIL_POLICY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EmailPolicyError';
  }
}

export class IpLimitError extends Error {
  readonly existingAccounts: { username: string; email: string }[];

  constructor(message: string, accounts: { username: string; email: string }[]) {
    super(message);
    this.name = 'IpLimitError';
    this.existingAccounts = accounts;
  }
}

export async function getUserIdByEmail(
  pool: Pool,
  email: string,
  ip: string | null = null,
  opts: GetUserIdOpts = {}
): Promise<string | number> {
  if (!email) throw new Error('Email is required for getUserIdByEmail');
  const normalizedEmail = email.toLowerCase();
  const rowRes = await pool.query('SELECT id, username, referral_code FROM users WHERE email = $1', [normalizedEmail]);
  const row = rowRes.rows[0];
  const allowAnyDomain = !!opts.allowAnyDomain;
  const preferred =
    typeof opts.preferredUsername === 'string' && opts.preferredUsername.trim().length > 0
      ? opts.preferredUsername.trim()
      : null;

  if (row) {
    if (!row.referral_code) {
      let code = generateReferralCode(row.username);
      let tries = 0;
      while (tries < 10) {
        const existsRes = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
        if (existsRes.rowCount === 0) break;
        code = generateReferralCode(row.username);
        tries++;
      }
      await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, row.id]);
    }
    return row.id;
  }
  const username = preferred || (email.split('@')[0] || 'user');
  let code = generateReferralCode(username);
  let tries = 0;
  while (tries < 10) {
    const existsRes = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
    if (existsRes.rowCount === 0) break;
    code = generateReferralCode(username);
    tries++;
  }
  try {
    if (!allowAnyDomain) {
      const policy = assertPublicSignupEmailAllowed(normalizedEmail);
      if (!policy.ok) {
        throw new EmailPolicyError(policy.error);
      }
    }
    if (ip) {
      const countRes = await pool.query('SELECT COUNT(*) FROM users WHERE registration_ip = $1', [ip]);
      if (parseInt(String(countRes.rows[0].count), 10) >= 3) {
        const existingRes = await pool.query('SELECT username, email FROM users WHERE registration_ip = $1 LIMIT 3', [ip]);
        throw new IpLimitError('Limite de 3 contas por IP atingido.', existingRes.rows);
      }
    }
    const info = await pool.query(
      'INSERT INTO users (username, email, referral_code, is_admin, is_blocked, registration_ip) VALUES ($1, $2, $3, 0, 0, $4) RETURNING id',
      [username, normalizedEmail, code, ip]
    );
    const newUid = info.rows[0].id;
    const now = Date.now();

    if (ip) {
      await pool.query(
        'INSERT INTO user_history_ips (user_id, ip, last_used_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [newUid, ip, now]
      );
    }

    const regBoxes = await pool.query("SELECT id FROM loot_boxes WHERE trigger = 'registration'");
    for (const box of regBoxes.rows) {
      await pool.query(
        'INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1',
        [newUid, box.id]
      );
      await pool.query(
        'INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [newUid, box.id, now]
      );
    }

    try {
      await pool.query(
        `INSERT INTO game_states (user_id, usdc, start_time, last_updated_at, claimed_referrals, referral_bonus_claimed, black_market_balance)
         VALUES ($1, 0, $2, $2, 0, 0, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [newUid, Date.now()]
      );
    } catch (gsErr) {
      console.error('Failed to create game state:', gsErr);
    }

    return newUid;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      const retryRes = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (retryRes.rows[0]) return retryRes.rows[0].id;
    }
    throw err;
  }
}
