import { describe, it, expect } from 'vitest';
import { persistStockStoredBatteriesPlacedRacks } from '../lib/serverRoomPersistence.js';

type Row = { item_id: string; qty: number };

/**
 * Mock mínimo do `PoolClient` para validar invariantes SQL emitidos pelo persist:
 * - simula UPSERT em `stock` (`INSERT ... ON CONFLICT ... DO UPDATE SET qty = EXCLUDED.qty`);
 * - simula `DELETE FROM stock WHERE user_id = $1` (apaga tudo) e
 *   `DELETE FROM stock WHERE user_id = $1 AND NOT (item_id = ANY($2::text[]))` (apaga ausentes);
 * - ignora as demais queries (placedRacks / stored_batteries) — não relevantes neste teste.
 */
function makeStockOnlyMockClient(initialStock: Row[]) {
  let rows: Row[] = initialStock.map((r) => ({ ...r }));
  const queries: { sql: string; params?: unknown[] }[] = [];

  const client = {
    async query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      queries.push({ sql, params });
      const s = String(sql || '').trim();

      // Leitura "SELECT item_id, qty FROM stock WHERE user_id = $1 [...]"
      if (/^SELECT\s+item_id,\s*qty\s+FROM\s+stock\s+WHERE\s+user_id\s*=\s*\$1/i.test(s)) {
        return { rows: [...rows], rowCount: rows.length };
      }

      // DELETE FROM stock WHERE user_id = $1 AND NOT (item_id = ANY($2::text[]))
      if (/^DELETE\s+FROM\s+stock\s+WHERE\s+user_id\s*=\s*\$1\s+AND\s+NOT\s*\(item_id\s*=\s*ANY/i.test(s)) {
        const keep = new Set(((params?.[1] as string[]) || []).map(String));
        const before = rows.length;
        rows = rows.filter((r) => keep.has(r.item_id));
        return { rows: [], rowCount: before - rows.length };
      }

      // DELETE FROM stock WHERE user_id = $1 AND qty <= 0
      if (/^DELETE\s+FROM\s+stock\s+WHERE\s+user_id\s*=\s*\$1\s+AND\s+qty\s*<=\s*0/i.test(s)) {
        const before = rows.length;
        rows = rows.filter((r) => Number(r.qty) > 0);
        return { rows: [], rowCount: before - rows.length };
      }

      // DELETE FROM stock WHERE user_id = $1
      if (/^DELETE\s+FROM\s+stock\s+WHERE\s+user_id\s*=\s*\$1\s*$/i.test(s)) {
        const before = rows.length;
        rows = [];
        return { rows: [], rowCount: before };
      }

      // INSERT INTO stock (...) SELECT $1, unnest($2::text[]), unnest($3::int[]) ON CONFLICT ...
      if (/^INSERT\s+INTO\s+stock\s*\(/i.test(s) && /ON\s+CONFLICT\s*\(user_id,\s*item_id\)/i.test(s)) {
        const ids = ((params?.[1] as string[]) || []).map(String);
        const qtys = ((params?.[2] as number[]) || []).map((n) => Math.floor(Number(n) || 0));
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          const q = qtys[i] ?? 0;
          const idx = rows.findIndex((r) => r.item_id === id);
          if (idx >= 0) rows[idx] = { item_id: id, qty: q };
          else rows.push({ item_id: id, qty: q });
        }
        return { rows: [], rowCount: ids.length };
      }

      // SELECT id FROM placed_racks / rack_slots / etc → não usados (não passamos placedRacks)
      return { rows: [], rowCount: 0 };
    }
  } as const;

  return {
    client,
    getRows: () => rows.slice(),
    getQueries: () => queries
  };
}

describe('persistStockStoredBatteriesPlacedRacks — stockMode snapshot vs partial', () => {
  it('snapshot: item omitido do snapshot é apagado da BD (Aurora x1 → equip → unequip não duplica)', async () => {
    const mock = makeStockOnlyMockClient([{ item_id: 'aurora', qty: 1 }]);

    // Cenário: utilizador equipou Aurora no rack; intent retorna stock = {} (aurora consumida).
    await persistStockStoredBatteriesPlacedRacks(
      mock.client as unknown as Parameters<typeof persistStockStoredBatteriesPlacedRacks>[0],
      42,
      { stock: {}, stockMode: 'snapshot' },
      []
    );

    expect(mock.getRows().find((r) => r.item_id === 'aurora')).toBeUndefined();
  });

  it('snapshot: item com qty>0 persiste, outros itens da BD são apagados', async () => {
    const mock = makeStockOnlyMockClient([
      { item_id: 'aurora', qty: 1 },
      { item_id: 'phoenix', qty: 3 }
    ]);

    await persistStockStoredBatteriesPlacedRacks(
      mock.client as unknown as Parameters<typeof persistStockStoredBatteriesPlacedRacks>[0],
      42,
      { stock: { phoenix: 3 }, stockMode: 'snapshot' },
      []
    );

    const rows = mock.getRows();
    expect(rows.find((r) => r.item_id === 'aurora')).toBeUndefined();
    expect(rows.find((r) => r.item_id === 'phoenix')?.qty).toBe(3);
  });

  it('snapshot: qty <= 0 ou negativo nunca persiste (filtrado antes do INSERT)', async () => {
    const mock = makeStockOnlyMockClient([
      { item_id: 'aurora', qty: 1 },
      { item_id: 'broken', qty: 5 }
    ]);

    await persistStockStoredBatteriesPlacedRacks(
      mock.client as unknown as Parameters<typeof persistStockStoredBatteriesPlacedRacks>[0],
      42,
      { stock: { aurora: 0, broken: -2 }, stockMode: 'snapshot' },
      []
    );

    // Ambos foram filtrados → snapshot ficou vazio → DELETE FROM stock WHERE user_id = $1
    expect(mock.getRows()).toHaveLength(0);
  });

  it('partial (default): NÃO apaga itens ausentes do snapshot — comportamento legado preservado', async () => {
    const mock = makeStockOnlyMockClient([
      { item_id: 'aurora', qty: 1 },
      { item_id: 'phoenix', qty: 3 }
    ]);

    await persistStockStoredBatteriesPlacedRacks(
      mock.client as unknown as Parameters<typeof persistStockStoredBatteriesPlacedRacks>[0],
      42,
      { stock: { phoenix: 3 } },
      []
    );

    const rows = mock.getRows();
    expect(rows.find((r) => r.item_id === 'aurora')?.qty).toBe(1);
    expect(rows.find((r) => r.item_id === 'phoenix')?.qty).toBe(3);
  });

  it('snapshot: ciclo Aurora equip → unequip → equip → unequip não duplica', async () => {
    const mock = makeStockOnlyMockClient([{ item_id: 'aurora', qty: 1 }]);

    // Passo 1: equipar Aurora → snapshot stock = {} (intent autoritativo)
    await persistStockStoredBatteriesPlacedRacks(
      mock.client as unknown as Parameters<typeof persistStockStoredBatteriesPlacedRacks>[0],
      42,
      { stock: {}, stockMode: 'snapshot' },
      []
    );
    expect(mock.getRows()).toHaveLength(0);

    // Passo 2: remover Aurora → snapshot stock = { aurora: 1 }
    await persistStockStoredBatteriesPlacedRacks(
      mock.client as unknown as Parameters<typeof persistStockStoredBatteriesPlacedRacks>[0],
      42,
      { stock: { aurora: 1 }, stockMode: 'snapshot' },
      []
    );
    expect(mock.getRows().find((r) => r.item_id === 'aurora')?.qty).toBe(1);

    // Passo 3: equipar novamente → snapshot stock = {}
    await persistStockStoredBatteriesPlacedRacks(
      mock.client as unknown as Parameters<typeof persistStockStoredBatteriesPlacedRacks>[0],
      42,
      { stock: {}, stockMode: 'snapshot' },
      []
    );
    expect(mock.getRows()).toHaveLength(0);

    // Passo 4: remover novamente → snapshot stock = { aurora: 1 } — NUNCA 2.
    await persistStockStoredBatteriesPlacedRacks(
      mock.client as unknown as Parameters<typeof persistStockStoredBatteriesPlacedRacks>[0],
      42,
      { stock: { aurora: 1 }, stockMode: 'snapshot' },
      []
    );
    const finalRows = mock.getRows();
    expect(finalRows.find((r) => r.item_id === 'aurora')?.qty).toBe(1);
    expect(finalRows.filter((r) => r.item_id === 'aurora')).toHaveLength(1);
  });
});
