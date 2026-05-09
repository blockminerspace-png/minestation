import { prisma } from '../config/prisma.js';
import { miningRuntimeStats } from '../cron/miningRuntimeStats.js';
import { normalizePlacedRackRoomId } from '../modules/batteries/batteries.validation.js';
import {
  CALCULATOR_PROJECTION_PERIODS,
  type CalculatorRackForProjection,
  type CalculatorUpgradeLite,
  computeDailyEarnings,
  computeUserHashByCoinId,
  effectiveNetworkHashrateForCoin
} from '../lib/playerCalculatorProjection.js';

const SCOPE_TOTAL = 'total';
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_.-]{1,120}$/;

export type PlayerCalculatorCoinRow = { label: string; coins: number; usd: number };

export type PlayerCalculatorCoinPayload = {
  id: string;
  symbol: string;
  name: string;
  priceUSD: number;
  networkHashrate: number;
  blockReward: number;
  blockTime: number;
  userPowerHps: number;
  dailyCoins: number;
  dailyUsd: number;
  projection30Usd: number;
  rows: PlayerCalculatorCoinRow[];
};

export type PlayerCalculatorScopeOption = { id: string; name: string };

export type PlayerCalculatorSnapshot = {
  scope: string;
  scopesUi: PlayerCalculatorScopeOption[];
  coins: PlayerCalculatorCoinPayload[];
};

export class PlayerCalculatorScopeError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'PlayerCalculatorScopeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function parseScope(raw: string | undefined): string {
  if (raw == null) return SCOPE_TOTAL;
  const t = String(raw).trim();
  if (!t || t.toLowerCase() === SCOPE_TOTAL) return SCOPE_TOTAL;
  if (!ROOM_ID_PATTERN.test(t)) {
    throw new PlayerCalculatorScopeError(422, 'INVALID_SCOPE', 'Parâmetro scope inválido.');
  }
  return normalizePlacedRackRoomId(t);
}

function sortRoomIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    if (a === 'room_initial') return -1;
    if (b === 'room_initial') return 1;
    return a.localeCompare(b);
  });
}

function buildSlotsArray(
  rackId: string,
  rows: { rack_id: string; slot_index: number; machine_item_id: string | null }[]
): (string | null)[] {
  const mine = rows.filter((r) => r.rack_id === rackId).sort((a, b) => a.slot_index - b.slot_index);
  if (mine.length === 0) return [];
  const max = mine.reduce((m, r) => Math.max(m, r.slot_index), 0);
  const arr: (string | null)[] = Array(max + 1).fill(null);
  for (const r of mine) {
    arr[r.slot_index] = r.machine_item_id != null ? String(r.machine_item_id) : null;
  }
  return arr;
}

function buildMultiplierArray(
  rackId: string,
  rows: { rack_id: string; slot_index: number; multiplier_item_id: string | null }[]
): (string | null)[] {
  const mine = rows.filter((r) => r.rack_id === rackId).sort((a, b) => a.slot_index - b.slot_index);
  if (mine.length === 0) return [];
  const max = mine.reduce((m, r) => Math.max(m, r.slot_index), 0);
  const arr: (string | null)[] = Array(max + 1).fill(null);
  for (const r of mine) {
    arr[r.slot_index] = r.multiplier_item_id != null ? String(r.multiplier_item_id) : null;
  }
  return arr;
}

/**
 * Snapshot servidor-autoritativo da calculadora (hashrates, ganhos diários, projeções).
 * `userId` deve vir sempre da sessão; `scope` só pode ser `total` ou sala pertencente ao jogador.
 */
export async function loadPlayerCalculatorSnapshot(
  userId: number,
  scopeQuery: string | undefined
): Promise<PlayerCalculatorSnapshot> {
  const scope = parseScope(scopeQuery);

  const [ownedRooms, rackRows] = await Promise.all([
    prisma.user_rig_rooms.findMany({
      where: { user_id: userId },
      select: { room_id: true }
    }),
    prisma.placed_racks.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        item_id: true,
        wiring_id: true,
        battery_id: true,
        current_charge: true,
        is_on: true,
        selected_coin_id: true,
        room_id: true
      }
    })
  ]);

  const ownedSet = new Set(ownedRooms.map((r) => normalizePlacedRackRoomId(r.room_id)));

  if (scope !== SCOPE_TOTAL) {
    const scopeNorm = normalizePlacedRackRoomId(scope);
    const hasRack = rackRows.some((r) => normalizePlacedRackRoomId(r.room_id) === scopeNorm);
    const ownsRoom = ownedSet.has(scopeNorm);
    if (!hasRack && !ownsRoom) {
      throw new PlayerCalculatorScopeError(403, 'FORBIDDEN_SCOPE', 'Sem acesso a esta sala.');
    }
  }

  const rackIds = rackRows.map((r) => r.id);
  const distinctRooms = sortRoomIds([
    ...new Set(rackRows.map((r) => normalizePlacedRackRoomId(r.room_id)).filter(Boolean))
  ]);

  const [slotRows, multRows, miningCoins, rigRoomMeta] = await Promise.all([
    rackIds.length === 0
      ? Promise.resolve([] as { rack_id: string; slot_index: number; machine_item_id: string | null }[])
      : prisma.rack_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, slot_index: true, machine_item_id: true }
        }),
    rackIds.length === 0
      ? Promise.resolve([] as { rack_id: string; slot_index: number; multiplier_item_id: string | null }[])
      : prisma.rack_multiplier_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, slot_index: true, multiplier_item_id: true }
        }),
    prisma.mining_coins.findMany({
      where: { is_active: 1 },
      select: {
        id: true,
        name: true,
        symbol: true,
        network_hashrate: true,
        block_reward: true,
        block_time: true,
        price_usd: true
      },
      orderBy: { name: 'asc' }
    }),
    distinctRooms.length === 0
      ? Promise.resolve([] as { id: string; name: string }[])
      : prisma.rig_rooms.findMany({
          where: { id: { in: distinctRooms }, is_active: 1 },
          select: { id: true, name: true }
        })
  ]);

  const rigNameById = new Map(rigRoomMeta.map((r) => [r.id, String(r.name || r.id)]));

  const upgradeIds = new Set<string>();
  for (const r of rackRows) {
    if (r.item_id) upgradeIds.add(String(r.item_id));
    if (r.wiring_id) upgradeIds.add(String(r.wiring_id));
    if (r.battery_id) upgradeIds.add(String(r.battery_id));
  }
  for (const s of slotRows) {
    if (s.machine_item_id) upgradeIds.add(String(s.machine_item_id));
  }
  for (const m of multRows) {
    if (m.multiplier_item_id) upgradeIds.add(String(m.multiplier_item_id));
  }

  const upgrades =
    upgradeIds.size === 0
      ? []
      : await prisma.upgrades.findMany({
          where: { id: { in: [...upgradeIds] } },
          select: {
            id: true,
            type: true,
            base_production: true,
            multiplier: true,
            power_capacity: true
          }
        });

  const upgradesById = new Map<string, CalculatorUpgradeLite>();
  for (const u of upgrades) {
    upgradesById.set(u.id, {
      id: u.id,
      type: String(u.type || ''),
      baseProduction: Number(u.base_production) || 0,
      multiplier: u.multiplier != null ? Number(u.multiplier) : null,
      powerCapacity: u.power_capacity != null ? Number(u.power_capacity) : null
    });
  }

  const racks: CalculatorRackForProjection[] = rackRows.map((r) => ({
    roomId: r.room_id != null ? String(r.room_id) : null,
    wiringId: r.wiring_id != null ? String(r.wiring_id) : null,
    batteryId: r.battery_id != null ? String(r.battery_id) : null,
    currentCharge: Number(r.current_charge) || 0,
    isOn: Number(r.is_on) !== 0,
    selectedCoinId: r.selected_coin_id != null ? String(r.selected_coin_id) : null,
    slots: buildSlotsArray(r.id, slotRows),
    multiplierSlots: buildMultiplierArray(r.id, multRows)
  }));

  const scopesUi: PlayerCalculatorScopeOption[] = [
    { id: SCOPE_TOTAL, name: 'Poder Total' },
    ...distinctRooms.map((rid) => ({
      id: rid,
      name: rigNameById.get(rid) || (rid === 'room_initial' ? 'Sala Principal' : rid)
    }))
  ];

  const runtime = miningRuntimeStats.globalNetworkHashrates;
  const powerByCoin = computeUserHashByCoinId(racks, upgradesById, scope);

  const coins: PlayerCalculatorCoinPayload[] = miningCoins.map((c) => {
    const id = String(c.id);
    const userPowerHps = powerByCoin[id] || 0;
    const netEff = effectiveNetworkHashrateForCoin(id, Number(c.network_hashrate) || 0, runtime);
    const blockTime = Number(c.block_time) || 0;
    const blockReward = Number(c.block_reward) || 0;
    const priceUSD = Number(c.price_usd) || 0;
    const { dailyCoins, dailyUsd } = computeDailyEarnings(userPowerHps, blockTime, netEff, blockReward, priceUSD);
    const rows: PlayerCalculatorCoinRow[] = CALCULATOR_PROJECTION_PERIODS.map((p) => ({
      label: p.label,
      coins: dailyCoins * p.multiplier,
      usd: dailyUsd * p.multiplier
    }));
    return {
      id,
      symbol: String(c.symbol || c.name || id),
      name: String(c.name || id),
      priceUSD,
      networkHashrate: netEff,
      blockReward,
      blockTime,
      userPowerHps,
      dailyCoins,
      dailyUsd,
      projection30Usd: dailyUsd * 30,
      rows
    };
  });

  return { scope, scopesUi, coins };
}
