import { describe, expect, it } from 'vitest';
import {
  computeDailyEarnings,
  computeUserHashByCoinId,
  effectiveNetworkHashrateForCoin,
  type CalculatorRackForProjection,
  type CalculatorUpgradeLite
} from '../lib/playerCalculatorProjection.js';

describe('effectiveNetworkHashrateForCoin', () => {
  it('usa runtime quando > 0', () => {
    const m = new Map<string, number>([['btc', 1e12]]);
    expect(effectiveNetworkHashrateForCoin('btc', 100, m)).toBe(1e12);
  });

  it('cai no valor da BD quando runtime ausente', () => {
    expect(effectiveNetworkHashrateForCoin('x', 500, new Map())).toBe(500);
  });

  it('garante mínimo 1', () => {
    expect(effectiveNetworkHashrateForCoin('x', 0, new Map())).toBe(1);
  });
});

describe('computeDailyEarnings', () => {
  it('proporcional ao share de hashrate', () => {
    const { dailyCoins, dailyUsd } = computeDailyEarnings(100, 600, 1000, 1, 2);
    expect(dailyCoins).toBeGreaterThan(0);
    expect(dailyUsd).toBeCloseTo(dailyCoins * 2, 8);
  });
});

describe('computeUserHashByCoinId', () => {
  it('soma rig operacional no escopo', () => {
    const up = new Map<string, CalculatorUpgradeLite>([
      ['bat', { id: 'bat', type: 'battery', baseProduction: 0, multiplier: null, powerCapacity: -1 }],
      ['wire', { id: 'wire', type: 'wiring', baseProduction: 0, multiplier: null, powerCapacity: null }],
      ['gpu', { id: 'gpu', type: 'machine', baseProduction: 10, multiplier: null, powerCapacity: null }]
    ]);
    const racks: CalculatorRackForProjection[] = [
      {
        roomId: 'room_initial',
        wiringId: 'wire',
        batteryId: 'bat',
        currentCharge: 0,
        isOn: true,
        selectedCoinId: 'c1',
        slots: ['gpu', null],
        multiplierSlots: []
      }
    ];
    const by = computeUserHashByCoinId(racks, up, 'total');
    expect(by.c1).toBe(10);
  });
});
