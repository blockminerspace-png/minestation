import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyRackBatteryUnequipToInventory } from '../lib/rackBatteryInventory';
import type { StoredBattery, Upgrade } from '../types';

const finiteBat: Upgrade = {
  id: 'bat_500k',
  name: '500kWh',
  category: 'power',
  type: 'battery',
  baseCost: 0,
  baseProduction: 0,
  powerCapacity: 500000,
  description: 'Test',
  icon: 'battery',
  status: 'normal'
};

const infiniteBat: Upgrade = {
  id: 'bat_inf',
  name: 'Ilimitada',
  category: 'power',
  type: 'battery',
  baseCost: 0,
  baseProduction: 0,
  powerCapacity: -1,
  description: 'Test',
  icon: 'battery',
  status: 'normal'
};

describe('applyRackBatteryUnequipToInventory', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee' as `${string}-${string}-${string}-${string}-${string}`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false and leaves stock/warehouse unchanged for orphan UUID', () => {
    const nb: StoredBattery[] = [];
    const ns: Record<string, number> = {};
    const out = applyRackBatteryUnequipToInventory(
      '00000000-0000-4000-8000-000000000099',
      250,
      nb,
      ns,
      [finiteBat]
    );
    expect(out.returnedToInventory).toBe(false);
    expect(out.nextNb).toEqual([]);
    expect(out.nextNs).toEqual({});
  });

  it('catalog battery on rack (full) increments stock', () => {
    const nb: StoredBattery[] = [];
    const ns: Record<string, number> = { bat_500k: 2 };
    const out = applyRackBatteryUnequipToInventory('bat_500k', 500000, nb, ns, [finiteBat]);
    expect(out.returnedToInventory).toBe(true);
    expect(out.nextNs.bat_500k).toBe(3);
    expect(out.nextNb).toEqual([]);
  });

  it('catalog battery on rack (partial) pushes new stored row with catalog itemId', () => {
    const nb: StoredBattery[] = [];
    const ns: Record<string, number> = {};
    const out = applyRackBatteryUnequipToInventory('bat_500k', 120000, nb, ns, [finiteBat]);
    expect(out.returnedToInventory).toBe(true);
    expect(out.nextNb).toHaveLength(1);
    expect(out.nextNb[0]).toEqual({
      id: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      itemId: 'bat_500k',
      currentCharge: 120000
    });
  });

  it('stored instance (partial) updates charge immutably', () => {
    const nb: StoredBattery[] = [{ id: 'inst-1', itemId: 'bat_500k', currentCharge: 400000 }];
    const ns: Record<string, number> = {};
    const out = applyRackBatteryUnequipToInventory('inst-1', 90000, nb, ns, [finiteBat]);
    expect(out.returnedToInventory).toBe(true);
    expect(out.nextNb[0]).toEqual({ id: 'inst-1', itemId: 'bat_500k', currentCharge: 90000 });
    expect(nb[0].currentCharge).toBe(400000);
  });

  it('stored instance (full) removes row and increments stock', () => {
    const nb: StoredBattery[] = [{ id: 'inst-1', itemId: 'bat_500k', currentCharge: 499000 }];
    const ns: Record<string, number> = {};
    const out = applyRackBatteryUnequipToInventory('inst-1', 500000, nb, ns, [finiteBat]);
    expect(out.returnedToInventory).toBe(true);
    expect(out.nextNb).toEqual([]);
    expect(out.nextNs.bat_500k).toBe(1);
  });

  it('infinite battery from catalog id always returns one unit to stock', () => {
    const nb: StoredBattery[] = [];
    const ns: Record<string, number> = { bat_inf: 0 };
    const out = applyRackBatteryUnequipToInventory('bat_inf', -1, nb, ns, [infiniteBat]);
    expect(out.returnedToInventory).toBe(true);
    expect(out.nextNs.bat_inf).toBe(1);
    expect(out.nextNb).toEqual([]);
  });

  it('infinite stored instance removes row and increments stock', () => {
    const nb: StoredBattery[] = [{ id: 'inst-inf', itemId: 'bat_inf', currentCharge: -1 }];
    const ns: Record<string, number> = {};
    const out = applyRackBatteryUnequipToInventory('inst-inf', -1, nb, ns, [infiniteBat]);
    expect(out.returnedToInventory).toBe(true);
    expect(out.nextNb).toEqual([]);
    expect(out.nextNs.bat_inf).toBe(1);
  });
});
