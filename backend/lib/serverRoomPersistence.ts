/**
 * Load/persist stock, stored batteries, and placed racks (with slots) for server-room actions.
 * Mirrors relevant blocks in server.js save-game / game-state.
 *
 * Sistema de carregamento de baterias descontinuado em
 * `20260516180000_battery_uuids_and_purge_charging`: já não há `current_charge`/
 * `power_capacity_wh` em `stored_batteries` nem `current_charge`/`battery_power_capacity_wh`
 * em `placed_racks`; cada bateria tem UUID próprio e é infinita.
 */
import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { syncStoredBatterySemanticsForUser } from '../modules/batteries/batterySemanticSync.js';
import { normalizePlacedRackRoomId } from '../modules/batteries/batteries.validation.js';
import {
  validateStoredBatteryWarehouseRemovalAllowed,
  sanitizeStoredBatteriesForSavePayload,
  StoredBatterySaveGuardError
} from './saveGameEconomyValidate.js';
import { deleteWarehouseStoredBatteriesExceptKeepIds } from './storedBatteriesWarehouseDelete.js';
import {
  buildRackBatteryPersistSnapshot,
  collectMountedBatteryInstanceIdsFromPlacedRacks,
  fetchBatteryUpgradeRowsByIds,
  isRackBatteryInstanceUuid,
  loadStoredBatteryRowsForIds,
  loadUserStoredBatteries,
  type PrevPlacedRackBattRow,
  type StoredBatteryRowSnap
} from '../modules/batteries/batteries.repository.js';
import { normalizeKnown1000WhBatteryCatalogId } from '../modules/batteries/batteries.catalog.js';

export { loadUserStoredBatteries, normalizePlacedRackRoomId };

export async function loadUserStock(client: PoolClient, uid: number | string): Promise<Record<string, number>> {
  const stockRes = await client.query('SELECT item_id, qty FROM stock WHERE user_id = $1', [uid]);
  const stock: Record<string, number> = {};
  stockRes.rows.forEach((r: { item_id: string; qty: number }) => {
    const itemId = normalizeKnown1000WhBatteryCatalogId(r.item_id);
    stock[itemId] = (stock[itemId] || 0) + (Number(r.qty) || 0);
  });
  return stock;
}

export type PlacedRackLoaded = {
  id: string;
  itemId: string;
  slots: string[];
  multiplierSlots: string[];
  wiringId: string | null;
  batteryId: string | null;
  isOn: boolean;
  selectedCoinId: string | null;
  roomId: string;
  slotIndex: number;
  /** Snapshot BD: catálogo da bateria montada (UI). */
  batteryCatalogItemId?: string | null;
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
      isOn: !!r.is_on,
      selectedCoinId: (r.selected_coin_id as string | null) ?? null,
      roomId: normalizePlacedRackRoomId(r.room_id),
      slotIndex: Number(r.slot_index) || 0,
      batteryCatalogItemId: (r.battery_catalog_item_id as string | null) ?? null,
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
  /** 0 = inativo no catálogo (não colocar nova rig). */
  isActive?: number;
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
    isActive: r.is_active == null ? 1 : Number(r.is_active),
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
    displayName?: string | null;
    imageUrl?: string | null;
  }>;
  placedRacks?: PlacedRackLoaded[];
  /**
   * Como interpretar `stock` na persistência:
   * - `'snapshot'`: o objeto representa o estoque livre completo do utilizador; linhas em
   *   `stock` ausentes do snapshot são apagadas (corrige duplicação infinita quando um item
   *   chega a qty 0 ao equipar no rack).
   * - `'partial'` (default): comportamento legado — apenas UPSERT das chaves presentes.
   */
  stockMode?: 'snapshot' | 'partial';
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
    `SELECT id, item_id, wiring_id, battery_id
     FROM placed_racks WHERE user_id = $1`,
    [uid]
  );
  type PrevRow = {
    id: string;
    item_id: string;
    wiring_id: string | null;
    battery_id: string | null;
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

    await returnRackBatteryFromDismantleToChanges(client, uid, row.battery_id, additions, changes);
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

/**
 * Sistema infinito: bateria desmontada volta como instância UUID para `stored_batteries`
 * (sem charge/capacidade), mantendo o id se já existia em armazém.
 */
async function returnRackBatteryFromDismantleToChanges(
  client: PoolClient,
  uid: number | string,
  batteryId: string | null | undefined,
  additions: Record<string, number>,
  changes: GameStateChanges
): Promise<void> {
  const bid = batteryId != null ? String(batteryId).trim() : '';
  if (!bid) return;
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bid);
  if (isUuid) {
    const br = await client.query(
      'SELECT id, item_id, display_name, image_url FROM stored_batteries WHERE id = $1 AND user_id = $2',
      [bid, uid]
    );
    if (br.rows[0]) {
      await ensureStoredBatteriesInChanges(client, uid, changes);
      const r = br.rows[0] as {
        id: string;
        item_id: string;
        display_name: string | null;
        image_url: string | null;
      };
      if (!changes.storedBatteries!.some((x) => x.id === r.id)) {
        changes.storedBatteries!.push({
          id: r.id,
          itemId: normalizeKnown1000WhBatteryCatalogId(r.item_id),
          displayName: r.display_name != null ? String(r.display_name) : undefined,
          imageUrl: r.image_url != null ? String(r.image_url) : undefined
        });
      }
      return;
    }
  }
  // Catalog id: cria instância UUID no armazém (sistema infinito; sem fullness check).
  const u = await client.query('SELECT type FROM upgrades WHERE id = $1', [bid]);
  const row = u.rows[0] as { type?: string } | undefined;
  if (row && String(row.type) === 'battery') {
    await ensureStoredBatteriesInChanges(client, uid, changes);
    changes.storedBatteries!.push({
      id: crypto.randomUUID(),
      itemId: normalizeKnown1000WhBatteryCatalogId(bid)
    });
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
      changes.placedRacks
    ) as typeof storedBatteries;
    const incomingBatIds = storedBatteriesNorm.map((b) => b.id);
    const rm = await validateStoredBatteryWarehouseRemovalAllowed(
      client,
      uid,
      incomingBatIds,
      { placedRacks: changes.placedRacks },
      false
    );
    if (!rm.ok) {
      throw new StoredBatterySaveGuardError(rm.error);
    }
  }

  if (stock) {
    const stockMode: 'snapshot' | 'partial' = changes.stockMode === 'snapshot' ? 'snapshot' : 'partial';
    const stockNorm = new Map<string, number>();
    for (const [rawId, rawQty] of Object.entries(stock)) {
      const itemId = normalizeKnown1000WhBatteryCatalogId(rawId);
      if (!itemId) continue;
      const qty = Math.floor(Number(rawQty) || 0);
      if (qty <= 0) continue;
      stockNorm.set(itemId, (stockNorm.get(itemId) || 0) + qty);
    }
    const itemIds = [...stockNorm.keys()];
    const qtys = itemIds.map((id) => stockNorm.get(id) || 0);

    if (stockMode === 'snapshot') {
      if (itemIds.length > 0) {
        await client.query(
          'DELETE FROM stock WHERE user_id = $1 AND NOT (item_id = ANY($2::text[]))',
          [uid, itemIds]
        );
        await client.query(
          `
            INSERT INTO stock (user_id, item_id, qty)
            SELECT $1, unnest($2::text[]), unnest($3::int[])
            ON CONFLICT (user_id, item_id) DO UPDATE SET qty = EXCLUDED.qty`,
          [uid, itemIds, qtys]
        );
      } else {
        await client.query('DELETE FROM stock WHERE user_id = $1', [uid]);
      }
      await client.query('DELETE FROM stock WHERE user_id = $1 AND qty <= 0', [uid]);
    } else if (itemIds.length > 0) {
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
    // `incomingIds` (saneado) NUNCA inclui UUIDs equipados em `placedRacks` (sanitize remove-os).
    // `placed_racks` na BD ainda reflete o estado VELHO; é actualizado mais à frente neste
    // mesmo método. Sem proteger explicitamente, equipar uma bateria UUID de armazém faria
    // o DELETE apagar a instância antes do INSERT placed_racks → rig fica com `battery_id`
    // órfão (foi exactamente este o bug que gerou os 92 racks fantasmas pós-explode UUID).
    const mountedIdsFromIncomingRacks = collectMountedBatteryInstanceIdsFromPlacedRacks(
      Array.isArray(changes.placedRacks)
        ? (changes.placedRacks as unknown as Array<{ batteryId?: unknown }>)
        : []
    );
    const incomingIds = [
      ...new Set([...storedBatteriesNorm.map((b) => b.id), ...mountedIdsFromIncomingRacks])
    ];
    await deleteWarehouseStoredBatteriesExceptKeepIds(client, Number(uid), incomingIds);
    if (storedBatteriesNorm.length > 0) {
      const bIds = storedBatteriesNorm.map((b) => b.id);
      const bItemIds = storedBatteriesNorm.map((b) => normalizeKnown1000WhBatteryCatalogId(b.itemId));
      const upStored = await fetchBatteryUpgradeRowsByIds(client, bItemIds);
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
          INSERT INTO stored_batteries (id, user_id, item_id, display_name, image_url)
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::text[]), unnest($5::text[])
          ON CONFLICT (id) DO UPDATE SET
            item_id = EXCLUDED.item_id,
            display_name = COALESCE(NULLIF(BTRIM(EXCLUDED.display_name), ''), stored_batteries.display_name),
            image_url = COALESCE(NULLIF(BTRIM(EXCLUDED.image_url), ''), stored_batteries.image_url)`,
        [uid, bIds, bItemIds, bNames, bImgs]
      );
    }
  }

  if (placedRacks) {
    const ts = new Date().toISOString();
    const prevRacksRes = await client.query(
      `SELECT id, item_id, wiring_id, battery_id, is_on, selected_coin_id,
              COALESCE(NULLIF(BTRIM(room_id::text), ''), 'room_initial') AS room_id, slot_index,
              battery_catalog_item_id, battery_display_name, battery_image_url
       FROM placed_racks WHERE user_id = $1`,
      [uid]
    );
    type PrevRackRow = {
      id: string;
      item_id: string;
      wiring_id: string | null;
      battery_id: string | null;
      is_on: number;
      selected_coin_id: string | null;
      room_id: string;
      slot_index: number;
      battery_catalog_item_id: string | null;
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
          cat = inst?.item_id != null ? normalizeKnown1000WhBatteryCatalogId(inst.item_id) : null;
          if (!cat && prow && String(prow.battery_id || '') === bid) {
            cat =
              prow.battery_catalog_item_id != null
                ? normalizeKnown1000WhBatteryCatalogId(prow.battery_catalog_item_id)
                : null;
          }
          if (!cat && r.batteryCatalogItemId != null && String(r.batteryCatalogItemId).trim() !== '') {
            cat = normalizeKnown1000WhBatteryCatalogId(r.batteryCatalogItemId);
          }
        } else {
          cat = normalizeKnown1000WhBatteryCatalogId(bid);
        }
        if (cat) catalogIdsForUpgrades.add(cat);
      }
      const upgradeByCatalog = await fetchBatteryUpgradeRowsByIds(client, [...catalogIdsForUpgrades]);

      const rIds = placedRacks.map((r) => r.id);
      const rItems = placedRacks.map((r) => r.itemId);
      const rWirings = placedRacks.map((r) => r.wiringId || null);
      const rBatteries = placedRacks.map((r) => {
        const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
        if (!bid || isRackBatteryInstanceUuid(bid)) return r.batteryId || null;
        return normalizeKnown1000WhBatteryCatalogId(bid);
      });
      const rOns = placedRacks.map((r) => (r.isOn ? 1 : 0));
      const rCoins = placedRacks.map((r) => r.selectedCoinId || null);
      const rRooms = placedRacks.map((r) => normalizePlacedRackRoomId(r.roomId));
      const rSlotIdxs = placedRacks.map((r) => r.slotIndex || 0);

      const rBatCats: (string | null)[] = [];
      const rBatNames: (string | null)[] = [];
      const rBatImgs: (string | null)[] = [];
      for (const r of placedRacks) {
        const prow = prevMap.get(r.id);
        const prevBatt: PrevPlacedRackBattRow | null = prow
          ? {
              battery_id: prow.battery_id,
              battery_catalog_item_id: prow.battery_catalog_item_id,
              battery_display_name: prow.battery_display_name,
              battery_image_url: prow.battery_image_url
            }
          : null;
        const snap = buildRackBatteryPersistSnapshot(r.batteryId, preMountBatterySnap, upgradeByCatalog, prevBatt);
        const catOut =
          snap.catalogItemId != null && String(snap.catalogItemId).trim() !== ''
            ? normalizeKnown1000WhBatteryCatalogId(snap.catalogItemId)
            : r.batteryCatalogItemId != null && String(r.batteryCatalogItemId).trim() !== ''
              ? normalizeKnown1000WhBatteryCatalogId(r.batteryCatalogItemId)
              : null;
        const uFromCat = catOut ? upgradeByCatalog.get(catOut) : undefined;
        const nameOut =
          snap.displayName != null && String(snap.displayName).trim() !== ''
            ? String(snap.displayName).trim().slice(0, 500)
            : uFromCat?.name != null && String(uFromCat.name).trim() !== ''
              ? String(uFromCat.name).trim().slice(0, 500)
              : null;
        const imgOut =
          snap.imageUrl != null && String(snap.imageUrl).trim() !== ''
            ? String(snap.imageUrl).trim().slice(0, 2048)
            : uFromCat?.image != null && String(uFromCat.image).trim() !== ''
              ? String(uFromCat.image).trim().slice(0, 2048)
              : null;
        rBatCats.push(catOut);
        rBatNames.push(nameOut);
        rBatImgs.push(imgOut);
      }

      await client.query(
        `
          INSERT INTO placed_racks (
            id, user_id, item_id, wiring_id, battery_id, is_on, selected_coin_id, room_id, slot_index,
            battery_catalog_item_id, battery_display_name, battery_image_url
          )
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::text[]), unnest($5::text[]), unnest($6::int[]), unnest($7::text[]), unnest($8::text[]), unnest($9::int[]),
                 unnest($10::text[]), unnest($11::text[]), unnest($12::text[])
          ON CONFLICT (id) DO UPDATE SET
            item_id = EXCLUDED.item_id, wiring_id = EXCLUDED.wiring_id, battery_id = EXCLUDED.battery_id,
            is_on = EXCLUDED.is_on, selected_coin_id = EXCLUDED.selected_coin_id,
            room_id = EXCLUDED.room_id, slot_index = EXCLUDED.slot_index,
            battery_catalog_item_id = EXCLUDED.battery_catalog_item_id,
            battery_display_name = EXCLUDED.battery_display_name,
            battery_image_url = EXCLUDED.battery_image_url`,
        [uid, rIds, rItems, rWirings, rBatteries, rOns, rCoins, rRooms, rSlotIdxs, rBatCats, rBatNames, rBatImgs]
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

  if (Array.isArray(placedRacks) || storedBatteriesNorm) {
    await syncStoredBatterySemanticsForUser(client, Number(uid));
  }
}
