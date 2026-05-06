/**
 * Load/persist stock, stored batteries, and placed racks (with slots) for server-room actions.
 * Mirrors relevant blocks in server.js save-game / game-state.
 */
import type { PoolClient } from 'pg';
import {
  validateStoredBatteryWarehouseRemovalAllowed,
  StoredBatterySaveGuardError
} from './saveGameEconomyValidate.js';

export function normalizePlacedRackRoomId(raw: unknown): string {
  const s = raw != null ? String(raw).trim() : '';
  if (!s || s === 'main') return 'room_initial';
  return s;
}

export async function loadUserStock(client: PoolClient, uid: number | string): Promise<Record<string, number>> {
  const stockRes = await client.query('SELECT item_id, qty FROM stock WHERE user_id = $1', [uid]);
  const stock: Record<string, number> = {};
  stockRes.rows.forEach((r: { item_id: string; qty: number }) => {
    stock[r.item_id] = r.qty;
  });
  return stock;
}

export async function loadUserStoredBatteries(
  client: PoolClient,
  uid: number | string
): Promise<Array<{ id: string; itemId: string; currentCharge: number }>> {
  const batRes = await client.query('SELECT id, item_id, current_charge FROM stored_batteries WHERE user_id = $1', [uid]);
  return batRes.rows.map((r: { id: string; item_id: string; current_charge: number }) => ({
    id: r.id,
    itemId: r.item_id,
    currentCharge: r.current_charge
  }));
}

export type PlacedRackLoaded = {
  id: string;
  itemId: string;
  slots: string[];
  multiplierSlots: string[];
  wiringId: string | null;
  batteryId: string | null;
  currentCharge: number;
  isOn: boolean;
  selectedCoinId: string | null;
  roomId: string;
  slotIndex: number;
};

export async function loadUserPlacedRacksWithSlots(client: PoolClient, uid: number | string): Promise<PlacedRackLoaded[]> {
  const placedRacksRes = await client.query('SELECT * FROM placed_racks WHERE user_id = $1', [uid]);
  const rackRows = placedRacksRes.rows as Record<string, unknown>[];
  if (rackRows.length === 0) return [];

  const rackIds = rackRows.map((r) => String(r.id));
  const [slotsRes, multipliersRes] = await Promise.all([
    client.query(
      'SELECT rack_id, slot_index, machine_item_id FROM rack_slots WHERE rack_id = ANY($1) ORDER BY slot_index',
      [rackIds]
    ),
    client.query(
      'SELECT rack_id, slot_index, multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = ANY($1) ORDER BY slot_index',
      [rackIds]
    )
  ]);

  const slotsMap = new Map<string, string[]>();
  const multipliersMap = new Map<string, string[]>();

  slotsRes.rows.forEach((s: { rack_id: string; slot_index: number; machine_item_id: string }) => {
    if (!slotsMap.has(s.rack_id)) slotsMap.set(s.rack_id, []);
    const arr = slotsMap.get(s.rack_id)!;
    arr[s.slot_index] = s.machine_item_id;
  });

  multipliersRes.rows.forEach((m: { rack_id: string; slot_index: number; multiplier_item_id: string }) => {
    if (!multipliersMap.has(m.rack_id)) multipliersMap.set(m.rack_id, []);
    const arr = multipliersMap.get(m.rack_id)!;
    arr[m.slot_index] = m.multiplier_item_id;
  });

  const placedRacks: PlacedRackLoaded[] = [];
  for (const r of rackRows) {
    const id = String(r.id);
    placedRacks.push({
      id,
      itemId: String(r.item_id ?? ''),
      slots: slotsMap.get(id) || [],
      multiplierSlots: multipliersMap.get(id) || [],
      wiringId: (r.wiring_id as string | null) ?? null,
      batteryId: (r.battery_id as string | null) ?? null,
      currentCharge: Number(r.current_charge) || 0,
      isOn: !!r.is_on,
      selectedCoinId: (r.selected_coin_id as string | null) ?? null,
      roomId: normalizePlacedRackRoomId(r.room_id),
      slotIndex: Number(r.slot_index) || 0
    });
  }
  return placedRacks;
}

export type UpgradeWithCompat = {
  id: string;
  name: string;
  category: string;
  type: string;
  baseCost: number;
  baseProduction: number;
  powerConsumption?: number;
  powerCapacity?: number;
  multiplier?: number;
  slotsCapacity?: number;
  aiSlotsCapacity?: number;
  description: string;
  icon: string;
  status: string;
  compatibleRacks: string[];
};

export async function loadUpgradesWithCompat(client: PoolClient): Promise<UpgradeWithCompat[]> {
  const rowsRes = await client.query('SELECT * FROM upgrades');
  const compatRowsRes = await client.query('SELECT * FROM upgrade_compat_racks');
  const compatMap = compatRowsRes.rows.reduce<Record<string, string[]>>((acc, r: { upgrade_id: string; rack_id: string }) => {
    acc[r.upgrade_id] = acc[r.upgrade_id] || [];
    acc[r.upgrade_id].push(r.rack_id);
    return acc;
  }, {});
  return (rowsRes.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    category: String(r.category ?? ''),
    type: String(r.type ?? ''),
    baseCost: Number(r.base_cost) || 0,
    baseProduction: Number(r.base_production) || 0,
    powerConsumption: r.power_consumption != null ? Number(r.power_consumption) : undefined,
    powerCapacity: r.power_capacity != null ? Number(r.power_capacity) : undefined,
    multiplier: r.multiplier != null ? Number(r.multiplier) : undefined,
    slotsCapacity: r.slots_capacity != null ? Number(r.slots_capacity) : undefined,
    aiSlotsCapacity: r.ai_slots_capacity != null ? Number(r.ai_slots_capacity) : undefined,
    description: String(r.description ?? ''),
    icon: String(r.icon ?? ''),
    status: String(r.status ?? ''),
    compatibleRacks: compatMap[String(r.id)] || []
  }));
}

export type GameStateChanges = {
  stock?: Record<string, number>;
  storedBatteries?: Array<{ id: string; itemId: string; currentCharge?: number }>;
  placedRacks?: PlacedRackLoaded[];
  /** Opcional: usado pela validação de remoções seguras em `stored_batteries`. */
  workshopSlots?: unknown;
};

export type ActivityLogEntry = { action: string; meta: Record<string, unknown> };

export async function persistStockStoredBatteriesPlacedRacks(
  client: PoolClient,
  uid: number | string,
  changes: GameStateChanges,
  saveActivityLogs: ActivityLogEntry[]
): Promise<void> {
  const { stock, storedBatteries, placedRacks } = changes;

  if (storedBatteries) {
    const incomingBatIds = storedBatteries.map((b) => b.id);
    const rm = await validateStoredBatteryWarehouseRemovalAllowed(
      client,
      uid,
      incomingBatIds,
      { placedRacks: changes.placedRacks, workshopSlots: changes.workshopSlots },
      false
    );
    if (!rm.ok) {
      throw new StoredBatterySaveGuardError(rm.error);
    }
  }

  if (stock) {
    const itemIds = Object.keys(stock);
    const qtys = Object.values(stock).map((q) => q || 0);
    if (itemIds.length > 0) {
      await client.query(
        `
          INSERT INTO stock (user_id, item_id, qty) 
          SELECT $1, unnest($2::text[]), unnest($3::int[])
          ON CONFLICT (user_id, item_id) DO UPDATE SET qty = EXCLUDED.qty`,
        [uid, itemIds, qtys]
      );
    }
  }

  if (storedBatteries) {
    const incomingIds = storedBatteries.map((b) => b.id);
    if (incomingIds.length > 0) {
      await client.query('DELETE FROM stored_batteries WHERE user_id = $1 AND NOT (id = ANY($2::text[]))', [uid, incomingIds]);
    } else {
      await client.query('DELETE FROM stored_batteries WHERE user_id = $1', [uid]);
    }
    if (storedBatteries.length > 0) {
      const bIds = storedBatteries.map((b) => b.id);
      const bItemIds = storedBatteries.map((b) => b.itemId);
      const bCharges = storedBatteries.map((b) => b.currentCharge || 0);
      await client.query(
        `
          INSERT INTO stored_batteries (id, user_id, item_id, current_charge) 
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::numeric[])
          ON CONFLICT (id) DO UPDATE SET current_charge = EXCLUDED.current_charge, item_id = EXCLUDED.item_id`,
        [uid, bIds, bItemIds, bCharges]
      );
    }
  }

  if (placedRacks) {
    const ts = new Date().toISOString();
    const prevRacksRes = await client.query(
      `SELECT id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id,
              COALESCE(NULLIF(BTRIM(room_id::text), ''), 'room_initial') AS room_id, slot_index
       FROM placed_racks WHERE user_id = $1`,
      [uid]
    );
    type PrevRackRow = {
      id: string;
      item_id: string;
      wiring_id: string | null;
      battery_id: string | null;
      current_charge: number;
      is_on: number;
      selected_coin_id: string | null;
      room_id: string;
      slot_index: number;
    };
    const prevMap = new Map<string, PrevRackRow>(
      prevRacksRes.rows.map((row: PrevRackRow) => [row.id, row])
    );
    const nextIdSet = new Set(placedRacks.map((r) => r.id));

    for (const row of prevRacksRes.rows as PrevRackRow[]) {
      if (!nextIdSet.has(row.id)) {
        const [slots, multis] = await Promise.all([
          client.query('SELECT slot_index, machine_item_id FROM rack_slots WHERE rack_id = $1 ORDER BY slot_index', [row.id]),
          client.query('SELECT slot_index, multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = $1 ORDER BY slot_index', [row.id])
        ]);
        const dismantledParts = {
          chassis: row.item_id,
          wiring: row.wiring_id,
          battery: row.battery_id,
          miners: slots.rows
            .filter((s: { machine_item_id: string | null }) => s.machine_item_id)
            .map((s: { slot_index: number; machine_item_id: string }) => ({ slot: s.slot_index, id: s.machine_item_id })),
          multipliers: multis.rows
            .filter((m: { multiplier_item_id: string | null }) => m.multiplier_item_id)
            .map((m: { slot_index: number; multiplier_item_id: string }) => ({ slot: m.slot_index, id: m.multiplier_item_id }))
        };
        console.log(`[RackDismantle] ts=${ts} userId=${uid} rackId=${row.id} parts=${JSON.stringify(dismantledParts)}`);
        saveActivityLogs.push({ action: 'rack_dismantle', meta: { rackId: row.id, parts: dismantledParts } });
      }
    }
    for (const r of placedRacks) {
      if (!prevMap.has(r.id)) {
        console.log(`[RackPlace] ts=${ts} userId=${uid} rackId=${r.id} itemId=${r.itemId} room=${r.roomId ?? ''} slotIndex=${r.slotIndex ?? 0}`);
        saveActivityLogs.push({
          action: 'rack_place',
          meta: { rackId: r.id, itemId: r.itemId, room: r.roomId ?? '', slotIndex: r.slotIndex ?? 0 }
        });
      }
    }

    const prevSlotsRes = await client.query(
      `SELECT s.rack_id, s.slot_index, s.machine_item_id
       FROM rack_slots s
       INNER JOIN placed_racks pr ON pr.id = s.rack_id AND pr.user_id = $1
       ORDER BY s.rack_id, s.slot_index`,
      [uid]
    );
    const prevMultRes = await client.query(
      `SELECT s.rack_id, s.slot_index, s.multiplier_item_id
       FROM rack_multiplier_slots s
       INNER JOIN placed_racks pr ON pr.id = s.rack_id AND pr.user_id = $1
       ORDER BY s.rack_id, s.slot_index`,
      [uid]
    );
    const prevMachSig = (rackId: string) =>
      prevSlotsRes.rows
        .filter((x: { rack_id: string }) => x.rack_id === rackId)
        .sort((a: { slot_index: number }, b: { slot_index: number }) => a.slot_index - b.slot_index)
        .map((x: { machine_item_id: string | null }) => String(x.machine_item_id || ''))
        .join('|');
    const prevMultiSig = (rackId: string) =>
      prevMultRes.rows
        .filter((x: { rack_id: string }) => x.rack_id === rackId)
        .sort((a: { slot_index: number }, b: { slot_index: number }) => a.slot_index - b.slot_index)
        .map((x: { multiplier_item_id: string | null }) => String(x.multiplier_item_id || ''))
        .join('|');
    let miningUpdateLogs = 0;
    for (const r of placedRacks) {
      if (!prevMap.has(r.id)) continue;
      const prow = prevMap.get(r.id);
      if (!prow) continue;
      const changed: string[] = [];
      if (String(prow.item_id || '') !== String(r.itemId || '')) changed.push('chassis');
      if (String(prow.wiring_id || '') !== String(r.wiringId || '')) changed.push('wiring');
      if (String(prow.battery_id || '') !== String(r.batteryId || '')) changed.push('battery');
      if (Number(prow.is_on) !== (r.isOn ? 1 : 0)) changed.push('power');
      if (Number(prow.current_charge || 0) !== Number(r.currentCharge || 0)) changed.push('charge');
      if (String(prow.selected_coin_id || '') !== String(r.selectedCoinId || '')) changed.push('coin');
      if (String(prow.room_id || '') !== String(normalizePlacedRackRoomId(r.roomId))) changed.push('room');
      if (Number(prow.slot_index || 0) !== Number(r.slotIndex || 0)) changed.push('slot');
      const nextMach = Array.isArray(r.slots) ? r.slots.map((x) => String(x || '')).join('|') : '';
      const nextMult = Array.isArray(r.multiplierSlots) ? r.multiplierSlots.map((x) => String(x || '')).join('|') : '';
      if (prevMachSig(r.id) !== nextMach) changed.push('miners');
      if (prevMultiSig(r.id) !== nextMult) changed.push('multipliers');
      if (changed.length > 0 && miningUpdateLogs < 48) {
        saveActivityLogs.push({ action: 'mining_rack_update', meta: { rackId: r.id, changed } });
        miningUpdateLogs++;
      }
    }

    const currentRackIds = placedRacks.map((r) => r.id);
    if (currentRackIds.length > 0) {
      const removedRacksQuery = 'SELECT id FROM placed_racks WHERE user_id = $1 AND NOT (id = ANY($2::text[]))';
      await client.query(`DELETE FROM rack_slots WHERE rack_id IN (${removedRacksQuery})`, [uid, currentRackIds]);
      await client.query(`DELETE FROM rack_multiplier_slots WHERE rack_id IN (${removedRacksQuery})`, [uid, currentRackIds]);
      await client.query('DELETE FROM placed_racks WHERE user_id = $1 AND NOT (id = ANY($2::text[]))', [uid, currentRackIds]);
    } else {
      await client.query('DELETE FROM rack_slots WHERE rack_id IN (SELECT id FROM placed_racks WHERE user_id = $1)', [uid]);
      await client.query('DELETE FROM rack_multiplier_slots WHERE rack_id IN (SELECT id FROM placed_racks WHERE user_id = $1)', [uid]);
      await client.query('DELETE FROM placed_racks WHERE user_id = $1', [uid]);
    }

    if (placedRacks.length > 0) {
      const rIds = placedRacks.map((r) => r.id);
      const rItems = placedRacks.map((r) => r.itemId);
      const rWirings = placedRacks.map((r) => r.wiringId || null);
      const rBatteries = placedRacks.map((r) => r.batteryId || null);
      const rCharges = placedRacks.map((r) => r.currentCharge || 0);
      const rOns = placedRacks.map((r) => (r.isOn ? 1 : 0));
      const rCoins = placedRacks.map((r) => r.selectedCoinId || null);
      const rRooms = placedRacks.map((r) => normalizePlacedRackRoomId(r.roomId));
      const rSlotIdxs = placedRacks.map((r) => r.slotIndex || 0);

      await client.query(
        `
          INSERT INTO placed_racks (id, user_id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id, room_id, slot_index)
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::text[]), unnest($5::text[]), unnest($6::numeric[]), unnest($7::int[]), unnest($8::text[]), unnest($9::text[]), unnest($10::int[])
          ON CONFLICT (id) DO UPDATE SET
            item_id = EXCLUDED.item_id, wiring_id = EXCLUDED.wiring_id, battery_id = EXCLUDED.battery_id,
            current_charge = EXCLUDED.current_charge, is_on = EXCLUDED.is_on, selected_coin_id = EXCLUDED.selected_coin_id,
            room_id = EXCLUDED.room_id, slot_index = EXCLUDED.slot_index`,
        [uid, rIds, rItems, rWirings, rBatteries, rCharges, rOns, rCoins, rRooms, rSlotIdxs]
      );

      await client.query('DELETE FROM rack_slots WHERE rack_id = ANY($1)', [rIds]);
      await client.query('DELETE FROM rack_multiplier_slots WHERE rack_id = ANY($1)', [rIds]);

      const allSlotsRackId: string[] = [];
      const allSlotsIdx: number[] = [];
      const allSlotsItem: string[] = [];

      const allMultiRackId: string[] = [];
      const allMultiIdx: number[] = [];
      const allMultiItem: string[] = [];

      for (const r of placedRacks) {
        if (r.slots) {
          for (let i = 0; i < r.slots.length; i++) {
            if (r.slots[i]) {
              allSlotsRackId.push(r.id);
              allSlotsIdx.push(i);
              allSlotsItem.push(String(r.slots[i]));
            }
          }
        }
        if (r.multiplierSlots) {
          for (let i = 0; i < r.multiplierSlots.length; i++) {
            if (r.multiplierSlots[i]) {
              allMultiRackId.push(r.id);
              allMultiIdx.push(i);
              allMultiItem.push(String(r.multiplierSlots[i]));
            }
          }
        }
      }

      if (allSlotsRackId.length > 0) {
        await client.query(
          `INSERT INTO rack_slots (rack_id, slot_index, machine_item_id) SELECT unnest($1::text[]), unnest($2::int[]), unnest($3::text[])`,
          [allSlotsRackId, allSlotsIdx, allSlotsItem]
        );
      }
      if (allMultiRackId.length > 0) {
        await client.query(
          `INSERT INTO rack_multiplier_slots (rack_id, slot_index, multiplier_item_id) SELECT unnest($1::text[]), unnest($2::int[]), unnest($3::text[])`,
          [allMultiRackId, allMultiIdx, allMultiItem]
        );
      }
    }
  }
}
