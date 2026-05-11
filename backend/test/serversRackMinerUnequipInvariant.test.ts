import { describe, it, expect } from 'vitest';
import {
  applyRackMinerEquip,
  applyRackMinerUnequip
} from '../modules/servers/servers.rackAuxIntent.service.js';
import type { PlacedRackLoaded } from '../lib/serverRoomPersistence.js';

const machineUpgrades = [
  {
    id: 'chassis_a',
    type: 'machine_chassis',
    category: 'infra',
    slotsCapacity: 3,
    aiSlotsCapacity: 0,
    isActive: 1,
    name: 'Chassi A',
    image: null,
    compatibleRacks: []
  },
  {
    id: 'gpu_x',
    type: 'machine',
    category: 'mining',
    isActive: 1,
    powerConsumption: 100,
    name: 'GPU X',
    image: null,
    compatibleRacks: ['chassis_a']
  }
];

function makeRackWithGpu(slotIndex = 0): PlacedRackLoaded {
  const slots: string[] = ['', '', ''];
  slots[slotIndex] = 'gpu_x';
  return {
    id: 'rack_unequip_test',
    itemId: 'chassis_a',
    slots,
    multiplierSlots: [],
    wiringId: null,
    batteryId: null,
    currentCharge: 0,
    isOn: true,
    selectedCoinId: null,
    roomId: 'room_initial',
    slotIndex: 0
  };
}

describe('GPU duplication invariants — unequip / equip cycles', () => {
  it('Caso A: stock=0 + slot=GPU → unequip devolve exatamente +1 ao stock e limpa o slot', () => {
    const prev = {
      stock: {} as Record<string, number>,
      storedBatteries: [],
      placedRacks: [makeRackWithGpu(0)]
    };
    const out = applyRackMinerUnequip(prev, 'rack_unequip_test', 0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.stock.gpu_x).toBe(1);
    expect(out.placedRacks[0].slots[0]).toBe('');
  });

  it('Caso B: aplicar duas vezes o resultado do unequip não duplica (uso correto de prev imutável)', () => {
    const prev = {
      stock: {} as Record<string, number>,
      storedBatteries: [],
      placedRacks: [makeRackWithGpu(0)]
    };
    const first = applyRackMinerUnequip(prev, 'rack_unequip_test', 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyRackMinerUnequip(
      {
        stock: first.stock,
        storedBatteries: first.storedBatteries,
        placedRacks: first.placedRacks
      },
      'rack_unequip_test',
      0
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/nada equipado/i);
    expect(first.stock.gpu_x).toBe(1);
    expect(first.placedRacks[0].slots[0]).toBe('');
  });

  it('Caso C: equip do mesmo item após unequip volta a consumir do stock e ocupa o slot', () => {
    const prev = {
      stock: {} as Record<string, number>,
      storedBatteries: [],
      placedRacks: [makeRackWithGpu(0)]
    };
    const unequipped = applyRackMinerUnequip(prev, 'rack_unequip_test', 0);
    expect(unequipped.ok).toBe(true);
    if (!unequipped.ok) return;
    const equipped = applyRackMinerEquip(
      {
        stock: unequipped.stock,
        storedBatteries: unequipped.storedBatteries,
        placedRacks: unequipped.placedRacks
      },
      'rack_unequip_test',
      0,
      'gpu_x',
      machineUpgrades
    );
    expect(equipped.ok).toBe(true);
    if (!equipped.ok) return;
    expect(equipped.stock.gpu_x).toBeUndefined();
    expect(equipped.placedRacks[0].slots[0]).toBe('gpu_x');
  });

  it('Invariante: item não pode ficar simultaneamente no slot e ter sido devolvido ao stock no mesmo passo', () => {
    const prev = {
      stock: {} as Record<string, number>,
      storedBatteries: [],
      placedRacks: [makeRackWithGpu(2)]
    };
    const out = applyRackMinerUnequip(prev, 'rack_unequip_test', 2);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const rack = out.placedRacks[0];
    // Soma de unidades no estoque + unidades equipadas em qualquer slot deve ser exactamente 1.
    const inSlots = rack.slots.filter((s) => s === 'gpu_x').length;
    const inStock = Number(out.stock.gpu_x || 0);
    expect(inSlots + inStock).toBe(1);
    expect(inSlots).toBe(0);
    expect(inStock).toBe(1);
  });
});
