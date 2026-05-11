import { describe, it, expect } from 'vitest';
import {
  applyLegacySaveGameFullBarrier,
  legacyCriticalKeysInChanges,
  neutralizeLegacySaveGameSlicePayload,
  overlayPlacedRacksDbWithClientRuntime
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

  it('legacyCriticalKeysInChanges detecta batteryId/rackId no topo', () => {
    const keys = legacyCriticalKeysInChanges({
      lastLoadTime: 1,
      batteryId: 'uuid-here',
      rackId: 'rack-1'
    });
    expect(keys).toContain('batteryId');
    expect(keys).toContain('rackId');
  });

  it('applyLegacySaveGameFullBarrier em modo strip remove stock', () => {
    process.env.LEGACY_SAVEGAME_PLAYER_POLICY = 'strip';
    const changes = { stock: { x: 1 }, lastLoadTime: 99 };
    const r = applyLegacySaveGameFullBarrier({ headers: {}, originalUrl: '/api/save-game' }, changes, 1, false);
    expect(r.mode).toBe('allow');
    expect(changes.stock).toBeUndefined();
  });

  it('applyLegacySaveGameFullBarrier em modo reject devolve erro sem persistir stock', () => {
    process.env.LEGACY_SAVEGAME_PLAYER_POLICY = 'reject';
    const changes = { stock: { x: 1 }, lastLoadTime: 99 };
    const r = applyLegacySaveGameFullBarrier({ headers: {}, originalUrl: '/api/save-game' }, changes, 1, false);
    expect(r.mode).toBe('reject');
    expect(r.code).toBe('LEGACY_SAVEGAME_CRITICAL_REJECTED');
    expect(changes.stock).toEqual({ x: 1 });
  });

  it('overlayPlacedRacksDbWithClientRuntime aplica isOn e selectedCoinId do cliente por id', () => {
    const db = [
      { id: 'rack-a', itemId: 'chassis', isOn: true, selectedCoinId: 'btc', wiringId: 'w1' },
      { id: 'rack-b', itemId: 'chassis2', isOn: true, selectedCoinId: 'eth', wiringId: 'w2' }
    ];
    const client = [
      { id: 'rack-a', isOn: false, selectedCoinId: 'doge' },
      { id: 'rack-b', isOn: true }
    ];
    const out = overlayPlacedRacksDbWithClientRuntime(db, client) as Array<Record<string, unknown>>;
    expect(out[0].isOn).toBe(false);
    expect(out[0].selectedCoinId).toBe('doge');
    expect(out[0].wiringId).toBe('w1');
    expect(out[1].isOn).toBe(true);
    expect(out[1].selectedCoinId).toBe('eth');
  });

  it('overlayPlacedRacksDbWithClientRuntime limpa moeda quando cliente envia vazio', () => {
    const db = [{ id: 'r1', isOn: true, selectedCoinId: 'btc' }];
    const client = [{ id: 'r1', selectedCoinId: '' }];
    const out = overlayPlacedRacksDbWithClientRuntime(db, client) as Array<Record<string, unknown>>;
    expect(out[0].selectedCoinId).toBeUndefined();
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
