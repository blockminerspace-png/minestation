import { describe, it, expect } from 'vitest';
import {
  calculateRackConsumptionWatts,
  resolvePlacedRackBatteryCatalogId,
  listStoredBatteriesForSelection
} from '../models/serverRoomModel';
import type { PlacedRack, StoredBattery, Upgrade } from '../types';

describe('serverRoomModel', () => {
  it('calculateRackConsumptionWatts soma slots', () => {
    const rack: PlacedRack = { slots: ['a'], multiplierSlots: [] } as PlacedRack;
    const upgrades: Upgrade[] = [{ id: 'a', powerConsumption: 100 } as Upgrade];
    expect(calculateRackConsumptionWatts(rack, upgrades)).toBe(100);
  });

  it('resolvePlacedRackBatteryCatalogId não adivinha catálogo com item_id vazio (sem hints)', () => {
    const rack = { batteryId: 'inst-1' } as PlacedRack;
    const upgrades = [{ id: 'bat_a', type: 'battery' } as Upgrade];
    const stored = [{ id: 'inst-1', itemId: '' } as StoredBattery];
    expect(resolvePlacedRackBatteryCatalogId(rack, stored, upgrades)).toBe(null);
  });

  it('resolvePlacedRackBatteryCatalogId usa hints quando a linha local não traz item_id', () => {
    const rack = { batteryId: 'inst-1' } as PlacedRack;
    const upgrades = [{ id: 'bat_a', type: 'battery' } as Upgrade];
    const stored = [{ id: 'inst-1', itemId: '' } as StoredBattery];
    expect(resolvePlacedRackBatteryCatalogId(rack, stored, upgrades, { 'inst-1': 'bat_a' })).toBe('bat_a');
  });

  it('listStoredBatteriesForSelection devolve baterias UUID infinitas compatíveis', () => {
    const batA = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const batB = 'cccccccc-cccc-4ccc-bccc-cccccccccccc';
    const upgrades: Upgrade[] = [
      { id: 'bat_pb', type: 'battery', powerCapacity: 5000 } as Upgrade
    ];
    const stored: StoredBattery[] = [
      { id: batA, itemId: 'bat_pb' },
      { id: batB, itemId: 'bat_pb' }
    ];
    const placed: PlacedRack[] = [{ id: 'rack1', itemId: 'rack_10u', batteryId: null } as PlacedRack];
    const sel = { type: 'battery' as const, rackId: 'rack1', slotIndex: null };
    const list = listStoredBatteriesForSelection(sel, placed, stored, upgrades);
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.id).sort()).toEqual([batA, batB].sort());
  });
});
