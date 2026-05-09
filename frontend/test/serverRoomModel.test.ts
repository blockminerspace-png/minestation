import { describe, it, expect } from 'vitest';
import {
  calculateRackConsumptionWatts,
  formatRackEnergyWh,
  formatBatteryRuntimeShortPt,
  resolvePlacedRackBatteryCatalogId,
  listStoredBatteriesForSelection,
  listWorkshopMountedBatteryInstances
} from '../models/serverRoomModel';
import type { PlacedRack, StoredBattery, Upgrade, WorkshopStructure } from '../types';

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

  it('listWorkshopMountedBatteryInstances lê slotCharges da oficina', () => {
    const batId = 'aaaaaaaa-bbbb-4ccc-bddd-eeeeeeeeeeee';
    const upgrades: Upgrade[] = [
      {
        id: 'charger_x',
        type: 'charger',
        category: 'Oficina',
        name: 'Charger',
        layout: {
          slots: [{ id: 'battery_0', type: 'battery' as const, x: 0, y: 0, w: 10, h: 10 }]
        }
      } as Upgrade,
      { id: 'bat_pb', type: 'battery', powerCapacity: 5000 } as Upgrade
    ];
    const ws: WorkshopStructure = {
      id: 'ws_0',
      itemId: 'charger_x',
      internalSlots: { battery_0: batId },
      slotCharges: { battery_0: 3500 },
      slotItemIds: { battery_0: 'bat_pb' },
      currentCharge: 0
    };
    const rows = listWorkshopMountedBatteryInstances([ws], upgrades);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(batId);
    expect(rows[0].currentCharge).toBe(3500);
    expect(rows[0].fromWorkshopSlot).toBe(true);
  });

  it('listStoredBatteriesForSelection funde oficina + armazém e ordena por Wh (mais carga primeiro)', () => {
    const batWs = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const batWh = 'cccccccc-cccc-4ccc-bccc-cccccccccccc';
    const upgrades: Upgrade[] = [
      {
        id: 'charger_x',
        type: 'charger',
        category: 'Oficina',
        name: 'Charger',
        layout: {
          slots: [{ id: 'battery_0', type: 'battery' as const, x: 0, y: 0, w: 10, h: 10 }]
        }
      } as Upgrade,
      { id: 'bat_pb', type: 'battery', powerCapacity: 5000 } as Upgrade
    ];
    const workshop: (WorkshopStructure | null)[] = [
      {
        id: 'ws_0',
        itemId: 'charger_x',
        internalSlots: { battery_0: batWs },
        slotCharges: { battery_0: 4800 },
        slotItemIds: { battery_0: 'bat_pb' },
        currentCharge: 0
      }
    ];
    const stored: StoredBattery[] = [
      { id: batWs, itemId: 'bat_pb', currentCharge: 0 },
      { id: batWh, itemId: 'bat_pb', currentCharge: 900 }
    ];
    const placed: PlacedRack[] = [{ id: 'rack1', itemId: 'rack_10u', batteryId: null } as PlacedRack];
    const sel = { type: 'battery' as const, rackId: 'rack1', slotIndex: null };
    const list = listStoredBatteriesForSelection(sel, placed, stored, upgrades, workshop);
    expect(list.map((b) => b.id)).toEqual([batWs, batWh]);
    expect(list[0].currentCharge).toBe(4800);
    expect(list[0].fromWorkshopSlot).toBe(true);
    expect(list[1].currentCharge).toBe(900);
  });
});
