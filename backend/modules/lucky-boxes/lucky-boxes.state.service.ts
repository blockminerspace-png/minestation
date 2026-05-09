import { prisma } from '../../config/prisma.js';
import type {
  LuckyBoxInventoryEntryV1,
  LuckyBoxOpeningHistoryEntryV1,
  LuckyBoxRewardSlotPublicDto,
  LuckyBoxShopEntryV1,
  LuckyBoxesStateV1Dto
} from './lucky-boxes.types.js';

function isLootBoxActive(isActive: number | null | undefined): boolean {
  return isActive == null || isActive === 1;
}

function buildPublicSlotsFromDbItems(
  items: Array<{ item_type: string; item_id: string; min_qty: number; max_qty: number }>
): LuckyBoxRewardSlotPublicDto[] {
  return items.map((it) => {
    const t = String(it.item_type || 'item').toLowerCase();
    const id = String(it.item_id || '').trim();
    let label = id || '—';
    if (t === 'currency' && id === 'usdc') label = 'USDC';
    else if (t === 'coin') label = `Moeda ${id}`;
    else if (t === 'bundle') label = `Pacote ${id}`;
    else label = `Item ${id}`;
    const minQ = Math.max(0, Math.floor(Number(it.min_qty) || 0));
    const maxQ = Math.max(minQ, Math.floor(Number(it.max_qty) || minQ));
    const rangeText = minQ === maxQ ? `×${minQ}` : `×${minQ}–${maxQ}`;
    return { kind: t, label, rangeText };
  });
}

function rewardSummaryForBoxId(
  itemMap: Map<string, Array<{ item_type: string; item_id: string; min_qty: number; max_qty: number }>>,
  boxId: string
): { slotCount: number; slots: LuckyBoxRewardSlotPublicDto[] } {
  const rows = itemMap.get(boxId) || [];
  const slots = buildPublicSlotsFromDbItems(rows);
  return { slotCount: slots.length, slots };
}

export async function buildLuckyBoxesStateV1(userId: number): Promise<LuckyBoxesStateV1Dto> {
  const gs = await prisma.game_states.findUnique({
    where: { user_id: userId },
    select: { usdc: true }
  });
  const usdc = gs != null && Number.isFinite(Number(gs.usdc)) ? Number(gs.usdc) : 0;

  const boxes = await prisma.loot_boxes.findMany({
    orderBy: [{ is_active: 'desc' }, { trigger: 'asc' }, { name: 'asc' }, { id: 'asc' }]
  });
  const boxIds = boxes.map((b) => b.id);
  const itemRows =
    boxIds.length > 0
      ? await prisma.loot_box_items.findMany({ where: { box_id: { in: boxIds } } })
      : [];
  const itemMap = new Map<string, Array<{ item_type: string; item_id: string; min_qty: number; max_qty: number }>>();
  for (const it of itemRows) {
    const arr = itemMap.get(it.box_id) || [];
    arr.push({
      item_type: it.item_type,
      item_id: it.item_id,
      min_qty: it.min_qty,
      max_qty: it.max_qty
    });
    itemMap.set(it.box_id, arr);
  }

  const claimed = await prisma.player_claimed_boxes.findMany({
    where: { user_id: userId },
    select: { box_id: true }
  });
  const claimedSet = new Set(claimed.map((c) => c.box_id));

  const unopenedRows = await prisma.unopened_boxes.findMany({ where: { user_id: userId } });
  const unopenedMap = new Map<string, number>();
  for (const r of unopenedRows) {
    unopenedMap.set(r.box_id, r.qty);
  }

  const shop: LuckyBoxShopEntryV1[] = [];
  for (const b of boxes) {
    if (!isLootBoxActive(b.is_active)) continue;
    const trig = String(b.trigger || '').trim();
    if (trig !== 'shop' && trig !== 'shop_once' && trig !== 'special') continue;
    if (trig === 'shop_once' && claimedSet.has(b.id)) continue;
    const rs = rewardSummaryForBoxId(itemMap, b.id);
    if (rs.slotCount < 1) continue;
    const price = Number(b.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const maxPerOrder = Math.max(1, Math.min(500, Math.floor(Number(b.max_per_order) || 20)));
    const stockRemaining = b.stock != null ? Math.max(0, Math.floor(Number(b.stock))) : null;
    shop.push({
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      priceUsdc: price,
      currency: 'USDC',
      trigger: trig,
      maxPerOrder,
      stockRemaining,
      rewardSummary: rs
    });
  }

  const boxById = new Map(boxes.map((x) => [x.id, x]));
  const inventory: LuckyBoxInventoryEntryV1[] = [];
  for (const [boxId, qty] of unopenedMap.entries()) {
    if (typeof qty !== 'number' || qty < 1) continue;
    const def = boxById.get(boxId);
    const trig = String(def?.trigger || '').trim();
    if (trig === 'roleta_code') continue;
    const rs = rewardSummaryForBoxId(itemMap, boxId);
    inventory.push({
      boxId,
      qty,
      name: def?.name || boxId,
      description: def?.description || '',
      icon: def?.icon || '🎁',
      trigger: trig,
      openableHere: trig !== 'roleta_code',
      rewardSummary: rs
    });
  }
  inventory.sort((a, b) => a.name.localeCompare(b.name, 'pt'));

  let historyItems: LuckyBoxOpeningHistoryEntryV1[] = [];
  let nextCursor: string | null = null;
  try {
    const opens = await prisma.lucky_box_openings.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 31
    });
    const page = opens.slice(0, 30);
    if (opens.length > 30) nextCursor = page[page.length - 1]?.id ?? null;
    historyItems = page.map((o) => {
      const raw = o.rewards_json;
      const rewards = Array.isArray(raw)
        ? (raw as unknown[]).map((x) => {
            if (!x || typeof x !== 'object') return { type: 'unknown', id: '', qty: 0 };
            const r = x as Record<string, unknown>;
            return {
              type: typeof r.type === 'string' ? r.type : 'unknown',
              id: typeof r.id === 'string' ? r.id : '',
              qty: Math.max(0, Number(r.qty) || 0)
            };
          })
        : [];
      const boxName = boxById.get(o.box_id)?.name || o.box_id;
      return {
        id: o.id,
        at: Number(o.created_at),
        boxId: o.box_id,
        boxName,
        gainedUsdc: String(o.gained_usdc),
        rewards
      };
    });
  } catch {
    historyItems = [];
  }

  const shopEmptyMessage =
    shop.length === 0
      ? 'Nenhuma caixa disponível para compra no momento.'
      : 'Escolhe uma caixa abaixo. Preço e stock são confirmados no servidor ao comprar.';

  const dto: LuckyBoxesStateV1Dto = {
    version: 1,
    usdc,
    banner:
      shop.length === 0
        ? { text: 'Loja de caixas vazia neste momento.', variant: 'warning' }
        : null,
    promoHelp:
      'Códigos promocionais válidos são verificados no servidor (validade, limite de uso e recompensa).',
    roulettePromoNote:
      'Códigos da Roleta são tratados no menu Roleta — não precisas de os colar aqui; ao resgatar, segue para a Roleta quando aplicável.',
    shop,
    shopEmptyMessage,
    inventory,
    history: { items: historyItems, limit: 30, nextCursor }
  };
  return dto;
}

export async function getLuckyBoxOpeningForUser(
  userId: number,
  openingId: string
): Promise<LuckyBoxOpeningHistoryEntryV1 | null> {
  const id = openingId.trim();
  if (!id || id.length > 80) return null;
  const o = await prisma.lucky_box_openings.findFirst({
    where: { id, user_id: userId }
  });
  if (!o) return null;
  const boxes = await prisma.loot_boxes.findMany({ where: { id: o.box_id }, select: { name: true } });
  const boxName = boxes[0]?.name || o.box_id;
  const raw = o.rewards_json;
  const rewards = Array.isArray(raw)
    ? (raw as unknown[]).map((x) => {
        if (!x || typeof x !== 'object') return { type: 'unknown', id: '', qty: 0 };
        const r = x as Record<string, unknown>;
        return {
          type: typeof r.type === 'string' ? r.type : 'unknown',
          id: typeof r.id === 'string' ? r.id : '',
          qty: Math.max(0, Number(r.qty) || 0)
        };
      })
    : [];
  return {
    id: o.id,
    at: Number(o.created_at),
    boxId: o.box_id,
    boxName,
    gainedUsdc: String(o.gained_usdc),
    rewards
  };
}
