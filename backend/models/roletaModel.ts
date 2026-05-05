import type { Pool, PoolClient } from 'pg';
import crypto from 'node:crypto';
import { RoletaAppError, sanitizeDisplayName } from '../validation/roletaValidation.js';
import { promoCodeRowEligibleForRoletaFlow, throwIfPromoCodeExpired } from './promoCodeRoleta.js';

export type WheelPrizeRow = {
  id: string;
  label: string;
  weight: number;
  color: string | null;
  item_id: string;
};

type PgQueryable = Pick<Pool, 'query'>;

/** `label` exibido: nome atual do upgrade quando `item_id` existe; senão etiqueta em `wheel_prizes`. */
function mapWheelPrizeJoinedRow(row: Record<string, unknown>): WheelPrizeRow {
  const un = row.upgrade_name;
  const live =
    un != null && typeof un === 'string' && String(un).trim().length > 0 ? String(un).trim() : null;
  const stored = row.stored_label != null ? String(row.stored_label) : String(row.label ?? '');
  return {
    id: String(row.id ?? ''),
    label: live ?? stored,
    weight: Number(row.weight),
    color: row.color != null ? String(row.color) : null,
    item_id: row.item_id != null ? String(row.item_id) : ''
  };
}

export async function queryAllWheelPrizesJoined(q: PgQueryable): Promise<WheelPrizeRow[]> {
  const prizesRes = await q.query(
    `SELECT wp.id,
            wp.label AS stored_label,
            wp.weight,
            wp.color,
            wp.item_id,
            u.name AS upgrade_name
     FROM wheel_prizes wp
     LEFT JOIN upgrades u ON u.id = wp.item_id
     ORDER BY wp.id ASC`
  );
  return prizesRes.rows.map((r) => mapWheelPrizeJoinedRow(r as Record<string, unknown>));
}

export async function queryWheelPrizeByItemIdJoined(
  q: PgQueryable,
  itemId: string
): Promise<WheelPrizeRow | null> {
  const prizeRes = await q.query(
    `SELECT wp.id,
            wp.label AS stored_label,
            wp.weight,
            wp.color,
            wp.item_id,
            u.name AS upgrade_name
     FROM wheel_prizes wp
     LEFT JOIN upgrades u ON u.id = wp.item_id
     WHERE wp.item_id = $1
     LIMIT 1`,
    [itemId]
  );
  const r = prizeRes.rows[0];
  return r ? mapWheelPrizeJoinedRow(r as Record<string, unknown>) : null;
}

/** Resposta JSON de `/api/wheel/config` e GET admin (camelCase). */
export async function fetchWheelPrizesForApiConfig(q: PgQueryable): Promise<
  Array<{ id: string; label: string; color: string | null; weight: number; itemId: string }>
> {
  const rows = await queryAllWheelPrizesJoined(q);
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    color: row.color,
    weight: row.weight,
    itemId: row.item_id
  }));
}

function assertFinitePositiveWeight(w: unknown): number {
  const n = typeof w === 'number' ? w : Number(w);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Sorteio ponderado determinístico no servidor; `prizes` já validados não vazios. */
export function pickWeightedPrize(prizes: WheelPrizeRow[]): WheelPrizeRow {
  const weights = prizes.map((p) => assertFinitePositiveWeight(p.weight));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    throw new RoletaAppError('Configuração da roleta inválida (pesos).', 500);
  }
  let r = Math.random() * total;
  for (let i = 0; i < prizes.length; i++) {
    const w = weights[i]!;
    if (r < w) return prizes[i]!;
    r -= w;
  }
  return prizes[prizes.length - 1]!;
}

export type WheelRollResult = {
  wonItemId: string;
  item: WheelPrizeRow | null;
  /** true quando já existia `won_item_id` (repetição do endpoint). */
  idempotent: boolean;
};

/** Giro pago (USDC): cobrança fixa por giro; `newUsdc` é o saldo após cobrar ou o atual em replay idempotente. */
export type PaidWheelRollResult = {
  wonItemId: string;
  item: WheelPrizeRow | null;
  idempotent: boolean;
  newUsdc: number;
  chargedUsdc: number;
};

export const PAID_WHEEL_SPIN_PRICE_USDC = 1;

/**
 * Cria ou reutiliza caixa `roleta_reward` e incrementa `unopened_boxes` (mesma lógica do resgate por código).
 * Não altera `promo_code_redemptions`.
 */
export async function grantWheelPrizeUnopenedBox(
  client: PoolClient,
  userId: number,
  wonItemId: string
): Promise<RoletaClaimResult> {
  const boxRes = await client.query(
    `SELECT id FROM loot_boxes
     WHERE trigger = 'roleta_reward' AND description = $1`,
    [`reward_for_${wonItemId}`]
  );

  let prizeBoxId: string;
  if (boxRes.rows[0]) {
    prizeBoxId = (boxRes.rows[0] as { id: string }).id;
  } else {
    prizeBoxId = crypto.randomUUID();
    const upgRes = await client.query(`SELECT name FROM upgrades WHERE id = $1`, [wonItemId]);
    const rawName = (upgRes.rows[0] as { name?: string } | undefined)?.name ?? wonItemId;
    const itemName = sanitizeDisplayName(String(rawName), 120);
    const boxName = `Prêmio: ${itemName}`;

    await client.query(
      `INSERT INTO loot_boxes (id, name, description, price, trigger, icon)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [prizeBoxId, boxName, `reward_for_${wonItemId}`, 0, 'roleta_reward', '🎁']
    );

    await client.query(
      `INSERT INTO loot_box_items (box_id, item_type, item_id, min_qty, max_qty, probability)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [prizeBoxId, 'item', wonItemId, 1, 1, 100]
    );
  }

  const boxNameRow = await client.query(`SELECT name FROM loot_boxes WHERE id = $1`, [prizeBoxId]);
  const boxName = sanitizeDisplayName(
    String((boxNameRow.rows[0] as { name?: string } | undefined)?.name ?? 'Prêmio'),
    200
  );

  await client.query(
    `INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1`,
    [userId, prizeBoxId]
  );

  return { boxId: prizeBoxId, boxName };
}

/**
 * Exige transação ativa. Bloqueia linha de resgate (`FOR UPDATE`) para evitar corrida em roll/claim.
 */
export async function wheelRollInTransaction(
  client: PoolClient,
  args: { userId: number; normalizedCode: string; serverNowMs: number }
): Promise<WheelRollResult> {
  const { userId, normalizedCode, serverNowMs } = args;

  const redRes = await client.query(
    `SELECT reward_granted, won_item_id
     FROM promo_code_redemptions
     WHERE code = $1 AND user_id = $2
     FOR UPDATE`,
    [normalizedCode, userId]
  );

  if (redRes.rowCount === 0) {
    throw new RoletaAppError('Você precisa resgatar o código primeiro.', 400);
  }

  const redemption = redRes.rows[0] as {
    reward_granted: number;
    won_item_id: string | null;
  };

  if (redemption.reward_granted === 1) {
    throw new RoletaAppError('Este código já foi totalmente utilizado.', 400);
  }

  const promoRowRes = await client.query(
    `SELECT type, loot_box_id, expires_at FROM promo_codes WHERE code = $1`,
    [normalizedCode]
  );
  const prow = promoRowRes.rows[0] as { type?: string; loot_box_id?: string | null; expires_at?: unknown } | undefined;
  if (prow) throwIfPromoCodeExpired(prow, serverNowMs);
  const wheelOk = prow ? await promoCodeRowEligibleForRoletaFlow(client, prow) : false;
  if (!wheelOk) {
    throw new RoletaAppError('Este código não permite giro de roleta.', 400);
  }

  if (redemption.won_item_id) {
    const item = await queryWheelPrizeByItemIdJoined(client, String(redemption.won_item_id));
    return { wonItemId: String(redemption.won_item_id), item, idempotent: true };
  }

  const prizes = await queryAllWheelPrizesJoined(client);
  if (prizes.length === 0) {
    throw new RoletaAppError('Configuração da roleta não encontrada.', 500);
  }

  const selected = pickWeightedPrize(prizes);

  const upd = await client.query(
    `UPDATE promo_code_redemptions
     SET won_item_id = $1, roulette_rolled_at = $2
     WHERE code = $3 AND user_id = $4
       AND won_item_id IS NULL
       AND reward_granted = 0`,
    [selected.item_id, serverNowMs, normalizedCode, userId]
  );

  if (upd.rowCount === 0) {
    const again = await client.query(
      `SELECT won_item_id FROM promo_code_redemptions WHERE code = $1 AND user_id = $2`,
      [normalizedCode, userId]
    );
    const wid = again.rows[0]?.won_item_id;
    if (wid) {
      const item = await queryWheelPrizeByItemIdJoined(client, String(wid));
      return { wonItemId: String(wid), item, idempotent: true };
    }
    throw new RoletaAppError('Não foi possível registrar o giro. Tente novamente.', 409);
  }

  return { wonItemId: selected.item_id, item: selected, idempotent: false };
}

export type RoletaClaimResult = {
  boxId: string;
  boxName: string;
};

export async function roletaClaimInTransaction(
  client: PoolClient,
  args: {
    userId: number;
    normalizedCode: string;
    wonItemId: string;
    serverNowMs: number;
  }
): Promise<RoletaClaimResult> {
  const { userId, normalizedCode, wonItemId, serverNowMs } = args;

  const redRes = await client.query(
    `SELECT reward_granted, won_item_id
     FROM promo_code_redemptions
     WHERE code = $1 AND user_id = $2
     FOR UPDATE`,
    [normalizedCode, userId]
  );

  if (redRes.rowCount === 0) {
    throw new RoletaAppError('Código não resgatado.', 400);
  }

  const redemption = redRes.rows[0] as {
    reward_granted: number;
    won_item_id: string | null;
  };

  if (redemption.reward_granted === 1) {
    throw new RoletaAppError('Recompensa já reivindicada.', 400);
  }
  if (!redemption.won_item_id) {
    throw new RoletaAppError('Você precisa girar a roleta primeiro.', 400);
  }

  if (String(redemption.won_item_id) !== String(wonItemId)) {
    throw new RoletaAppError(
      'Integridade do sorteio violada. O item reivindicado não corresponde ao sorteado.',
      403
    );
  }

  const codeRes = await client.query(
    `SELECT type, loot_box_id, expires_at FROM promo_codes WHERE code = $1`,
    [normalizedCode]
  );
  const promo = codeRes.rows[0] as { type?: string; loot_box_id?: string | null; expires_at?: unknown } | undefined;
  if (promo) throwIfPromoCodeExpired(promo, serverNowMs);
  const claimOk = promo ? await promoCodeRowEligibleForRoletaFlow(client, promo) : false;
  if (!claimOk) {
    throw new RoletaAppError('Tipo de código inválido.', 400);
  }

  const granted = await grantWheelPrizeUnopenedBox(client, userId, wonItemId);

  const upd = await client.query(
    `UPDATE promo_code_redemptions
     SET reward_granted = 1, roulette_claimed_at = $1
     WHERE code = $2 AND user_id = $3 AND reward_granted = 0`,
    [serverNowMs, normalizedCode, userId]
  );

  if (upd.rowCount === 0) {
    throw new RoletaAppError('Falha ao finalizar resgate do código (nenhuma linha atualizada).', 409);
  }

  return granted;
}

/**
 * Giro pago: cobra USDC em `game_states`, regista prémio pendente até `paidWheelClaimInTransaction`.
 * No máximo um giro pendente por jogador (repetir POST devolve o mesmo resultado sem cobrar de novo).
 */
export async function paidWheelRollInTransaction(
  client: PoolClient,
  args: { userId: number; serverNowMs: number }
): Promise<PaidWheelRollResult> {
  const { userId, serverNowMs } = args;
  const price = PAID_WHEEL_SPIN_PRICE_USDC;

  /** `game_states` primeiro: serializa giros pagos do mesmo jogador e evita cobrança dupla. */
  const gsRes = await client.query(
    'SELECT usdc FROM game_states WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  const gs = gsRes.rows[0] as { usdc?: unknown } | undefined;
  if (!gs) {
    throw new RoletaAppError('Estado de jogo não encontrado.', 400);
  }

  const pendRes = await client.query(
    `SELECT won_item_id FROM wheel_paid_pending WHERE user_id = $1 FOR UPDATE`,
    [userId]
  );
  const existingWon = pendRes.rows[0]?.won_item_id as string | undefined;
  if (existingWon) {
    const newUsdc = Number(gs.usdc) || 0;
    const item = await queryWheelPrizeByItemIdJoined(client, String(existingWon));
    return {
      wonItemId: String(existingWon),
      item,
      idempotent: true,
      newUsdc,
      chargedUsdc: 0
    };
  }

  const bal = Number(gs.usdc) || 0;
  if (bal < price) {
    throw new RoletaAppError('Saldo USDC insuficiente (mínimo US$1,00 por giro).', 400);
  }

  const payRes = await client.query(
    `UPDATE game_states SET usdc = usdc - $1, last_updated_at = $2, server_updated_at = $2
     WHERE user_id = $3 AND usdc >= $1 RETURNING usdc`,
    [price, serverNowMs, userId]
  );
  if (payRes.rowCount === 0) {
    throw new RoletaAppError('Saldo USDC insuficiente (mínimo US$1,00 por giro).', 400);
  }

  const prizes = await queryAllWheelPrizesJoined(client);
  if (prizes.length === 0) {
    throw new RoletaAppError('Configuração da roleta não encontrada.', 500);
  }
  const selected = pickWeightedPrize(prizes);

  await client.query(
    `INSERT INTO wheel_paid_pending (user_id, won_item_id, charged_usdc, rolled_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, selected.item_id, price, serverNowMs]
  );

  const newUsdc = Number((payRes.rows[0] as { usdc?: unknown }).usdc) || 0;
  return {
    wonItemId: selected.item_id,
    item: selected,
    idempotent: false,
    newUsdc,
    chargedUsdc: price
  };
}

export async function paidWheelClaimInTransaction(
  client: PoolClient,
  args: { userId: number; wonItemId: string }
): Promise<RoletaClaimResult> {
  const { userId, wonItemId } = args;

  const pendRes = await client.query(
    `SELECT won_item_id FROM wheel_paid_pending WHERE user_id = $1 FOR UPDATE`,
    [userId]
  );
  if (pendRes.rowCount === 0) {
    throw new RoletaAppError('Não há prémio pendente. Gire a roleta paga primeiro.', 400);
  }
  const rowWon = String((pendRes.rows[0] as { won_item_id?: string }).won_item_id || '');
  if (rowWon !== String(wonItemId)) {
    throw new RoletaAppError(
      'Integridade do sorteio violada. O item reivindicado não corresponde ao sorteado.',
      403
    );
  }

  const granted = await grantWheelPrizeUnopenedBox(client, userId, wonItemId);

  const del = await client.query(`DELETE FROM wheel_paid_pending WHERE user_id = $1`, [userId]);
  if (del.rowCount === 0) {
    throw new RoletaAppError('Estado da roleta paga alterado. Recarregue a página.', 409);
  }

  return granted;
}
