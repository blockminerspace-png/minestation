import type { SqlTransaction } from '../lib/sqlTransaction.js';

/**
 * Comissão de referral (deposit / hardware / black_market) dentro da transação activa.
 * Não falha o fluxo principal — erros só em log.
 */
export async function runReferralCommissionOnTx(
  sql: SqlTransaction,
  userId: number,
  amount: number,
  type: string
): Promise<void> {
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
      deposit_commission_percent?: number | null;
      hardware_commission_percent?: number | null;
      black_market_commission_percent?: number | null;
    }>(
      `
      SELECT m.*
      FROM referral_models m
      JOIN access_level_referral_models a ON m.id = a.referral_model_id
      WHERE a.access_level_id = $1 AND m.is_active = 1
    `,
      [alId]
    );
    const model = modelRows[0];
    if (!model) return;

    let commissionPercent = 0;
    if (type === 'deposit') commissionPercent = Number(model.deposit_commission_percent) || 0;
    else if (type === 'hardware') commissionPercent = Number(model.hardware_commission_percent) || 0;
    else if (type === 'black_market') commissionPercent = Number(model.black_market_commission_percent) || 0;

    if (commissionPercent > 0) {
      const commissionAmount = (amount * commissionPercent) / 100;
      if (commissionAmount > 0) {
        console.log(
          `[ReferralCommission] Awarding ${commissionAmount} USDC to referrer ${referrer_id} (${type} commission ${commissionPercent}%)`
        );
        await sql.execute(
          'UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2',
          [commissionAmount, referrer_id]
        );
      }
    }
  } catch (err) {
    console.error('[ReferralCommission] Error processing commission:', err);
  }
}
