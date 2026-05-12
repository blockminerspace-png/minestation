import { describe, it, expect, vi } from 'vitest';
import {
  SAVE_GAME_ITEM_ID_RE,
  STORED_BATTERY_CATALOG_PENDING_ID,
  isClientDailyActionKey,
  isAdminDailyActionKey,
  validateDailyActionsForSave,
  validateStockForSave,
  validateStoredBatteryWarehouseRemovalAllowed,
  validateStoredBatteriesForSave,
  sanitizeStoredBatteriesForSavePayload
} from '../lib/saveGameEconomyValidate.js';

describe('saveGameEconomyValidate', () => {
  it('SAVE_GAME_ITEM_ID_RE', () => {
    expect(SAVE_GAME_ITEM_ID_RE.test('item_1')).toBe(true);
    expect(SAVE_GAME_ITEM_ID_RE.test('bad id')).toBe(false);
  });

  it('isClientDailyActionKey rejeita tudo (oficina/recarga descontinuadas)', () => {
    expect(isClientDailyActionKey('reward_ad_slot_0')).toBe(false);
    expect(isClientDailyActionKey('daily_boost_slot_15')).toBe(false);
    expect(isClientDailyActionKey('instant_recharge_slot_0')).toBe(false);
    expect(isClientDailyActionKey('tx_foo')).toBe(false);
  });

  it('isAdminDailyActionKey', () => {
    expect(isAdminDailyActionKey('custom_key-1')).toBe(true);
    expect(isAdminDailyActionKey('valid:key_1')).toBe(true);
    expect(isAdminDailyActionKey('tx_abc')).toBe(false);
    expect(isAdminDailyActionKey('a'.repeat(200))).toBe(false);
  });

  it('validateDailyActionsForSave ignora chaves de cliente (sistema descontinuado)', () => {
    const now = 1_700_000_000_000;
    const r = validateDailyActionsForSave(
      { tx_dep: now, reward_ad_slot_0: now - 1000 },
      false,
      now
    );
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.keys).toEqual([]);
      expect(r.vals).toEqual([]);
    }
  });

  it('validateDailyActionsForSave admin aceita chave custom e ignora chave inválida (silenciosamente)', () => {
    const now = 1_700_000_000_000;
    const ok = validateDailyActionsForSave({ admin_note: now }, true, now);
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) {
      expect(ok.keys).toEqual(['admin_note']);
    }

    // Chaves inválidas no admin são ignoradas silenciosamente (sistema de oficina descontinuado).
    const skipped = validateDailyActionsForSave({ 'no spaces': now }, true, now);
    expect(skipped).toMatchObject({ ok: true });
    if (skipped.ok) {
      expect(skipped.keys).toEqual([]);
    }
  });

  it('validateDailyActionsForSave cliente nunca falha por futuro (não aceita chaves de cliente)', () => {
    const now = 1_700_000_000_000;
    const r = validateDailyActionsForSave({ reward_ad_slot_0: now + 2 * 86400000 }, false, now);
    expect(r).toMatchObject({ ok: true });
  });

  it('validateStockForSave rejeita chave inválida e devolve samples (sem query à BD)', async () => {
    const client = { query: vi.fn() };
    const r = await validateStockForSave(client as never, { 'item com espaço': 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid_key');
      expect(r.samples.some((s) => s.includes(' '))).toBe(true);
    }
    expect(client.query).not.toHaveBeenCalled();
  });

  it('validateStockForSave aceita itens fora do catálogo (stock legado) e consulta upgrades', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'known_a' }], rowCount: 1 })
    };
    const r = await validateStockForSave(client as never, { known_a: 1, ghost_item: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.itemIds).toContain('ghost_item');
    }
    expect(client.query).toHaveBeenCalled();
  });

  it('validateStoredBatteryWarehouseRemovalAllowed aceita wipe quando cada id está numa rig', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'bat-a' }, { id: 'bat-b' }] })
    };
    const r = await validateStoredBatteryWarehouseRemovalAllowed(
      client as never,
      1,
      [],
      {
        placedRacks: [{ id: 'r1', batteryId: 'bat-a' }, { id: 'r2', batteryId: 'bat-b' }]
      },
      false
    );
    expect(r).toEqual({ ok: true });
  });

  it('validateStoredBatteryWarehouseRemovalAllowed rejeita wipe quando falta referência no payload', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'orphan' }] })
    };
    const r = await validateStoredBatteryWarehouseRemovalAllowed(
      client as never,
      1,
      [],
      { placedRacks: [] },
      false
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/F5/);
    }
  });

  it('validateStoredBatteryWarehouseRemovalAllowed admin ignora', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'x' }] }) };
    const r = await validateStoredBatteryWarehouseRemovalAllowed(
      client as never,
      1,
      [],
      { placedRacks: [] },
      true
    );
    expect(r).toEqual({ ok: true });
  });

  it('sanitizeStoredBatteriesForSavePayload deduplica por id (última entrada vence)', () => {
    const out = sanitizeStoredBatteriesForSavePayload(
      [
        { id: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee', itemId: 'small_battery' },
        { id: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee', itemId: 'small_battery_alt' }
      ],
      []
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { itemId: string }).itemId).toBe('small_battery_alt');
  });

  it('sanitizeStoredBatteriesForSavePayload remove instância montada na rig', () => {
    const bid = 'cccccccc-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const out = sanitizeStoredBatteriesForSavePayload(
      [{ id: bid, itemId: 'small_battery' }],
      [{ id: 'rack1', batteryId: bid }]
    );
    expect(out).toHaveLength(0);
  });

  it('sanitizeStoredBatteriesForSavePayload aceita itemId vazio e usa marcador para validação posterior', () => {
    const bid = 'dddddddd-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const out = sanitizeStoredBatteriesForSavePayload(
      [{ id: bid, itemId: '' }],
      []
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { itemId: string }).itemId).toBe(STORED_BATTERY_CATALOG_PENDING_ID);
  });

  it('validateStoredBatteriesForSave normaliza itemId pendente com fallback do catálogo', async () => {
    const bat = {
      id: 'eeeeeeee-bbbb-4ccc-dddd-eeeeeeeeeeee',
      itemId: STORED_BATTERY_CATALOG_PENDING_ID
    };
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('FROM upgrades') && s.includes('LIMIT 1')) {
          return Promise.resolve({ rows: [{ id: 'battery_estelar' }] });
        }
        if (s.includes('stored_batteries') && s.includes('IS DISTINCT FROM')) {
          return Promise.resolve({ rowCount: 0 });
        }
        if (s.includes('stored_batteries') && s.includes('user_id') && s.includes('id = ANY')) {
          return Promise.resolve({ rows: [] });
        }
        if (s.includes('upgrades') && s.includes('ANY') && s.includes('NOT (')) {
          return Promise.resolve({ rows: [] });
        }
        if (s.includes('upgrades') && s.includes('ANY') && !s.includes('NOT (')) {
          return Promise.resolve({ rows: [{ id: 'battery_estelar' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      })
    };
    const r = await validateStoredBatteriesForSave(client as never, 1, [bat]);
    expect(r).toEqual({ ok: true });
    expect(bat.itemId).toBe('battery_estelar');
  });

  it('validateStoredBatteriesForSave rejeita item_id de miner/GPU no armazém (não reescreve para bateria barata)', async () => {
    const bat = {
      id: 'ffffffff-bbbb-4ccc-dddd-eeeeeeeeeeee',
      itemId: 'some_gpu_catalog'
    };
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('FROM upgrades') && s.includes('LIMIT 1')) {
          return Promise.resolve({ rows: [{ id: 'battery_protostar' }] });
        }
        if (s.includes('stored_batteries') && s.includes('IS DISTINCT FROM')) {
          return Promise.resolve({ rowCount: 0 });
        }
        if (s.includes('stored_batteries') && s.includes('user_id') && s.includes('id = ANY')) {
          return Promise.resolve({ rows: [{ id: bat.id, item_id: 'some_gpu_catalog' }] });
        }
        if (s.includes('upgrades') && s.includes('ANY') && s.includes('NOT (')) {
          return Promise.resolve({ rows: [{ id: 'some_gpu_catalog' }] });
        }
        if (s.includes('upgrades') && s.includes('ANY')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      })
    };
    const r = await validateStoredBatteriesForSave(client as never, 1, [bat]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/não é bateria/);
    }
    expect(bat.itemId).toBe('some_gpu_catalog');
  });

  it('validateStoredBatteryWarehouseRemovalAllowed usa battery_id em placed_racks na BD', async () => {
    const mountedOnDb = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    let n = 0;
    const client = {
      query: vi.fn().mockImplementation(() => {
        n += 1;
        if (n === 1) return Promise.resolve({ rows: [{ id: mountedOnDb }] });
        if (n === 2) return Promise.resolve({ rows: [{ battery_id: mountedOnDb }] });
        return Promise.resolve({ rows: [] });
      })
    };
    const r = await validateStoredBatteryWarehouseRemovalAllowed(
      client as never,
      1,
      [],
      { placedRacks: [] },
      false
    );
    expect(r).toEqual({ ok: true });
  });
});
