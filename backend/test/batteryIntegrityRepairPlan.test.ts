import { describe, expect, it, vi } from 'vitest';
import { buildBatteryIntegrityRepairPlan } from '../modules/batteries/batteries.integrity.js';

describe('buildBatteryIntegrityRepairPlan', () => {
  it('devolve resumo e 4 acções nomeadas (sistema de carregamento descontinuado)', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ c: '0' }] })
    };
    const plan = await buildBatteryIntegrityRepairPlan(client as import('pg').PoolClient);
    expect(plan.summary.event).toBe('battery_integrity_readonly_report');
    expect(plan.actions).toHaveLength(4);
    expect(plan.actions.map((x) => x.id)).toEqual([
      'fix_stored_battery_catalog',
      'clear_orphan_rack_battery_uuid',
      'clear_duplicate_rack_battery_uuid',
      'clear_invalid_rack_battery_catalog_ref'
    ]);
    expect(client.query).toHaveBeenCalled();
  });
});
