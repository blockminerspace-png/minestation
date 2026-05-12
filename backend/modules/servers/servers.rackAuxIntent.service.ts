/**
 * Regras de equipar/desequipar auxiliares na rig (bateria, cablagem, multiplicador) — espelho do frontend `App.tsx`.
 *
 * Sistema de carregamento descontinuado em
 * `20260516180000_battery_uuids_and_purge_charging`: cada bateria é uma
 * instância UUID infinita em `stored_batteries`; já não há `current_charge`,
 * `power_capacity_wh`, oficina ou cargas parciais que distingam stock de armazém.
 */
import crypto from 'node:crypto';
import { stableIntentFingerprint } from '../../lib/gameIntentIdempotencyPrisma.js';
import { SAVE_GAME_ITEM_ID_RE } from '../../lib/saveGameEconomyValidate.js';
import type { PlacedRackLoaded } from '../../lib/serverRoomPersistence.js';
import { normalizePlacedRackRoomId } from '../batteries/batteries.validation.js';

export type RackAuxUpgradeRow = {
  id: string;
  type?: string;
  category?: string;
  powerCapacity?: number;
  name?: string | null;
  image?: string | null;
  slotsCapacity?: number;
  aiSlotsCapacity?: number;
  /** 0 = inactivo no catálogo. */
  isActive?: number;
  compatibleRacks?: string[];
};

export type StoredBatteryRowLite = {
  id: string;
  itemId: string;
  displayName?: string | null;
  imageUrl?: string | null;
};

function newBatteryInstanceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

export function resolveEquippedBatteryCatalogId(
  batteryId: string | null | undefined,
  storedBatteries: StoredBatteryRowLite[],
  upgrades: RackAuxUpgradeRow[],
  hints?: Readonly<Record<string, string>> | null
): string | null {
  if (batteryId == null) return null;
  const bid = String(batteryId).trim();
  if (!bid) return null;
  const hinted = hints?.[bid] != null ? String(hints[bid]).trim() : '';
  if (hinted && upgrades.some((u) => u.id === hinted && u.type === 'battery')) return hinted;
  if (upgrades.some((u) => u.id === bid && u.type === 'battery')) return bid;
  const row = storedBatteries.find((b) => String(b.id) === bid);
  const cat = row?.itemId != null ? String(row.itemId).trim() : '';
  if (cat && upgrades.some((u) => u.id === cat && u.type === 'battery')) return cat;
  return null;
}

function cloneRack(r: PlacedRackLoaded): PlacedRackLoaded {
  return {
    ...r,
    slots: [...(r.slots || [])],
    multiplierSlots: [...(r.multiplierSlots || [])]
  };
}

export type RackAuxEquipBatteryInput =
  | { mode: 'from_warehouse'; storedBatteryId: string }
  | { mode: 'from_stock'; catalogItemId: string };

export type RackAuxEquipInput =
  | { kind: 'battery'; battery: RackAuxEquipBatteryInput }
  | { kind: 'wiring'; catalogItemId: string }
  | { kind: 'multiplier'; catalogItemId: string; multiplierSlotIndex: number };

export type RackAuxUnequipInput =
  | { kind: 'battery' }
  | { kind: 'wiring' }
  | { kind: 'multiplier'; multiplierSlotIndex: number };

export type RackAuxApplyResult =
  | { ok: true; stock: Record<string, number>; storedBatteries: StoredBatteryRowLite[]; placedRacks: PlacedRackLoaded[] }
  | { ok: false; error: string };

export type RackAuxApplyFn = (
  prev: {
    stock: Record<string, number>;
    storedBatteries: StoredBatteryRowLite[];
    placedRacks: PlacedRackLoaded[];
  },
  upgrades: RackAuxUpgradeRow[],
  /** Instância montada na rig → catálogo (`placed_racks.battery_catalog_item_id`), quando não há linha em `stored_batteries`. */
  rackBatteryCatalogHints: Readonly<Map<string, string>> | null
) => RackAuxApplyResult;

/** Mapa bateria montada (UUID) → item de catálogo, a partir do estado carregado das rigs. */
export function rackBatteryCatalogHintsFromPlacedRacks(
  placedRacks: PlacedRackLoaded[]
): Readonly<Map<string, string>> | null {
  const m = new Map<string, string>();
  for (const r of placedRacks) {
    const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
    const cat = r.batteryCatalogItemId != null ? String(r.batteryCatalogItemId).trim() : '';
    if (bid && cat) m.set(bid, cat);
  }
  return m.size > 0 ? m : null;
}

function isBatteryUpgrade(upgrades: RackAuxUpgradeRow[], id: string): boolean {
  return upgrades.some((u) => u.id === id && u.type === 'battery');
}

function isMachineUpgrade(upgrades: RackAuxUpgradeRow[], id: string): boolean {
  return upgrades.some((u) => u.id === id && u.type === 'machine');
}

function returnBatteryInstanceToWarehouse(
  storedBatteries: StoredBatteryRowLite[],
  batteryId: string,
  catalogId: string,
  upgrades: RackAuxUpgradeRow[]
): void {
  const upg = upgrades.find((u) => u.id === catalogId && u.type === 'battery');
  const id = batteryId && batteryId.trim() !== '' ? batteryId.trim() : newBatteryInstanceId();
  // Dedup defensivo: `loadUserStoredBatteries` carrega TODAS as instâncias do
  // jogador (INVENTORY + EQUIPPED). Ao desequipar, a instância já existe no array
  // como EQUIPPED. PUSH cego duplicaria o UUID na resposta ao cliente (DB fica
  // íntegro pelo PK, mas a UI mostra 2 cards do mesmo UUID).
  for (let i = storedBatteries.length - 1; i >= 0; i--) {
    if (storedBatteries[i] && storedBatteries[i].id === id) storedBatteries.splice(i, 1);
  }
  storedBatteries.push({
    id,
    itemId: catalogId,
    displayName: upg?.name ?? null,
    imageUrl: upg?.image ?? null
  });
}

export function applyRackMinerEquip(
  prev: {
    stock: Record<string, number>;
    storedBatteries: StoredBatteryRowLite[];
    placedRacks: PlacedRackLoaded[];
  },
  rackId: string,
  slotIndexRaw: number,
  catalogItemId: string,
  upgrades: RackAuxUpgradeRow[]
): RackAuxApplyResult {
  const ri = prev.placedRacks.findIndex((r) => r.id === rackId);
  if (ri === -1) return { ok: false, error: 'Rig não encontrada.' };

  const slotIndex = Math.floor(Number(slotIndexRaw));
  if (!Number.isFinite(slotIndex) || slotIndex < 0) return { ok: false, error: 'Slot de GPU inválido.' };

  const itemId = String(catalogItemId || '').trim();
  if (!SAVE_GAME_ITEM_ID_RE.test(itemId) || !isMachineUpgrade(upgrades, itemId)) {
    return { ok: false, error: 'GPU inválida.' };
  }

  const def = upgrades.find((u) => u.id === itemId && u.type === 'machine');
  if (!def || def.isActive === 0) return { ok: false, error: 'GPU indisponível ou inativa.' };

  const placedRacks = prev.placedRacks.map(cloneRack);
  const rack = cloneRack(placedRacks[ri]);
  const rackDef = upgrades.find((u) => u.id === rack.itemId);
  const declaredSlots =
    rackDef?.slotsCapacity != null && Number.isFinite(rackDef.slotsCapacity)
      ? Math.max(0, Math.min(128, Math.floor(Number(rackDef.slotsCapacity))))
      : 0;
  const maxAllowedSlot = declaredSlots > 0 ? declaredSlots - 1 : 127;
  if (slotIndex > maxAllowedSlot) return { ok: false, error: 'Slot de GPU inválido.' };
  rack.slots = [...(rack.slots || [])];
  while (rack.slots.length <= slotIndex) rack.slots.push('');
  if (rack.slots[slotIndex]) return { ok: false, error: 'Slot já ocupado.' };
  if (def.compatibleRacks?.length && !def.compatibleRacks.includes(rack.itemId)) {
    return { ok: false, error: 'GPU incompatível com esta rig.' };
  }

  const stock = { ...prev.stock };
  if ((stock[itemId] || 0) < 1) return { ok: false, error: 'Stock insuficiente.' };
  stock[itemId] = (stock[itemId] || 0) - 1;
  if (stock[itemId] <= 0) delete stock[itemId];

  rack.slots[slotIndex] = itemId;
  placedRacks[ri] = rack;
  return { ok: true, stock, storedBatteries: [...prev.storedBatteries], placedRacks };
}

export function applyRackMinerUnequip(
  prev: {
    stock: Record<string, number>;
    storedBatteries: StoredBatteryRowLite[];
    placedRacks: PlacedRackLoaded[];
  },
  rackId: string,
  slotIndexRaw: number
): RackAuxApplyResult {
  const ri = prev.placedRacks.findIndex((r) => r.id === rackId);
  if (ri === -1) return { ok: false, error: 'Rig não encontrada.' };

  const slotIndex = Math.floor(Number(slotIndexRaw));
  if (!Number.isFinite(slotIndex) || slotIndex < 0) return { ok: false, error: 'Slot de GPU inválido.' };

  const placedRacks = prev.placedRacks.map(cloneRack);
  const rack = cloneRack(placedRacks[ri]);
  if (slotIndex >= (rack.slots || []).length) return { ok: false, error: 'Slot de GPU inválido.' };

  const itemId = rack.slots[slotIndex] != null ? String(rack.slots[slotIndex]).trim() : '';
  if (!itemId) return { ok: false, error: 'Nada equipado nesse slot.' };

  const stock = { ...prev.stock };
  stock[itemId] = (stock[itemId] || 0) + 1;
  rack.slots = [...(rack.slots || [])];
  rack.slots[slotIndex] = '';
  placedRacks[ri] = rack;
  return { ok: true, stock, storedBatteries: [...prev.storedBatteries], placedRacks };
}

/**
 * `rackHints`: mapa instância UUID → id de catálogo (bateria montada a partir de stock sem linha prévia no armazém).
 */
export function applyRackAuxEquip(
  prev: {
    stock: Record<string, number>;
    storedBatteries: StoredBatteryRowLite[];
    placedRacks: PlacedRackLoaded[];
  },
  rackId: string,
  input: RackAuxEquipInput,
  upgrades: RackAuxUpgradeRow[],
  rackHints: Readonly<Map<string, string>> | null
): RackAuxApplyResult {
  const ri = prev.placedRacks.findIndex((r) => r.id === rackId);
  if (ri === -1) return { ok: false, error: 'Rig não encontrada.' };
  const placedRacks = [...prev.placedRacks];
  const r = cloneRack(placedRacks[ri]);
  let ns = { ...prev.stock };
  let nb = [...prev.storedBatteries];

  const hintObj = rackHints ? Object.fromEntries(rackHints) : undefined;

  let oldItemId: string | null = null;
  let oldBatteryId: string | null = null;
  if (input.kind === 'battery' && r.batteryId) {
    oldItemId = r.batteryId;
    oldBatteryId = r.batteryId;
  } else if (input.kind === 'wiring' && r.wiringId) {
    oldItemId = r.wiringId;
  } else if (input.kind === 'multiplier' && r.multiplierSlots[input.multiplierSlotIndex]) {
    oldItemId = r.multiplierSlots[input.multiplierSlotIndex]!;
  }

  if (oldItemId) {
    if (input.kind === 'battery' && oldBatteryId) {
      const catOld = resolveEquippedBatteryCatalogId(oldBatteryId, nb, upgrades, hintObj);
      if (catOld) {
        returnBatteryInstanceToWarehouse(nb, oldBatteryId, catOld, upgrades);
      }
    } else if (input.kind !== 'battery') {
      ns[oldItemId] = (ns[oldItemId] || 0) + 1;
    }
  }

  if (input.kind === 'battery') {
    if (input.battery.mode === 'from_warehouse') {
      const sbid = String(input.battery.storedBatteryId || '').trim();
      const s = nb.find((b) => b.id === sbid);
      if (!s) return { ok: false, error: 'Bateria não encontrada no armazém.' };
      nb = nb.filter((b) => b.id !== sbid);
      r.batteryId = sbid;
      const catW = String(s.itemId).trim();
      const upW = upgrades.find((u) => u.id === catW && u.type === 'battery');
      r.batteryCatalogItemId = catW;
      r.batteryDisplayName = upW?.name ?? null;
      r.batteryImageUrl = upW?.image ?? null;
      r.isOn = true;
    } else {
      const iid = String(input.battery.catalogItemId || '').trim();
      if (!SAVE_GAME_ITEM_ID_RE.test(iid) || !isBatteryUpgrade(upgrades, iid)) {
        return { ok: false, error: 'Item de bateria inválido.' };
      }
      if ((ns[iid] || 0) < 1) return { ok: false, error: 'Stock insuficiente.' };
      ns[iid]--;
      r.batteryId = newBatteryInstanceId();
      const upS = upgrades.find((u) => u.id === iid && u.type === 'battery');
      r.batteryCatalogItemId = iid;
      r.batteryDisplayName = upS?.name ?? null;
      r.batteryImageUrl = upS?.image ?? null;
      r.isOn = true;
    }
  } else if (input.kind === 'wiring') {
    const iid = String(input.catalogItemId || '').trim();
    if (!SAVE_GAME_ITEM_ID_RE.test(iid)) return { ok: false, error: 'Circuito inválido.' };
    if ((ns[iid] || 0) < 1) return { ok: false, error: 'Stock insuficiente.' };
    ns[iid]--;
    r.wiringId = iid;
  } else if (input.kind === 'multiplier') {
    const iid = String(input.catalogItemId || '').trim();
    const idx = input.multiplierSlotIndex;
    if (!Number.isFinite(idx) || idx < 0) return { ok: false, error: 'Índice de slot inválido.' };
    if (!SAVE_GAME_ITEM_ID_RE.test(iid)) return { ok: false, error: 'Multiplicador inválido.' };
    if ((ns[iid] || 0) < 1) return { ok: false, error: 'Stock insuficiente.' };
    ns[iid]--;
    const ms = [...r.multiplierSlots];
    while (ms.length <= idx) ms.push('');
    ms[idx] = iid;
    r.multiplierSlots = ms;
  }

  placedRacks[ri] = r;
  return { ok: true, stock: ns, storedBatteries: nb, placedRacks };
}

export function applyRackAuxUnequip(
  prev: {
    stock: Record<string, number>;
    storedBatteries: StoredBatteryRowLite[];
    placedRacks: PlacedRackLoaded[];
  },
  rackId: string,
  input: RackAuxUnequipInput,
  upgrades: RackAuxUpgradeRow[],
  rackHints: Readonly<Map<string, string>> | null
): RackAuxApplyResult {
  const ri = prev.placedRacks.findIndex((r) => r.id === rackId);
  if (ri === -1) return { ok: false, error: 'Rig não encontrada.' };
  const placedRacks = [...prev.placedRacks];
  const r = cloneRack(placedRacks[ri]);
  let ns = { ...prev.stock };
  let nb = [...prev.storedBatteries];

  const hintObj = rackHints ? Object.fromEntries(rackHints) : undefined;

  let id: string | null = null;
  if (input.kind === 'battery') id = r.batteryId;
  else if (input.kind === 'wiring') id = r.wiringId;
  else id = r.multiplierSlots[input.multiplierSlotIndex] || null;

  if (!id) return { ok: false, error: 'Nada equipado nesse slot.' };

  if (input.kind === 'battery') {
    const catId = resolveEquippedBatteryCatalogId(id, nb, upgrades, hintObj);
    if (catId) {
      returnBatteryInstanceToWarehouse(nb, id, catId, upgrades);
    }
    r.batteryId = null;
    r.batteryCatalogItemId = undefined;
    r.batteryDisplayName = undefined;
    r.batteryImageUrl = undefined;
    r.isOn = false;
  } else if (input.kind === 'wiring') {
    ns[id] = (ns[id] || 0) + 1;
    r.wiringId = null;
  } else {
    ns[id] = (ns[id] || 0) + 1;
    const ms = [...r.multiplierSlots];
    ms[input.multiplierSlotIndex] = '';
    r.multiplierSlots = ms;
  }

  placedRacks[ri] = r;
  return { ok: true, stock: ns, storedBatteries: nb, placedRacks };
}

export function placeRackIntentFingerprint(parts: {
  catalogItemId: string;
  roomId: string;
  slotIndex: number;
}): string {
  return stableIntentFingerprint({
    catalogItemId: String(parts.catalogItemId || '').trim(),
    roomId: normalizePlacedRackRoomId(parts.roomId),
    slotIndex: Math.floor(Number(parts.slotIndex) || 0)
  });
}

export function applyRemoveRackToStock(
  prev: {
    stock: Record<string, number>;
    storedBatteries: StoredBatteryRowLite[];
    placedRacks: PlacedRackLoaded[];
  },
  rackId: string,
  upgrades: RackAuxUpgradeRow[],
  rackHints: Readonly<Map<string, string>> | null
): RackAuxApplyResult {
  const ri = prev.placedRacks.findIndex((r) => r.id === rackId);
  if (ri === -1) return { ok: false, error: 'Rig não encontrada.' };

  const rack = cloneRack(prev.placedRacks[ri]);
  const stock = { ...prev.stock };
  const storedBatteries = [...prev.storedBatteries];
  const hintObj = rackHints ? Object.fromEntries(rackHints) : undefined;

  const bump = (id: string | null | undefined) => {
    const itemId = id != null ? String(id).trim() : '';
    if (!itemId) return;
    stock[itemId] = (stock[itemId] || 0) + 1;
  };

  bump(rack.itemId);
  bump(rack.wiringId);
  for (const sid of rack.slots || []) bump(sid || null);
  for (const mid of rack.multiplierSlots || []) bump(mid || null);

  const batteryId = rack.batteryId != null ? String(rack.batteryId).trim() : '';
  if (batteryId) {
    const catId = resolveEquippedBatteryCatalogId(batteryId, storedBatteries, upgrades, hintObj);
    if (catId) {
      returnBatteryInstanceToWarehouse(storedBatteries, batteryId, catId, upgrades);
    }
  }

  const placedRacks = prev.placedRacks.filter((r) => r.id !== rackId).map(cloneRack);
  return { ok: true, stock, storedBatteries, placedRacks };
}

/** Coloca nova rig a partir do stock (espelho seguro de `handlePlaceRack` no cliente). */
export function applyPlaceRackFromStock(
  prev: {
    stock: Record<string, number>;
    storedBatteries: StoredBatteryRowLite[];
    placedRacks: PlacedRackLoaded[];
  },
  catalogItemId: string,
  roomIdRaw: string,
  slotIndexRaw: number,
  upgrades: RackAuxUpgradeRow[]
): RackAuxApplyResult {
  const typeId = String(catalogItemId || '').trim();
  if (!typeId || !SAVE_GAME_ITEM_ID_RE.test(typeId)) {
    return { ok: false, error: 'Chassi inválido.' };
  }
  const def = upgrades.find((u) => u.id === typeId);
  if (!def) {
    return { ok: false, error: 'Item de catálogo não encontrado.' };
  }
  if (def.isActive === 0) {
    return { ok: false, error: 'Item indisponível ou inativo.' };
  }
  const roomN = normalizePlacedRackRoomId(roomIdRaw);
  if (!roomN || roomN === 'null') {
    return { ok: false, error: 'Sala inválida.' };
  }
  if (!Number.isFinite(slotIndexRaw) || slotIndexRaw < 0 || slotIndexRaw > 999) {
    return { ok: false, error: 'Índice de slot inválido.' };
  }
  const slotIndex = Math.floor(slotIndexRaw);
  const stock = { ...prev.stock };
  const storedBatteries = [...prev.storedBatteries];
  const placedBeforeInsert = prev.placedRacks.map(cloneRack);
  const occupiedIndex = placedBeforeInsert.findIndex(
    (r) => normalizePlacedRackRoomId(r.roomId) === roomN && Math.floor(Number(r.slotIndex) || 0) === slotIndex
  );
  if (occupiedIndex >= 0) {
    const oldRack = placedBeforeInsert[occupiedIndex];
    const bump = (id: string | null | undefined) => {
      const itemId = id != null ? String(id).trim() : '';
      if (!itemId) return;
      stock[itemId] = (stock[itemId] || 0) + 1;
    };

    bump(oldRack.itemId);
    bump(oldRack.wiringId);
    for (const sid of oldRack.slots || []) bump(sid || null);
    for (const mid of oldRack.multiplierSlots || []) bump(mid || null);

    const oldBatteryId = oldRack.batteryId != null ? String(oldRack.batteryId).trim() : '';
    if (oldBatteryId) {
      const hint =
        oldRack.batteryCatalogItemId != null && String(oldRack.batteryCatalogItemId).trim() !== ''
          ? { [oldBatteryId]: String(oldRack.batteryCatalogItemId).trim() }
          : undefined;
      const catId = resolveEquippedBatteryCatalogId(oldBatteryId, storedBatteries, upgrades, hint);
      if (catId) {
        returnBatteryInstanceToWarehouse(storedBatteries, oldBatteryId, catId, upgrades);
      }
    }

    placedBeforeInsert.splice(occupiedIndex, 1);
  }

  const qty = Number(stock[typeId] || 0);
  if (!Number.isFinite(qty) || qty < 1) {
    return { ok: false, error: 'Stock insuficiente para montar esta rig.' };
  }
  const cap =
    def.slotsCapacity != null && Number.isFinite(def.slotsCapacity)
      ? Math.max(1, Math.min(128, Math.floor(Number(def.slotsCapacity))))
      : 10;
  const aiCap =
    def.aiSlotsCapacity != null && Number.isFinite(def.aiSlotsCapacity)
      ? Math.max(0, Math.min(64, Math.floor(Number(def.aiSlotsCapacity))))
      : 0;
  let rackId: string;
  try {
    rackId = crypto.randomUUID();
  } catch {
    rackId = `rack_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  const slots: string[] = [];
  for (let i = 0; i < cap; i++) slots.push('');
  const multiplierSlots: string[] = [];
  for (let i = 0; i < aiCap; i++) multiplierSlots.push('');
  const newRack: PlacedRackLoaded = {
    id: rackId,
    itemId: typeId,
    slots,
    multiplierSlots,
    wiringId: null,
    batteryId: null,
    isOn: false,
    selectedCoinId: null,
    roomId: roomN,
    slotIndex,
    batteryCatalogItemId: null,
    batteryDisplayName: null,
    batteryImageUrl: null
  };
  stock[typeId] = qty - 1;
  if (stock[typeId] <= 0) delete stock[typeId];
  const placedRacks = [...placedBeforeInsert, newRack];
  return { ok: true, stock, storedBatteries, placedRacks };
}
