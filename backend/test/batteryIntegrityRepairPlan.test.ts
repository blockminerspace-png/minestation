import { describe, expect, it, vi } from 'vitest';
import { buildBatteryIntegrityRepairPlan } from '../modules/batteries/batteries.integrity.js';

describe('buildBatteryIntegrityRepairPlan', () => {
  it('devolve resumo e 6 acções nomeadas', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ c: '0' }] })
    };
    const plan = await buildBatteryIntegrityRepairPlan(client as import('pg').PoolClient);
    expect(plan.summary.event).toBe('battery_integrity_readonly_report');
    expect(plan.actions).toHaveLength(6);
    expect(plan.actions.map((x) => x.id)).toEqual([
      'fix_stored_battery_catalog',
      'clear_orphan_rack_battery_uuid',
      'clear_duplicate_rack_battery_uuid',
      'clear_invalid_rack_battery_catalog_ref',
      'sync_infinite_charge_from_instance',
      'sync_infinite_charge_from_catalog_id'
    ]);
    expect(client.query).toHaveBeenCalled();
  });
});
