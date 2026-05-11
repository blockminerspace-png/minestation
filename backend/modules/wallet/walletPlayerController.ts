import type { Express, Request, RequestHandler, Response } from 'express';
import pool from '../../config/db.js';
import { getSettingsRecord } from '../../lib/settingsPrisma.js';
import { parseIdempotencyKey, RoletaAppError } from '../../validation/roletaValidation.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { runExchangeLiquidation, walletExchangeLiquidateRequestFingerprint } from './walletExchangeLiquidation.js';
import { parseDeskLiquidationPercentagePoints } from './walletDeskPercent.js';

export type WalletPlayerDeps = {
  authenticateToken: RequestHandler;
  appendGameActivityLog: (
    q: unknown,
    userId: number,
    action: string,
    meta: unknown
  ) => Promise<void>;
};

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const COIN_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

export async function buildWalletStatePayload(userId: number): Promise<Record<string, unknown>> {
  const exSet = await getSettingsRecord(['exchange_min_usdc', 'exchange_fee_percent', 'web3_withdraw_tokens']);
  const minUsdc = Math.max(0, Number(exSet.exchange_min_usdc)) || 0.1;
  const feePercent = Math.max(0, Math.min(100, Number(exSet.exchange_fee_percent) || 0));

  let withdrawTokens: unknown[] = [];
  try {
    const raw = exSet.web3_withdraw_tokens;
    if (raw) withdrawTokens = JSON.parse(String(raw)) as unknown[];
  } catch {
    withdrawTokens = [];
  }

  const client = await pool.connect();
  try {
    const u = await client.query<{ polygon_wallet: string | null }>(
      'SELECT polygon_wallet FROM users WHERE id = $1',
      [userId]
    );
    const gs = await client.query<{ usdc: string }>('SELECT usdc::text FROM game_states WHERE user_id = $1', [userId]);
    const coins = await client.query<{
      id: string;
      name: string;
      symbol: string;
      usdc_rate: string;
      sx: number;
      amount: string | null;
    }>(
      `SELECT c.id, c.name, c.symbol, c.usdc_rate::text,
              COALESCE(c.show_in_exchange, 1) AS sx,
              b.amount::text AS amount
       FROM mining_coins c
       LEFT JOIN coin_balances b ON b.coin_id = c.id AND b.user_id = $1
       WHERE c.is_active = 1
       ORDER BY c.name ASC`,
      [userId]
    );

    const led = await client.query(
      `SELECT id::text, coin_id, sold_crypto::text, gross_usdc::text, fee_usdc::text, net_usdc::text, created_at::text, entry_type
       FROM wallet_ledger_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [userId]
    );

    const wd = await client.query(
      `SELECT id::text, coin_id, amount_crypto::text, fee_amount::text, net_amount::text, status, wallet_address,
              tx_hash, created_at::text
       FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );

    const minedBalances = coins.rows.map((r) => {
      const bal = Number(r.amount || 0) || 0;
      const rate = Number(r.usdc_rate) || 0;
      const gross = bal * rate;
      const fee = gross * (feePercent / 100);
      const net = gross - fee;
      return {
        coinId: r.id,
        name: r.name,
        symbol: r.symbol,
        usdcRate: rate,
        showInExchange: Number(r.sx) !== 0,
        minedBalance: bal,
        grossUsdcEstimate: gross,
        feeUsdcEstimate: fee,
        netUsdcEstimate: net
      };
    });

    return {
      ok: true,
      usdcBalance: Number(gs.rows[0]?.usdc || 0),
      polygonWallet: u.rows[0]?.polygon_wallet ?? null,
      exchange: {
        minUsdc,
        feePercent,
        networkUsdcHint: 'Polygon'
      },
      minedBalances,
      withdrawTokens,
      ledger: led.rows,
      withdrawals: wd.rows,
      notice:
        'Valores de taxa, mínimos e saldos são calculados no servidor. Não envies montantes confiáveis como verdade absoluta.'
    };
  } finally {
    client.release();
  }
}

export function registerWalletPlayerRoutes(app: Express, deps: WalletPlayerDeps): void {
  const { authenticateToken, appendGameActivityLog } = deps;

  app.get('/api/wallet/state', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      const payload = await buildWalletStatePayload(userId);
      return res.json(payload);
    } catch (e) {
      console.error('[wallet/state]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/wallet/state', e, 'Erro interno.');
    }
  });

  app.get('/api/wallet/history', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    const lim = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
    const client = await pool.connect();
    try {
      const led = await client.query(
        `SELECT id::text, coin_id, sold_crypto::text, gross_usdc::text, fee_usdc::text, net_usdc::text, created_at::text, entry_type
         FROM wallet_ledger_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, lim]
      );
      const wd = await client.query(
        `SELECT id::text, coin_id, amount_crypto::text, fee_amount::text, net_amount::text, status, created_at::text
         FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, lim]
      );
      return res.json({ ok: true, ledger: led.rows, withdrawals: wd.rows });
    } catch (e) {
      console.error('[wallet/history]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/wallet/history', e, 'Erro interno.');
    } finally {
      client.release();
    }
  });

  app.post('/api/wallet/exchange/liquidate', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    const body = req.body as Record<string, unknown>;
    const idem = parseIdempotencyKey(body.idempotencyKey);
    if (!idem) {
      return res.status(400).json({ error: 'idempotencyKey inválido ou ausente (8–128 caracteres seguros).' });
    }
    const mode = String(body.mode || '').toUpperCase();
    if (mode !== 'PERCENTAGE') {
      return res.status(400).json({ error: 'Modo inválido: use mode PERCENTAGE.' });
    }
    const pct = parseDeskLiquidationPercentagePoints(body.percentage);
    if (pct == null) {
      return res.status(400).json({ error: 'percentage deve ser 10, 50 ou 100.' });
    }
    const fraction = pct / 100;
    const coinId = typeof body.coinId === 'string' ? body.coinId.trim() : '';
    if (!coinId || !COIN_ID_RE.test(coinId)) {
      return res.status(400).json({ error: 'Moeda inválida.' });
    }

    const exSet = await getSettingsRecord(['exchange_min_usdc', 'exchange_fee_percent']);
    const minUsdc = Math.max(0, Number(exSet.exchange_min_usdc)) || 0.1;
    const feePercent = Math.max(0, Math.min(100, Number(exSet.exchange_fee_percent) || 0));
    const serverNowMs = Date.now();

    const client = await pool.connect();
    try {
      const requestFingerprint = walletExchangeLiquidateRequestFingerprint({
        coinId,
        fractionMode: 'desk_shortcuts',
        deskPercentagePoints: pct
      });
      const result = await runExchangeLiquidation(client, {
        userId,
        coinId,
        fraction,
        fractionMode: 'desk_shortcuts',
        minUsdc,
        feePercent,
        idempotencyKey: idem,
        idempotencyScope: 'wallet_exchange_liquidate',
        serverNowMs,
        requestFingerprint
      });

      if (!result.idempotentReplay) {
        await appendGameActivityLog(null, userId, 'wallet_exchange_liquidate', {
          coinId,
          percentagePoints: pct,
          soldAmount: result.soldAmount,
          netUsdc: result.netUsdc,
          serverAtMs: serverNowMs
        });
      }

      return res.json({
        ok: true,
        soldAmount: result.soldAmount,
        netUsdc: result.netUsdc,
        feeUsdc: result.feeUsdc,
        grossUsdc: result.grossUsdc,
        newUsdc: result.newUsdc,
        newCoinBalance: result.newCoinBalance,
        idempotentReplay: result.idempotentReplay
      });
    } catch (e) {
      if (e instanceof RoletaAppError) {
        if (e.statusCode === 409 && e.message.includes('idempotência')) {
          return res.status(409).json({
            error: e.message,
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            forceReload: true
          });
        }
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[wallet/exchange/liquidate]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/wallet/exchange/liquidate', e, 'Erro interno.');
    } finally {
      client.release();
    }
  });
}
