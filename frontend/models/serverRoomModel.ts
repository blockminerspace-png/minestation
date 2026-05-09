import type { PlacedRack, StoredBattery, Upgrade, WorkshopStructure } from '../types';
import { readWorkshopBatterySlotField } from '../lib/workshopBatterySlotStorageKey';
import { NFT_AUTO_ALLOWED_CHASSIS_ID, isNftAutoArmario1OnlyRoomContext } from '../types';
import { batteryTierScore, poolEntryEnergyWh } from './roomBatteryModel';

/** UUID v4 de instância em `stored_batteries.id` / `placed_racks.battery_id` (alinhado ao servidor). */
const RACK_BATTERY_INSTANCE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRackBatteryInstanceUuid(batteryId: string | null | undefined): boolean {
  return RACK_BATTERY_INSTANCE_UUID_RE.test(String(batteryId ?? '').trim());
}

function normalizedStoredChargeWh(sb: StoredBattery): number {
  const q = sb.currentCharge;
  if (typeof q === 'number' && Number.isFinite(q)) return q;
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Baterias montadas nos carregadores da oficina: a carga vive em `slotCharges`, não em `stored_batteries`
 * (a linha do armazém é apagada ao equipar no carregador).
 */
export function listWorkshopMountedBatteryInstances(
  workshopSlots: (WorkshopStructure | null)[] | null | undefined,
  upgrades: Upgrade[]
): StoredBattery[] {
  const out: StoredBattery[] = [];
  const seen = new Set<string>();
  const arr = workshopSlots && workshopSlots.length ? workshopSlots : [];
  for (const ws of arr) {
    if (!ws || !ws.itemId) continue;
    const chargerDef = upgrades.find((u) => u.id === ws.itemId);
    if (!chargerDef || chargerDef.type !== 'charger') continue;
    const layout = chargerDef.layout;
    if (!layout?.slots?.length) continue;
    const internal = (ws.internalSlots || {}) as Record<string, unknown>;
    const slotCharges = (ws.slotCharges || {}) as Record<string, unknown>;
    const slotItemIds = (ws.slotItemIds || {}) as Record<string, unknown>;
    const slotsArr = layout.slots;
    for (let li = 0; li < slotsArr.length; li++) {
      const s = slotsArr[li];
      if (s.type !== 'battery') continue;
      const rawId = readWorkshopBatterySlotField(internal, slotsArr, li);
      if (rawId == null) continue;
      const instanceId = String(rawId).trim();
      if (!instanceId || !RACK_BATTERY_INSTANCE_UUID_RE.test(instanceId)) continue;
      if (seen.has(instanceId)) continue;
      const itemIdRaw = readWorkshopBatterySlotField(slotItemIds, slotsArr, li);
      const itemId = String(itemIdRaw ?? '').trim();
      if (!itemId) continue;
      const batDef = upgrades.find((u) => u.id === itemId);
      const chRaw = readWorkshopBatterySlotField(slotCharges, slotsArr, li);
      const ch = typeof chRaw === 'number' && Number.isFinite(chRaw) ? chRaw : Number(chRaw);
      const currentCharge = Number.isFinite(ch) ? ch : 0;
      seen.add(instanceId);
      const capSnap = batDef?.powerCapacity;
      out.push({
        id: instanceId,
        itemId,
        currentCharge,
        powerCapacityWh: capSnap != null && Number.isFinite(capSnap) ? capSnap : null,
        fromWorkshopSlot: true
      });
    }
  }
  return out;
}

/** `rack.batteryId` deve ser UUID de instância; catálogo só em legado até migração.
 * `batteryInstanceCatalogHints`: mapa instância UUID → id de catálogo (ex.: após equipar do armazém a linha some do array local). */
export function resolvePlacedRackBatteryCatalogId(
  rack: PlacedRack,
  storedBatteries: StoredBattery[] | null | undefined,
  upgrades?: Upgrade[] | null,
  batteryInstanceCatalogHints?: Readonly<Record<string, string>> | null
): string | null {
  const bid = rack.batteryId != null ? String(rack.batteryId).trim() : '';
  if (!bid) return null;

  const snapCat =
    rack.batteryCatalogItemId != null ? String(rack.batteryCatalogItemId).trim() : '';
  if (snapCat && upgrades?.length) {
    const okSnap = upgrades.some((u) => u.id === snapCat && u.type === 'battery');
    if (okSnap) return snapCat;
  }

  const hintedRaw = batteryInstanceCatalogHints?.[bid];
  const hinted = hintedRaw != null ? String(hintedRaw).trim() : '';
  if (hinted && upgrades?.length) {
    const ok = upgrades.some((u) => u.id === hinted && u.type === 'battery');
    if (ok) return hinted;
  }

  const row = (storedBatteries || []).find((b) => String(b.id).trim() === bid);
  const catFromRow = row?.itemId != null ? String(row.itemId).trim() : '';

  if (upgrades && upgrades.length > 0) {
    if (catFromRow) {
      const fromCat = upgrades.find((u) => u.id === catFromRow && u.type === 'battery');
      if (fromCat) return catFromRow;
    }
    const direct = upgrades.find((u) => u.id === bid && u.type === 'battery');
    if (direct) return bid;
    return null;
  }
  if (catFromRow) return catFromRow;
  return bid;
}

export type ServerRoomSelectionType = 'machine' | 'battery' | 'wiring' | 'multiplier' | 'rack';

export interface ServerRoomSelectionContext {
  rackId: string | null;
  slotIndex: number | null;
  type: ServerRoomSelectionType;
  roomId?: string | null;
  roomName?: string | null;
  /** Vindo de `/api/my-rig-rooms` quando a sala está na política NFT H1-only. */
  nftAutoArmario1Only?: boolean;
}

export function calculateRackConsumptionWatts(rack: PlacedRack, upgrades: Upgrade[]): number {
  const slotsWatts = (rack.slots || []).reduce((acc, sid) => {
    const m = upgrades.find((u) => u.id === sid);
    return acc + (m?.powerConsumption || 0);
  }, 0);
  const multWatts = (rack.multiplierSlots || []).reduce((acc, sid) => {
    const m = upgrades.find((u) => u.id === sid);
    return acc + (m?.powerConsumption || 0);
  }, 0);

  let total = slotsWatts + multWatts;
  if (rack.wiringId) {
    const wiring = upgrades.find((u) => u.id === rack.wiringId);
    if (wiring?.energyConsumptionReduction) {
      total *= 1 - wiring.energyConsumptionReduction;
    }
  }
  return total;
}

/** Segundos até 0 Wh ao ritmo atual (Wh × 3600 / W), alinhado ao servidor. */
export function estimateRackBatteryRuntimeSeconds(
  rack: PlacedRack,
  upgrades: Upgrade[],
  storedBatteries?: StoredBattery[] | null,
  batteryInstanceCatalogHints?: Readonly<Record<string, string>> | null
): number | null {
  const catalogId = resolvePlacedRackBatteryCatalogId(rack, storedBatteries, upgrades, batteryInstanceCatalogHints);
  if (!catalogId) return null;
  const battery = upgrades.find((u) => u.id === catalogId);
  if (!battery || battery.powerCapacity === -1) return null;
  const watts = calculateRackConsumptionWatts(rack, upgrades);
  if (watts <= 0) return null;
  const wh = Math.max(0, Number(rack.currentCharge) || 0);
  const sec = (wh * 3600) / watts;
  return Number.isFinite(sec) ? sec : null;
}

/** Energia em Wh com sufixo legível (evita "498098Wh" confundido com kWh). */
export function formatRackEnergyWh(wh: number | null | undefined): string {
  const n = typeof wh === 'number' && Number.isFinite(wh) ? wh : 0;
  const a = Math.abs(n);
  if (a >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 0 })} MWh`;
  }
  if (a >= 1000) {
    const digits = a >= 100_000 ? 0 : 1;
    return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} kWh`;
  }
  return `${Math.round(n).toLocaleString('pt-BR')} Wh`;
}

export function formatBatteryRuntimeShortPt(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '0s';
  if (totalSec < 60) return `${Math.max(1, Math.floor(totalSec))}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m`;
  if (totalSec < 86400) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

/** Texto curto para o CMD (sem caixa colorida). */
export function getRackBatteryRuntimeShortLabel(
  rack: PlacedRack,
  upgrades: Upgrade[],
  storedBatteries?: StoredBattery[] | null,
  batteryInstanceCatalogHints?: Readonly<Record<string, string>> | null
): string {
  if (!rack.batteryId) return '—';
  const catalogId = resolvePlacedRackBatteryCatalogId(rack, storedBatteries, upgrades, batteryInstanceCatalogHints);
  const battery = catalogId ? upgrades.find((u) => u.id === catalogId) : null;
  if (!battery) return '—';
  if (battery.powerCapacity === -1) return '∞';
  const sec = estimateRackBatteryRuntimeSeconds(rack, upgrades, storedBatteries, batteryInstanceCatalogHints);
  if (sec == null) return '—';
  return `~${formatBatteryRuntimeShortPt(sec)}`;
}

/** Tooltip / acessibilidade (explicação completa). */
export function getRackBatteryRuntimeHint(
  rack: PlacedRack,
  upgrades: Upgrade[],
  storedBatteries?: StoredBattery[] | null,
  batteryInstanceCatalogHints?: Readonly<Record<string, string>> | null
): string {
  if (!rack.batteryId) return 'Sem bateria instalada.';
  const catalogId = resolvePlacedRackBatteryCatalogId(rack, storedBatteries, upgrades, batteryInstanceCatalogHints);
  const battery = catalogId ? upgrades.find((u) => u.id === catalogId) : null;
  if (!battery) {
    return 'Referência de bateria inválida (sincronize com F5 ou re-equipe a bateria).';
  }
  if (battery.powerCapacity === -1) return 'Bateria ilimitada.';
  const watts = calculateRackConsumptionWatts(rack, upgrades);
  if (watts <= 0) return 'Sem consumo (0 W): a carga não desce com o equipamento atual.';
  const sec = estimateRackBatteryRuntimeSeconds(rack, upgrades, storedBatteries, batteryInstanceCatalogHints);
  if (sec == null) return '';
  const w = watts;
  return `Autonomia estimada: ~${formatBatteryRuntimeShortPt(sec)} até 0 Wh ao consumo atual (${w} W). Com a rig desligada a bateria não gasta.`;
}

export function calculatePlacedRacksProductionHashrate(
  racks: PlacedRack[],
  upgrades: Upgrade[],
  storedBatteries?: StoredBattery[] | null,
  batteryInstanceCatalogHints?: Readonly<Record<string, string>> | null
): number {
  let total = 0;
  racks.forEach((rack) => {
    const cat = resolvePlacedRackBatteryCatalogId(rack, storedBatteries, upgrades, batteryInstanceCatalogHints);
    const battery = cat ? upgrades.find((u) => u.id === cat) : null;
    const isInfinite = battery && battery.powerCapacity === -1;
    const isOperational =
      rack.isOn && rack.wiringId && Boolean(battery) && (isInfinite || rack.currentCharge > 0);

    if (isOperational) {
      const baseProd = rack.slots.reduce((acc, sid) => {
        const m = upgrades.find((u) => u.id === sid);
        return acc + (m?.baseProduction || 0);
      }, 0);
      let mult = 1;
      if (rack.multiplierSlots) {
        rack.multiplierSlots.forEach((sid) => {
          const m = upgrades.find((u) => u.id === sid);
          if (m?.multiplier) mult += m.multiplier;
        });
      }
      total += baseProd * mult;
    }
  });
  return total;
}

export type RackLayoutSlot = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Garante barra de carga + CMD com ETA; layouts antigos/só máquinas não tinham estes slots. */
export function mergeBatteryWidgetsIfAbsent(layout: {
  slots?: RackLayoutSlot[];
  canvasWidth?: number;
  canvasHeight?: number;
}): { slots: RackLayoutSlot[]; canvasWidth: number; canvasHeight: number } {
  const slots = Array.isArray(layout.slots) ? [...layout.slots] : [];
  const canvasWidth = layout.canvasWidth || 500;
  const canvasHeight = layout.canvasHeight || 600;
  if (!slots.some((s) => s.type === 'battery_bar')) {
    slots.push({ id: 'battery_bar_auto', type: 'battery_bar', x: 72, y: 60, w: 28, h: 4 });
  }
  if (!slots.some((s) => s.type === 'stat_monitor')) {
    slots.push({ id: 'stat_monitor_auto', type: 'stat_monitor', x: 2, y: 52, w: 36, h: 28 });
  }
  return { slots, canvasWidth, canvasHeight };
}

export function getDefaultRackLayout(rackDef: Upgrade): {
  slots: RackLayoutSlot[];
  canvasWidth: number;
  canvasHeight: number;
} {
  const slots: RackLayoutSlot[] = [];
  const slotCount = rackDef.slotsCapacity || 0;
  for (let i = 0; i < slotCount; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    slots.push({
      id: `slot_${i}`,
      type: 'machine',
      x: 5 + col * 31,
      y: 10 + row * 15,
      w: 28,
      h: 12
    });
  }
  slots.push({ id: 'battery', type: 'battery', x: 75, y: 70, w: 20, h: 8 });
  slots.push({ id: 'wiring', type: 'wiring', x: 75, y: 80, w: 20, h: 8 });
  const aiCount = rackDef.aiSlotsCapacity || 0;
  for (let i = 0; i < aiCount; i++) {
    slots.push({ id: `slot_${i}`, type: 'multiplier', x: 75, y: 10 + i * 10, w: 20, h: 8 });
  }
  slots.push({ id: 'power', type: 'power', x: 10, y: 85, w: 12, h: 10 });
  slots.push({ id: 'config', type: 'config', x: 25, y: 85, w: 12, h: 10 });
  slots.push({ id: 'coin_selector', type: 'coin_selector', x: 40, y: 85, w: 30, h: 10 });
  return { slots, canvasWidth: 500, canvasHeight: 600 };
}

export function listInfrastructureInStock(upgrades: Upgrade[], stock: Record<string, number>): Upgrade[] {
  return upgrades.filter((u) => u.type === 'infrastructure' && (stock[u.id] || 0) > 0);
}

export function listItemsForSelection(
  selection: ServerRoomSelectionContext,
  placedRacks: PlacedRack[],
  upgrades: Upgrade[],
  stock: Record<string, number>
): Upgrade[] {
  if (selection.type === 'rack') {
    let list = upgrades.filter((u) => u.type === 'infrastructure' && (stock[u.id] || 0) > 0);
    if (isNftAutoArmario1OnlyRoomContext(selection.roomId, selection.roomName, selection.nftAutoArmario1Only)) {
      list = list.filter((u) => u.id === NFT_AUTO_ALLOWED_CHASSIS_ID);
    }
    return list;
  }
  const currentRack = selection.rackId ? placedRacks.find((r) => r.id === selection.rackId) : undefined;
  let filtered = upgrades.filter((u) => u.type === selection.type && (stock[u.id] || 0) > 0);
  if (currentRack) {
    filtered = filtered.filter((u) => {
      if (u.compatibleRacks?.length) return u.compatibleRacks.includes(currentRack.itemId);
      return true;
    });
  }
  return filtered;
}

export function listStoredBatteriesForSelection(
  selection: ServerRoomSelectionContext,
  placedRacks: PlacedRack[],
  storedBatteries: StoredBattery[],
  upgrades: Upgrade[],
  workshopSlots?: (WorkshopStructure | null)[] | null
): StoredBattery[] {
  if (selection.type !== 'battery' || !selection.rackId) return [];
  const currentRack = placedRacks.find((r) => r.id === selection.rackId);
  const mountedIds = new Set(
    (placedRacks || []).map((r) => (r.batteryId != null ? String(r.batteryId).trim() : '')).filter(Boolean)
  );

  const fromWorkshop = listWorkshopMountedBatteryInstances(workshopSlots, upgrades).filter((sb) => {
    if (mountedIds.has(String(sb.id).trim())) return false;
    const def = upgrades.find((u) => u.id === sb.itemId);
    if (currentRack && def?.compatibleRacks?.length)
      return def.compatibleRacks.includes(currentRack.itemId);
    return true;
  });
  const workshopIds = new Set(fromWorkshop.map((b) => String(b.id).trim()));

  const filtered = storedBatteries.filter((sb) => {
    if (sb.workshopSlotIndex != null || sb.workshopComponentSlotId != null) return false;
    const sid = String(sb.id).trim();
    if (workshopIds.has(sid)) return false;
    if (mountedIds.has(sid)) return false;
    const def = upgrades.find((u) => u.id === sb.itemId);
    if (currentRack && def?.compatibleRacks?.length)
      return def.compatibleRacks.includes(currentRack.itemId);
    return true;
  });

  const merged = [...fromWorkshop, ...filtered];
  return merged.sort((a, b) => {
    const da = upgrades.find((u) => u.id === a.itemId);
    const db = upgrades.find((u) => u.id === b.itemId);
    const ea = poolEntryEnergyWh(normalizedStoredChargeWh(a), da);
    const eb = poolEntryEnergyWh(normalizedStoredChargeWh(b), db);
    if (eb !== ea) return eb - ea;
    const ta = batteryTierScore(da);
    const tb = batteryTierScore(db);
    if (tb !== ta) return tb - ta;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function formatHashrateDisplay(val: number): string {
  if (val === 0) return '0';
  if (val < 0.0001) return val.toFixed(8);
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(val);
}
