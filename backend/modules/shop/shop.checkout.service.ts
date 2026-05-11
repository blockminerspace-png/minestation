/**
 * Checkout da Lojinha Miner — transação atómica (preço e stock sempre na BD).
 * Extraído de `POST /api/upgrades/buy` para reutilização e `POST /api/shop/checkout`.
 */
import type { Pool } from 'pg';
import { getSettingValue } from '../../lib/settingsPrisma.js';
import { appendGameActivityLogMongo } from '../../lib/mongoLogs.js';
import { stableIntentFingerprint } from '../../lib/gameIntentIdempotencyPrisma.js';
import { walletAdvisoryLockKey64 } from '../wallet/walletLocks.js';

const ID_RE = /^[a-zA-Z0-9_.-]{1,160}$/;
const MAX_LINE_QTY = 50000;

export type HardwareCheckoutOk = {
  ok: true;
  newUsdc: number;
  totalCost: number;
  cached?: boolean;
};

export type HardwareCheckoutFail = {
  ok: false;
  status: number;
  error: string;
  missing?: number;
  code?: string;
};

export type HardwareCheckoutResult = HardwareCheckoutOk | HardwareCheckoutFail;

/** Fingerprint estável do carrinho (servidor) para `shop_checkout_idempotency.request_fingerprint`. */
export function shopCheckoutCartFingerprint(cart: Record<string, number>): string {
  const parts: Record<string, unknown> = { op: 'shop_checkout' };
  for (const id of Object.keys(cart).sort()) {
    const q = Math.floor(Number(cart[id]) || 0);
    parts[`line:${id}`] = q;
  }
  return stableIntentFingerprint(parts);
}

function validateCartShape(cart: unknown): Record<string, number> | null {
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) return null;
  const entries = Object.entries(cart as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 100) return null;
  const out: Record<string, number> = {};
  for (const [id, rawQty] of entries) {
    if (!ID_RE.test(id)) return null;
    const q = Number(rawQty);
    if (!Number.isInteger(q) || q < 1 || q > MAX_LINE_QTY) return null;
    out[id] = q;
  }
  return out;
}

export function parseHardwareCartOrError(cart: unknown): HardwareCheckoutFail | Record<string, number> {
  const parsed = validateCartShape(cart);
  if (!parsed) {
    return { ok: false, status: 400, error: 'Carrinho vazio ou inválido.' };
  }
  return parsed;
}

export async function runHardwareCheckoutTransaction(
  pool: Pool,
  uid: number,
  cart: Record<string, number>,
  opts?: { idempotencyKey?: string | null; clearCartId?: string | null }
): Promise<HardwareCheckoutResult> {
  const userId = Number(uid);
  if (!Number.isFinite(userId) || userId <= 0) {
    return { ok: false, status: 401, error: 'Sessão inválida.' };
  }

  const idemRaw = opts?.idempotencyKey != null ? String(opts.idempotencyKey).trim() : '';
  const idemKey = idemRaw.length > 128 ? idemRaw.slice(0, 128) : idemRaw;

  const client = await pool.connect();
  let idemFingerprint: string | null = null;

  try {
    await client.query('BEGIN');

    if (idemKey.length > 0) {
      const lockKey = walletAdvisoryLockKey64(userId, 'shop_checkout', idemKey);
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

      const idemRes = await client.query<{
        new_usdc: unknown;
        total_cost: unknown;
        request_fingerprint: string | null;
      }>(
        `SELECT new_usdc, total_cost, request_fingerprint FROM shop_checkout_idempotency
         WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [userId, idemKey]
      );
      const idRow = idemRes.rows[0];
      if (idRow) {
        const cartEmpty = Object.keys(cart).length === 0;
        const curFp = shopCheckoutCartFingerprint(cart);
        const stFp = String(idRow.request_fingerprint ?? '').trim();
        if (!cartEmpty && stFp && curFp !== stFp) {
          await client.query('ROLLBACK');
          console.warn(
            JSON.stringify({
              event: 'shop_checkout_idempotency_mismatch',
              userId,
              idempotencyKeyLen: idemKey.length
            })
          );
          return {
            ok: false,
            status: 409,
            error: 'Mesma chave de idempotência com pedido diferente.',
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH'
          };
        }
        await client.query('ROLLBACK');
        return {
          ok: true,
          newUsdc: Number(idRow.new_usdc),
          totalCost: Number(idRow.total_cost),
          cached: true
        };
      }
      idemFingerprint = shopCheckoutCartFingerprint(cart);
    }

    const hwVal = await getSettingValue('hardware_market_enabled');
    if (hwVal != null && hwVal !== '1') {
      await client.query('ROLLBACK');
      return { ok: false, status: 403, error: 'Mercado de hardware pausado.' };
    }

    const upgradeIds = Object.keys(cart).sort();
    if (upgradeIds.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Carrinho vazio ou inválido.' };
    }

    const upgradesRes = await client.query(
      `SELECT id, base_cost, name, sell_in_hardware_market, status, max_global_stock, total_sold,
              COALESCE(is_active, 1) AS ia, COALESCE(is_nft, 0) AS is_nft
       FROM upgrades WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [upgradeIds]
    );
    if (upgradesRes.rows.length !== upgradeIds.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Um ou mais itens do carrinho não existem.' };
    }

    const explicitHardwareRes = await client.query(
      `
      SELECT COUNT(*)::int AS n
        FROM upgrades
       WHERE COALESCE(is_active, 1) <> 0
         AND COALESCE(is_nft, 0) <> 1
         AND COALESCE(sell_in_hardware_market, 1) <> 0
         AND status NOT IN ('legacy', 'exclusive')
         AND id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
         AND COALESCE(category, '') <> 'legacy-temp'
         AND COALESCE(type, '') <> 'legacy-temp'
      `
    );
    const hasExplicitHardwareProducts = Number(explicitHardwareRes.rows[0]?.n || 0) > 0;

    let totalCost = 0;
    const itemsToBuy: Array<{ id: string; qty: number; name: string }> = [];
    const limitedItemsToUpdate: Array<{ id: string; qty: number }> = [];

    for (const [id, rawQty] of Object.entries(cart)) {
      const qty = Number(rawQty);
      const u = upgradesRes.rows.find((x: { id: string }) => x.id === id);
      if (!u) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: `Item inválido: ${id}` };
      }
      if (Number(u.ia) === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: `Item indisponível: ${u.name}` };
      }
      if (hasExplicitHardwareProducts && u.sell_in_hardware_market === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: `Item não disponível para venda: ${u.name}` };
      }
      if (Number(u.is_nft) === 1) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          status: 400,
          error:
            'Itens NFT não podem ser comprados na Lojinha com USDC. Usa os fluxos de carteira / NFT do jogo.'
        };
      }

      if (u.status === 'limited') {
        const available = (Number(u.max_global_stock) || 0) - (Number(u.total_sold) || 0);
        if (available < qty) {
          await client.query('ROLLBACK');
          return { ok: false, status: 422, error: `Estoque insuficiente para ${u.name}. Restam ${available}.` };
        }
        limitedItemsToUpdate.push({ id: u.id, qty });
      }

      const unit = Number(u.base_cost);
      if (!Number.isFinite(unit) || unit < 0 || unit > 1e12) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: 'Preço de item inválido.' };
      }
      const cost = unit * qty;
      if (!Number.isFinite(cost) || cost < 0 || cost > 1e15) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: 'Valor de compra inválido.' };
      }
      totalCost += cost;
      itemsToBuy.push({ id, qty, name: u.name });
    }

    const gsRes = await client.query('SELECT usdc FROM game_states WHERE user_id = $1 FOR UPDATE', [userId]);
    const currentUsdc = Number(gsRes.rows[0]?.usdc) || 0;
    if (currentUsdc < totalCost) {
      await client.query('ROLLBACK');
      return { ok: false, status: 422, error: 'Saldo insuficiente', missing: totalCost - currentUsdc };
    }

    const newUsdc = currentUsdc - totalCost;
    const now = Date.now();
    const deductRes = await client.query(
      `UPDATE game_states SET usdc = $1, last_updated_at = $2, server_updated_at = $2
       WHERE user_id = $3 AND usdc >= $4`,
      [newUsdc, now, userId, totalCost]
    );
    if (deductRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 422, error: 'Saldo insuficiente' };
    }

    for (const lim of limitedItemsToUpdate) {
      const updateRes = await client.query(
        `UPDATE upgrades SET total_sold = total_sold + $1
         WHERE id = $2 AND (max_global_stock - total_sold) >= $1`,
        [lim.qty, lim.id]
      );
      if (updateRes.rowCount === 0) {
        throw Object.assign(
          new Error('Este item esgotou enquanto confirmavas a compra. Atualiza a página e tenta de novo.'),
          { buyClientError: true, httpStatus: 409 }
        );
      }
    }

    for (const item of itemsToBuy) {
      await client.query(
        `INSERT INTO stock (user_id, item_id, qty) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_id) DO UPDATE SET qty = stock.qty + EXCLUDED.qty`,
        [userId, item.id, item.qty]
      );
    }

    const clearCartId = opts?.clearCartId != null ? String(opts.clearCartId).trim() : '';
    if (clearCartId) {
      await client.query('DELETE FROM shop_cart_lines WHERE cart_id = $1::uuid', [clearCartId]);
      await client.query('UPDATE shop_carts SET updated_at = $1 WHERE id = $2::uuid', [BigInt(now), clearCartId]);
    }

    if (idemKey.length > 0) {
      const fpToStore = idemFingerprint ?? shopCheckoutCartFingerprint(cart);
      await client.query(
        `INSERT INTO shop_checkout_idempotency (user_id, idempotency_key, new_usdc, total_cost, lines_json, created_at, request_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
        [userId, idemKey, newUsdc, totalCost, JSON.stringify(itemsToBuy), BigInt(now), fpToStore]
      );
    }

    await client.query('COMMIT');

    const unameRes = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
    const username = unameRes.rows[0]?.username || '';
    console.log(
      '[HardwareBuy] ts=%s userId=%s username=%s totalUsdc=%s newUsdc=%s lines=%s',
      new Date().toISOString(),
      userId,
      username,
      totalCost.toFixed(6),
      newUsdc.toFixed(6),
      JSON.stringify(itemsToBuy.map((i) => ({ id: i.id, qty: i.qty, name: i.name })))
    );
    await appendGameActivityLogMongo(userId, 'hardware_buy', {
      totalUsdc: Number(totalCost.toFixed(6)),
      newUsdc: Number(newUsdc.toFixed(6)),
      lines: itemsToBuy.map((i) => ({ id: i.id, qty: i.qty, name: i.name })),
      source: opts?.clearCartId ? 'shop_checkout' : 'upgrades_buy'
    });

    return { ok: true, newUsdc, totalCost };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    const err = e as { buyClientError?: boolean; httpStatus?: number; message?: string };
    if (err && err.buyClientError && typeof err.message === 'string') {
      return { ok: false, status: Number.isInteger(err.httpStatus) ? (err.httpStatus as number) : 409, error: err.message };
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Valida carrinho antes de abrir transação (mensagens HTTP). */
export async function assertHardwareMarketOpen(): Promise<HardwareCheckoutFail | null> {
  const hwVal = await getSettingValue('hardware_market_enabled');
  if (hwVal != null && hwVal !== '1') {
    return { ok: false, status: 403, error: 'Mercado de hardware pausado.' };
  }
  return null;
}
