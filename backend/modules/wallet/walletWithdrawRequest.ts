import type { Pool, PoolClient } from 'pg';
import crypto from 'node:crypto';
import { stableIntentFingerprint } from '../../lib/gameIntentIdempotencyPrisma.js';
import { walletAdvisoryLockKey64 } from './walletLocks.js';
import { RoletaAppError } from '../../validation/roletaValidation.js';
import { getSettingValue } from '../../lib/settingsPrisma.js';
import { ensureWalletWithdrawSchema } from './walletWithdrawSchema.js';

const WITHDRAW_IDEM_SCOPE = 'withdraw_request';

export type WithdrawRequestOk = {
  ok: true;
  requestId: string;
  message: string;
  idempotentReplay?: boolean;
};

/** Fingerprint estável do pedido de saque (minerado → pedido interno, sem on-chain). */
export function withdrawRequestFingerprint(input: {
  coinId: string;
  amount: number;
  walletAddress: string;
}): string {
  const coinId = String(input.coinId || '').trim();
  const wa = String(input.walletAddress || '').trim().toLowerCase();
  const amt = Number(input.amount);
  const amtNorm = Number.isFinite(amt) ? String(Math.round(amt * 1e12) / 1e12) : 'NaN';
  return stableIntentFingerprint({
    op: 'withdraw_request',
    coinId,
    amount: amtNorm,
    walletAddress: wa
  });
}

/**
 * Configuração de um token em `web3_withdraw_tokens` (admin). Aceita variantes históricas:
 *  - `name`: pode conter `coin.symbol` (gravado pelo Web3Withdraw moderno) ou `coin.name` (legado).
 *  - `symbol`: campo opcional explícito.
 *  - `coinId`: campo opcional para emparelhar diretamente pelo id da moeda.
 *  - `disabled`: quando `true`, a config existe mas não permite saque.
 *  - `feePercent` / `minAmount` / `minWithdrawalUsdc`: parâmetros de saque.
 */
type WithdrawTokenCfg = {
  name?: string;
  symbol?: string;
  coinId?: string;
  feePercent?: number | string;
  minAmount?: number | string;
  minWithdrawalUsdc?: number | string;
  disabled?: boolean;
  contract?: string;
  payoutWallet?: string;
};

function normCompare(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

function parseWithdrawTokens(raw: string | null): WithdrawTokenCfg[] {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? (v as WithdrawTokenCfg[]) : [];
  } catch {
    return [];
  }
}

/**
 * Procura a configuração do token de forma tolerante:
 *  - case-insensitive + trim em `symbol`/`name`/`coinId`.
 *  - aceita `cfg.symbol` igual ao `coin.symbol` ou `coin.name`.
 *  - aceita `cfg.name` igual ao `coin.symbol`, `coin.name` ou `coin.id`.
 *  - aceita `cfg.coinId` igual ao `coin.id`.
 */
export function findWithdrawTokenCfg(
  tokens: WithdrawTokenCfg[],
  coin: { id?: string; symbol?: string; name?: string }
): WithdrawTokenCfg | null {
  const coinId = normCompare(coin.id);
  const coinSym = normCompare(coin.symbol);
  const coinNm = normCompare(coin.name);
  if (!coinId && !coinSym && !coinNm) return null;
  for (const t of tokens) {
    const cfgId = normCompare(t.coinId);
    const cfgSym = normCompare(t.symbol);
    const cfgNm = normCompare(t.name);
    if (coinId && cfgId === coinId) return t;
    /** Legado: `name` no JSON por vezes guarda o id da moeda. */
    if (coinId && cfgNm === coinId) return t;
    if (coinSym && (cfgSym === coinSym || cfgNm === coinSym)) return t;
    if (coinNm && (cfgNm === coinNm || cfgSym === coinNm)) return t;
  }
  return null;
}

function isEvmWalletAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || '').trim());
}

/**
 * Cria pedido de saque com idempotência (`wallet_idempotency` + lock transacional).
 * Não envia transação on-chain — só Postgres.
 */
export async function runWithdrawRequestIdempotent(
  client: PoolClient,
  args: {
    userId: number;
    coinId: string;
    amount: number;
    walletAddress: string;
    idempotencyKey: string;
    requestFingerprint: string;
    serverNowMs: number;
  }
): Promise<WithdrawRequestOk> {
  const { userId, coinId, amount, walletAddress, idempotencyKey, requestFingerprint, serverNowMs } = args;
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new RoletaAppError('Sessão inválida.', 401);
  }
  if (!coinId || typeof coinId !== 'string') {
    throw new RoletaAppError('Moeda inválida.', 400);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RoletaAppError('Valor de saque inválido.', 400);
  }
  const cleanWallet = String(walletAddress || '').trim();
  if (!cleanWallet) {
    throw new RoletaAppError('Informe uma carteira válida.', 400);
  }
  if (!isEvmWalletAddress(cleanWallet)) {
    throw new RoletaAppError('Informe uma carteira Polygon (EVM) válida (0x + 40 hex).', 400);
  }

  console.log('[Withdraw][start]', { userId, coinId, amount });

  await client.query('BEGIN');
  try {
    const lockKey = walletAdvisoryLockKey64(userId, WITHDRAW_IDEM_SCOPE, idempotencyKey);
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

    const prev = await client.query<{ response_json: string; request_fingerprint: string | null }>(
      `SELECT response_json, request_fingerprint::text AS request_fingerprint FROM wallet_idempotency
       WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3 FOR UPDATE`,
      [userId, WITHDRAW_IDEM_SCOPE, idempotencyKey]
    );
    const row0 = prev.rows[0];
    if (row0?.response_json) {
      try {
        const parsed = JSON.parse(row0.response_json) as WithdrawRequestOk;
        if (parsed && parsed.ok === true && parsed.requestId) {
          const storedFp = String(row0.request_fingerprint ?? '').trim();
          const reqFp = String(requestFingerprint ?? '').trim();
          if (storedFp && reqFp && storedFp !== reqFp) {
            console.warn('[Withdraw][error] idempotency mismatch', { userId, idempotencyKey });
            throw new RoletaAppError('Mesma chave de idempotência com pedido diferente.', 409);
          }
          await client.query('COMMIT');
          return { ...parsed, idempotentReplay: true };
        }
      } catch (e) {
        if (e instanceof RoletaAppError) throw e;
        /* continuar */
      }
    }

    const coinRes = await client.query<{ id: string; usdc_rate: string; symbol: string; name: string }>(
      'SELECT id, usdc_rate::text, symbol, name FROM mining_coins WHERE id = $1',
      [coinId]
    );
    const coin = coinRes.rows[0];
    if (!coin) {
      console.warn('[Withdraw][validation] moeda inexistente', { coinId });
      throw new RoletaAppError('Moeda não encontrada ou inativa.', 400);
    }

    const sym = coin.symbol || coin.name || coin.id;
    const usdcRate = Number(coin.usdc_rate) || 0;

    const withdrawTokensRaw = await getSettingValue('web3_withdraw_tokens');
    const withdrawTokens = parseWithdrawTokens(withdrawTokensRaw != null ? String(withdrawTokensRaw) : null);
    const tokenCfg = findWithdrawTokenCfg(withdrawTokens, coin);
    console.log('[Withdraw][config]', {
      coinId: coin.id,
      symbol: sym,
      matched: !!tokenCfg,
      disabled: !!tokenCfg?.disabled
    });

    if (!tokenCfg) {
      throw new RoletaAppError(
        `${sym} não está configurado para saque no painel administrativo.`,
        400
      );
    }
    if (tokenCfg.disabled) {
      throw new RoletaAppError(`Saques para ${sym} estão desativados no momento.`, 400);
    }

    const feePercent = Math.max(0, Math.min(100, Number(tokenCfg.feePercent) || 0));
    const feeAmount = amount * (feePercent / 100);
    const netAmount = Math.max(0, amount - feeAmount);
    const amountUsdc = amount * usdcRate;

    const minAmountRaw = Number(tokenCfg.minAmount);
    const minByCoin = Number.isFinite(minAmountRaw) && minAmountRaw > 0 ? minAmountRaw : 0;
    const minUsdcRaw = Number(tokenCfg.minWithdrawalUsdc);
    const minByUsdc =
      Number.isFinite(minUsdcRaw) && minUsdcRaw > 0 && usdcRate > 0 ? minUsdcRaw / usdcRate : 0;
    const minimumRequired = Math.max(minByCoin, minByUsdc);

    console.log('[Withdraw][validation]', {
      minimumRequired,
      minByCoin,
      minByUsdc,
      usdcRate,
      feePercent
    });

    if (minimumRequired > 0 && amount + 1e-9 < minimumRequired) {
      const minStr = minimumRequired.toLocaleString('en-US', { maximumFractionDigits: 8 });
      throw new RoletaAppError(
        `O valor mínimo para saque de ${sym} é ${minStr} ${sym} (valor bruto a debitar do saldo minerado).`,
        400
      );
    }

    const balRes = await client.query<{ amount: string }>(
      'SELECT amount::text FROM coin_balances WHERE user_id = $1 AND coin_id = $2 FOR UPDATE',
      [userId, coinId]
    );
    const balance = Number(balRes.rows[0]?.amount) || 0;
    console.log('[Withdraw][balance]', { balance, amount, coinId });

    if (balance + 1e-9 < amount) {
      const balStr = balance.toLocaleString('en-US', { maximumFractionDigits: 8 });
      throw new RoletaAppError(
        `Saldo insuficiente. Tens ${balStr} ${sym} disponível; este saque requer ${sym} em valor bruto.`,
        400
      );
    }

    const upd = await client.query(
      'UPDATE coin_balances SET amount = amount - $1 WHERE user_id = $2 AND coin_id = $3 AND amount >= $1',
      [amount, userId, coinId]
    );
    if (upd.rowCount === 0) {
      throw new RoletaAppError(
        `Saldo insuficiente. Tens ${balance.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${sym} disponível.`,
        400
      );
    }

    const requestId = crypto.randomUUID();
    await client.query(
      `INSERT INTO withdrawal_requests (id, user_id, coin_id, amount_crypto, amount_usdc, fee_amount, net_amount, wallet_address, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
      [requestId, userId, coinId, amount, amountUsdc, feeAmount, netAmount, cleanWallet, serverNowMs]
    );

    const out: WithdrawRequestOk = {
      ok: true,
      requestId,
      message: 'Solicitação de saque enviada com sucesso. O saque será confirmado em até 24 horas.'
    };

    const fp =
      requestFingerprint != null && String(requestFingerprint).trim() !== ''
        ? String(requestFingerprint).trim().slice(0, 64)
        : null;
    await client.query(
      `INSERT INTO wallet_idempotency (user_id, scope, idempotency_key, response_json, request_fingerprint, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::bigint)`,
      [userId, WITHDRAW_IDEM_SCOPE, idempotencyKey, JSON.stringify(out), fp, BigInt(serverNowMs)]
    );

    await client.query('COMMIT');
    console.log('[Withdraw][request_created]', { userId, coinId: coin.id, amount, feeAmount, netAmount, requestId });
    return out;
  } catch (e) {
    if (!(e instanceof RoletaAppError)) {
      console.error('[Withdraw][error]', e instanceof Error ? e.message : e);
    }
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * Wrapper que abre/fecha a `PoolClient`, garante o schema necessário e dispara o pedido idempotente.
 * Permite reuso entre rota legada `/api/withdraw` (server.ts) e nova `/api/wallet/withdraw`.
 */
export async function executeWithdrawRequest(
  pool: Pool,
  args: {
    userId: number;
    coinId: string;
    amount: number;
    walletAddress: string;
    idempotencyKey: string;
    serverNowMs?: number;
  }
): Promise<WithdrawRequestOk> {
  await ensureWalletWithdrawSchema(pool);
  const client = await pool.connect();
  try {
    const fp = withdrawRequestFingerprint({
      coinId: args.coinId,
      amount: args.amount,
      walletAddress: args.walletAddress
    });
    return await runWithdrawRequestIdempotent(client, {
      userId: args.userId,
      coinId: args.coinId,
      amount: args.amount,
      walletAddress: args.walletAddress,
      idempotencyKey: args.idempotencyKey,
      requestFingerprint: fp,
      serverNowMs: args.serverNowMs ?? Date.now()
    });
  } finally {
    client.release();
  }
}
