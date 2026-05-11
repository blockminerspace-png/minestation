import { describe, expect, it } from 'vitest';
import type { PlacedRackLoaded } from '../lib/serverRoomPersistence.js';
import {
  applyPlaceRackFromStock,
  placeRackIntentFingerprint,
  type RackAuxUpgradeRow
} from '../modules/servers/servers.rackAuxIntent.service.js';

describe('placeRackIntentFingerprint', () => {
  it('é estável para o mesmo pedido', () => {
    const a = placeRackIntentFingerprint({ catalogItemId: 'rack_x', roomId: 'room_a', slotIndex: 2 });
    const b = placeRackIntentFingerprint({ catalogItemId: 'rack_x', roomId: 'room_a', slotIndex: 2 });
    expect(a).toBe(b);
  });

  it('muda com sala ou chassi diferente', () => {
    const a = placeRackIntentFingerprint({ catalogItemId: 'rack_x', roomId: 'room_a', slotIndex: 0 });
    const b = placeRackIntentFingerprint({ catalogItemId: 'rack_y', roomId: 'room_a', slotIndex: 0 });
    expect(a).not.toBe(b);
  });
});

describe('applyPlaceRackFromStock', () => {
  const upgrades: RackAuxUpgradeRow[] = [
    {
      id: 'chassis_1',
      type: 'rack',
      category: 'rack',
      slotsCapacity: 4,
      aiSlotsCapacity: 0,
      isActive: 1
    }
  ];

  it('consome stock e adiciona rig', () => {
    const prev = {
      stock: { chassis_1: 1, other: 2 },
      storedBatteries: [] as { id: string; itemId: string; currentCharge: number }[],
      placedRacks: [] as PlacedRackLoaded[]
    };
    const out = applyPlaceRackFromStock(prev, 'chassis_1', 'room_norm', 0, upgrades);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.placedRacks).toHaveLength(1);
    expect(out.placedRacks[0].itemId).toBe('chassis_1');
    expect(out.stock.chassis_1).toBeUndefined();
    expect(out.stock.other).toBe(2);
  });

  it('falha sem stock', () => {
    const prev = {
      stock: {},
      storedBatteries: [],
      placedRacks: []
    };
    const out = applyPlaceRackFromStock(prev, 'chassis_1', 'room_norm', 0, upgrades);
    expect(out.ok).toBe(false);
  });
});
