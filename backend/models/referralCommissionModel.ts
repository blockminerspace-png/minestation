import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { SqlTransaction } from '../lib/sqlTransaction.js';

/** Comissão fixa sobre depósitos USDC validados (indicador recebe % do valor creditado ao indicado). */
export const REFERRAL_DEPOSIT_COMMISSION_PERCENT = 5;

const MAX_COMMISSION_USDC = 1_000_000;

function roundUsdc8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

/**
 * Credita comissão de referral sobre um depósito USDC, **idempotente** por `idempotency_key`
 * (ex.: `deposit_tx:0xabc...`). Deve correr na **mesma transação** `BEGIN` do crédito do depósito.
 */
export async function creditDepositReferralCommissionPg(
  client: PoolClient,
  depositorUserId: number,
  depositAmountUsdc: number,
  idempotencyKey: string
): Promise<void> {
  const amount = Number(depositAmountUsdc);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const key = String(idempotencyKey || '').trim().slice(0, 240);
  if (!key) return;

  const refRes = await client.query<{ referrer_id: number }>(
    `SELECT r.user_id AS referrer_id
     FROM referrals r
     WHERE r.referred_username = (SELECT username FROM users WHERE id = $1 LIMIT 1)`,
    [depositorUserId]
  );
  if (refRes.rowCount === 0) return;
  const referrerId = Number(refRes.rows[0].referrer_id);
  if (!Number.isFinite(referrerId) || referrerId <= 0 || referrerId === depositorUserId) return;

  const commission = roundUsdc8((amount * REFERRAL_DEPOSIT_COMMISSION_PERCENT) / 100);
  if (!(commission > 0) || commission > MAX_COMMISSION_USDC) return;

  const now = Date.now();
  const ins = await client.query(
    `INSERT INTO referral_commission_ledger (
       idempotency_key, referrer_user_id, referred_user_id, source_type,
       base_amount_usdc, commission_percent, commission_usdc, created_at
     ) VALUES ($1, $2, $3, 'deposit', $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING 1`,
    [
      key,
      referrerId,
      depositorUserId,
      roundUsdc8(amount),
      REFERRAL_DEPOSIT_COMMISSION_PERCENT,
      commission,
      now
    ]
  );
  if (ins.rowCount === 0) return;

  await client.query(
    `UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1, server_updated_at = $2, last_updated_at = $2 WHERE user_id = $3`,
    [commission, now, referrerId]
  );

  console.log(
    `[ReferralCommission] deposit referrer=${referrerId} referred=${depositorUserId} base=${amount} commission=${commission} key=${key.slice(0, 48)}`
  );
}

/**
 * Comissão de referral (hardware / black_market) a partir de `referral_models` + nível de acesso.
 * Depósitos usam `creditDepositReferralCommissionPg` com chave idempotente (não passar por aqui).
 */
export async function runReferralCommissionOnTx(
  sql: SqlTransaction,
  userId: number,
  amount: number,
  type: string
): Promise<void> {
  if (type === 'deposit') {
    console.warn('[ReferralCommission] type=deposit ignorado aqui; usar creditDepositReferralCommissionPg com idempotency_key.');
    return;
  }
  try {
    const refRows = await sql.queryRows<{ referrer_id: number; access_level_id: string | null }>(
      `
      SELECT r.user_id as referrer_id, u.access_level_id
      FROM referrals r
      JOIN users u ON r.user_id = u.id
      WHERE r.referred_username = (SELECT username FROM users WHERE id = $1)
    `,
      [userId]
    );
    if (refRows.length === 0) return;
    const { referrer_id, access_level_id } = refRows[0]!;
    const alId = access_level_id || 'normal';

    const modelRows = await sql.queryRows<{
      hardware_commission_percent?: number | null;
      black_market_commission_percent?: number | null;
    }>(
      `
      SELECT m.hardware_commission_percent, m.black_market_commission_percent
      FROM referral_models m
      JOIN access_level_referral_models a ON m.id = a.referral_model_id
      WHERE a.access_level_id = $1 AND m.is_active = 1
    `,
      [alId]
    );
    const model = modelRows[0];
    if (!model) return;

    let commissionPercent = 0;
    if (type === 'hardware') commissionPercent = Number(model.hardware_commission_percent) || 0;
    else if (type === 'black_market') commissionPercent = Number(model.black_market_commission_percent) || 0;

    if (commissionPercent > 0) {
      const commissionAmount = (amount * commissionPercent) / 100;
      if (commissionAmount > 0) {
        console.log(
          `[ReferralCommission] Awarding ${commissionAmount} USDC to referrer ${referrer_id} (${type} commission ${commissionPercent}%)`
        );
        await sql.execute('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [
          commissionAmount,
          referrer_id
        ]);
      }
    }
  } catch (err) {
    console.error('[ReferralCommission] Error processing commission:', err);
  }
}

/** Gera chave idempotente para comissão sobre brindes USDC admin (sem tx on-chain). */
export function newAdminUsdcGiftReferralIdempotencyKey(depositorUserId: number, amountUsdc: number): string {
  const r = crypto.randomBytes(10).toString('hex');
  return `admin_usdc_gift:${depositorUserId}:${roundUsdc8(amountUsdc)}:${Date.now()}:${r}`;
}
