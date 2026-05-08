import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import {
  batteryIdLooksLikePhysicalInstanceUuid,
  workshopDbRowInstanceToCatalog
} from './batteryInstanceResolve.js';

function num(v: unknown, def = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : def;
}

export type UpgradeRow = { base: number; mult: number; cap: number | null };

function parsePowerCapacity(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw === -1 ? -1 : num(raw);
  const s = String(raw).trim();
  if (s === '-1') return -1;
  return num(s);
}

/** Catálogo `upgrades` muda raramente; evita leitura completa a cada tick do WS (por jogador). */
const UPGRADES_CATALOG_CACHE_TTL_MS = Math.min(
  600_000,
  Math.max(15_000, parseInt(String(process.env.UPGRADES_SNAPSHOT_CACHE_TTL_MS || '60000'), 10) || 60_000)
);

let upgradesCatalogCache: { map: Map<string, UpgradeRow>; expiresAt: number } | null = null;

/** Só para testes (Vitest); invalida cache entre casos. */
export function resetUpgradesCatalogCacheForTests(): void {
  upgradesCatalogCache = null;
}

async function loadUpgradesCatalogMap(): Promise<Map<string, UpgradeRow>> {
  const now = Date.now();
  if (upgradesCatalogCache && upgradesCatalogCache.expiresAt > now) {
    return upgradesCatalogCache.map;
  }
  const upRows = await prisma.upgrades.findMany({
    select: {
      id: true,
      base_production: true,
      multiplier: true,
      power_capacity: true
    }
  });
  const upgrades = new Map<string, UpgradeRow>();
  for (const u of upRows) {
    const cap = parsePowerCapacity(u.power_capacity);
    upgrades.set(String(u.id), {
      base: num(u.base_production),
      mult: num(u.multiplier),
      cap
    });
  }
  upgradesCatalogCache = { map: upgrades, expiresAt: now + UPGRADES_CATALOG_CACHE_TTL_MS };
  return upgrades;
}

export type PlayerGameHeaderPayload = {
  coinBalances: Record<string, number>;
  usdc: number;
  hashByCoinId: Record<string, number>;
  totalHash: number;
  serverUpdatedAt: number;
};

/**
 * Saldos USDC/moedas e hashrate por moeda + total, a partir da BD (alinhado ao cálculo de produção do cliente).
 */
export async function computePlayerGameHeaderSnapshot(userId: number): Promise<PlayerGameHeaderPayload> {
  const gs = await prisma.game_states.findUnique({
    where: { user_id: userId },
    select: { usdc: true, server_updated_at: true }
  });
  if (!gs) {
    return {
      coinBalances: {},
      usdc: 0,
      hashByCoinId: {},
      totalHash: 0,
      serverUpdatedAt: Date.now()
    };
  }
  const usdc = num(gs.usdc);
  const su = gs.server_updated_at;
  const serverUpdatedAt = su == null ? Date.now() : Number(su) || Date.now();

  const balRows = await prisma.coin_balances.findMany({
    where: { user_id: userId },
    select: { coin_id: true, amount: true }
  });
  const coinBalances: Record<string, number> = {};
  for (const row of balRows) {
    coinBalances[String(row.coin_id)] = num(row.amount);
  }

  const upgrades = await loadUpgradesCatalogMap();

  const [racksRows, storedBatRows] = await Promise.all([
    prisma.placed_racks.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        is_on: true,
        wiring_id: true,
        battery_id: true,
        current_charge: true,
        selected_coin_id: true
      }
    }),
    prisma.stored_batteries.findMany({
      where: { user_id: userId },
      select: { id: true, item_id: true }
    })
  ]);
  const storedBatteryIdToItem = new Map<string, string>();
  for (const sb of storedBatRows) {
    storedBatteryIdToItem.set(String(sb.id), String(sb.item_id));
  }

  const workshopInstanceToCatalog = new Map<string, string>();
  const wsRows = await prisma.workshop_slots.findMany({
    where: { user_id: userId },
    select: { internal_state: true, slot_item_ids: true }
  });
  for (const w of wsRows) {
    const m = workshopDbRowInstanceToCatalog(w.internal_state, w.slot_item_ids);
    for (const [inst, cat] of m) workshopInstanceToCatalog.set(inst, cat);
  }

  const instanceIdsForHistory = [
    ...new Set(
      racksRows
        .map((r) => (r.battery_id ? String(r.battery_id).trim() : ''))
        .filter(
          (id) =>
            id.length > 0 &&
            batteryIdLooksLikePhysicalInstanceUuid(id) &&
            !storedBatteryIdToItem.has(id) &&
            !workshopInstanceToCatalog.has(id)
        )
    )
  ];
  const historyInstanceToItem = new Map<string, string>();
  if (instanceIdsForHistory.length > 0) {
    const hRows = await prisma.$queryRaw<Array<{ iid: string; item_id: string }>>(
      Prisma.sql`
        SELECT DISTINCT ON (ch.battery_instance_id)
          ch.battery_instance_id::text AS iid,
          ch.battery_item_id::text AS item_id
        FROM charging_history ch
        INNER JOIN users u ON lower(trim(u.email::text)) = lower(trim(ch.user_email::text))
        WHERE u.id = ${userId}
          AND ch.battery_instance_id IN (${Prisma.join(instanceIdsForHistory)})
          AND ch.battery_item_id IS NOT NULL
          AND BTRIM(ch.battery_item_id::text) <> ''
        ORDER BY ch.battery_instance_id, ch.timestamp DESC
      `
    );
    for (const row of hRows) {
      if (row.iid && row.item_id) historyInstanceToItem.set(String(row.iid), String(row.item_id));
    }
  }

  const rackIds = racksRows.map((r) => String(r.id));
  const slotsMap = new Map<string, string[]>();
  const multiMap = new Map<string, string[]>();
  if (rackIds.length > 0) {
    const slots = await prisma.rack_slots.findMany({
      where: { rack_id: { in: rackIds } },
      orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }],
      select: { rack_id: true, slot_index: true, machine_item_id: true }
    });
    for (const s of slots) {
      const rid = String(s.rack_id);
      if (!slotsMap.has(rid)) slotsMap.set(rid, []);
      const arr = slotsMap.get(rid)!;
      const idx = Math.max(0, Math.floor(num(s.slot_index, 0)));
      while (arr.length <= idx) arr.push('');
      arr[idx] = s.machine_item_id ? String(s.machine_item_id) : '';
    }
    const mults = await prisma.rack_multiplier_slots.findMany({
      where: { rack_id: { in: rackIds } },
      orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }],
      select: { rack_id: true, slot_index: true, multiplier_item_id: true }
    });
    for (const m of mults) {
      const rid = String(m.rack_id);
      if (!multiMap.has(rid)) multiMap.set(rid, []);
      const arr = multiMap.get(rid)!;
      const idx = Math.max(0, Math.floor(num(m.slot_index, 0)));
      while (arr.length <= idx) arr.push('');
      arr[idx] = m.multiplier_item_id ? String(m.multiplier_item_id) : '';
    }
  }

  const hashByCoinId: Record<string, number> = {};
  let totalHash = 0;

  for (const r of racksRows) {
    const isOn = Number(r.is_on) === 1;
    const wiringId = r.wiring_id ? String(r.wiring_id).trim() : '';
    const batteryIdRaw = r.battery_id ? String(r.battery_id).trim() : '';
    const batteryUpgradeId = batteryIdRaw
      ? storedBatteryIdToItem.get(batteryIdRaw) ||
          workshopInstanceToCatalog.get(batteryIdRaw) ||
          historyInstanceToItem.get(batteryIdRaw) ||
          (batteryIdLooksLikePhysicalInstanceUuid(batteryIdRaw) ? '' : batteryIdRaw)
      : '';
    const charge = num(r.current_charge);
    const selectedCoinId = r.selected_coin_id ? String(r.selected_coin_id).trim() : '';

    const batt = batteryUpgradeId ? upgrades.get(batteryUpgradeId) : undefined;
    if (!batt) continue;
    const isInfinite = batt.cap === -1;
    if (!isOn || !wiringId || !batteryIdRaw || (!isInfinite && charge <= 0)) continue;
    if (!selectedCoinId) continue;

    const rid = String(r.id);
    const slots = slotsMap.get(rid) || [];
    let rackBaseProd = 0;
    for (const sid of slots) {
      if (!sid) continue;
      const up = upgrades.get(sid);
      if (up) rackBaseProd += up.base;
    }
    let multFactor = 1;
    for (const sid of multiMap.get(rid) || []) {
      if (!sid) continue;
      const up = upgrades.get(sid);
      if (up && up.mult) multFactor += up.mult;
    }
    const power = rackBaseProd * multFactor;
    if (!Number.isFinite(power) || power <= 0) continue;

    hashByCoinId[selectedCoinId] = (hashByCoinId[selectedCoinId] || 0) + power;
    totalHash += power;
  }

  return { coinBalances, usdc, hashByCoinId, totalHash, serverUpdatedAt };
}
