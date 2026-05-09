import { describe, it, expect } from 'vitest';
import { mapPrismaRacksToPlacedRackDtos } from '../modules/servers/servers.snapshot.service.js';

describe('mapPrismaRacksToPlacedRackDtos', () => {
  it('mapeia slots e multiplicadores por rack', () => {
    const racks = [
      {
        id: 'rack_a',
        item_id: 'chassis_1',
        wiring_id: null,
        battery_id: null,
        current_charge: 0,
        is_on: 1,
        selected_coin_id: 'coin_x',
        room_id: 'room_initial',
        slot_index: 0,
        battery_catalog_item_id: null,
        battery_power_capacity_wh: null,
        battery_display_name: null,
        battery_image_url: null
      }
    ];
    const slots = [
      { rack_id: 'rack_a', slot_index: 0, machine_item_id: 'm1' },
      { rack_id: 'rack_a', slot_index: 1, machine_item_id: null }
    ];
    const mult = [{ rack_id: 'rack_a', slot_index: 0, multiplier_item_id: 'x1' }];
    const out = mapPrismaRacksToPlacedRackDtos(racks, slots, mult);
    expect(out).toHaveLength(1);
    expect(out[0].slots[0]).toBe('m1');
    expect(out[0].slots[1]).toBe(null);
    expect(out[0].multiplierSlots[0]).toBe('x1');
    expect(out[0].roomId).toBe('room_initial');
    expect(out[0].isOn).toBe(true);
  });
});
