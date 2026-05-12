import { describe, it, expect } from 'vitest';
import {
  applyRackAuxEquip,
  applyRackAuxUnequip,
  applyRemoveRackToStock
} from '../modules/servers/servers.rackAuxIntent.service.js';
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

  it('regressão: desequipar bateria UUID não duplica entrada quando ela já estava em prev.storedBatteries (loaded como EQUIPPED)', () => {
    // `loadUserStoredBatteries` traz TODAS as instâncias do jogador (INVENTORY + EQUIPPED).
    // Ao chamar `returnBatteryInstanceToWarehouse`, sem dedup defensivo o array de saída
    // ficava com a mesma UUID 2 vezes — visível como 2 cards no inventário.
    const bid = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const rack: PlacedRackLoaded = {
      ...baseRack(),
      batteryId: bid,
      batteryCatalogItemId: 'bat1',
      isOn: true
    };
    const prev = {
      stock: {},
      storedBatteries: [{ id: bid, itemId: 'bat1' }],
      placedRacks: [rack]
    };
    const out = applyRackAuxUnequip(prev, 'rack1', { kind: 'battery' }, upgrades, new Map([[bid, 'bat1']]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.storedBatteries.filter((b) => b.id === bid)).toHaveLength(1);
  });

  it('regressão: desmontar rig com bateria EQUIPPED não duplica a UUID na resposta', () => {
    const bid = 'bbbbbbbb-cccc-4ddd-eeee-ffffffffffff';
    const rack: PlacedRackLoaded = {
      ...baseRack(),
      batteryId: bid,
      batteryCatalogItemId: 'bat1',
      slots: ['gpu1'],
      wiringId: 'wire1',
      isOn: true
    };
    const prev = {
      stock: {},
      storedBatteries: [{ id: bid, itemId: 'bat1' }],
      placedRacks: [rack]
    };
    const out = applyRemoveRackToStock(prev, 'rack1', upgrades, new Map([[bid, 'bat1']]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.placedRacks).toHaveLength(0);
    expect(out.storedBatteries.filter((b) => b.id === bid)).toHaveLength(1);
    // chassis + wiring + 1 GPU + 0 multi (slot vazio) devolvidos ao stock
    expect(out.stock.chassis).toBe(1);
    expect(out.stock.wire1).toBe(1);
    expect(out.stock.gpu1).toBe(1);
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
