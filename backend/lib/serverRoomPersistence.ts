/**
 * Load/persist stock, stored batteries, and placed racks (with slots) for server-room actions.
 * Mirrors relevant blocks in server.js save-game / game-state.
 */
import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  validateStoredBatteryWarehouseRemovalAllowed,
  sanitizeStoredBatteriesForSavePayload,
  StoredBatterySaveGuardError
} from './saveGameEconomyValidate.js';
import {
  buildRackBatteryPersistSnapshot,
  collectMountedBatteryInstanceIdsFromPlacedRacks,
  fetchBatteryUpgradeRowsByIds,
  isRackBatteryInstanceUuid,
  loadStoredBatteryRowsForIds,
  type PrevPlacedRackBattRow,
  type StoredBatteryRowSnap
} from './batteryPersistHelpers.js';

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
): Promise<
  Array<{
    id: string;
    itemId: string;
    currentCharge: number;
    powerCapacityWh?: number | null;
    displayName?: string | null;
    imageUrl?: string | null;
  }>
> {
  const batRes = await client.query(
    'SELECT id, item_id, current_charge, power_capacity_wh, display_name, image_url FROM stored_batteries WHERE user_id = $1',
    [uid]
  );
  return batRes.rows.map(
    (r: {
      id: string;
      item_id: string;
      current_charge: number;
      power_capacity_wh: number | null;
      display_name: string | null;
      image_url: string | null;
    }) => ({
      id: r.id,
      itemId: r.item_id,
      currentCharge: r.current_charge,
      powerCapacityWh: r.power_capacity_wh != null ? Number(r.power_capacity_wh) : null,
      displayName: r.display_name != null ? String(r.display_name) : null,
      imageUrl: r.image_url != null ? String(r.image_url) : null
    })
  );
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
  /** Snapshot BD: catálogo da bateria montada (Wh / UI). */
  batteryCatalogItemId?: string | null;
  batteryPowerCapacityWh?: number | null;
  batteryDisplayName?: string | null;
  batteryImageUrl?: string | null;
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
      slotIndex: Number(r.slot_index) || 0,
      batteryCatalogItemId: (r.battery_catalog_item_id as string | null) ?? null,
      batteryPowerCapacityWh:
        r.battery_power_capacity_wh != null ? Number(r.battery_power_capacity_wh) : null,
      batteryDisplayName: (r.battery_display_name as string | null) ?? null,
      batteryImageUrl: (r.battery_image_url as string | null) ?? null
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
  storedBatteries?: Array<{
    id: string;
    itemId: string;
    currentCharge?: number;
    powerCapacityWh?: number | null;
    displayName?: string | null;
    imageUrl?: string | null;
  }>;
  placedRacks?: PlacedRackLoaded[];
  /** Opcional: usado pela validação de remoções seguras em `stored_batteries`. */
  workshopSlots?: unknown;
};

export type ActivityLogEntry = { action: string; meta: Record<string, unknown> };

async function ensureStoredBatteriesInChanges(
  client: PoolClient,
  uid: number | string,
  changes: GameStateChanges
): Promise<void> {
  if (Array.isArray(changes.storedBatteries)) return;
  changes.storedBatteries = await loadUserStoredBatteries(client, uid);
}

/**
 * Quando `POST /api/game/save-servers` envia só `placedRacks` (sem `stock`), o servidor remove rigs
 * na BD mas não recebia os incrementos de estoque — os componentes «evaporavam».
 * Recupera chassis, fiação, slots, multiplicadores e bateria a partir do estado anterior em BD.
 */
async function applyDismantledRacksStockRecoveryWhenStockOmitted(
  client: PoolClient,
  uid: number | string,
  placedRacks: NonNullable<GameStateChanges['placedRacks']>,
  changes: GameStateChanges
): Promise<void> {
  if (changes.stock !== undefined) return;

  const prevRes = await client.query(
    `SELECT id, item_id, wiring_id, battery_id, current_charge
     FROM placed_racks WHERE user_id = $1`,
    [uid]
  );
  type PrevRow = {
    id: string;
    item_id: string;
    wiring_id: string | null;
    battery_id: string | null;
    current_charge: number;
  };
  const nextIds = new Set(placedRacks.map((r) => r.id));
  const removed = (prevRes.rows as PrevRow[]).filter((r) => !nextIds.has(r.id));
  if (removed.length === 0) return;

  const additions: Record<string, number> = {};
  const bump = (id: string | null | undefined, n = 1) => {
    const t = id != null ? String(id).trim() : '';
    if (!t || n <= 0) return;
    additions[t] = (additions[t] || 0) + n;
  };

  for (const row of removed) {
    bump(row.item_id, 1);
    bump(row.wiring_id, 1);
    const [slots, multis] = await Promise.all([
      client.query(
        'SELECT machine_item_id FROM rack_slots WHERE rack_id = $1 AND machine_item_id IS NOT NULL',
        [row.id]
      ),
      client.query(
        'SELECT multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = $1 AND multiplier_item_id IS NOT NULL',
        [row.id]
      )
    ]);
    for (const s of slots.rows as { machine_item_id: string }[]) {
      bump(s.machine_item_id, 1);
    }
    for (const m of multis.rows as { multiplier_item_id: string }[]) {
      bump(m.multiplier_item_id, 1);
    }

    await returnRackBatteryFromDismantleToChanges(
      client,
      uid,
      row.battery_id,
      Number(row.current_charge) || 0,
      additions,
      changes
    );
  }

  const keys = Object.keys(additions);
  if (keys.length === 0) return;
  const qtyRes = await client.query(
    'SELECT item_id, qty FROM stock WHERE user_id = $1 AND item_id = ANY($2::text[])',
    [uid, keys]
  );
  const prevQty = new Map<string, number>();
  for (const r of qtyRes.rows as { item_id: string; qty: number }[]) {
    prevQty.set(String(r.item_id), Number(r.qty) || 0);
  }
  changes.stock = {};
  for (const k of keys) {
    const base = prevQty.get(k) ?? 0;
    changes.stock[k] = Math.floor(base + (additions[k] || 0));
  }
}

async function returnRackBatteryFromDismantleToChanges(
  client: PoolClient,
  uid: number | string,
  batteryId: string | null | undefined,
  rackCurrentCharge: number,
  additions: Record<string, number>,
  changes: GameStateChanges
): Promise<void> {
  const bid = batteryId != null ? String(batteryId).trim() : '';
  if (!bid) return;
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bid);
  if (isUuid) {
    const br = await client.query(
      'SELECT id, item_id, current_charge, power_capacity_wh, display_name, image_url FROM stored_batteries WHERE id = $1 AND user_id = $2',
      [bid, uid]
    );
    if (br.rows[0]) {
      await ensureStoredBatteriesInChanges(client, uid, changes);
      const r = br.rows[0] as {
        id: string;
        item_id: string;
        current_charge: number;
        power_capacity_wh: number | null;
        display_name: string | null;
        image_url: string | null;
      };
      if (!changes.storedBatteries!.some((x) => x.id === r.id)) {
        changes.storedBatteries!.push({
          id: r.id,
          itemId: r.item_id,
          currentCharge: Number(r.current_charge) || 0,
          powerCapacityWh: r.power_capacity_wh != null ? Number(r.power_capacity_wh) : undefined,
          displayName: r.display_name != null ? String(r.display_name) : undefined,
          imageUrl: r.image_url != null ? String(r.image_url) : undefined
        });
      }
      return;
    }
  }
  const u = await client.query('SELECT type, power_capacity FROM upgrades WHERE id = $1', [bid]);
  const row = u.rows[0] as { type?: string; power_capacity?: unknown } | undefined;
  if (row && String(row.type) === 'battery') {
    const capRaw = row.power_capacity;
    const cap = capRaw === null || capRaw === undefined ? null : Number(capRaw);
    const charge = Number(rackCurrentCharge) || 0;
    const isInf = cap === -1;
    const isFull = isInf || (typeof cap === 'number' && cap > 0 && charge >= cap * 0.999);
    if (isFull) {
      additions[bid] = (additions[bid] || 0) + 1;
    } else {
      await ensureStoredBatteriesInChanges(client, uid, changes);
      changes.storedBatteries!.push({
        id: crypto.randomUUID(),
        itemId: bid,
        currentCharge: charge
      });
    }
    return;
  }
  additions[bid] = (additions[bid] || 0) + 1;
}

export async function persistStockStoredBatteriesPlacedRacks(
  client: PoolClient,
  uid: number | string,
  changes: GameStateChanges,
  saveActivityLogs: ActivityLogEntry[]
): Promise<void> {
  if (Array.isArray(changes.placedRacks) && changes.stock === undefined) {
    await applyDismantledRacksStockRecoveryWhenStockOmitted(client, uid, changes.placedRacks, changes);
  }

  const { stock, storedBatteries, placedRacks } = changes;

  /** Linhas em `stored_batteries` antes do DELETE — instâncias montadas na rig saem do payload do armazém. */
  let preMountBatterySnap = new Map<string, StoredBatteryRowSnap>();
  if (Array.isArray(placedRacks) && placedRacks.length > 0) {
    const mountedIds = collectMountedBatteryInstanceIdsFromPlacedRacks(placedRacks as { batteryId?: unknown }[]);
    if (mountedIds.length > 0) {
      preMountBatterySnap = await loadStoredBatteryRowsForIds(client, uid, mountedIds);
    }
  }

  let storedBatteriesNorm = storedBatteries;
  if (storedBatteries) {
    storedBatteriesNorm = sanitizeStoredBatteriesForSavePayload(
      storedBatteries,
      changes.workshopSlots,
      changes.placedRacks
    ) as typeof storedBatteries;
    const incomingBatIds = storedBatteriesNorm.map((b) => b.id);
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

  if (storedBatteriesNorm) {
    const incomingIds = storedBatteriesNorm.map((b) => b.id);
    if (incomingIds.length > 0) {
      await client.query('DELETE FROM stored_batteries WHERE user_id = $1 AND NOT (id = ANY($2::text[]))', [uid, incomingIds]);
    } else {
      await client.query('DELETE FROM stored_batteries WHERE user_id = $1', [uid]);
    }
    if (storedBatteriesNorm.length > 0) {
      const bIds = storedBatteriesNorm.map((b) => b.id);
      const bItemIds = storedBatteriesNorm.map((b) => b.itemId);
      const bCharges = storedBatteriesNorm.map((b) => b.currentCharge || 0);
      const upStored = await fetchBatteryUpgradeRowsByIds(client, bItemIds);
      const bPowers = bItemIds.map((cid) => {
        const u = upStored.get(String(cid));
        return u?.power_capacity != null && Number.isFinite(Number(u.power_capacity)) ? Number(u.power_capacity) : null;
      });
      const bNames = bItemIds.map((cid) => {
        const n = upStored.get(String(cid))?.name;
        return n != null && String(n).trim() !== '' ? String(n).trim().slice(0, 500) : null;
      });
      const bImgs = bItemIds.map((cid) => {
        const im = upStored.get(String(cid))?.image;
        return im != null && String(im).trim() !== '' ? String(im).trim().slice(0, 2048) : null;
      });
      await client.query(
        `
          INSERT INTO stored_batteries (id, user_id, item_id, current_charge, power_capacity_wh, display_name, image_url)
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::numeric[]), unnest($5::float8[]), unnest($6::text[]), unnest($7::text[])
          ON CONFLICT (id) DO UPDATE SET
            current_charge = EXCLUDED.current_charge,
            item_id = EXCLUDED.item_id,
            power_capacity_wh = COALESCE(EXCLUDED.power_capacity_wh, stored_batteries.power_capacity_wh),
            display_name = COALESCE(NULLIF(BTRIM(EXCLUDED.display_name), ''), stored_batteries.display_name),
            image_url = COALESCE(NULLIF(BTRIM(EXCLUDED.image_url), ''), stored_batteries.image_url)`,
        [uid, bIds, bItemIds, bCharges, bPowers, bNames, bImgs]
      );
    }
  }

  if (placedRacks) {
    const ts = new Date().toISOString();
    const prevRacksRes = await client.query(
      `SELECT id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id,
              COALESCE(NULLIF(BTRIM(room_id::text), ''), 'room_initial') AS room_id, slot_index,
              battery_catalog_item_id, battery_power_capacity_wh, battery_display_name, battery_image_url
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
      battery_catalog_item_id: string | null;
      battery_power_capacity_wh: number | null;
      battery_display_name: string | null;
      battery_image_url: string | null;
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
      const catalogIdsForUpgrades = new Set<string>();
      for (const r of placedRacks) {
        const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
        if (!bid) continue;
        const prow = prevMap.get(r.id);
        let cat: string | null = null;
        if (isRackBatteryInstanceUuid(bid)) {
          const inst = preMountBatterySnap.get(bid);
          cat = inst?.item_id != null ? String(inst.item_id).trim() : null;
          if (!cat && prow && String(prow.battery_id || '') === bid) {
            cat = prow.battery_catalog_item_id != null ? String(prow.battery_catalog_item_id).trim() : null;
          }
        } else {
          cat = bid;
        }
        if (cat) catalogIdsForUpgrades.add(cat);
      }
      const upgradeByCatalog = await fetchBatteryUpgradeRowsByIds(client, [...catalogIdsForUpgrades]);

      const rIds = placedRacks.map((r) => r.id);
      const rItems = placedRacks.map((r) => r.itemId);
      const rWirings = placedRacks.map((r) => r.wiringId || null);
      const rBatteries = placedRacks.map((r) => r.batteryId || null);
      const rCharges = placedRacks.map((r) => r.currentCharge || 0);
      const rOns = placedRacks.map((r) => (r.isOn ? 1 : 0));
      const rCoins = placedRacks.map((r) => r.selectedCoinId || null);
      const rRooms = placedRacks.map((r) => normalizePlacedRackRoomId(r.roomId));
      const rSlotIdxs = placedRacks.map((r) => r.slotIndex || 0);

      const rBatCats: (string | null)[] = [];
      const rBatPows: (number | null)[] = [];
      const rBatNames: (string | null)[] = [];
      const rBatImgs: (string | null)[] = [];
      for (const r of placedRacks) {
        const prow = prevMap.get(r.id);
        const prevBatt: PrevPlacedRackBattRow | null = prow
          ? {
              battery_id: prow.battery_id,
              battery_catalog_item_id: prow.battery_catalog_item_id,
              battery_power_capacity_wh: prow.battery_power_capacity_wh,
              battery_display_name: prow.battery_display_name,
              battery_image_url: prow.battery_image_url
            }
          : null;
        const snap = buildRackBatteryPersistSnapshot(r.batteryId, preMountBatterySnap, upgradeByCatalog, prevBatt);
        rBatCats.push(snap.catalogItemId);
        rBatPows.push(snap.powerWh);
        rBatNames.push(snap.displayName != null && snap.displayName.trim() !== '' ? snap.displayName.trim().slice(0, 500) : null);
        rBatImgs.push(snap.imageUrl != null && snap.imageUrl.trim() !== '' ? snap.imageUrl.trim().slice(0, 2048) : null);
      }

      await client.query(
        `
          INSERT INTO placed_racks (
            id, user_id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id, room_id, slot_index,
            battery_catalog_item_id, battery_power_capacity_wh, battery_display_name, battery_image_url
          )
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::text[]), unnest($5::text[]), unnest($6::numeric[]), unnest($7::int[]), unnest($8::text[]), unnest($9::text[]), unnest($10::int[]),
                 unnest($11::text[]), unnest($12::float8[]), unnest($13::text[]), unnest($14::text[])
          ON CONFLICT (id) DO UPDATE SET
            item_id = EXCLUDED.item_id, wiring_id = EXCLUDED.wiring_id, battery_id = EXCLUDED.battery_id,
            current_charge = EXCLUDED.current_charge, is_on = EXCLUDED.is_on, selected_coin_id = EXCLUDED.selected_coin_id,
            room_id = EXCLUDED.room_id, slot_index = EXCLUDED.slot_index,
            battery_catalog_item_id = EXCLUDED.battery_catalog_item_id,
            battery_power_capacity_wh = EXCLUDED.battery_power_capacity_wh,
            battery_display_name = EXCLUDED.battery_display_name,
            battery_image_url = EXCLUDED.battery_image_url`,
        [
          uid,
          rIds,
          rItems,
          rWirings,
          rBatteries,
          rCharges,
          rOns,
          rCoins,
          rRooms,
          rSlotIdxs,
          rBatCats,
          rBatPows,
          rBatNames,
          rBatImgs
        ]
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
