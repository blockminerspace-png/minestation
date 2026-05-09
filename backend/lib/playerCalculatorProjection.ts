import { normalizePlacedRackRoomId } from './roomBatteryBulk.js';

/** Subconjunto de `upgrades` necessário para a calculadora de mineração. */
export type CalculatorUpgradeLite = {
  id: string;
  type: string;
  baseProduction: number;
  multiplier: number | null;
  powerCapacity: number | null;
};

export type CalculatorRackForProjection = {
  roomId: string | null;
  wiringId: string | null;
  batteryId: string | null;
  currentCharge: number;
  isOn: boolean;
  selectedCoinId: string | null;
  slots: (string | null)[];
  multiplierSlots: (string | null)[];
};

/** Hashrate de rede efectiva (≥1), alinhado ao bootstrap / calculadora legada. */
export function effectiveNetworkHashrateForCoin(coinId: string, dbNetworkHashrate: number, runtimeByCoin: Map<string, number>): number {
  const dyn = runtimeByCoin.get(coinId);
  const base = Number(dbNetworkHashrate);
  const chosen = dyn != null && dyn > 0 ? dyn : base;
  return Math.max(1, Number.isFinite(chosen) ? chosen : 1);
}

/**
 * Soma H/s por `mining_coins.id` a partir das rigs operacionais (mesma regra que `PlayerCalculator` no cliente).
 */
export function computeUserHashByCoinId(
  racks: CalculatorRackForProjection[],
  upgradesById: Map<string, CalculatorUpgradeLite>,
  scopeRoom: 'total' | string
): Record<string, number> {
  const out: Record<string, number> = {};
  const scopeNorm = scopeRoom === 'total' ? 'total' : normalizePlacedRackRoomId(scopeRoom);

  for (const rack of racks) {
    if (scopeRoom !== 'total') {
      const rNorm = normalizePlacedRackRoomId(rack.roomId);
      if (rNorm !== scopeNorm) continue;
    }

    const cid = rack.selectedCoinId != null ? String(rack.selectedCoinId).trim() : '';
    if (!cid) continue;

    const battery = rack.batteryId ? upgradesById.get(String(rack.batteryId)) : undefined;
    const isInfinite = battery?.type === 'battery' && battery.powerCapacity === -1;
    const isOperational =
      rack.isOn && Boolean(rack.wiringId) && Boolean(rack.batteryId) && (isInfinite || rack.currentCharge > 0);
    if (!isOperational) continue;

    let rackBase = 0;
    for (const sid of rack.slots) {
      if (!sid) continue;
      const machine = upgradesById.get(String(sid));
      if (machine) rackBase += machine.baseProduction;
    }
    let mult = 1;
    for (const sid of rack.multiplierSlots || []) {
      if (!sid) continue;
      const modifier = upgradesById.get(String(sid));
      if (modifier != null && modifier.multiplier != null) mult += modifier.multiplier;
    }
    const totalRackHash = rackBase * mult;
    out[cid] = (out[cid] || 0) + totalRackHash;
  }
  return out;
}

export function computeDailyEarnings(
  userHashHps: number,
  blockTimeSec: number,
  effectiveNetworkHash: number,
  blockReward: number,
  priceUsd: number
): { dailyCoins: number; dailyUsd: number } {
  const bt = Number(blockTimeSec);
  const net = Number(effectiveNetworkHash);
  if (!Number.isFinite(bt) || bt <= 0 || !Number.isFinite(net) || net <= 0) {
    return { dailyCoins: 0, dailyUsd: 0 };
  }
  const uh = Number(userHashHps);
  if (!Number.isFinite(uh) || uh < 0) return { dailyCoins: 0, dailyUsd: 0 };

  const share = uh / net;
  const blocksPerDay = 86400 / bt;
  const br = Number(blockReward);
  const dailyCoins = share * (Number.isFinite(br) ? br : 0) * blocksPerDay;
  const pu = Number(priceUsd);
  const dailyUsd = dailyCoins * (Number.isFinite(pu) ? pu : 0);
  return { dailyCoins, dailyUsd };
}

export const CALCULATOR_PROJECTION_PERIODS: { label: string; multiplier: number }[] = [
  { label: '1 Hora', multiplier: 1 / 24 },
  { label: '24 Horas', multiplier: 1 },
  { label: '7 Dias', multiplier: 7 },
  { label: '30 Dias', multiplier: 30 },
  { label: '1 Ano', multiplier: 365 }
];
