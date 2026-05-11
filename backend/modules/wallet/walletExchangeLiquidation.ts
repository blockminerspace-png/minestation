import type { PoolClient } from 'pg';
import { stableIntentFingerprint } from '../../lib/gameIntentIdempotencyPrisma.js';
import { RoletaAppError } from '../../validation/roletaValidation.js';
import { walletAdvisoryLockKey64 } from './walletLocks.js';

/** Fingerprint estável do pedido de liquidação (câmbio) para `wallet_idempotency.request_fingerprint`. */
export function walletExchangeLiquidateRequestFingerprint(input: {
  coinId: string;
  fractionMode: 'desk_shortcuts' | 'legacy';
  deskPercentagePoints?: number | null;
  legacyFraction?: number | null;
}): string {
  const coinId = String(input.coinId || '').trim();
  if (input.fractionMode === 'desk_shortcuts') {
    return stableIntentFingerprint({
      op: 'wallet_exchange_liquidate',
      coinId,
      fractionMode: input.fractionMode,
      deskPercentagePoints: input.deskPercentagePoints ?? null
    });
  }
  return stableIntentFingerprint({
    op: 'wallet_exchange_liquidate',
    coinId,
    fractionMode: input.fractionMode,
    legacyFraction: input.legacyFraction ?? null
  });
}

export type ExchangeLiquidationOk = {
  ok: true;
  soldAmount: number;
  grossUsdc: number;
  feeUsdc: number;
  netUsdc: number;
  newUsdc: number;
  newCoinBalance: number;
  idempotentReplay: boolean;
};

const DESK_SHORTCUT_FRACTIONS = new Set([0.1, 0.5, 1]);

function assertFractionAllowed(fraction: number, mode: 'desk_shortcuts' | 'legacy'): void {
  if (mode === 'desk_shortcuts') {
    if (!DESK_SHORTCUT_FRACTIONS.has(fraction)) {
      throw new RoletaAppError('Percentual inválido: use 10, 50 ou 100 (atalhos do desk).', 400);
    }
    return;
  }
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new RoletaAppError('Percentual inválido (use entre 0 e 1, ex.: 0.5).', 400);
  }
}

/**
 * Liquidação desk (saldo minerado -> USDC), transacional.
 * `fractionMode`: `desk_shortcuts` aceita só 0.1, 0.5, 1; `legacy` aceita qualquer ]0,1].
 * `idempotencyKey` opcional: quando presente, grava/replay em `wallet_idempotency` + `wallet_ledger_entries`.
 */
export async function runExchangeLiquidation(
  client: PoolClient,
  args: {
    userId: number;
    coinId: string;
    fraction: number;
    fractionMode: 'desk_shortcuts' | 'legacy';
    minUsdc: number;
    feePercent: number;
    idempotencyKey: string | null;
    idempotencyScope: string;
    serverNowMs: number;
    /** Obrigatório quando `idempotencyKey` está definido — comparação em replay (409 se diferir). */
    requestFingerprint?: string | null;
  }
): Promise<ExchangeLiquidationOk> {
  const {
    userId,
    coinId,
    fraction,
    fractionMode,
    minUsdc,
    feePercent,
    idempotencyKey,
    idempotencyScope,
    serverNowMs,
    requestFingerprint
  } =
    args;
  assertFractionAllowed(fraction, fractionMode);

  await client.query('BEGIN');
  try {
    if (idempotencyKey) {
      const lockKey = walletAdvisoryLockKey64(userId, idempotencyScope, idempotencyKey);
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

      const prev = await client.query<{ response_json: string; request_fingerprint: string | null }>(
        `SELECT response_json, request_fingerprint::text AS request_fingerprint FROM wallet_idempotency
         WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3`,
        [userId, idempotencyScope, idempotencyKey]
      );
      const row0 = prev.rows[0];
      if (row0?.response_json) {
        try {
          const parsed = JSON.parse(row0.response_json) as ExchangeLiquidationOk;
          if (parsed && parsed.ok === true) {
            const storedFp = String(row0.request_fingerprint ?? '').trim();
            const reqFp = String(requestFingerprint ?? '').trim();
            if (storedFp && reqFp && storedFp !== reqFp) {
              console.warn(
                JSON.stringify({
                  event: 'wallet_exchange_liquidate_idem_mismatch',
                  userId
                })
              );
              await client.query('ROLLBACK');
              throw new RoletaAppError('Mesma chave de idempotência com pedido diferente.', 409);
            }
            console.warn(
              JSON.stringify({
                event: 'wallet_exchange_liquidate_idem_replay',
                userId
              })
            );
            await client.query('COMMIT');
            return { ...parsed, idempotentReplay: true };
          }
        } catch (replayErr) {
          if (replayErr instanceof RoletaAppError) throw replayErr;
          /* continuar */
        }
      }

    }

    const coinRes = await client.query<{
      id: string;
      name: string;
      usdc_rate: string;
      sx: number;
      is_active: number;
    }>(
      `SELECT id, name, usdc_rate::text, COALESCE(show_in_exchange, 1) AS sx, is_active
       FROM mining_coins WHERE id = $1`,
      [coinId]
    );
    const coinDef = coinRes.rows[0];
    if (!coinDef || !coinDef.is_active) {
      throw new RoletaAppError('Moeda não encontrada ou inativa.', 404);
    }
    if (Number(coinDef.sx) === 0) {
      throw new RoletaAppError('Esta moeda não está disponível no desk de câmbio.', 422);
    }

    const rate = Number(coinDef.usdc_rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new RoletaAppError('Taxa USDC da moeda indisponível.', 500);
    }

    const balRes = await client.query<{ amount: string }>(
      'SELECT amount::text FROM coin_balances WHERE user_id = $1 AND coin_id = $2 FOR UPDATE',
      [userId, coinId]
    );
    const balance = Number(balRes.rows[0]?.amount) || 0;

    if (balance <= 0) {
      throw new RoletaAppError('Saldo insuficiente.', 422);
    }

    const sellAmount = balance * fraction;
    if (!Number.isFinite(sellAmount) || sellAmount <= 0 || sellAmount > balance + 1e-12) {
      throw new RoletaAppError('Valor de troca inválido.', 400);
    }

    const grossUsdc = sellAmount * rate;
    if (!Number.isFinite(grossUsdc) || grossUsdc < minUsdc) {
      throw new RoletaAppError(`Valor mínimo para troca é $${Number(minUsdc).toFixed(2)} USDC`, 422);
    }

    const feeAmount = grossUsdc * (feePercent / 100);
    const netUsdc = grossUsdc - feeAmount;
    if (!Number.isFinite(netUsdc) || netUsdc <= 0) {
      throw new RoletaAppError('Valor líquido inválido após taxas.', 422);
    }

    const updCoin = await client.query(
      'UPDATE coin_balances SET amount = amount - $1 WHERE user_id = $2 AND coin_id = $3 AND amount >= $1 RETURNING amount::float AS amount',
      [sellAmount, userId, coinId]
    );
    if (updCoin.rowCount === 0) {
      throw new RoletaAppError('Saldo alterado durante o pedido. Tenta novamente.', 409);
    }

    await client.query(
      'UPDATE game_states SET usdc = COALESCE(usdc::numeric, 0) + $1::numeric WHERE user_id = $2',
      [netUsdc, userId]
    );

    const nowBig = BigInt(serverNowMs);
    if (idempotencyKey) {
      try {
        await client.query(
          `INSERT INTO wallet_ledger_entries
           (user_id, entry_type, coin_id, sold_crypto, gross_usdc, fee_usdc, net_usdc, idempotency_key, created_at)
           VALUES ($1, 'exchange_liquidate', $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7, $8)`,
          [userId, coinId, String(sellAmount), String(grossUsdc), String(feeAmount), String(netUsdc), idempotencyKey, nowBig]
        );
      } catch (insErr: unknown) {
        const code = insErr && typeof insErr === 'object' && 'code' in insErr ? String((insErr as { code: string }).code) : '';
        if (code === '23505') {
          throw new RoletaAppError('Operação duplicada ou em conflito. Recarrega o estado da carteira.', 409);
        }
        throw insErr;
      }
    } else {
      await client.query(
        `INSERT INTO wallet_ledger_entries
         (user_id, entry_type, coin_id, sold_crypto, gross_usdc, fee_usdc, net_usdc, idempotency_key, created_at)
         VALUES ($1, 'exchange_liquidate', $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, NULL, $7)`,
        [userId, coinId, String(sellAmount), String(grossUsdc), String(feeAmount), String(netUsdc), nowBig]
      );
    }

    const finalGs = await client.query<{ usdc: string }>('SELECT usdc::text FROM game_states WHERE user_id = $1', [userId]);
    const finalBal = await client.query<{ amount: string }>(
      'SELECT amount::text FROM coin_balances WHERE user_id = $1 AND coin_id = $2',
      [userId, coinId]
    );

    const out: ExchangeLiquidationOk = {
      ok: true,
      soldAmount: sellAmount,
      grossUsdc,
      feeUsdc: feeAmount,
      netUsdc,
      newUsdc: Number(finalGs.rows[0]?.usdc || 0),
      newCoinBalance: Number(finalBal.rows[0]?.amount || 0),
      idempotentReplay: false
    };

    if (idempotencyKey) {
      await client.query(
        `INSERT INTO wallet_idempotency (user_id, scope, idempotency_key, response_json, request_fingerprint, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          idempotencyScope,
          idempotencyKey,
          JSON.stringify(out),
          requestFingerprint != null && String(requestFingerprint).trim() !== ''
            ? String(requestFingerprint).trim().slice(0, 64)
            : null,
          nowBig
        ]
      );
    }

    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}
