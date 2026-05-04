import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import type bcryptjs from 'bcryptjs';
import {
  assertPublicSignupEmailAllowed,
  getConflictingUserIdByEmail,
  getConflictingUserIdByUsername,
  sanitizeOptionalReferralCode,
  validateAccessLevelIdsArray,
  validateOptionalAccessLevelId,
  validateOptionalPolygonWallet,
  validateSignupPassword,
  validateSignupUsername
} from '../models/registrationValidation.js';
import { EmailPolicyError, getUserIdByEmail, IpLimitError } from '../models/userModel.js';
import { insertDeviceFingerprintLog, sanitizeDeviceFingerprint } from '../models/deviceFingerprintModel.js';
import { sendInternalErrorSafeMessage } from '../utils/apiErrorResponse.js';

export type UserRegistrationDeps = {
  pool: Pool;
  bcrypt: typeof bcryptjs;
  getClientIp: (req: Request) => string;
};

export function registerUserRoutes(app: Express, deps: UserRegistrationDeps): void {
  const { pool, bcrypt, getClientIp } = deps;

  app.put('/api/user', async (req: Request, res: Response) => {
    const isAuthenticatedRequest = Boolean((req as Request & { userId?: number }).userId);
    const u = req.body as Record<string, unknown>;
    const normalizedEmail = String(u.email || '')
      .toLowerCase()
      .trim();
    console.log(`[UserUpdate] Payload received for email: ${normalizedEmail}, userId: ${req.userId}`);
    const client = await pool.connect();
    try {
      let uid: string | number;
      let usernameForDb: string | unknown = u.username;
      let polygonForDb: unknown = u.polygonWallet ?? null;
      let accessLevelForDb: unknown = u.accessLevelId ?? null;
      let referredByForDb: unknown = u.referredBy ?? null;

      if (req.userId) {
        const uAdminRes = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
        const isAdminUser = uAdminRes.rows[0]?.is_admin;

        if (isAdminUser && (u.id || u.email)) {
          if (u.id) {
            uid = u.id as string | number;
          } else {
            uid = await getUserIdByEmail(pool, normalizedEmail, getClientIp(req), { allowAnyDomain: true });
          }
        } else {
          uid = req.userId;
        }

        if (typeof u.username === 'string' && u.username.trim().length > 0) {
          const vu = validateSignupUsername(u.username);
          if (!vu.ok) {
            return res.status(400).json({ error: vu.error });
          }
          const taken = await getConflictingUserIdByUsername(pool, vu.username, uid);
          if (taken != null) {
            return res.status(409).json({
              error: 'Este nome de utilizador já está em uso. Escolha outro.',
              code: 'USERNAME_TAKEN'
            });
          }
          usernameForDb = vu.username;
        }

        if (normalizedEmail.length > 0) {
          if (!normalizedEmail.includes('@') || normalizedEmail.length > 254) {
            return res.status(400).json({ error: 'E-mail inválido.' });
          }
          const emailTaken = await getConflictingUserIdByEmail(pool, normalizedEmail, uid);
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

        referredByForDb = sanitizeOptionalReferralCode(u.referredBy);

        if (Array.isArray(u.accessLevelIds)) {
          const av = validateAccessLevelIdsArray(u.accessLevelIds);
          if (!av.ok) {
            return res.status(400).json({ error: av.error });
          }
        }
      } else {
        if (!u.email) {
          return res.status(400).json({ error: 'Email é obrigatório para o registro.' });
        }
        if (!normalizedEmail.includes('@') || normalizedEmail.length > 254) {
          return res.status(400).json({ error: 'E-mail inválido.' });
        }

        const userVu = validateSignupUsername(u.username);
        if (!userVu.ok) {
          return res.status(400).json({ error: userVu.error });
        }
        const nickname = userVu.username;

        const existingRow = await pool.query('SELECT id, password FROM users WHERE email = $1', [normalizedEmail]);
        const existing = existingRow.rows[0];

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

        referredByForDb = sanitizeOptionalReferralCode(u.referredBy);

        if (!existing) {
          const ev = assertPublicSignupEmailAllowed(normalizedEmail);
          if (!ev.ok) {
            return res.status(400).json({ ok: false, error: ev.error });
          }

          const userTaken = await getConflictingUserIdByUsername(pool, nickname, null);
          if (userTaken != null) {
            return res.status(409).json({
              error: 'Este nome de utilizador já está em uso. Escolha outro.',
              code: 'USERNAME_TAKEN'
            });
          }

          uid = (await getUserIdByEmail(pool, normalizedEmail, getClientIp(req), {
            preferredUsername: nickname
          })) as number;
        } else {
          const userTaken = await getConflictingUserIdByUsername(pool, nickname, existing.id);
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

      await client.query('BEGIN');

      const hasPassword = typeof u.password === 'string' && u.password.trim().length > 0;
      if (hasPassword) {
        const hashedPassword = await bcrypt.hash(u.password as string, 10);
        await client.query(
          'UPDATE users SET username=$1, email=$2, password=$3, polygon_wallet=$4, access_level_id=$5, referred_by=$6 WHERE id=$7',
          [
            usernameForDb,
            normalizedEmail,
            hashedPassword,
            polygonForDb,
            accessLevelForDb,
            referredByForDb,
            uid
          ]
        );
      } else {
        await client.query(
          'UPDATE users SET username=$1, email=$2, polygon_wallet=$3, access_level_id=$4, referred_by=$5 WHERE id=$6',
          [usernameForDb, normalizedEmail, polygonForDb, accessLevelForDb, referredByForDb, uid]
        );
      }

      if (accessLevelForDb) {
        await client.query(
          'INSERT INTO user_access_levels (user_id, access_level_id, granted_at) VALUES ($1,$2,$3) ON CONFLICT (user_id, access_level_id) DO NOTHING',
          [uid, accessLevelForDb, Date.now()]
        );
      }

      if (Array.isArray(u.accessLevelIds)) {
        const av = validateAccessLevelIdsArray(u.accessLevelIds);
        if (!av.ok) {
          throw new Error(av.error);
        }
        await client.query('DELETE FROM user_access_levels WHERE user_id = $1', [uid]);
        for (const alid of av.ids) {
          await client.query(
            'INSERT INTO user_access_levels (user_id, access_level_id, granted_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [uid, alid, Date.now()]
          );
        }
        if (accessLevelForDb) {
          await client.query(
            'INSERT INTO user_access_levels (user_id, access_level_id, granted_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [uid, accessLevelForDb, Date.now()]
          );
        }
      }

      const clientIp = getClientIp(req);
      const refCode = typeof referredByForDb === 'string' ? referredByForDb : null;

      if (refCode) {
        const refRes = await client.query('SELECT id, access_level_id FROM users WHERE LOWER(referral_code) = LOWER($1)', [
          refCode
        ]);
        const ref = refRes.rows[0];
        const referredUsername = typeof usernameForDb === 'string' ? usernameForDb : String(usernameForDb ?? '');

        if (ref && referredUsername) {
          const referrerRes = await client.query('SELECT registration_ip FROM users WHERE id = $1', [ref.id]);
          const referrerRegIp = referrerRes.rows[0]?.registration_ip;

          const historyCheck = await client.query('SELECT 1 FROM user_history_ips WHERE user_id = $1 AND ip = $2', [
            ref.id,
            clientIp
          ]);

          if ((referrerRegIp && referrerRegIp === clientIp) || historyCheck.rowCount! > 0) {
            console.warn(`[Referral] Bloqueada tentativa de auto-indicação. IP ${clientIp} vinculado ao indicador ID: ${ref.id}`);
            throw new Error(
              'Auto-indicação não permitida. Você não pode usar seu próprio código de indicação em contas do mesmo IP.'
            );
          } else {
            const refInsert = await client.query(
              'INSERT INTO referrals (user_id, referred_username) VALUES ($1, $2) ON CONFLICT (user_id, referred_username) DO NOTHING',
              [ref.id, referredUsername]
            );

            if (refInsert.rowCount! > 0) {
              const alId = ref.access_level_id || 'normal';
              const modelRes = await client.query(
                `SELECT m.*
                 FROM referral_models m
                 JOIN access_level_referral_models a ON m.id = a.referral_model_id
                 WHERE a.access_level_id = $1 AND m.is_active = 1`,
                [alId]
              );
              const model = modelRes.rows[0];

              if (model) {
                console.log(`[Referral] Using Advanced Model: ${model.name} for Access Level: ${alId}`);

                if (model.sender_reward_usdc > 0) {
                  await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [
                    model.sender_reward_usdc,
                    ref.id
                  ]);
                }
                if (model.sender_loot_box_id) {
                  await client.query(
                    'INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1',
                    [ref.id, model.sender_loot_box_id]
                  );
                }

                if (model.receiver_reward_usdc > 0) {
                  await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [
                    model.receiver_reward_usdc,
                    uid
                  ]);
                }
                if (model.receiver_loot_box_id) {
                  await client.query(
                    'INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1',
                    [uid, model.receiver_loot_box_id]
                  );
                  await client.query(
                    'INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                    [uid, model.receiver_loot_box_id, Date.now()]
                  );
                }

                await client.query('UPDATE game_states SET claimed_referrals = claimed_referrals + 1 WHERE user_id = $1', [
                  ref.id
                ]);
                await client.query('UPDATE game_states SET referral_bonus_claimed = 1 WHERE user_id = $1', [uid]);
              } else {
                const senderBoxes = await client.query("SELECT id FROM loot_boxes WHERE trigger = 'referral_sender'");
                for (const box of senderBoxes.rows) {
                  await client.query(
                    'INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1',
                    [ref.id, box.id]
                  );
                }
                await client.query('UPDATE game_states SET claimed_referrals = claimed_referrals + 1 WHERE user_id = $1', [
                  ref.id
                ]);

                const gsRes = await client.query('SELECT referral_bonus_claimed FROM game_states WHERE user_id = $1', [uid]);
                if (gsRes.rows[0] && !gsRes.rows[0].referral_bonus_claimed) {
                  const receiverBoxes = await client.query("SELECT id FROM loot_boxes WHERE trigger = 'referral_receiver'");
                  const now = Date.now();
                  for (const box of receiverBoxes.rows) {
                    await client.query(
                      'INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1',
                      [uid, box.id]
                    );
                    await client.query(
                      'INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                      [uid, box.id, now]
                    );
                  }
                  await client.query('UPDATE game_states SET referral_bonus_claimed = 1 WHERE user_id = $1', [uid]);
                }
              }
            }
          }
        }
      }

      await client.query('COMMIT');
      console.log(`[UserUpdate] Success for uid: ${uid}`);

      if (!isAuthenticatedRequest) {
        const fp = sanitizeDeviceFingerprint(u.deviceFingerprint);
        if (fp) {
          const ip = getClientIp(req);
          const ua = String(req.get('user-agent') || '');
          void insertDeviceFingerprintLog(pool, {
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

      res.json({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK').catch(() => {});
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
      sendInternalErrorSafeMessage(
        res,
        'PUT /api/user',
        e,
        'Erro interno no servidor durante o registro.'
      );
    } finally {
      client.release();
    }
  });
}
