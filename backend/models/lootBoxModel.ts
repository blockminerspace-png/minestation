import type { PoolClient } from 'pg';

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
export async function isLootBoxBrokenForSafeDelete(
  client: PoolClient,
  boxId: string
): Promise<boolean> {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(GREATEST(0, probability::double precision)), 0)::double precision AS w
     FROM loot_box_items WHERE box_id = $1`,
    [boxId]
  );
  const row = r.rows[0] as { n: number; w: number };
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
 * Apaga a caixa e referências conhecidas (transação deve estar aberta no `client`).
 * Ordem respeita FK `loot_box_items` → `loot_boxes` e limpa inventários / promo / referral.
 */
export async function deleteLootBoxCascade(
  client: PoolClient,
  boxId: string
): Promise<LootBoxDeleteSummary> {
  const delItems = await client.query('DELETE FROM loot_box_items WHERE box_id = $1', [boxId]);
  const delUnopened = await client.query('DELETE FROM unopened_boxes WHERE box_id = $1', [boxId]);
  const delClaimed = await client.query('DELETE FROM player_claimed_boxes WHERE box_id = $1', [
    boxId
  ]);
  const delUpgradeBoxes = await client.query(
    'DELETE FROM admin_upgrade_boxes WHERE box_id = $1',
    [boxId]
  );
  const promoUp = await client.query(
    'UPDATE promo_codes SET loot_box_id = NULL WHERE loot_box_id = $1',
    [boxId]
  );
  const refSend = await client.query(
    'UPDATE referral_models SET sender_loot_box_id = NULL WHERE sender_loot_box_id = $1',
    [boxId]
  );
  const refRecv = await client.query(
    'UPDATE referral_models SET receiver_loot_box_id = NULL WHERE receiver_loot_box_id = $1',
    [boxId]
  );
  const delBox = await client.query('DELETE FROM loot_boxes WHERE id = $1', [boxId]);

  return {
    lootBoxItemsRemoved: delItems.rowCount ?? 0,
    unopenedBoxesRows: delUnopened.rowCount ?? 0,
    playerClaimedRows: delClaimed.rowCount ?? 0,
    adminUpgradeBoxesRows: delUpgradeBoxes.rowCount ?? 0,
    promoCodesCleared: promoUp.rowCount ?? 0,
    referralModelsSenderCleared: refSend.rowCount ?? 0,
    referralModelsReceiverCleared: refRecv.rowCount ?? 0,
    lootBoxesRemoved: delBox.rowCount ?? 0
  };
}
