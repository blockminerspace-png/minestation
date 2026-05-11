import { describe, it, expect } from 'vitest';
import { shouldExposeBatteryInInventoryWarehouse } from '../modules/batteries/batteryInvariant.service.js';

const UUID = '550e8400-e29b-41d4-a716-446655440001';
const mounted = new Set<string>([UUID]);

describe('shouldExposeBatteryInInventoryWarehouse', () => {
  it('exclui bateria listada em placed_racks', () => {
    const r = shouldExposeBatteryInInventoryWarehouse(
      {
        id: UUID,
        status: 'INVENTORY',
        location: 'WAREHOUSE',
        rack_id: null,
        slot_id: null,
        room_id: null,
        workshop_slot_index: null,
        workshop_component_slot_id: null
      },
      mounted
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.event).toBe('inventory_state_battery_divergence');
  });

  it('exclui EQUIPPED e CHARGING', () => {
    for (const st of ['EQUIPPED', 'CHARGING'] as const) {
      const r = shouldExposeBatteryInInventoryWarehouse(
        {
          id: '660e8400-e29b-41d4-a716-446655440002',
          status: st,
          location: st === 'EQUIPPED' ? 'RACK' : 'WORKSHOP_CHARGER',
          rack_id: null,
          slot_id: null,
          room_id: null,
          workshop_slot_index: st === 'CHARGING' ? 0 : null,
          workshop_component_slot_id: st === 'CHARGING' ? 'b0' : null
        },
        new Set()
      );
      expect(r.ok).toBe(false);
    }
  });

  it('permite INVENTORY em WAREHOUSE fora de rack', () => {
    const r = shouldExposeBatteryInInventoryWarehouse(
      {
        id: '770e8400-e29b-41d4-a716-446655440003',
        status: 'INVENTORY',
        location: 'WAREHOUSE',
        rack_id: null,
        slot_id: null,
        room_id: null,
        workshop_slot_index: null,
        workshop_component_slot_id: null
      },
      new Set()
    );
    expect(r.ok).toBe(true);
  });

  it('exclui INVENTORY com rack_id preenchido', () => {
    const r = shouldExposeBatteryInInventoryWarehouse(
      {
        id: '880e8400-e29b-41d4-a716-446655440004',
        status: 'INVENTORY',
        location: 'WAREHOUSE',
        rack_id: 'rack_x',
        slot_id: null,
        room_id: null,
        workshop_slot_index: null,
        workshop_component_slot_id: null
      },
      new Set()
    );
    expect(r.ok).toBe(false);
  });
});
