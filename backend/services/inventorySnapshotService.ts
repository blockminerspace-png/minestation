import { prisma } from '../config/prisma.js';
import {
  isStoredBatteryFullyCharged,
  type UpgradeBatteryCapacityRow
} from '../lib/batteryChargeClassification.js';

export type InventoryStoredBatteryDto = {
  id: string;
  itemId: string;
  currentCharge: number;
};

export type PlayerInventorySnapshot = {
  stock: Record<string, number>;
  storedBatteriesFull: InventoryStoredBatteryDto[];
  storedBatteriesPartial: InventoryStoredBatteryDto[];
  serverUpdatedAt: number;
};

function stockRowsToMap(rows: { item_id: string; qty: number }[]): Record<string, number> {
  const stock: Record<string, number> = {};
  for (const r of rows) {
    const id = typeof r.item_id === 'string' ? r.item_id.trim() : '';
    if (!id) continue;
    const q = Number(r.qty);
    if (!Number.isFinite(q) || q <= 0) continue;
    stock[id] = q;
  }
  return stock;
}

/**
 * Snapshot de inventário (stock + baterias em armazém) para o jogador.
 * Classificação cheia vs parcial é sempre calculada no servidor a partir da BD + catálogo `upgrades`.
 */
export async function loadPlayerInventorySnapshot(userId: number): Promise<PlayerInventorySnapshot> {
  const [stockRows, batRows, gs] = await Promise.all([
    prisma.stock.findMany({
      where: { user_id: userId },
      select: { item_id: true, qty: true }
    }),
    prisma.stored_batteries.findMany({
      where: { user_id: userId },
      select: { id: true, item_id: true, current_charge: true }
    }),
    prisma.game_states.findUnique({
      where: { user_id: userId },
      select: { last_updated_at: true, server_updated_at: true }
    })
  ]);

  const itemIds = [...new Set(batRows.map((b) => String(b.item_id || '').trim()).filter(Boolean))];
  const upgrades =
    itemIds.length === 0
      ? []
      : await prisma.upgrades.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, type: true, power_capacity: true }
        });
  const upById = new Map<string, UpgradeBatteryCapacityRow>();
  for (const u of upgrades) {
    upById.set(u.id, { type: u.type, power_capacity: u.power_capacity });
  }

  const storedBatteriesFull: InventoryStoredBatteryDto[] = [];
  const storedBatteriesPartial: InventoryStoredBatteryDto[] = [];

  for (const b of batRows) {
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    const itemId = typeof b.item_id === 'string' ? b.item_id.trim() : '';
    if (!id || !itemId) continue;
    const currentCharge = Number(b.current_charge);
    const charge = Number.isFinite(currentCharge) ? currentCharge : 0;
    const row = upById.get(itemId);
    const dto: InventoryStoredBatteryDto = { id, itemId, currentCharge: charge };
    if (isStoredBatteryFullyCharged(charge, row)) storedBatteriesFull.push(dto);
    else storedBatteriesPartial.push(dto);
  }

  const last = gs?.last_updated_at != null ? Number(gs.last_updated_at) : 0;
  const srv = gs?.server_updated_at != null ? Number(gs.server_updated_at) : 0;
  const serverUpdatedAt = Math.max(Number.isFinite(last) ? last : 0, Number.isFinite(srv) ? srv : 0);

  return {
    stock: stockRowsToMap(stockRows),
    storedBatteriesFull,
    storedBatteriesPartial,
    serverUpdatedAt
  };
}
