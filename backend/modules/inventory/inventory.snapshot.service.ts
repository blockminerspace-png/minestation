/**
 * Fonte de verdade do inventário (stock + baterias em armazém, fora de oficina/rack).
 */
import type { Pool } from 'pg';
import { prisma } from '../../config/prisma.js';
import { computeProgressForUser } from '../../cron/miningProgressComputer.js';
import {
  isStoredBatteryFullyCharged,
  resolveBatteryNominalCapacityWh,
  type UpgradeBatteryCapacityRow
} from '../batteries/batteries.charge.js';
import type {
  InventoryBatteryInstanceDto,
  InventoryStackableCategoryDto,
  InventoryStackableRowDto,
  InventoryStateV1Dto,
  PlayerInventorySnapshot
} from './inventory.types.js';
import { shouldExposeBatteryInInventoryWarehouse } from '../batteries/batteryInvariant.service.js';

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

/** Ordenação de categorias alinhada ao `InventoryView` (frontend). */
export function sortInventoryCategoryKeys(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    if (a === 'Infraestrutura') return -1;
    if (b === 'Infraestrutura') return 1;
    if (a === 'Energia & Cabeamento') return -1;
    if (b === 'Energia & Cabeamento') return 1;
    return a.localeCompare(b);
  });
}

function parseLegacyOriginalIdFromDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = String(description).match(/original=([^\s]+)\s+email=/);
  const id = m?.[1]?.trim();
  return id || null;
}

type UpgradeSelect = {
  id: string;
  name: string;
  category: string;
  type: string;
  description: string;
  icon: string;
  image: string | null;
  base_production: number | null;
  power_consumption: number | null;
  power_capacity: number | null;
  slots_capacity: number | null;
  ai_slots_capacity: number | null;
  is_nft: number | null;
};

function mapUpgradeToStackRow(
  stockKey: string,
  qty: number,
  u: UpgradeSelect
): InventoryStackableRowDto {
  return {
    stockKey,
    catalogItemId: u.id,
    displayQuantity: qty,
    availableQuantity: qty,
    name: u.name || stockKey,
    description: u.description || '',
    category: u.category || 'Outros',
    type: u.type || 'other',
    image: u.image != null ? String(u.image) : null,
    icon: u.icon || '',
    baseProduction: Number(u.base_production ?? 0) || 0,
    powerConsumption: Number(u.power_consumption ?? 0) || 0,
    powerCapacity: Number(u.power_capacity ?? 0) || 0,
    slotsCapacity: Number(u.slots_capacity ?? 0) || 0,
    aiSlotsCapacity: Number(u.ai_slots_capacity ?? 0) || 0,
    isNft: !!u.is_nft
  };
}

/**
 * Resolve linha de catálogo para uma chave de stock (incl. legacy-temp → original).
 */
export async function resolveStackableRowsForStock(
  stock: Record<string, number>,
  upgradeById: Map<string, UpgradeSelect>
): Promise<InventoryStackableRowDto[]> {
  const rows: InventoryStackableRowDto[] = [];
  for (const [stockKey, qty] of Object.entries(stock)) {
    if (!(qty > 0)) continue;
    let u = upgradeById.get(stockKey);
    if (!u) continue;
    const isLegacy =
      u.category === 'legacy-temp' && (u.type as string) === 'legacy-temp' && u.description
        ? true
        : false;
    if (isLegacy) {
      const origId = parseLegacyOriginalIdFromDescription(u.description);
      const real = origId ? upgradeById.get(origId) : undefined;
      if (real?.name) {
        const base = mapUpgradeToStackRow(stockKey, qty, real);
        rows.push({ ...base, stockKey, catalogItemId: real.id });
        continue;
      }
    }
    rows.push(mapUpgradeToStackRow(stockKey, qty, u));
  }
  return rows;
}

export function groupStackablesByCategory(rows: InventoryStackableRowDto[]): InventoryStackableCategoryDto[] {
  const byCat = new Map<string, InventoryStackableRowDto[]>();
  for (const r of rows) {
    const c = r.category || 'Outros';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(r);
  }
  const keys = sortInventoryCategoryKeys([...byCat.keys()]);
  return keys.map((category) => ({ category, items: byCat.get(category) || [] }));
}

function publicRefFromInstanceId(id: string): string {
  const t = String(id || '').trim();
  if (t.length >= 8) return t.slice(0, 8).toLowerCase();
  return t.slice(0, 6) || '—';
}

function batteryDtoFromRow(
  b: {
    id: string;
    item_id: string;
    current_charge: number;
    power_capacity_wh: number | null;
    display_name: string | null;
    image_url: string | null;
  },
  upRow: UpgradeBatteryCapacityRow | undefined
): InventoryBatteryInstanceDto {
  const id = String(b.id || '').trim();
  const itemId = String(b.item_id || '').trim();
  const charge = Number.isFinite(Number(b.current_charge)) ? Number(b.current_charge) : 0;
  const capWh =
    b.power_capacity_wh != null && Number.isFinite(Number(b.power_capacity_wh))
      ? Number(b.power_capacity_wh)
      : null;
  const nominal = resolveBatteryNominalCapacityWh(upRow);
  let chargePercent = 0;
  if (nominal === -1) chargePercent = 100;
  else if (nominal != null && nominal > 0) chargePercent = Math.min(100, (charge / nominal) * 100);
  const isFull = isStoredBatteryFullyCharged(charge, upRow);
  return {
    id,
    itemId,
    currentCharge: charge,
    powerCapacityWh: capWh,
    displayName: b.display_name != null ? String(b.display_name) : null,
    imageUrl: b.image_url != null ? String(b.image_url) : null,
    chargePercent: Math.round(chargePercent * 10) / 10,
    publicRef: publicRefFromInstanceId(id),
    isFull
  };
}

/**
 * Snapshot legado usado por `GET /api/inventory/me` (contrato estável).
 */
export async function loadPlayerInventorySnapshot(pool: Pool, userId: number): Promise<PlayerInventorySnapshot> {
  const state = await buildInventoryStateV1(pool, userId);
  return {
    stock: state.stock,
    storedBatteriesFull: state.fullChargeBatteries.map((x) => ({
      id: x.id,
      itemId: x.itemId,
      currentCharge: x.currentCharge
    })),
    storedBatteriesPartial: state.partialChargeBatteries.map((x) => ({
      id: x.id,
      itemId: x.itemId,
      currentCharge: x.currentCharge
    })),
    serverUpdatedAt: state.serverUpdatedAt
  };
}

/**
 * Estado consolidado para `GET /api/inventory/state`.
 * Aplica o mesmo tick de mineração/carga que `GET /api/game-state` (BD como fonte de verdade).
 */
export async function buildInventoryStateV1(pool: Pool, userId: number): Promise<InventoryStateV1Dto> {
  const progressRes = await computeProgressForUser(pool, userId, Date.now());
  if (!progressRes.ok) {
    console.warn(
      '[inventory/state] computeProgressForUser falhou uid=%s — snapshot pode estar ligeiramente atrás neste pedido',
      userId
    );
  }

  const rackBattRows = await prisma.placed_racks.findMany({
    where: { user_id: userId },
    select: { battery_id: true }
  });
  const mountedBatteryIds = [
    ...new Set(
      rackBattRows
        .map((r) => (r.battery_id != null ? String(r.battery_id).trim() : ''))
        .filter((id) => id.length > 0)
    )
  ];
  const mountedSet = new Set(mountedBatteryIds);

  const [stockRows, batRowsRaw, gs] = await Promise.all([
    prisma.stock.findMany({
      where: { user_id: userId },
      select: { item_id: true, qty: true }
    }),
    prisma.stored_batteries.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        item_id: true,
        current_charge: true,
        power_capacity_wh: true,
        display_name: true,
        image_url: true,
        status: true,
        location: true,
        rack_id: true,
        slot_id: true,
        room_id: true,
        workshop_slot_index: true,
        workshop_component_slot_id: true
      }
    }),
    prisma.game_states.findUnique({
      where: { user_id: userId },
      select: { last_updated_at: true, server_updated_at: true }
    })
  ]);

  const stock = stockRowsToMap(stockRows);
  const stockKeys = Object.keys(stock);
  const batItemIds = [...new Set(batRowsRaw.map((b) => String(b.item_id || '').trim()).filter(Boolean))];
  const allUpgradeIds = [...new Set([...stockKeys, ...batItemIds])];

  const upgrades =
    allUpgradeIds.length === 0
      ? []
      : await prisma.upgrades.findMany({
          where: { id: { in: allUpgradeIds } },
          select: {
            id: true,
            name: true,
            category: true,
            type: true,
            description: true,
            icon: true,
            image: true,
            base_production: true,
            power_consumption: true,
            power_capacity: true,
            slots_capacity: true,
            ai_slots_capacity: true,
            is_nft: true
          }
        });

  const upgradeById = new Map<string, UpgradeSelect>();
  for (const u of upgrades) upgradeById.set(u.id, u);

  const upByIdForCharge = new Map<string, UpgradeBatteryCapacityRow>();
  for (const u of upgrades) {
    upByIdForCharge.set(u.id, { type: u.type, power_capacity: u.power_capacity });
  }

  const partialChargeBatteries: InventoryBatteryInstanceDto[] = [];
  const fullChargeBatteries: InventoryBatteryInstanceDto[] = [];

  for (const b of batRowsRaw) {
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    const itemId = typeof b.item_id === 'string' ? b.item_id.trim() : '';
    if (!id || !itemId) continue;
    const expose = shouldExposeBatteryInInventoryWarehouse(
      {
        id,
        status: b.status != null ? String(b.status) : null,
        location: b.location != null ? String(b.location) : null,
        rack_id: b.rack_id != null ? String(b.rack_id) : null,
        slot_id: b.slot_id != null ? Number(b.slot_id) : null,
        room_id: b.room_id != null ? String(b.room_id) : null,
        workshop_slot_index: b.workshop_slot_index != null ? Number(b.workshop_slot_index) : null,
        workshop_component_slot_id:
          b.workshop_component_slot_id != null ? String(b.workshop_component_slot_id) : null
      },
      mountedSet
    );
    if (!expose.ok) {
      if (expose.event === 'inventory_state_battery_divergence' || expose.event === 'inventory_state_battery_blocked') {
        console.warn(
          JSON.stringify({
            event: expose.event,
            userId,
            batteryId: id.slice(0, 12),
            reason: expose.reason,
            onRack: mountedSet.has(id)
          })
        );
      }
      continue;
    }
    const dto = batteryDtoFromRow(b, upByIdForCharge.get(itemId));
    if (dto.isFull) fullChargeBatteries.push(dto);
    else partialChargeBatteries.push(dto);
  }

  const stackRows = await resolveStackableRowsForStock(stock, upgradeById);
  const stackableCategories = groupStackablesByCategory(stackRows);

  const last = gs?.last_updated_at != null ? Number(gs.last_updated_at) : 0;
  const srv = gs?.server_updated_at != null ? Number(gs.server_updated_at) : 0;
  const serverUpdatedAt = Math.max(Number.isFinite(last) ? last : 0, Number.isFinite(srv) ? srv : 0);

  return {
    version: 1,
    serverUpdatedAt,
    stateVersion: serverUpdatedAt,
    stock,
    partialChargeBatteries,
    fullChargeBatteries,
    stackableCategories
  };
}
