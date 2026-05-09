import { describe, it, expect } from 'vitest';
import {
  calculateRackConsumptionWatts,
  formatRackEnergyWh,
  formatBatteryRuntimeShortPt,
  resolvePlacedRackBatteryCatalogId,
} from '../models/serverRoomModel';
import type { PlacedRack, StoredBattery, Upgrade } from '../types';

describe('serverRoomModel', () => {
  it('calculateRackConsumptionWatts soma slots', () => {
    const rack: PlacedRack = { slots: ['a'], multiplierSlots: [] } as PlacedRack;
    const upgrades: Upgrade[] = [{ id: 'a', powerConsumption: 100 } as Upgrade];
    expect(calculateRackConsumptionWatts(rack, upgrades)).toBe(100);
  });

  it('formatRackEnergyWh', () => {
    expect(formatRackEnergyWh(500)).toMatch(/Wh/);
    expect(formatRackEnergyWh(5000)).toMatch(/kWh/);
  });

  it('formatBatteryRuntimeShortPt', () => {
    expect(formatBatteryRuntimeShortPt(30)).toMatch(/s/);
    expect(formatBatteryRuntimeShortPt(120)).toMatch(/m/);
    expect(formatBatteryRuntimeShortPt(4000)).toMatch(/h/);
  });

  it('resolvePlacedRackBatteryCatalogId não adivinha catálogo com item_id vazio (sem hints)', () => {
    const rack = { batteryId: 'inst-1' } as PlacedRack;
    const upgrades = [{ id: 'bat_a', type: 'battery' } as Upgrade];
    const stored = [{ id: 'inst-1', itemId: '', currentCharge: 10 } as StoredBattery];
    expect(resolvePlacedRackBatteryCatalogId(rack, stored, upgrades)).toBe(null);
  });

  it('resolvePlacedRackBatteryCatalogId usa hints quando a linha local não traz item_id', () => {
    const rack = { batteryId: 'inst-1' } as PlacedRack;
    const upgrades = [{ id: 'bat_a', type: 'battery' } as Upgrade];
    const stored = [{ id: 'inst-1', itemId: '', currentCharge: 10 } as StoredBattery];
    expect(resolvePlacedRackBatteryCatalogId(rack, stored, upgrades, { 'inst-1': 'bat_a' })).toBe('bat_a');
  });
});
