import { normalizePlacedRackRoomId, type GameState, type PlacedRack, type StoredBattery, type Upgrade } from '../types';
import type { BatteryRigSortMode } from '../types/bulkRoomBattery';

const newStoredId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `sb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export type BulkRoomBatteryApplyOptions = {
  /** Ordenação das rigs ao distribuir unidades (modo tipo único ou inteligente). */
  rigSort?: BatteryRigSortMode;
};

/** Unidades disponíveis = caixas no `stock` + instâncias em `storedBatteries` (carga parcial ou cheia). */
export function totalBatteryInstances(
  batteryItemId: string,
  stock: Record<string, number>,
  storedBatteries: StoredBattery[],
  placedRacks?: PlacedRack[]
): number {
  if (!batteryItemId || typeof batteryItemId !== 'string') return 0;
  const s = Math.max(0, Math.floor(Number(stock[batteryItemId]) || 0));
  const mountedStorageIds = new Set(
    (placedRacks || [])
      .map((r) => (r?.batteryId ? String(r.batteryId) : ''))
      .filter((id) => id.length > 0)
  );
  const inStorage = (storedBatteries || []).filter(
    (b) => b && b.itemId === batteryItemId && !mountedStorageIds.has(String(b.id))
  ).length;
  return s + inStorage;
}

/** Hash teórico (GPUs × multiplicadores) para ordenar rigs — sem exigir bateria/fiação ligadas. */
export function rackTheoreticalHash(placedRacks: PlacedRack[], rackIndex: number, upgrades: Upgrade[]): number {
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
  placedRacks: PlacedRack[],
  upgrades: Upgrade[],
  rigSort: BatteryRigSortMode
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

/** Índices em `placedRacks` das rigs da sala compatíveis com a bateria. */
export function compatibleRackIndicesForBattery(
  placedRacks: PlacedRack[],
  roomId: string,
  batDef: Upgrade
): number[] {
  if (!roomId || !batDef || batDef.type !== 'battery') return [];
  const roomNorm = normalizePlacedRackRoomId(roomId);
  const inRoom = placedRacks
    .map((r, i) => (normalizePlacedRackRoomId(r.roomId) === roomNorm ? i : -1))
    .filter((i): i is number => i >= 0);
  return inRoom.filter((i) => {
    const rack = placedRacks[i];
    if (!rack) return false;
    if (!batDef.compatibleRacks?.length) return true;
    return batDef.compatibleRacks.includes(rack.itemId);
  });
}

function unloadRackBatteryToInventory(
  rack: PlacedRack,
  ns: Record<string, number>,
  nb: StoredBattery[],
  upgrades: Upgrade[]
): void {
  if (!rack.batteryId) return;
  const id = rack.batteryId;
  const upg = upgrades.find((u) => u.id === id);
  if (upg) {
    const capacity = upg.powerCapacity ?? 100;
    const isInf = capacity === -1;
    const isFull = isInf || rack.currentCharge >= capacity * 0.999;
    if (isFull) ns[id] = (ns[id] || 0) + 1;
    else nb.push({ id: newStoredId(), itemId: id, currentCharge: rack.currentCharge });
    return;
  }
  const mountedRow = nb.find((b) => b.id === id);
  if (mountedRow) {
    const def = upgrades.find((u) => u.id === mountedRow.itemId);
    const capacity = def?.powerCapacity ?? 100;
    const isInf = capacity === -1;
    const isFull = isInf || rack.currentCharge >= capacity * 0.999;
    if (isFull) {
      const iid = mountedRow.itemId;
      ns[iid] = (ns[iid] || 0) + 1;
      const ix = nb.findIndex((b) => b.id === mountedRow.id);
      if (ix >= 0) nb.splice(ix, 1);
    } else {
      mountedRow.currentCharge =
        typeof rack.currentCharge === 'number' ? rack.currentCharge : mountedRow.currentCharge;
    }
  }
}

type PoolEntry = {
  itemId: string;
  charge: number;
  /** Se definido, retirar esta linha de `storedBatteries` por `id`. */
  storageId?: string;
};

export function batteryTierScore(def: Upgrade | undefined): number {
  if (!def || def.type !== 'battery') return 0;
  const c = def.powerCapacity;
  if (c === -1) return Number.MAX_SAFE_INTEGER - 1;
  return Math.max(0, Number(c) || 0);
}

/** Energia atual na unidade (Wh). Smart fill e listas: priorizar mais Wh antes do tier do modelo. */
export function poolEntryEnergyWh(charge: number, def: Upgrade | undefined): number {
  if (!def || def.type !== 'battery') return 0;
  const cap = def.powerCapacity ?? 0;
  if (cap === -1) return Number.MAX_SAFE_INTEGER - 1;
  const q = typeof charge === 'number' && Number.isFinite(charge) ? charge : 0;
  return Math.max(0, q);
}

/** Ordena unidades armazenadas do mesmo tipo: mais carga primeiro (baterias “mais fortes” no sentido energético). */
function sortStoredInstancesForType(list: StoredBattery[], batDef: Upgrade): StoredBattery[] {
  const cap = batDef.powerCapacity ?? 0;
  return [...list].sort((a, b) => {
    if (cap === -1) return 0;
    return (b.currentCharge || 0) - (a.currentCharge || 0);
  });
}

/**
 * Retira uma unidade do armazém (prioriza instância com mais carga) ou do stock (nova cheia).
 */
function takeOneBatteryUnit(
  batteryItemId: string,
  batDef: Upgrade,
  ns: Record<string, number>,
  nb: StoredBattery[],
  placedRacks: PlacedRack[]
): { charge: number; rackMountId?: string } | null {
  const matching = nb
    .map((b, idx) => ({ b, idx }))
    .filter(({ b }) => b.itemId === batteryItemId && !placedRacks.some((r) => r.batteryId === b.id));
  const sorted = sortStoredInstancesForType(
    matching.map((m) => m.b),
    batDef
  );
  if (sorted.length > 0) {
    const best = sorted[0]!;
    const idx = nb.findIndex((x) => x.id === best.id);
    if (idx < 0) return null;
    const [taken] = nb.splice(idx, 1);
    const cap = batDef.powerCapacity ?? 0;
    if (cap === -1) return { charge: -1, rackMountId: taken.id };
    return {
      charge: typeof taken.currentCharge === 'number' ? taken.currentCharge : cap,
      rackMountId: taken.id
    };
  }
  if ((ns[batteryItemId] || 0) > 0) {
    ns[batteryItemId]--;
    const capRaw = batDef.powerCapacity;
    const initCharge = capRaw === -1 ? -1 : capRaw ?? 0;
    return { charge: initCharge };
  }
  return null;
}

export type BulkRoomBatteryResult =
  | { ok: true; next: GameState; appliedRigs: number; compatibleRigs: number; smartFill?: boolean }
  | { ok: false; message: string };

export function bulkBatteryWillApplyCount(
  compatibleRackCount: number,
  batteryItemId: string,
  stock: Record<string, number>,
  storedBatteries: StoredBattery[],
  placedRacks?: PlacedRack[]
): number {
  const avail = totalBatteryInstances(batteryItemId, stock, storedBatteries, placedRacks);
  return Math.max(0, Math.min(compatibleRackCount, avail));
}

/**
 * Preenchimento inteligente: esvazia baterias das rigs da sala, reconstrói um “pool” global
 * (tipos compatíveis com pelo menos uma rig), ordena por **energia útil (Wh na unidade)**
 * primeiro (evita equipar Powerwall a 0% quando há Nobreak/Pilhas carregadas), depois por
 * capacidade do modelo como desempate, e reatribui às rigs na ordem pedida.
 */
export function applyBulkRoomBatterySmartFill(
  prev: GameState,
  roomId: string,
  upgrades: Upgrade[],
  rigSort: BatteryRigSortMode
): BulkRoomBatteryResult {
  const room = normalizePlacedRackRoomId(roomId);
  if (!room) return { ok: false, message: 'Sala inválida.' };

  const racksInRoomIdx = prev.placedRacks
    .map((r, i) => (normalizePlacedRackRoomId(r.roomId) === room ? i : -1))
    .filter((i) => i >= 0);
  if (racksInRoomIdx.length === 0) {
    return { ok: false, message: 'Nenhuma rig nesta sala.' };
  }

  let ns = { ...prev.stock };
  let nb = [...(prev.storedBatteries || [])];
  const out = [...prev.placedRacks];

  for (const i of racksInRoomIdx) {
    const rack = out[i];
    if (!rack?.batteryId) continue;
    unloadRackBatteryToInventory(rack, ns, nb, upgrades);
    out[i] = { ...rack, batteryId: null, currentCharge: 0, isOn: false };
  }

  const pool: PoolEntry[] = [];

  for (const u of upgrades) {
    if (u.type !== 'battery') continue;
    const qtyStock = Math.max(0, Math.floor(Number(ns[u.id]) || 0));
    const storedList = nb.filter(
      (b) => b && b.itemId === u.id && !out.some((rack) => rack.batteryId === b.id)
    );
    if (storedList.length === 0 && qtyStock === 0) continue;

    const usableOnAnyRack = racksInRoomIdx.some((ri) => {
      const ch = out[ri]?.itemId;
      if (!ch) return false;
      return !u.compatibleRacks?.length || u.compatibleRacks.includes(ch);
    });
    if (!usableOnAnyRack) continue;

    const cap = u.powerCapacity ?? 0;
    for (const s of sortStoredInstancesForType(storedList, u)) {
      pool.push({
        itemId: u.id,
        charge: cap === -1 ? -1 : s.currentCharge,
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
      return !def.compatibleRacks?.length || def.compatibleRacks.includes(ch);
    });
    if (idx === -1) continue;
    const picked = pool[idx]!;
    pool.splice(idx, 1);
    const def = upgrades.find((x) => x.id === picked.itemId);
    if (!def) continue;

    if (picked.storageId) {
      const sbi = nb.findIndex((x) => x.id === picked.storageId);
      if (sbi < 0) continue;
    } else {
      if ((ns[picked.itemId] || 0) < 1) continue;
      ns[picked.itemId]--;
    }

    out[ri] = {
      ...rack,
      batteryId: picked.storageId ? picked.storageId : picked.itemId,
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

/**
 * Remove todas as baterias das rigs da sala (`batteryUpgradeId` vazio) ou equipa o mesmo tipo
 * em até N rigs compatíveis (N = min(rigs compatíveis, unidades em stock + armazém)).
 * Unidades do armazém: mais carregadas primeiro; rigs: ordem opcional por slot ou hashrate.
 */
export function applyBulkRoomBatteryChange(
  prev: GameState,
  roomId: string,
  batteryUpgradeId: string,
  upgrades: Upgrade[],
  opts?: BulkRoomBatteryApplyOptions
): BulkRoomBatteryResult {
  const room = normalizePlacedRackRoomId(roomId);
  if (!room) return { ok: false, message: 'Sala inválida.' };

  const racksInRoomIdx = prev.placedRacks
    .map((r, i) => (normalizePlacedRackRoomId(r.roomId) === room ? i : -1))
    .filter((i) => i >= 0);

  if (!batteryUpgradeId) {
    let ns = { ...prev.stock };
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

  const rigSort: BatteryRigSortMode = opts?.rigSort === 'hashrate_desc' ? 'hashrate_desc' : 'slot_asc';
  compatibleIdx = sortRackIndicesForAllocation(compatibleIdx, prev.placedRacks, upgrades, rigSort);

  const totalAvail = totalBatteryInstances(
    batteryUpgradeId,
    prev.stock,
    prev.storedBatteries || [],
    prev.placedRacks
  );
  if (totalAvail <= 0) {
    return { ok: false, message: `Não há unidades de "${batDef.name}" no stock nem no armazém.` };
  }

  const nApply = Math.min(compatibleIdx.length, totalAvail);
  let ns = { ...prev.stock };
  const nb = [...(prev.storedBatteries || [])];
  const out = [...prev.placedRacks];

  for (let k = 0; k < nApply; k++) {
    const i = compatibleIdx[k]!;
    const rack = { ...out[i] };
    if (rack.batteryId) unloadRackBatteryToInventory(rack, ns, nb, upgrades);
    const taken = takeOneBatteryUnit(batteryUpgradeId, batDef, ns, nb, out);
    if (!taken) {
      return { ok: false, message: 'Falha ao retirar unidade do estoque/armazém. Tente novamente.' };
    }
    out[i] = {
      ...rack,
      batteryId: taken.rackMountId ?? batteryUpgradeId,
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
