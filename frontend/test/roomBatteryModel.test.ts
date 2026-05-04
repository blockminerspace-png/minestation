import { describe, it, expect } from 'vitest';
import { totalBatteryInstances, rackTheoreticalHash } from '../models/roomBatteryModel';
import type { PlacedRack, StoredBattery, Upgrade } from '../types';

describe('roomBatteryModel', () => {
  it('totalBatteryInstances', () => {
    const stock = { bat: 2 };
    const stored: StoredBattery[] = [{ itemId: 'bat' } as StoredBattery, { itemId: 'bat' } as StoredBattery];
    expect(totalBatteryInstances('bat', stock, stored)).toBe(4);
    expect(totalBatteryInstances('', stock, stored)).toBe(0);
  });

  it('rackTheoreticalHash', () => {
    const upgrades: Upgrade[] = [
      { id: 'gpu', baseProduction: 10, multiplier: 0 } as Upgrade,
      { id: 'm', baseProduction: 0, multiplier: 0.5 } as Upgrade,
    ];
    const rack: PlacedRack = {
      slots: ['gpu'],
      multiplierSlots: ['m'],
    } as PlacedRack;
    const placed = [rack];
    expect(rackTheoreticalHash(placed, 0, upgrades)).toBe(15);
  });
});
