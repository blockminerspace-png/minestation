import { describe, expect, it } from 'vitest';
import {
  getBatteryUpgradeForRack,
  resolveRackBatteryItemId,
  resolveRackBatteryItemIdWithWorkshopFallback
} from '../lib/rackBatteryResolve';
import type { PlacedRack, StoredBattery, Upgrade, WorkshopStructure } from '../types';

const batteryUp: Upgrade = {
  id: 'bat_stock_1',
  name: 'Bat',
  category: 'energy',
  type: 'battery',
  baseCost: 0,
  baseProduction: 0,
  powerCapacity: 100,
  description: '',
  icon: '🔋',
  status: 'normal',
  image: '/img/x.png'
};

describe('resolveRackBatteryItemId', () => {
  it('returns upgrade id when rack holds stock id', () => {
    expect(resolveRackBatteryItemId('bat_stock_1', [batteryUp], [])).toBe('bat_stock_1');
  });

  it('maps stored instance UUID to itemId', () => {
    const stored: StoredBattery[] = [{ id: 'uuid-instance-abc', itemId: 'bat_stock_1', currentCharge: 50 }];
    expect(resolveRackBatteryItemId('uuid-instance-abc', [batteryUp], stored)).toBe('bat_stock_1');
  });

  it('returns null for orphan instance id', () => {
    expect(resolveRackBatteryItemId('uuid-missing', [batteryUp], [])).toBeNull();
  });
});

describe('resolveRackBatteryItemIdWithWorkshopFallback', () => {
  it('maps instance via workshop slotItemIds when not in stored', () => {
    const inst = 'uuid-only-in-workshop';
    const ws: WorkshopStructure = {
      id: 'ws1',
      itemId: 'charger1',
      internalSlots: { batA: inst },
      currentCharge: 0,
      slotItemIds: { batA: 'bat_stock_1' }
    };
    expect(
      resolveRackBatteryItemIdWithWorkshopFallback(inst, [batteryUp], [], [ws])
    ).toBe('bat_stock_1');
  });
});

describe('getBatteryUpgradeForRack', () => {
  it('finds upgrade for equipped stored battery', () => {
    const rack: PlacedRack = {
      id: 'r1',
      itemId: 'rack',
      slots: [],
      roomId: 'room',
      slotIndex: 0,
      wiringId: null,
      batteryId: 'uuid-instance-abc',
      multiplierSlots: [],
      currentCharge: 40,
      isOn: false
    };
    const stored: StoredBattery[] = [{ id: 'uuid-instance-abc', itemId: 'bat_stock_1', currentCharge: 40 }];
    const u = getBatteryUpgradeForRack(rack, [batteryUp], stored);
    expect(u?.id).toBe('bat_stock_1');
  });
});
