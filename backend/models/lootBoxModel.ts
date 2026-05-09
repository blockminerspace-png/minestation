import { Prisma } from '@prisma/client';
import type { SqlTransaction } from '../lib/sqlTransaction.js';
import { grantAdminUpgradeRewardsInTx } from './adminUpgradeGrantModel.js';

/**
 * Sorteio de loot box:
 * - Padrão (`rollLootBoxOnce`): um único prémio; `probability` é peso relativo na roleta.
 * - Cadastro (`rollLootBoxGrantAll`): concede cada linha com `probability` > 0 (quantidade min–max por linha).
 */

const BOX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

/** Valida ID de caixa vindo da API (path/body). */
export function parseLootBoxId(raw: unknown): string | null {
  const boxId = typeof raw === 'string' ? raw.trim() : '';
  if (!boxId || boxId.length > 200 || !BOX_ID_RE.test(boxId)) return null;
  return boxId;
}

export type LootBoxItemRow = {
  item_type: string;
  item_id: string;
  min_qty: number | string | null | undefined;
  max_qty: number | string | null | undefined;
  probability: number | string | null | undefined;
};

export type LootRewardGrant = {
  type: string;
  id: string;
  qty: number;
};

export type RolledLootPayload = {
  rewards: LootRewardGrant[];
  gainedUsdc: number;
  gainedItems: Record<string, number>;
  gainedCoins: Record<string, number>;
  gainedBundles: Array<{ id: string; qty: number }>;
};

function emptyRolledLootPayload(): RolledLootPayload {
  return {
    rewards: [],
    gainedUsdc: 0,
    gainedItems: {},
    gainedCoins: {},
    gainedBundles: []
  };
}

/** Acrescenta um prémio ao payload (uma linha de `loot_box_items`, com qty aleatória em [min,max]). */
function appendLootLineGrant(payload: RolledLootPayload, chosen: LootBoxItemRow): void {
  const minQ = Math.max(0, Number(chosen.min_qty) || 0);
  const maxQ = Math.max(minQ, Number(chosen.max_qty) || minQ);
  const qty = Math.floor(Math.random() * (maxQ - minQ + 1)) + minQ;

  const itemType = String(chosen.item_type || 'item');
  const itemId = String(chosen.item_id || '');

  if (itemType === 'currency') {
    if (itemId === 'usdc') payload.gainedUsdc += qty;
    payload.rewards.push({ type: 'currency', id: itemId, qty });
  } else if (itemType === 'coin') {
    payload.gainedCoins[itemId] = (payload.gainedCoins[itemId] || 0) + qty;
    payload.rewards.push({ type: 'coin', id: itemId, qty });
  } else if (itemType === 'bundle') {
    payload.gainedBundles.push({ id: itemId, qty });
    payload.rewards.push({ type: 'bundle', id: itemId, qty });
  } else {
    payload.gainedItems[itemId] = (payload.gainedItems[itemId] || 0) + qty;
    payload.rewards.push({ type: 'item', id: itemId, qty });
  }
}

export function rollLootBoxOnce(items: LootBoxItemRow[]): RolledLootPayload {
  const payload = emptyRolledLootPayload();

  const weighted = items
    .map((it) => ({
      it,
      w: Math.max(0, Number(it.probability) || 0)
    }))
    .filter((x) => x.w > 0);

  const sumW = weighted.reduce((a, x) => a + x.w, 0);
  if (!Number.isFinite(sumW) || sumW <= 0) {
    return payload;
  }

  const r = Math.random() * sumW;
  let cum = 0;
  let chosen = weighted[weighted.length - 1]!.it;
  for (const row of weighted) {
    cum += row.w;
    if (r < cum) {
      chosen = row.it;
      break;
    }
  }

  appendLootLineGrant(payload, chosen);
  return payload;
}

/** Caixa de cadastro: todas as linhas com probabilidade > 0 entram no pacote (uma vez cada). */
export function rollLootBoxGrantAll(items: LootBoxItemRow[]): RolledLootPayload {
  const payload = emptyRolledLootPayload();
  const eligible = items.filter((it) => Math.max(0, Number(it.probability) || 0) > 0);
  for (const it of eligible) {
    appendLootLineGrant(payload, it);
  }
  return payload;
}

/** Sem linhas em `loot_box_items` OU soma de probabilidades > 0 é zero (não há sorteio válido). */
export async function isLootBoxBrokenForSafeDelete(sql: SqlTransaction, boxId: string): Promise<boolean> {
  const rows = await sql.queryRows<{ n: number; w: number }>(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(GREATEST(0, probability::double precision)), 0)::double precision AS w
     FROM loot_box_items WHERE box_id = $1`,
    [boxId]
  );
  const row = rows[0];
  if (!row) return true;
  return row.n === 0 || row.w <= 0;
}

export type LootBoxDeleteSummary = {
  lootBoxItemsRemoved: number;
  unopenedBoxesRows: number;
  playerClaimedRows: number;
  adminUpgradeBoxesRows: number;
  promoCodesCleared: number;
  referralModelsSenderCleared: number;
  referralModelsReceiverCleared: number;
  lootBoxesRemoved: number;
};

/**
 * Apaga a caixa e referências conhecidas (transação activa no `sql`).
 * Ordem respeita FK `loot_box_items` → `loot_boxes` e limpa inventários / promo / referral.
 */
export async function deleteLootBoxCascade(sql: SqlTransaction, boxId: string): Promise<LootBoxDeleteSummary> {
  const lootBoxItemsRemoved = await sql.execute('DELETE FROM loot_box_items WHERE box_id = $1', [boxId]);
  const unopenedBoxesRows = await sql.execute('DELETE FROM unopened_boxes WHERE box_id = $1', [boxId]);
  const playerClaimedRows = await sql.execute('DELETE FROM player_claimed_boxes WHERE box_id = $1', [boxId]);
  const adminUpgradeBoxesRows = await sql.execute(
    'DELETE FROM admin_upgrade_boxes WHERE box_id = $1',
    [boxId]
  );
  const promoCodesCleared = await sql.execute(
    'UPDATE promo_codes SET loot_box_id = NULL WHERE loot_box_id = $1',
    [boxId]
  );
  const referralModelsSenderCleared = await sql.execute(
    'UPDATE referral_models SET sender_loot_box_id = NULL WHERE sender_loot_box_id = $1',
    [boxId]
  );
  const referralModelsReceiverCleared = await sql.execute(
    'UPDATE referral_models SET receiver_loot_box_id = NULL WHERE receiver_loot_box_id = $1',
    [boxId]
  );
  const lootBoxesRemoved = await sql.execute('DELETE FROM loot_boxes WHERE id = $1', [boxId]);

  return {
    lootBoxItemsRemoved,
    unopenedBoxesRows,
    playerClaimedRows,
    adminUpgradeBoxesRows,
    promoCodesCleared,
    referralModelsSenderCleared,
    referralModelsReceiverCleared,
    lootBoxesRemoved
  };
}

export class LootBoxOpenError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'LootBoxOpenError';
    this.statusCode = statusCode;
  }
}

export class LootBoxBuyError extends Error {
  readonly statusCode: number;
  /** USDC em falta (opcional), para o cliente mostrar detalhe ao jogador. */
  readonly missing?: number;
  constructor(statusCode: number, message: string, opts?: { missing?: number }) {
    super(message);
    this.name = 'LootBoxBuyError';
    this.statusCode = statusCode;
    const miss = opts?.missing;
    if (typeof miss === 'number' && Number.isFinite(miss) && miss > 0) {
      this.missing = miss;
    }
  }
}

export class LootBoxDiscardError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'LootBoxDiscardError';
    this.statusCode = statusCode;
  }
}

function isLootBoxListedAsActive(isActive: number | null | undefined): boolean {
  return isActive == null || isActive === 1;
}

/**
 * Abre uma caixa (consumir 1 unidade, aplicar prémios) dentro de `prisma.$transaction`.
 */
export async function executeLootBoxOpenInTransaction(
  tx: Prisma.TransactionClient,
  args: { userId: number; boxId: string; idempotencyKey?: string | null }
): Promise<{ rewards: LootRewardGrant[]; gainedUsdc: number; boxName: string; openingId: string }> {
  const { userId, boxId } = args;
  const idemKey =
    typeof args.idempotencyKey === 'string' && args.idempotencyKey.trim()
      ? args.idempotencyKey.trim().slice(0, 128)
      : null;

  const locked = await tx.$queryRaw<Array<{ qty: number }>>`
    SELECT qty FROM unopened_boxes WHERE user_id = ${userId} AND box_id = ${boxId} FOR UPDATE
  `;
  const boxCount = locked[0];
  if (!boxCount || boxCount.qty < 1) {
    throw new LootBoxOpenError(400, 'Não tens caixas deste tipo no inventário.');
  }

  const boxDef = await tx.loot_boxes.findUnique({
    where: { id: boxId },
    select: { name: true, trigger: true }
  });
  if (!boxDef) {
    throw new LootBoxOpenError(404, 'Caixa não encontrada.');
  }

  const itemRows = await tx.loot_box_items.findMany({
    where: { box_id: boxId }
  });
  const items: LootBoxItemRow[] = itemRows.map((it) => ({
    item_type: it.item_type,
    item_id: it.item_id,
    min_qty: it.min_qty,
    max_qty: it.max_qty,
    probability: it.probability
  }));

  if (items.length === 0) {
    console.error(
      `[LootBox] Critical Error: Box ${boxId} ("${boxDef.name}") has no items configured.`
    );
    throw new LootBoxOpenError(500, 'Configuração da caixa inválida (sem itens).');
  }

  const isRegistrationBox = String(boxDef.trigger || '') === 'registration';
  const { rewards, gainedUsdc, gainedItems, gainedCoins, gainedBundles } = isRegistrationBox
    ? rollLootBoxGrantAll(items)
    : rollLootBoxOnce(items);

  if (boxCount.qty <= 1) {
    await tx.unopened_boxes.delete({
      where: { user_id_box_id: { user_id: userId, box_id: boxId } }
    });
  } else {
    await tx.unopened_boxes.update({
      where: { user_id_box_id: { user_id: userId, box_id: boxId } },
      data: { qty: { decrement: 1 } }
    });
  }

  if (gainedUsdc > 0) {
    await tx.game_states.updateMany({
      where: { user_id: userId },
      data: {
        usdc: { increment: gainedUsdc },
        usdc_bonus: { increment: gainedUsdc }
      }
    });
  }

  for (const [id, qty] of Object.entries(gainedItems)) {
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0) continue;
    await tx.stock.upsert({
      where: { user_id_item_id: { user_id: userId, item_id: id } },
      create: { user_id: userId, item_id: id, qty: q },
      update: { qty: { increment: q } }
    });
  }

  for (const [id, qty] of Object.entries(gainedCoins)) {
    const q = Number(qty);
    if (!Number.isFinite(q) || q === 0) continue;
    await tx.coin_balances.upsert({
      where: { user_id_coin_id: { user_id: userId, coin_id: id } },
      create: { user_id: userId, coin_id: id, amount: q },
      update: { amount: { increment: q } }
    });
  }

  for (const b of gainedBundles) {
    const n = Math.max(0, Math.floor(Number(b.qty)));
    for (let i = 0; i < n; i++) {
      await grantAdminUpgradeRewardsInTx(userId, b.id, tx);
    }
  }

  const opening = await tx.lucky_box_openings.create({
    data: {
      user_id: userId,
      box_id: boxId,
      rewards_json: JSON.parse(JSON.stringify(rewards)) as Prisma.InputJsonValue,
      gained_usdc: new Prisma.Decimal(String(Number.isFinite(gainedUsdc) ? gainedUsdc : 0)),
      created_at: BigInt(Date.now()),
      idempotency_key: idemKey
    },
    select: { id: true }
  });

  return { rewards, gainedUsdc, boxName: boxDef.name, openingId: opening.id };
}

/**
 * Compra de caixa na loja (`shop` / `shop_once` / `special`) dentro de `prisma.$transaction`.
 */
export async function executeLootBoxBuyInTransaction(
  tx: Prisma.TransactionClient,
  args: { userId: number; boxId: string; qty?: number }
): Promise<{ newUsdc: number; boxName: string; trigger: string; price: number; qtyPurchased: number }> {
  const { userId, boxId } = args;

  const box = await tx.loot_boxes.findUnique({ where: { id: boxId } });
  if (!box || !isLootBoxListedAsActive(box.is_active)) {
    throw new LootBoxBuyError(404, 'Caixa não encontrada.');
  }

  const trigger = String(box.trigger || '');
  if (trigger !== 'shop' && trigger !== 'shop_once' && trigger !== 'special') {
    throw new LootBoxBuyError(400, 'Esta caixa não está à venda na loja.');
  }

  const price = Number(box.price);
  if (!Number.isFinite(price) || price <= 0 || price > 1e12) {
    throw new LootBoxBuyError(400, 'Preço da caixa inválido ou não configurado para venda.');
  }

  const maxOrderRaw = box.max_per_order ?? 20;
  const maxOrder = Math.max(1, Math.min(500, Math.floor(Number(maxOrderRaw)) || 20));
  let q = Math.floor(Number(args.qty));
  if (!Number.isFinite(q) || q < 1) q = 1;
  q = Math.min(maxOrder, q);
  if (trigger === 'shop_once' && q !== 1) {
    throw new LootBoxBuyError(400, 'Esta caixa de compra única só pode ser adquirida uma unidade de cada vez.');
  }

  const itemCount = await tx.loot_box_items.count({ where: { box_id: boxId } });
  if (itemCount < 1) {
    throw new LootBoxBuyError(
      400,
      'Esta caixa não tem prémios configurados e não pode ser vendida. Contacte o suporte.'
    );
  }

  const ownedRow = await tx.unopened_boxes.findUnique({
    where: { user_id_box_id: { user_id: userId, box_id: boxId } },
    select: { qty: true }
  });
  const owned = ownedRow?.qty ?? 0;
  const maxPerUser = box.max_per_user != null ? Math.floor(Number(box.max_per_user)) : null;
  if (maxPerUser != null && Number.isFinite(maxPerUser) && maxPerUser >= 0 && owned + q > maxPerUser) {
    throw new LootBoxBuyError(422, 'Limite por jogador para esta caixa excedido.');
  }

  if (trigger === 'shop_once') {
    try {
      await tx.player_claimed_boxes.create({
        data: {
          user_id: userId,
          box_id: boxId,
          claimed_at: BigInt(Date.now())
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new LootBoxBuyError(409, 'Esta caixa de compra única já foi resgatada.');
      }
      throw e;
    }
  }

  const totalPrice = price * q;

  const gsPay = await tx.game_states.findUnique({
    where: { user_id: userId },
    select: { usdc: true }
  });
  const curRaw = Number(gsPay?.usdc);
  const curUsdc = Number.isFinite(curRaw) ? curRaw : 0;

  const nowBi = BigInt(Date.now());

  const paid = await tx.game_states.updateMany({
    where: { user_id: userId, usdc: { gte: totalPrice } },
    data: {
      usdc: { decrement: totalPrice },
      last_updated_at: nowBi,
      server_updated_at: nowBi
    }
  });
  if (paid.count === 0) {
    if (trigger === 'shop_once') {
      try {
        await tx.player_claimed_boxes.delete({
          where: { user_id_box_id: { user_id: userId, box_id: boxId } }
        });
      } catch {
        /* ignore */
      }
    }
    const missing = Math.max(0, Number((totalPrice - curUsdc).toFixed(6)));
    throw new LootBoxBuyError(422, 'Saldo USDC insuficiente.', { missing });
  }

  await tx.unopened_boxes.upsert({
    where: { user_id_box_id: { user_id: userId, box_id: boxId } },
    create: { user_id: userId, box_id: boxId, qty: q },
    update: { qty: { increment: q } }
  });

  if (box.stock != null) {
    const dec = await tx.loot_boxes.updateMany({
      where: { id: boxId, stock: { gte: q } },
      data: { stock: { decrement: q } }
    });
    if (dec.count === 0) {
      throw new LootBoxBuyError(
        409,
        'Stock esgotado ou alterado durante a compra. O saldo não foi debitado em duplicado — recarrega a loja.'
      );
    }
  }

  const gs = await tx.game_states.findUnique({
    where: { user_id: userId },
    select: { usdc: true }
  });

  return {
    newUsdc: Number(gs?.usdc ?? 0),
    boxName: box.name,
    trigger,
    price,
    qtyPurchased: q
  };
}

/**
 * Descarte de unidades de caixa no inventário dentro de `prisma.$transaction`.
 */
export async function executeLootBoxDiscardInTransaction(
  tx: Prisma.TransactionClient,
  args: { userId: number; boxId: string; qtySpec: number | 'all' }
): Promise<{ discardedQty: number; remainingQty: number; boxName: string }> {
  const { userId, boxId, qtySpec } = args;

  const locked = await tx.$queryRaw<Array<{ qty: number }>>`
    SELECT qty FROM unopened_boxes WHERE user_id = ${userId} AND box_id = ${boxId} FOR UPDATE
  `;
  const row = locked[0];
  const owned = row?.qty ?? 0;
  if (!row || owned < 1) {
    throw new LootBoxDiscardError(400, 'Não tens caixas deste tipo no inventário.');
  }

  const toRemove = qtySpec === 'all' ? owned : Math.min(qtySpec, owned);
  if (toRemove < 1) {
    throw new LootBoxDiscardError(400, 'Quantidade inválida.');
  }

  if (owned <= toRemove) {
    await tx.unopened_boxes.delete({
      where: { user_id_box_id: { user_id: userId, box_id: boxId } }
    });
  } else {
    await tx.unopened_boxes.update({
      where: { user_id_box_id: { user_id: userId, box_id: boxId } },
      data: { qty: { decrement: toRemove } }
    });
  }

  const boxRow = await tx.loot_boxes.findUnique({
    where: { id: boxId },
    select: { name: true }
  });
  const boxName = boxRow?.name || boxId;
  const remaining = owned - toRemove;

  return { discardedQty: toRemove, remainingQty: remaining, boxName };
}
