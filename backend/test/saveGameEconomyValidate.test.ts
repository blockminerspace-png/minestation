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
  sanitizeStoredBatteriesForSavePayload,
  validateWorkshopSlotsPayloadForSave
} from '../lib/saveGameEconomyValidate.js';

describe('saveGameEconomyValidate', () => {
  it('SAVE_GAME_ITEM_ID_RE', () => {
    expect(SAVE_GAME_ITEM_ID_RE.test('item_1')).toBe(true);
    expect(SAVE_GAME_ITEM_ID_RE.test('bad id')).toBe(false);
  });

  it('isClientDailyActionKey', () => {
    expect(isClientDailyActionKey('reward_ad_slot_0')).toBe(true);
    expect(isClientDailyActionKey('reward_ad_slot_16')).toBe(false);
    expect(isClientDailyActionKey('tx_foo')).toBe(false);
  });

  it('isAdminDailyActionKey', () => {
    expect(isAdminDailyActionKey('custom_key-1')).toBe(true);
    expect(isAdminDailyActionKey('valid:key_1')).toBe(true);
    expect(isAdminDailyActionKey('tx_abc')).toBe(false);
    expect(isAdminDailyActionKey('a'.repeat(200))).toBe(false);
  });

  it('isClientDailyActionKey slots daily_boost e instant', () => {
    expect(isClientDailyActionKey('daily_boost_slot_15')).toBe(true);
    expect(isClientDailyActionKey('instant_recharge_slot_0')).toBe(true);
    expect(isClientDailyActionKey('instant_recharge_slot_20')).toBe(false);
  });

  it('validateDailyActionsForSave ignora tx_ e aceita chaves cliente', () => {
    const now = 1_700_000_000_000;
    const r = validateDailyActionsForSave(
      { tx_dep: now, reward_ad_slot_0: now - 1000 },
      false,
      now
    );
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.keys).toEqual(['reward_ad_slot_0']);
      expect(r.vals).toEqual([Math.floor(now - 1000)]);
    }
  });

  it('validateDailyActionsForSave admin aceita chave custom e rejeita chave inválida', () => {
    const now = 1_700_000_000_000;
    const ok = validateDailyActionsForSave({ admin_note: now }, true, now);
    expect(ok).toMatchObject({ ok: true });

    const bad = validateDailyActionsForSave({ 'no spaces': now }, true, now);
    expect(bad).toMatchObject({ ok: false });
  });

  it('validateDailyActionsForSave cliente rejeita futuro > now+1d', () => {
    const now = 1_700_000_000_000;
    const r = validateDailyActionsForSave({ reward_ad_slot_0: now + 2 * 86400000 }, false, now);
    expect(r).toMatchObject({ ok: false });
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
        placedRacks: [{ id: 'r1', batteryId: 'bat-a' }, { id: 'r2', batteryId: 'bat-b' }],
        workshopSlots: []
      },
      false
    );
    expect(r).toEqual({ ok: true });
  });

  it('validateStoredBatteryWarehouseRemovalAllowed aceita id na oficina (internalSlots)', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'inst-1' }] })
    };
    const r = await validateStoredBatteryWarehouseRemovalAllowed(
      client as never,
      1,
      [],
      {
        placedRacks: [],
        workshopSlots: [{ itemId: 'charger_x', internalSlots: { s0: 'inst-1' }, currentCharge: 0 }]
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
      { placedRacks: [], workshopSlots: [] },
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
      { placedRacks: [], workshopSlots: [] },
      true
    );
    expect(r).toEqual({ ok: true });
  });

  it('sanitizeStoredBatteriesForSavePayload deduplica por id (última entrada vence)', () => {
    const out = sanitizeStoredBatteriesForSavePayload(
      [
        { id: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee', itemId: 'small_battery', currentCharge: 10 },
        { id: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee', itemId: 'small_battery', currentCharge: 99 }
      ],
      [],
      []
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { currentCharge: number }).currentCharge).toBe(99);
  });

  it('sanitizeStoredBatteriesForSavePayload remove instância montada na oficina', () => {
    const bid = 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const out = sanitizeStoredBatteriesForSavePayload(
      [{ id: bid, itemId: 'small_battery', currentCharge: 50 }],
      [{ itemId: 'genesis_charger', internalSlots: { bat: bid }, currentCharge: 0 }],
      []
    );
    expect(out).toHaveLength(0);
  });

  it('sanitizeStoredBatteriesForSavePayload remove instância montada na rig', () => {
    const bid = 'cccccccc-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const out = sanitizeStoredBatteriesForSavePayload(
      [{ id: bid, itemId: 'small_battery', currentCharge: 50 }],
      [],
      [{ id: 'rack1', batteryId: bid }]
    );
    expect(out).toHaveLength(0);
  });

  it('sanitizeStoredBatteriesForSavePayload aceita itemId vazio e usa marcador para validação posterior', () => {
    const bid = 'dddddddd-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const out = sanitizeStoredBatteriesForSavePayload(
      [{ id: bid, itemId: '', currentCharge: 12 }],
      [],
      []
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { itemId: string }).itemId).toBe(STORED_BATTERY_CATALOG_PENDING_ID);
  });

  it('validateStoredBatteriesForSave normaliza itemId pendente com fallback do catálogo', async () => {
    // Catálogo canónico passou a ser `battery_estelar` (infinita); aliases legados
    // (`small_battery`, `battery_protostar`, `battery_stellar`) normalizam para Estelar.
    const bat = {
      id: 'eeeeeeee-bbbb-4ccc-dddd-eeeeeeeeeeee',
      itemId: STORED_BATTERY_CATALOG_PENDING_ID,
      currentCharge: 5
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
      itemId: 'some_gpu_catalog',
      currentCharge: 0
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

  it('validateWorkshopSlotsPayloadForSave retorna erro amigável quando a query upgrades falha', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('connection refused'))
    };
    const slots = [{ itemId: 'charger_slot_test', currentCharge: 0, internalSlots: {}, slotCharges: {} }];
    const r = await validateWorkshopSlotsPayloadForSave(client as never, slots, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/F5/);
    }
  });

  it('validateStoredBatteryWarehouseRemovalAllowed usa battery_id em placed_racks na BD', async () => {
    const mountedOnDb = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    let n = 0;
    const client = {
      query: vi.fn().mockImplementation(() => {
        n += 1;
        if (n === 1) return Promise.resolve({ rows: [{ id: mountedOnDb }] });
        if (n === 2) return Promise.resolve({ rows: [] });
        if (n === 3) return Promise.resolve({ rows: [{ battery_id: mountedOnDb }] });
        return Promise.resolve({ rows: [] });
      })
    };
    const r = await validateStoredBatteryWarehouseRemovalAllowed(
      client as never,
      1,
      [],
      { placedRacks: [], workshopSlots: [] },
      false
    );
    expect(r).toEqual({ ok: true });
  });
});
