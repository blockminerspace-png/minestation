import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  computePlayerGameHeaderSnapshot,
  resetUpgradesCatalogCacheForTests
} from '../lib/playerGameHeaderSnapshot.js';

function makePoolResponder(
  rows: {
    gameState: { rowCount: number; rows: Record<string, unknown>[] };
    balances: { rows: Record<string, unknown>[] };
    upgrades: { rows: Record<string, unknown>[] };
    racks: { rows: Record<string, unknown>[] };
    slots: { rows: Record<string, unknown>[] };
    mults: { rows: Record<string, unknown>[] };
  }
) {
  let upgradeCalls = 0;
  const pool = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (String(sql).includes('FROM game_states')) return rows.gameState;
      if (String(sql).includes('coin_balances')) return rows.balances;
      if (String(sql).includes('FROM upgrades')) {
        upgradeCalls += 1;
        return rows.upgrades;
      }
      if (String(sql).includes('placed_racks')) return rows.racks;
      if (String(sql).includes('rack_slots')) return rows.slots;
      if (String(sql).includes('rack_multiplier_slots')) return rows.mults;
      return { rows: [] };
    })
  } as unknown as Pool;
  return { pool, getUpgradeQueryCount: () => upgradeCalls };
}

describe('computePlayerGameHeaderSnapshot', () => {
  beforeEach(() => {
    resetUpgradesCatalogCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    resetUpgradesCatalogCacheForTests();
    vi.useRealTimers();
  });

  it('sem game_state devolve payload vazio e não consulta upgrades', async () => {
    const { pool, getUpgradeQueryCount } = makePoolResponder({
      gameState: { rowCount: 0, rows: [] },
      balances: { rows: [] },
      upgrades: { rows: [] },
      racks: { rows: [] },
      slots: { rows: [] },
      mults: { rows: [] }
    });
    const out = await computePlayerGameHeaderSnapshot(pool, 42);
    expect(out.coinBalances).toEqual({});
    expect(out.usdc).toBe(0);
    expect(out.totalHash).toBe(0);
    expect(getUpgradeQueryCount()).toBe(0);
  });

  it('com estado soma hashrate de rack ligado com bateria infinita e GPUs', async () => {
    const { pool, getUpgradeQueryCount } = makePoolResponder({
      gameState: { rowCount: 1, rows: [{ usdc: 2.5, server_updated_at: '12345' }] },
      balances: { rows: [{ coin_id: 'btc', amount: 1 }] },
      upgrades: {
        rows: [
          { id: 'gpu1', base_production: 10, multiplier: 0, power_capacity: null },
          { id: 'bat_inf', base_production: 0, multiplier: 0, power_capacity: '-1' },
          { id: 'wire1', base_production: 0, multiplier: 0, power_capacity: null }
        ]
      },
      racks: {
        rows: [
          {
            id: 'r1',
            is_on: 1,
            wiring_id: 'wire1',
            battery_id: 'bat_inf',
            current_charge: 0,
            selected_coin_id: 'btc'
          }
        ]
      },
      slots: {
        rows: [{ rack_id: 'r1', slot_index: 0, machine_item_id: 'gpu1' }]
      },
      mults: { rows: [] }
    });
    const out = await computePlayerGameHeaderSnapshot(pool, 7);
    expect(out.usdc).toBe(2.5);
    expect(out.serverUpdatedAt).toBe(12345);
    expect(out.coinBalances.btc).toBe(1);
    expect(out.hashByCoinId.btc).toBe(10);
    expect(out.totalHash).toBe(10);
    expect(getUpgradeQueryCount()).toBe(1);
  });

  it('rack desligado ou sem moeda não contribui', async () => {
    const { pool } = makePoolResponder({
      gameState: { rowCount: 1, rows: [{ usdc: 0, server_updated_at: '1' }] },
      balances: { rows: [] },
      upgrades: {
        rows: [
          { id: 'g', base_production: 5, multiplier: 0, power_capacity: null },
          { id: 'b', base_production: 0, multiplier: 0, power_capacity: '-1' },
          { id: 'w', base_production: 0, multiplier: 0, power_capacity: null }
        ]
      },
      racks: {
        rows: [
          {
            id: 'r1',
            is_on: 0,
            wiring_id: 'w',
            battery_id: 'b',
            current_charge: 100,
            selected_coin_id: 'x'
          },
          {
            id: 'r2',
            is_on: 1,
            wiring_id: 'w',
            battery_id: 'b',
            current_charge: 100,
            selected_coin_id: null
          }
        ]
      },
      slots: {
        rows: [
          { rack_id: 'r1', slot_index: 0, machine_item_id: 'g' },
          { rack_id: 'r2', slot_index: 0, machine_item_id: 'g' }
        ]
      },
      mults: { rows: [] }
    });
    const out = await computePlayerGameHeaderSnapshot(pool, 1);
    expect(out.totalHash).toBe(0);
  });

  it('cache de upgrades: segunda chamada não volta a SELECT upgrades antes do TTL', async () => {
    const data = {
      gameState: { rowCount: 1, rows: [{ usdc: 1, server_updated_at: '9' }] },
      balances: { rows: [] },
      upgrades: {
        rows: [{ id: 'u1', base_production: 1, multiplier: 0, power_capacity: null }]
      },
      racks: { rows: [] },
      slots: { rows: [] },
      mults: { rows: [] }
    };
    const { pool, getUpgradeQueryCount } = makePoolResponder(data);
    await computePlayerGameHeaderSnapshot(pool, 1);
    expect(getUpgradeQueryCount()).toBe(1);
    await computePlayerGameHeaderSnapshot(pool, 2);
    expect(getUpgradeQueryCount()).toBe(1);
  });

  it('após TTL volta a consultar upgrades', async () => {
    const data = {
      gameState: { rowCount: 1, rows: [{ usdc: 1, server_updated_at: '9' }] },
      balances: { rows: [] },
      upgrades: {
        rows: [{ id: 'u1', base_production: 1, multiplier: 0, power_capacity: null }]
      },
      racks: { rows: [] },
      slots: { rows: [] },
      mults: { rows: [] }
    };
    const { pool, getUpgradeQueryCount } = makePoolResponder(data);
    await computePlayerGameHeaderSnapshot(pool, 1);
    vi.advanceTimersByTime(60_001);
    await computePlayerGameHeaderSnapshot(pool, 1);
    expect(getUpgradeQueryCount()).toBe(2);
  });

  it('aplica multiplicadores de rack_multiplier_slots', async () => {
    const { pool } = makePoolResponder({
      gameState: { rowCount: 1, rows: [{ usdc: 0, server_updated_at: '1' }] },
      balances: { rows: [] },
      upgrades: {
        rows: [
          { id: 'gpu', base_production: 20, multiplier: 0, power_capacity: null },
          { id: 'mul', base_production: 0, multiplier: 0.25, power_capacity: null },
          { id: 'bat', base_production: 0, multiplier: 0, power_capacity: '-1' },
          { id: 'wir', base_production: 0, multiplier: 0, power_capacity: null }
        ]
      },
      racks: {
        rows: [
          {
            id: 'rx',
            is_on: 1,
            wiring_id: 'wir',
            battery_id: 'bat',
            current_charge: 0,
            selected_coin_id: 'eth'
          }
        ]
      },
      slots: { rows: [{ rack_id: 'rx', slot_index: 0, machine_item_id: 'gpu' }] },
      mults: { rows: [{ rack_id: 'rx', slot_index: 0, multiplier_item_id: 'mul' }] }
    });
    const out = await computePlayerGameHeaderSnapshot(pool, 1);
    expect(out.hashByCoinId.eth).toBeCloseTo(25);
    expect(out.totalHash).toBeCloseTo(25);
  });

  it('bateria finita com carga zero não produz', async () => {
    const { pool } = makePoolResponder({
      gameState: { rowCount: 1, rows: [{ usdc: 0, server_updated_at: '1' }] },
      balances: { rows: [] },
      upgrades: {
        rows: [
          { id: 'gpu', base_production: 99, multiplier: 0, power_capacity: null },
          { id: 'bat', base_production: 0, multiplier: 0, power_capacity: '100' },
          { id: 'wir', base_production: 0, multiplier: 0, power_capacity: null }
        ]
      },
      racks: {
        rows: [
          {
            id: 'rx',
            is_on: 1,
            wiring_id: 'wir',
            battery_id: 'bat',
            current_charge: 0,
            selected_coin_id: 'x'
          }
        ]
      },
      slots: { rows: [{ rack_id: 'rx', slot_index: 0, machine_item_id: 'gpu' }] },
      mults: { rows: [] }
    });
    const out = await computePlayerGameHeaderSnapshot(pool, 1);
    expect(out.totalHash).toBe(0);
  });

  it('bateria finita com carga > 0 produz', async () => {
    const { pool } = makePoolResponder({
      gameState: { rowCount: 1, rows: [{ usdc: 0, server_updated_at: '1' }] },
      balances: { rows: [] },
      upgrades: {
        rows: [
          { id: 'gpu', base_production: 4, multiplier: 0, power_capacity: null },
          { id: 'bat', base_production: 0, multiplier: 0, power_capacity: '100' },
          { id: 'wir', base_production: 0, multiplier: 0, power_capacity: null }
        ]
      },
      racks: {
        rows: [
          {
            id: 'rx',
            is_on: 1,
            wiring_id: 'wir',
            battery_id: 'bat',
            current_charge: 50,
            selected_coin_id: 'x'
          }
        ]
      },
      slots: { rows: [{ rack_id: 'rx', slot_index: 0, machine_item_id: 'gpu' }] },
      mults: { rows: [] }
    });
    const out = await computePlayerGameHeaderSnapshot(pool, 1);
    expect(out.totalHash).toBe(4);
  });
});
