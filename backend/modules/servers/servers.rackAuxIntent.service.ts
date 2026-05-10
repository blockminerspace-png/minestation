/**
 * Regras de equipar/desequipar auxiliares na rig (bateria, cablagem, multiplicador) — espelho do frontend `App.tsx`.
 */
import crypto from 'node:crypto';
import { SAVE_GAME_ITEM_ID_RE } from '../../lib/saveGameEconomyValidate.js';
import type { PlacedRackLoaded } from '../../lib/serverRoomPersistence.js';

export type RackAuxUpgradeRow = {
  id: string;
  type?: string;
  category?: string;
  powerCapacity?: number;
  name?: string | null;
  image?: string | null;
};

export type StoredBatteryRowLite = {
  id: string;
  itemId: string;
  currentCharge: number;
  powerCapacityWh?: number | null;
  displayName?: string | null;
  imageUrl?: string | null;
  workshopSlotIndex?: number | null;
  workshopComponentSlotId?: string | null;
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

function isBatteryUpgrade(upgrades: RackAuxUpgradeRow[], id: string): boolean {
  return upgrades.some((u) => u.id === id && u.type === 'battery');
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
  let oldCharge = 0;
  if (input.kind === 'battery' && r.batteryId) {
    oldItemId = r.batteryId;
    oldCharge = r.currentCharge;
  } else if (input.kind === 'wiring' && r.wiringId) {
    oldItemId = r.wiringId;
  } else if (input.kind === 'multiplier' && r.multiplierSlots[input.multiplierSlotIndex]) {
    oldItemId = r.multiplierSlots[input.multiplierSlotIndex]!;
  }

  if (oldItemId) {
    const hintSnapOld = { ...hintObj };
    if (input.kind === 'battery') {
      const catOld = resolveEquippedBatteryCatalogId(oldItemId, nb, upgrades, hintSnapOld);
      if (catOld) {
        const upg = upgrades.find((u) => u.id === catOld && u.type === 'battery');
        const capacity = upg?.powerCapacity || 100;
        const isFull = oldCharge >= capacity * 0.999;
        if (isFull) {
          ns[catOld] = (ns[catOld] || 0) + 1;
        } else {
          const upOld = upgrades.find((u) => u.id === catOld && u.type === 'battery');
          nb.push({
            id: newBatteryInstanceId(),
            itemId: catOld,
            currentCharge: oldCharge,
            powerCapacityWh: upOld?.powerCapacity ?? null,
            displayName: upOld?.name ?? null,
            imageUrl: upOld?.image ?? null
          });
        }
      }
    } else {
      ns[oldItemId] = (ns[oldItemId] || 0) + 1;
    }
  }

  if (input.kind === 'battery') {
    if (input.battery.mode === 'from_warehouse') {
      const sbid = String(input.battery.storedBatteryId || '').trim();
      const s = nb.find((b) => b.id === sbid);
      if (!s) return { ok: false, error: 'Bateria não encontrada no armazém.' };
      if (s.workshopSlotIndex != null || s.workshopComponentSlotId) {
        return { ok: false, error: 'Bateria está na oficina; remova da oficina antes de equipar na rig.' };
      }
      const initCharge = s.currentCharge;
      nb = nb.filter((b) => b.id !== sbid);
      r.batteryId = sbid;
      const catW = String(s.itemId).trim();
      const upW = upgrades.find((u) => u.id === catW && u.type === 'battery');
      r.batteryCatalogItemId = catW;
      r.batteryPowerCapacityWh = upW?.powerCapacity ?? null;
      r.batteryDisplayName = upW?.name ?? null;
      r.batteryImageUrl = upW?.image ?? null;
      r.currentCharge = initCharge;
      r.isOn = true;
    } else {
      const iid = String(input.battery.catalogItemId || '').trim();
      if (!SAVE_GAME_ITEM_ID_RE.test(iid) || !isBatteryUpgrade(upgrades, iid)) {
        return { ok: false, error: 'Item de bateria inválido.' };
      }
      if ((ns[iid] || 0) < 1) return { ok: false, error: 'Stock insuficiente.' };
      ns[iid]--;
      const initCharge = upgrades.find((u) => u.id === iid)?.powerCapacity || 0;
      r.batteryId = newBatteryInstanceId();
      const upS = upgrades.find((u) => u.id === iid && u.type === 'battery');
      r.batteryCatalogItemId = iid;
      r.batteryPowerCapacityWh = upS?.powerCapacity ?? null;
      r.batteryDisplayName = upS?.name ?? null;
      r.batteryImageUrl = upS?.image ?? null;
      r.currentCharge = initCharge;
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
    if (!catId) return { ok: false, error: 'Não foi possível resolver o tipo da bateria.' };
    const upg = upgrades.find((u) => u.id === catId && u.type === 'battery');
    const capacity = upg?.powerCapacity || 100;
    const isFull = r.currentCharge >= capacity * 0.999;
    if (isFull) {
      ns[catId] = (ns[catId] || 0) + 1;
    } else {
      nb.push({
        id: newBatteryInstanceId(),
        itemId: catId,
        currentCharge: r.currentCharge,
        powerCapacityWh: upg?.powerCapacity ?? null,
        displayName: upg?.name ?? null,
        imageUrl: upg?.image ?? null
      });
    }
    r.batteryId = null;
    r.batteryCatalogItemId = undefined;
    r.batteryPowerCapacityWh = undefined;
    r.batteryDisplayName = undefined;
    r.batteryImageUrl = undefined;
    r.currentCharge = 0;
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
