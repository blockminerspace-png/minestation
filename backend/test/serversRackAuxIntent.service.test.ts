import { describe, it, expect } from 'vitest';
import { applyRackAuxEquip, applyRackAuxUnequip } from '../modules/servers/servers.rackAuxIntent.service.js';
import type { PlacedRackLoaded } from '../lib/serverRoomPersistence.js';

const upgrades = [
  { id: 'bat1', type: 'battery', category: 'battery', powerCapacity: 100, name: 'B1', image: null },
  { id: 'wire1', type: 'wiring', category: 'wiring', name: 'W1', image: null },
  { id: 'mult1', type: 'multiplier', category: 'multiplier', multiplier: 0.5, name: 'M1', image: null }
];

function baseRack(): PlacedRackLoaded {
  return {
    id: 'rack1',
    itemId: 'chassis',
    slots: [],
    multiplierSlots: [''],
    wiringId: null,
    batteryId: null,
    isOn: false,
    selectedCoinId: null,
    roomId: 'room_initial',
    slotIndex: 0
  };
}

describe('servers.rackAuxIntent.service', () => {
  it('equipar bateria do stock consome 1 unidade e define batteryId', () => {
    const prev = {
      stock: { bat1: 2 },
      storedBatteries: [],
      placedRacks: [baseRack()]
    };
    const out = applyRackAuxEquip(
      prev,
      'rack1',
      { kind: 'battery', battery: { mode: 'from_stock', catalogItemId: 'bat1' } },
      upgrades,
      null
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.stock.bat1).toBe(1);
    expect(out.placedRacks[0].batteryId).toBeTruthy();
    expect(out.placedRacks[0].batteryCatalogItemId).toBe('bat1');
  });

  it('remover bateria UUID devolve a instância ao armazém (não vai para o stock)', () => {
    // Sistema UUID: a instância individual da bateria é preservada em
    // `stored_batteries` ao desmontar — `stock` agrega apenas itens sem identidade.
    const bid = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const rack: PlacedRackLoaded = {
      ...baseRack(),
      batteryId: bid,
      batteryCatalogItemId: 'bat1',
      isOn: true
    };
    const prev = {
      stock: {},
      storedBatteries: [],
      placedRacks: [rack]
    };
    const out = applyRackAuxUnequip(prev, 'rack1', { kind: 'battery' }, upgrades, new Map([[bid, 'bat1']]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.placedRacks[0].batteryId).toBeNull();
    expect(out.storedBatteries).toHaveLength(1);
    expect(out.storedBatteries[0]?.id).toBe(bid);
    expect(out.storedBatteries[0]?.itemId).toBe('bat1');
    expect(out.stock.bat1 ?? 0).toBe(0);
  });

  it('double equip com mesma lógica: segundo sem stock falha', () => {
    const prev = {
      stock: { bat1: 1 },
      storedBatteries: [],
      placedRacks: [baseRack()]
    };
    const first = applyRackAuxEquip(
      prev,
      'rack1',
      { kind: 'battery', battery: { mode: 'from_stock', catalogItemId: 'bat1' } },
      upgrades,
      null
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyRackAuxEquip(
      {
        stock: first.stock,
        storedBatteries: first.storedBatteries,
        placedRacks: first.placedRacks
      },
      'rack1',
      { kind: 'battery', battery: { mode: 'from_stock', catalogItemId: 'bat1' } },
      upgrades,
      null
    );
    expect(second.ok).toBe(false);
  });
});
