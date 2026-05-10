import { describe, it, expect } from 'vitest';
import {
  applyLegacySaveGameFullBarrier,
  legacyCriticalKeysInChanges,
  neutralizeLegacySaveGameSlicePayload
} from '../lib/legacySaveGamePlayerPolicy.js';
import type { PoolClient } from 'pg';

describe('legacySaveGamePlayerPolicy', () => {
  it('legacyCriticalKeysInChanges detecta stock e placedRacks', () => {
    const keys = legacyCriticalKeysInChanges({
      stock: { a: 1 },
      placedRacks: [],
      lastLoadTime: 1
    });
    expect(keys).toContain('stock');
    expect(keys).toContain('placedRacks');
  });

  it('applyLegacySaveGameFullBarrier em modo strip remove stock', () => {
    process.env.LEGACY_SAVEGAME_PLAYER_POLICY = 'strip';
    const changes = { stock: { x: 1 }, lastLoadTime: 99 };
    const r = applyLegacySaveGameFullBarrier({ headers: {}, originalUrl: '/api/save-game' }, changes, 1, false);
    expect(r.mode).toBe('allow');
    expect(changes.stock).toBeUndefined();
  });

  it('neutralizeLegacySaveGameSlicePayload inventory remove stock do cliente', async () => {
    const client = {
      query: async () => ({ rows: [] })
    } as unknown as PoolClient;
    const changes: Record<string, unknown> = { stock: { a: 1 }, storedBatteries: [], lastLoadTime: 1 };
    await neutralizeLegacySaveGameSlicePayload(
      client,
      1,
      'inventory',
      changes,
      { headers: {}, originalUrl: '/api/game/save-inventory' },
      1
    );
    expect(changes.stock).toBeUndefined();
    expect(changes.storedBatteries).toBeUndefined();
  });
});
