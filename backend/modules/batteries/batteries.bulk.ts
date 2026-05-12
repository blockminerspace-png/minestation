/**
 * Server-side copy of frontend bulk room battery rules (roomBatteryModel + roomBatteryController).
 * Keep in sync when changing game rules.
 *
 * Sistema de carregamento descontinuado em
 * `20260516180000_battery_uuids_and_purge_charging`: cada instância em
 * `stored_batteries` é uma bateria UUID infinita; já não há cargas parciais nem
 * `power_capacity_wh` / `current_charge` em rigs.
 */
import crypto from 'node:crypto';
import { STORED_BATTERY_CATALOG_PENDING_ID } from './batteries.constants.js';
import { isRackBatteryInstanceUuid } from './batteries.repository.js';
import {
  isValidBatteryRigSort,
  isValidBatterySelectionId,
  isValidRoomId,
  normalizePlacedRackRoomId,
  parseBooleanSmartFill
} from './batteries.validation.js';

const newStoredId = () => crypto.randomUUID();

export type GameUpgrade = {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  status?: string;
  isActive?: number;
  isNft?: boolean;
  baseProduction?: number;
  multiplier?: number;
  powerCapacity?: number;
  compatibleRacks?: string[];
  image?: string | null;
};

export type StoredBatteryRow = {
  id: string;
  itemId: string;
  displayName?: string | null;
  imageUrl?: string | null;
};

export type PlacedRackState = {
  id: string;
  itemId?: string;
  roomId?: string;
  slotIndex?: number;
  batteryId?: string | null;
  isOn?: boolean;
  batteryCatalogItemId?: string | null;
  batteryDisplayName?: string | null;
  batteryImageUrl?: string | null;
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

function isUsableBatteryCatalog(def: GameUpgrade | undefined): def is GameUpgrade {
  if (!def || def.type !== 'battery') return false;
  if (!def.id || def.id === STORED_BATTERY_CATALOG_PENDING_ID || def.id.startsWith('temp_legacy_')) return false;
  if (def.category === 'legacy-temp' || def.status === 'legacy' || def.status === 'exclusive') return false;
  if (def.isActive === 0 || def.isNft === true) return false;
  return true;
}

function isBatteryAvailableForRackUse(row: StoredBatteryRow | undefined | null): row is StoredBatteryRow {
  if (!row || !row.id || !row.itemId) return false;
  return true;
}

export function totalBatteryInstances(
  batteryItemId: string,
  stock: Record<string, number>,
  storedBatteries: StoredBatteryRow[] | undefined
): number {
  if (!batteryItemId || typeof batteryItemId !== 'string') return 0;
  const s = Math.max(0, Math.floor(Number(stock[batteryItemId]) || 0));
  const inStorage = (storedBatteries || []).filter((b) => isBatteryAvailableForRackUse(b) && b.itemId === batteryItemId).length;
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
    if (!isUsableBatteryCatalog(upg)) {
      nb.splice(instIdx, 1);
      return;
    }
    return;
  }

  if (isRackBatteryInstanceUuid(id)) {
    return;
  }

  const upgCat = upgrades.find((u) => u.id === id && u.type === 'battery');
  if (!isUsableBatteryCatalog(upgCat)) return;
  nb.push({ id: newStoredId(), itemId: id });
}

export function batteryTierScore(def: GameUpgrade): number {
  if (!def || def.type !== 'battery') return 0;
  return Number.MAX_SAFE_INTEGER - 1;
}

function takeOneBatteryUnit(
  batteryItemId: string,
  batDef: GameUpgrade,
  ns: Record<string, number>,
  nb: StoredBatteryRow[]
): { instanceId: string } | null {
  const matching = nb.filter((b) => isBatteryAvailableForRackUse(b) && b.itemId === batteryItemId);
  if (matching.length > 0) {
    const best = matching[0];
    const idx = nb.findIndex((x) => x.id === best.id);
    if (idx < 0) return null;
    const [taken] = nb.splice(idx, 1);
    return { instanceId: taken.id };
  }
  if ((ns[batteryItemId] || 0) > 0) {
    ns[batteryItemId]--;
    if (ns[batteryItemId] <= 0) delete ns[batteryItemId];
    void batDef;
    return { instanceId: newStoredId() };
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
    out[i] = {
      ...rack,
      batteryId: null,
      batteryCatalogItemId: null,
      batteryDisplayName: null,
      batteryImageUrl: null,
      isOn: false
    };
  }

  type PoolEntry = { itemId: string; storageId?: string };
  const pool: PoolEntry[] = [];

  for (const u of upgrades) {
    if (!isUsableBatteryCatalog(u)) continue;
    const qtyStock = Math.max(0, Math.floor(Number(ns[u.id]) || 0));
    const storedList = nb.filter((b) => isBatteryAvailableForRackUse(b) && b.itemId === u.id);
    if (qtyStock === 0 && storedList.length === 0) continue;

    const usableOnAnyRack = racksInRoomIdx.some((ri) => {
      const ch = out[ri]?.itemId;
      if (!ch) return false;
      return !u.compatibleRacks?.length || u.compatibleRacks.includes(String(ch));
    });
    if (!usableOnAnyRack) continue;

    for (const s of storedList) {
      pool.push({ itemId: u.id, storageId: s.id });
    }
    for (let q = 0; q < qtyStock; q++) {
      pool.push({ itemId: u.id, storageId: undefined });
    }
  }

  if (pool.length === 0) {
    return { ok: false, message: 'Não há baterias no stock nem no armazém compatíveis com as rigs desta sala.' };
  }

  const sortedRacks = sortRackIndicesForAllocation(racksInRoomIdx, out, upgrades, rigSort);
  let applied = 0;

  for (const ri of sortedRacks) {
    const rack = out[ri];
    const ch = rack.itemId;
    const idx = pool.findIndex((p) => {
      const def = upgrades.find((x) => x.id === p.itemId);
      if (!isUsableBatteryCatalog(def)) return false;
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
      if (ns[picked.itemId] <= 0) delete ns[picked.itemId];
    }

    const rackBattId =
      picked.storageId != null && String(picked.storageId).trim() !== ''
        ? String(picked.storageId).trim()
        : newStoredId();
    out[ri] = {
      ...rack,
      batteryId: rackBattId,
      batteryCatalogItemId: picked.itemId,
      batteryDisplayName: def.name ?? null,
      batteryImageUrl: def.image ?? null,
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
      out[i] = {
        ...rack,
        batteryId: null,
        batteryCatalogItemId: null,
        batteryDisplayName: null,
        batteryImageUrl: null,
        isOn: false
      };
    }
    return {
      ok: true,
      next: { ...prev, stock: ns, storedBatteries: nb, placedRacks: out },
      appliedRigs: 0,
      compatibleRigs: 0
    };
  }

  const batDef = upgrades.find((u) => u.id === batteryUpgradeId && u.type === 'battery');
  if (!isUsableBatteryCatalog(batDef)) return { ok: false, message: 'Bateria inválida.' };

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
      batteryCatalogItemId: batteryUpgradeId,
      batteryDisplayName: batDef.name ?? null,
      batteryImageUrl: batDef.image ?? null,
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

export {
  isValidBatteryRigSort,
  isValidBatterySelectionId,
  isValidRoomId,
  normalizePlacedRackRoomId,
  parseBooleanSmartFill
} from './batteries.validation.js';
