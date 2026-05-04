import type { PlacedRack, StoredBattery, Upgrade } from '../types';
import { NFT_AUTO_ALLOWED_CHASSIS_ID, isNftAutoArmario1OnlyRoomContext } from '../types';
import { batteryTierScore, poolEntryEnergyWh } from './roomBatteryModel';

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
export function estimateRackBatteryRuntimeSeconds(rack: PlacedRack, upgrades: Upgrade[]): number | null {
  if (!rack.batteryId) return null;
  const battery = upgrades.find((u) => u.id === rack.batteryId);
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
export function getRackBatteryRuntimeShortLabel(rack: PlacedRack, upgrades: Upgrade[]): string {
  if (!rack.batteryId) return '—';
  const battery = upgrades.find((u) => u.id === rack.batteryId);
  if (!battery) return '—';
  if (battery.powerCapacity === -1) return '∞';
  const sec = estimateRackBatteryRuntimeSeconds(rack, upgrades);
  if (sec == null) return '—';
  return `~${formatBatteryRuntimeShortPt(sec)}`;
}

/** Tooltip / acessibilidade (explicação completa). */
export function getRackBatteryRuntimeHint(rack: PlacedRack, upgrades: Upgrade[]): string {
  if (!rack.batteryId) return 'Sem bateria instalada.';
  const battery = upgrades.find((u) => u.id === rack.batteryId);
  if (!battery) return '';
  if (battery.powerCapacity === -1) return 'Bateria ilimitada.';
  const watts = calculateRackConsumptionWatts(rack, upgrades);
  if (watts <= 0) return 'Sem consumo (0 W): a carga não desce com o equipamento atual.';
  const sec = estimateRackBatteryRuntimeSeconds(rack, upgrades);
  if (sec == null) return '';
  const w = watts;
  return `Autonomia estimada: ~${formatBatteryRuntimeShortPt(sec)} até 0 Wh ao consumo atual (${w} W). Com a rig desligada a bateria não gasta.`;
}

export function calculatePlacedRacksProductionHashrate(racks: PlacedRack[], upgrades: Upgrade[]): number {
  let total = 0;
  racks.forEach((rack) => {
    const battery = upgrades.find((u) => u.id === rack.batteryId);
    const isInfinite = battery && battery.powerCapacity === -1;
    const isOperational =
      rack.isOn && rack.wiringId && rack.batteryId && (isInfinite || rack.currentCharge > 0);

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
  upgrades: Upgrade[]
): StoredBattery[] {
  if (selection.type !== 'battery' || !selection.rackId) return [];
  const currentRack = placedRacks.find((r) => r.id === selection.rackId);
  const filtered = storedBatteries.filter((sb) => {
    const def = upgrades.find((u) => u.id === sb.itemId);
    if (currentRack && def?.compatibleRacks?.length)
      return def.compatibleRacks.includes(currentRack.itemId);
    return true;
  });
  return [...filtered].sort((a, b) => {
    const da = upgrades.find((u) => u.id === a.itemId);
    const db = upgrades.find((u) => u.id === b.itemId);
    const ea = poolEntryEnergyWh(typeof a.currentCharge === 'number' ? a.currentCharge : 0, da);
    const eb = poolEntryEnergyWh(typeof b.currentCharge === 'number' ? b.currentCharge : 0, db);
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
