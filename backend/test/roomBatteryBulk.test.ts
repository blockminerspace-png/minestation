import { describe, expect, it } from 'vitest';
import { applyBulkRoomBatteryChange, type BulkBatteryPrev, type GameUpgrade } from '../lib/roomBatteryBulk.js';

const upgrades: GameUpgrade[] = [
  {
    id: 'small_battery',
    type: 'battery',
    name: 'Small',
    powerCapacity: 100,
    compatibleRacks: []
  }
];

describe('roomBatteryBulk instance UUID on rack', () => {
  it('unload + remove all batteries in room keeps stored_batteries consistent (no orphan ids)', () => {
    const instId = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const prev: BulkBatteryPrev = {
      stock: {},
      storedBatteries: [{ id: instId, itemId: 'small_battery', currentCharge: 50 }],
      placedRacks: [
        {
          id: 'rack1',
          itemId: 'some_chassis',
          roomId: 'room_initial',
          slotIndex: 0,
          batteryId: instId,
          currentCharge: 50,
          isOn: true,
          slots: [],
          multiplierSlots: []
        }
      ]
    };
    const out = applyBulkRoomBatteryChange(prev, 'room_initial', '', upgrades, { rigSort: 'slot_asc' });
    expect(out.ok).toBe(true);
    expect(out.next?.storedBatteries?.some((b) => b.id === instId)).toBe(true);
    expect(out.next?.placedRacks?.[0]?.batteryId).toBeNull();
  });

  it('bulk equip from stock sets rack batteryId to a new instance UUID (not catalog id)', () => {
    const prev: BulkBatteryPrev = {
      stock: { small_battery: 2 },
      storedBatteries: [],
      placedRacks: [
        {
          id: 'rack1',
          itemId: 'some_chassis',
          roomId: 'room_initial',
          slotIndex: 0,
          batteryId: null,
          currentCharge: 0,
          isOn: false,
          slots: [],
          multiplierSlots: []
        }
      ]
    };
    const out = applyBulkRoomBatteryChange(prev, 'room_initial', 'small_battery', upgrades, { rigSort: 'slot_asc' });
    expect(out.ok).toBe(true);
    const bid = out.next?.placedRacks?.[0]?.batteryId;
    expect(bid).toBeTruthy();
    expect(bid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(bid).not.toBe('small_battery');
    expect(out.next?.stock?.small_battery).toBe(1);
  });

  it('bulk equip from warehouse sets rack batteryId to instance UUID', () => {
    const instId = 'bbbbbbbb-cccc-4ddd-eeee-ffffffffffff';
    const prev: BulkBatteryPrev = {
      stock: {},
      storedBatteries: [{ id: instId, itemId: 'small_battery', currentCharge: 80 }],
      placedRacks: [
        {
          id: 'rack1',
          itemId: 'some_chassis',
          roomId: 'room_initial',
          slotIndex: 0,
          batteryId: null,
          currentCharge: 0,
          isOn: false,
          slots: [],
          multiplierSlots: []
        }
      ]
    };
    const out = applyBulkRoomBatteryChange(prev, 'room_initial', 'small_battery', upgrades, { rigSort: 'slot_asc' });
    expect(out.ok).toBe(true);
    expect(out.next?.placedRacks?.[0]?.batteryId).toBe(instId);
    expect(out.next?.storedBatteries?.some((b) => b.id === instId)).toBe(false);
  });
});
