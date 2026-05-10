import { describe, it, expect, vi } from 'vitest';
import { deleteWarehouseStoredBatteriesExceptKeepIds } from '../lib/storedBatteriesWarehouseDelete.js';

describe('storedBatteriesWarehouseDelete', () => {
  it('com keepIds usa DELETE com NOT EXISTS sobre placed_racks', async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rowCount: 0 };
      })
    };
    await deleteWarehouseStoredBatteriesExceptKeepIds(client as never, 42, ['b1']);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('NOT EXISTS');
    expect(queries[0]).toContain('ANY($2::text[])');
  });

  it('sem keepIds omite ANY mas mantém NOT EXISTS', async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rowCount: 0 };
      })
    };
    await deleteWarehouseStoredBatteriesExceptKeepIds(client as never, 42, []);
    expect(queries[0]).toContain('NOT EXISTS');
    expect(queries[0]).not.toContain('ANY($2::text[])');
  });
});
