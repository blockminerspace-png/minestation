/**
 * Server-side copy of frontend bulk room battery rules (roomBatteryModel + roomBatteryController).
 * Keep in sync when changing game rules.
 */
import crypto from 'node:crypto';
import { STORED_BATTERY_CATALOG_PENDING_ID } from './saveGameEconomyValidate.js';

const newStoredId = () => crypto.randomUUID();

const RACK_BATTERY_INSTANCE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isRackBatteryInstanceUuid(id: string): boolean {
  return RACK_BATTERY_INSTANCE_UUID_RE.test(String(id || '').trim());
}

export type GameUpgrade = {
  id: string;
  name?: string;
  type?: string;
  baseProduction?: number;
  multiplier?: number;
  powerCapacity?: number;
  compatibleRacks?: string[];
};

export type StoredBatteryRow = { id: string; itemId: string; currentCharge?: number };

export type PlacedRackState = {
  id: string;
  itemId?: string;
  roomId?: string;
  slotIndex?: number;
  batteryId?: string | null;
  currentCharge?: number;
  isOn?: boolean;
  slots?: (string | null | undefined)[];
  multiplierSlots?: (string | null | undefined)[];
};

export type BulkBatteryPrev = {
  stock: Record<string, number>;
  storedBatteries?: StoredBatteryRow[];
  placedRacks: PlacedRackState[];
};

export type BulkRoomBatteryRunOpts = {
  smartFill?: unknown;
  rigSort?: unknown;
};

export function normalizePlacedRackRoomId(raw: unknown): string {
  const s = raw != null ? String(raw).trim() : '';
  if (!s || s === 'main') return 'room_initial';
  return s;
}

export function totalBatteryInstances(
  batteryItemId: string,
  stock: Record<string, number>,
  storedBatteries: StoredBatteryRow[] | undefined
): number {
  if (!batteryItemId || typeof batteryItemId !== 'string') return 0;
  const s = Math.max(0, Math.floor(Number(stock[batteryItemId]) || 0));
  const inStorage = (storedBatteries || []).filter((b) => b && b.itemId === batteryItemId).length;
  return s + inStorage;
}

export function rackTheoreticalHash(placedRacks: PlacedRackState[], rackIndex: number, upgrades: GameUpgrade[]): number {
  const rack = placedRacks[rackIndex];
  if (!rack) return 0;
  let base = 0;
  for (const sid of rack.slots || []) {
    if (!sid) continue;
    base += upgrades.find((u) => u.id === sid)?.baseProduction || 0;
  }
  let mult = 1;
  for (const sid of rack.multiplierSlots || []) {
    if (!sid) continue;
    const m = upgrades.find((u) => u.id === sid);
    if (m?.multiplier) mult += m.multiplier;
  }
  return base * mult;
}

function sortRackIndicesForAllocation(
  indices: number[],
  placedRacks: PlacedRackState[],
  upgrades: GameUpgrade[],
  rigSort: string
): number[] {
  const arr = [...indices];
  arr.sort((ai, bi) => {
    if (rigSort === 'hashrate_desc') {
      const ha = rackTheoreticalHash(placedRacks, ai, upgrades);
      const hb = rackTheoreticalHash(placedRacks, bi, upgrades);
      if (hb !== ha) return hb - ha;
    }
    const a = placedRacks[ai];
    const b = placedRacks[bi];
    const sa = a?.slotIndex ?? ai;
    const sb = b?.slotIndex ?? bi;
    if (sa !== sb) return sa - sb;
    return ai - bi;
  });
  return arr;
}

export function compatibleRackIndicesForBattery(placedRacks: PlacedRackState[], roomId: string, batDef: GameUpgrade): number[] {
  if (!roomId || !batDef || batDef.type !== 'battery') return [];
  const roomNorm = normalizePlacedRackRoomId(roomId);
  const inRoom = placedRacks
    .map((r, i) => (normalizePlacedRackRoomId(r.roomId) === roomNorm ? i : -1))
    .filter((i) => i >= 0);
  return inRoom.filter((i) => {
    const rack = placedRacks[i];
    if (!rack) return false;
    if (!batDef.compatibleRacks?.length) return true;
    return batDef.compatibleRacks.includes(String(rack.itemId));
  });
}

function unloadRackBatteryToInventory(
  rack: PlacedRackState,
  ns: Record<string, number>,
  nb: StoredBatteryRow[],
  upgrades: GameUpgrade[]
): void {
  if (!rack.batteryId) return;
  const id = String(rack.batteryId).trim();
  if (!id) return;

  /** `placed_racks.battery_id` pode ser UUID de `stored_batteries.id` ou id de catálogo (upgrades). */
  const instIdx = nb.findIndex((b) => b && String(b.id).trim() === id);
  if (instIdx >= 0) {
    const row = nb[instIdx];
    const upg = upgrades.find((u) => u.id === row.itemId && u.type === 'battery');
    const capacity = upg?.powerCapacity ?? 100;
    const isInf = capacity === -1;
    const isFull = isInf || (rack.currentCharge != null && rack.currentCharge >= capacity * 0.999);
    nb.splice(instIdx, 1);
    if (isFull) {
      const cat = String(row.itemId || '').trim();
      if (cat) ns[cat] = (ns[cat] || 0) + 1;
    } else {
      nb.push({
        id: row.id,
        itemId: row.itemId,
        currentCharge: typeof rack.currentCharge === 'number' ? rack.currentCharge : row.currentCharge
      });
    }
    return;
  }

  if (isRackBatteryInstanceUuid(id)) {
    nb.push({
      id,
      itemId: STORED_BATTERY_CATALOG_PENDING_ID,
      currentCharge: typeof rack.currentCharge === 'number' ? rack.currentCharge : 0
    });
    return;
  }

  const upgCat = upgrades.find((u) => u.id === id && u.type === 'battery');
  if (!upgCat) return;
  const capacity = upgCat.powerCapacity ?? 100;
  const isInf = capacity === -1;
  const isFull = isInf || (rack.currentCharge != null && rack.currentCharge >= capacity * 0.999);
  if (isFull) ns[id] = (ns[id] || 0) + 1;
  else nb.push({ id: newStoredId(), itemId: id, currentCharge: rack.currentCharge });
}

export function batteryTierScore(def: GameUpgrade): number {
  if (!def || def.type !== 'battery') return 0;
  const c = def.powerCapacity;
  if (c === -1) return Number.MAX_SAFE_INTEGER - 1;
  return Math.max(0, Number(c) || 0);
}

export function poolEntryEnergyWh(charge: unknown, def: GameUpgrade): number {
  if (!def || def.type !== 'battery') return 0;
  const cap = def.powerCapacity ?? 0;
  if (cap === -1) return Number.MAX_SAFE_INTEGER - 1;
  const q = typeof charge === 'number' && Number.isFinite(charge) ? charge : 0;
  return Math.max(0, q);
}

function sortStoredInstancesForType(list: StoredBatteryRow[], batDef: GameUpgrade): StoredBatteryRow[] {
  const cap = batDef.powerCapacity ?? 0;
  return [...list].sort((a, b) => {
    if (cap === -1) return 0;
    return (b.currentCharge || 0) - (a.currentCharge || 0);
  });
}

function takeOneBatteryUnit(
  batteryItemId: string,
  batDef: GameUpgrade,
  ns: Record<string, number>,
  nb: StoredBatteryRow[]
): { charge: number; instanceId?: string } | null {
  const matching = nb
    .map((b, idx) => ({ b, idx }))
    .filter(({ b }) => b.itemId === batteryItemId);
  const sorted = sortStoredInstancesForType(
    matching.map((m) => m.b),
    batDef
  );
  if (sorted.length > 0) {
    const best = sorted[0];
    const idx = nb.findIndex((x) => x.id === best.id);
    if (idx < 0) return null;
    const [taken] = nb.splice(idx, 1);
    const cap = batDef.powerCapacity ?? 0;
    if (cap === -1) return { charge: -1, instanceId: taken.id };
    return {
      charge: typeof taken.currentCharge === 'number' ? taken.currentCharge : cap,
      instanceId: taken.id
    };
  }
  if ((ns[batteryItemId] || 0) > 0) {
    ns[batteryItemId]--;
    const capRaw = batDef.powerCapacity;
    const initCharge = capRaw === -1 ? -1 : capRaw ?? 0;
    return { charge: initCharge, instanceId: newStoredId() };
  }
  return null;
}

export function applyBulkRoomBatterySmartFill(
  prev: BulkBatteryPrev,
  roomId: string,
  upgrades: GameUpgrade[],
  rigSort: string
): {
  ok: boolean;
  message?: string;
  next?: BulkBatteryPrev;
  appliedRigs?: number;
  compatibleRigs?: number;
  smartFill?: boolean;
} {
  const room = normalizePlacedRackRoomId(roomId);
  if (!room) return { ok: false, message: 'Sala inválida.' };

  const racksInRoomIdx = prev.placedRacks
    .map((r, i) => (normalizePlacedRackRoomId(r.roomId) === room ? i : -1))
    .filter((i) => i >= 0);
  if (racksInRoomIdx.length === 0) {
    return { ok: false, message: 'Nenhuma rig nesta sala.' };
  }

  const ns = { ...prev.stock };
  const nb = [...(prev.storedBatteries || [])];
  const out = [...prev.placedRacks];

  for (const i of racksInRoomIdx) {
    const rack = out[i];
    if (!rack?.batteryId) continue;
    unloadRackBatteryToInventory(rack, ns, nb, upgrades);
    out[i] = { ...rack, batteryId: null, currentCharge: 0, isOn: false };
  }

  type PoolEntry = { itemId: string; charge: number; storageId?: string };
  const pool: PoolEntry[] = [];

  for (const u of upgrades) {
    if (u.type !== 'battery') continue;
    const qtyStock = Math.max(0, Math.floor(Number(ns[u.id]) || 0));
    const storedList = nb.filter((b) => b && b.itemId === u.id);
    if (storedList.length === 0 && qtyStock === 0) continue;

    const usableOnAnyRack = racksInRoomIdx.some((ri) => {
      const ch = out[ri]?.itemId;
      if (!ch) return false;
      return !u.compatibleRacks?.length || u.compatibleRacks.includes(String(ch));
    });
    if (!usableOnAnyRack) continue;

    const cap = u.powerCapacity ?? 0;
    for (const s of sortStoredInstancesForType(storedList, u)) {
      pool.push({
        itemId: u.id,
        charge: cap === -1 ? -1 : Number(s.currentCharge),
        storageId: s.id
      });
    }
    for (let q = 0; q < qtyStock; q++) {
      pool.push({
        itemId: u.id,
        charge: cap === -1 ? -1 : cap,
        storageId: undefined
      });
    }
  }

  if (pool.length === 0) {
    return { ok: false, message: 'Não há baterias no stock nem no armazém compatíveis com as rigs desta sala.' };
  }

  pool.sort((a, b) => {
    const da = upgrades.find((x) => x.id === a.itemId);
    const db = upgrades.find((x) => x.id === b.itemId);
    if (!da || !db || da.type !== 'battery' || db.type !== 'battery') return 0;
    const ea = poolEntryEnergyWh(a.charge, da);
    const eb = poolEntryEnergyWh(b.charge, db);
    if (eb !== ea) return eb - ea;
    const ta = batteryTierScore(da);
    const tb = batteryTierScore(db);
    if (tb !== ta) return tb - ta;
    return (b.charge || 0) - (a.charge || 0);
  });

  const sortedRacks = sortRackIndicesForAllocation(racksInRoomIdx, out, upgrades, rigSort);
  let applied = 0;

  for (const ri of sortedRacks) {
    const rack = out[ri];
    const ch = rack.itemId;
    const idx = pool.findIndex((p) => {
      const def = upgrades.find((x) => x.id === p.itemId);
      if (!def || def.type !== 'battery') return false;
      return !def.compatibleRacks?.length || def.compatibleRacks.includes(String(ch));
    });
    if (idx === -1) continue;
    const picked = pool[idx];
    pool.splice(idx, 1);
    const def = upgrades.find((x) => x.id === picked.itemId);
    if (!def) continue;

    if (picked.storageId) {
      const sbi = nb.findIndex((x) => x.id === picked.storageId);
      if (sbi < 0) continue;
      nb.splice(sbi, 1);
    } else {
      if ((ns[picked.itemId] || 0) < 1) continue;
      ns[picked.itemId]--;
    }

    const rackBattId =
      picked.storageId != null && String(picked.storageId).trim() !== ''
        ? String(picked.storageId).trim()
        : newStoredId();
    out[ri] = {
      ...rack,
      batteryId: rackBattId,
      currentCharge: picked.charge,
      isOn: true
    };
    applied++;
  }

  return {
    ok: true,
    next: { ...prev, stock: ns, storedBatteries: nb, placedRacks: out },
    appliedRigs: applied,
    compatibleRigs: racksInRoomIdx.length,
    smartFill: true
  };
}

export function applyBulkRoomBatteryChange(
  prev: BulkBatteryPrev,
  roomId: string,
  batteryUpgradeId: string,
  upgrades: GameUpgrade[],
  opts: { rigSort?: string }
): {
  ok: boolean;
  message?: string;
  next?: BulkBatteryPrev;
  appliedRigs?: number;
  compatibleRigs?: number;
} {
  const room = normalizePlacedRackRoomId(roomId);
  if (!room) return { ok: false, message: 'Sala inválida.' };

  const racksInRoomIdx = prev.placedRacks
    .map((r, i) => (normalizePlacedRackRoomId(r.roomId) === room ? i : -1))
    .filter((i) => i >= 0);

  if (!batteryUpgradeId) {
    const ns = { ...prev.stock };
    const nb = [...(prev.storedBatteries || [])];
    const out = [...prev.placedRacks];
    for (const i of racksInRoomIdx) {
      const rack = out[i];
      if (!rack?.batteryId) continue;
      unloadRackBatteryToInventory(rack, ns, nb, upgrades);
      out[i] = { ...rack, batteryId: null, currentCharge: 0, isOn: false };
    }
    return {
      ok: true,
      next: { ...prev, stock: ns, storedBatteries: nb, placedRacks: out },
      appliedRigs: 0,
      compatibleRigs: 0
    };
  }

  const batDef = upgrades.find((u) => u.id === batteryUpgradeId && u.type === 'battery');
  if (!batDef) return { ok: false, message: 'Bateria inválida.' };

  let compatibleIdx = compatibleRackIndicesForBattery(prev.placedRacks, room, batDef);
  if (compatibleIdx.length === 0) {
    return { ok: false, message: 'Nenhuma rig nesta sala é compatível com este tipo de bateria.' };
  }

  const rigSort = opts?.rigSort === 'hashrate_desc' ? 'hashrate_desc' : 'slot_asc';
  compatibleIdx = sortRackIndicesForAllocation(compatibleIdx, prev.placedRacks, upgrades, rigSort);

  const totalAvail = totalBatteryInstances(batteryUpgradeId, prev.stock, prev.storedBatteries || []);
  if (totalAvail <= 0) {
    return { ok: false, message: `Não há unidades de "${batDef.name}" no stock nem no armazém.` };
  }

  const nApply = Math.min(compatibleIdx.length, totalAvail);
  const ns = { ...prev.stock };
  const nb = [...(prev.storedBatteries || [])];
  const out = [...prev.placedRacks];

  for (let k = 0; k < nApply; k++) {
    const i = compatibleIdx[k];
    const rack = { ...out[i] };
    if (rack.batteryId) unloadRackBatteryToInventory(rack, ns, nb, upgrades);
    const taken = takeOneBatteryUnit(batteryUpgradeId, batDef, ns, nb);
    if (!taken) {
      return { ok: false, message: 'Falha ao retirar unidade do estoque/armazém. Tente novamente.' };
    }
    const rackBattId =
      taken.instanceId != null && String(taken.instanceId).trim() !== ''
        ? String(taken.instanceId).trim()
        : newStoredId();
    out[i] = {
      ...rack,
      batteryId: rackBattId,
      currentCharge: taken.charge,
      isOn: true
    };
  }

  return {
    ok: true,
    next: { ...prev, stock: ns, storedBatteries: nb, placedRacks: out },
    appliedRigs: nApply,
    compatibleRigs: compatibleIdx.length
  };
}

const BATTERY_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

export function isValidRoomId(raw: unknown): boolean {
  const s = raw != null ? String(raw).trim() : '';
  return s.length > 0 && s.length <= 120 && !/[\x00-\x1f<>]/.test(s);
}

export function isValidBatterySelectionId(raw: unknown): boolean {
  if (raw == null || raw === '') return true;
  const s = String(raw).trim();
  return BATTERY_ID_RE.test(s);
}

export function isValidBatteryRigSort(raw: unknown): boolean {
  return raw === 'slot_asc' || raw === 'hashrate_desc';
}

export function parseBooleanSmartFill(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

export function runBulkRoomBattery(
  prev: BulkBatteryPrev,
  roomNorm: string,
  batteryUpgradeId: string,
  gameUpgrades: GameUpgrade[],
  runOpts?: BulkRoomBatteryRunOpts
): {
  ok: boolean;
  message?: string;
  next?: BulkBatteryPrev;
  appliedRigs?: number;
  compatibleRigs?: number;
  smartFill?: boolean;
} {
  if (!isValidRoomId(roomNorm)) {
    return { ok: false, message: 'Sala inválida.' };
  }

  const smart = parseBooleanSmartFill(runOpts?.smartFill);
  const rigSort = isValidBatteryRigSort(runOpts?.rigSort) ? String(runOpts?.rigSort) : 'slot_asc';

  if (smart) {
    if (batteryUpgradeId) {
      return {
        ok: false,
        message: 'No modo inteligente não pode haver um tipo de bateria selecionado na lista.'
      };
    }
    return applyBulkRoomBatterySmartFill(prev, roomNorm, gameUpgrades, rigSort);
  }

  if (batteryUpgradeId && !isValidBatterySelectionId(batteryUpgradeId)) {
    return { ok: false, message: 'Identificador de bateria inválido.' };
  }
  return applyBulkRoomBatteryChange(prev, roomNorm, batteryUpgradeId, gameUpgrades, { rigSort });
}
