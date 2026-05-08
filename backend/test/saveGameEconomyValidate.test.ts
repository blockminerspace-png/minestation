import { describe, it, expect, vi } from 'vitest';
import {
  SAVE_GAME_ITEM_ID_RE,
  isClientDailyActionKey,
  isAdminDailyActionKey,
  validateDailyActionsForSave,
  validateStockForSave,
  validateUnopenedBoxesForSave,
  validateStoredBatteryWarehouseRemovalAllowed,
  assertPlacedRacksSlotPayloadAgainstPrevDb,
  PlacedRackSlotsSaveGuardError,
  dedupeParallelArraysLastWins,
  dedupeParallelArraysSumQty,
  dedupePlacedRacksByRackIdLastWins,
  dedupeStoredBatteriesByIdLastWins,
} from '../lib/saveGameEconomyValidate.js';

describe('dedupeParallelArrays (evita PG ON CONFLICT row twice)', () => {
  it('dedupeParallelArraysLastWins mantém último valor por chave', () => {
    const r = dedupeParallelArraysLastWins(['x', 'y', 'x'], [1, 2, 3]);
    expect(r.keys).toHaveLength(2);
    expect(r.vals[r.keys.indexOf('x')]).toBe(3);
    expect(r.vals[r.keys.indexOf('y')]).toBe(2);
  });

  it('dedupeParallelArraysSumQty soma quantidades', () => {
    const r = dedupeParallelArraysSumQty(['b', 'b', 'c'], [2, 3, 1]);
    expect(r.keys).toHaveLength(2);
    expect(r.vals[r.keys.indexOf('b')]).toBe(5);
    expect(r.vals[r.keys.indexOf('c')]).toBe(1);
  });

  it('dedupePlacedRacksByRackIdLastWins', () => {
    const racks = [
      { id: 'r1', itemId: 'a' },
      { id: 'r2', itemId: 'b' },
      { id: 'r1', itemId: 'c' },
    ];
    const out = dedupePlacedRacksByRackIdLastWins(racks);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.id === 'r1')?.itemId).toBe('c');
  });

  it('dedupeStoredBatteriesByIdLastWins', () => {
    const rows = [
      { id: 'u1', itemId: 'bat', currentCharge: 1 },
      { id: 'u2', itemId: 'bat', currentCharge: 2 },
      { id: 'u1', itemId: 'bat', currentCharge: 9 },
    ];
    const out = dedupeStoredBatteriesByIdLastWins(rows);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.id === 'u1')?.currentCharge).toBe(9);
  });
});

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

  it('validateStockForSave unknown_item após SELECT', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'known_a' }], rowCount: 1 })
    };
    const r = await validateStockForSave(client as never, { known_a: 1, ghost_item: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unknown_item');
      expect(r.samples).toContain('ghost_item');
    }
  });

  it('validateUnopenedBoxesForSave mantém caixas válidas e descarta órfãs', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'known_box' }], rowCount: 1 })
    };
    const r = await validateUnopenedBoxesForSave(client as never, { known_box: 2, ghost_box: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.boxIds).toEqual(['known_box']);
      expect(r.qtys).toEqual([2]);
      expect(r.droppedBoxIds).toEqual(['ghost_box']);
    }
  });

  it('validateUnopenedBoxesForSave rejeita boxId inválido antes de consultar BD', async () => {
    const client = { query: vi.fn() };
    const r = await validateUnopenedBoxesForSave(client as never, { 'ghost box': 1 });
    expect(r.ok).toBe(false);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('validateStoredBatteryWarehouseRemovalAllowed aceita wipe quando cada id está numa rig', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValue({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'bat-a' }, { id: 'bat-b' }] })
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
      query: vi
        .fn()
        .mockResolvedValue({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inst-1' }] })
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
      query: vi
        .fn()
        .mockResolvedValue({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'orphan' }] })
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
    const client = { query: vi.fn() };
    const r = await validateStoredBatteryWarehouseRemovalAllowed(
      client as never,
      1,
      [],
      { placedRacks: [], workshopSlots: [] },
      true
    );
    expect(r).toEqual({ ok: true });
  });

  it('validateStoredBatteryWarehouseRemovalAllowed aceita id só montado na BD quando payload não traz rigs', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValue({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'uuid-on-rack' }] })
        .mockResolvedValueOnce({ rows: [{ bid: 'uuid-on-rack' }] })
    };
    const r = await validateStoredBatteryWarehouseRemovalAllowed(
      client as never,
      1,
      [],
      { placedRacks: undefined, workshopSlots: [] },
      false
    );
    expect(r).toEqual({ ok: true });
  });

  describe('assertPlacedRacksSlotPayloadAgainstPrevDb', () => {
    const prevRacks = [{ id: 'rack_a', item_id: 'chassis_1' }];
    const prevSlotsMiner = [
      { rack_id: 'rack_a', slot_index: 1, machine_item_id: 'gpu_x' },
    ];
    const prevMultEmpty: { rack_id: string; slot_index: number; multiplier_item_id: string | null }[] = [];

    it('adminOverride não valida', () => {
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(prevRacks, prevSlotsMiner, prevMultEmpty, [{ id: 'rack_a', itemId: 'chassis_1' }], {
          adminOverride: true,
          userId: 1,
        })
      ).not.toThrow();
    });

    it('rig nova (sem linha em prev racks) ignora payload incompleto', () => {
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          [],
          prevSlotsMiner,
          prevMultEmpty,
          [{ id: 'rack_a', itemId: 'c', slots: [] }],
          { userId: 1 }
        )
      ).not.toThrow();
    });

    it('rejeita slots ausentes quando BD tinha miner', () => {
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevMultEmpty,
          [{ id: 'rack_a', itemId: 'chassis_1' }],
          { userId: 1 }
        )
      ).toThrow(PlacedRackSlotsSaveGuardError);
    });

    it('rejeita slots [] quando BD tinha miner', () => {
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevMultEmpty,
          [{ id: 'rack_a', itemId: 'chassis_1', slots: [] }],
          { userId: 1 }
        )
      ).toThrow(PlacedRackSlotsSaveGuardError);
    });

    it('rejeita array de slots mais curto que max slot_index na BD (chassis igual)', () => {
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevMultEmpty,
          [{ id: 'rack_a', itemId: 'chassis_1', slots: [null] }],
          { userId: 1 }
        )
      ).toThrow(PlacedRackSlotsSaveGuardError);
    });

    it('aceita limpar miners com array longo o suficiente (só vazios)', () => {
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevMultEmpty,
          [{ id: 'rack_a', itemId: 'chassis_1', slots: [null, null] }],
          { userId: 1 }
        )
      ).not.toThrow();
    });

    it('com chassis mudado não exige comprimento face ao índice antigo', () => {
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevMultEmpty,
          [{ id: 'rack_a', itemId: 'chassis_2', slots: ['only'] }],
          { userId: 1 }
        )
      ).not.toThrow();
    });

    it('rejeita multiplierSlots ausente quando BD tinha mult', () => {
      const prevM = [{ rack_id: 'rack_a', slot_index: 0, multiplier_item_id: 'm1' }];
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(prevRacks, [], prevM, [{ id: 'rack_a', itemId: 'chassis_1', slots: ['a', 'b'] }], {
          userId: 1,
        })
      ).toThrow(PlacedRackSlotsSaveGuardError);
    });

    it('linha de slot só com espaços em machine_item_id não conta como miner ocupado', () => {
      const prevSlotsWs = [{ rack_id: 'rack_a', slot_index: 0, machine_item_id: '   ' }];
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsWs,
          prevMultEmpty,
          [{ id: 'rack_a', itemId: 'chassis_1', slots: [] }],
          { userId: 1 }
        )
      ).not.toThrow();
    });

    it('duas rigs: uma válida e outra com slots omitidos mas com miner na BD → rejeita', () => {
      const twoRacks = [
        { id: 'rack_a', item_id: 'c1' },
        { id: 'rack_b', item_id: 'c2' },
      ];
      const slotsBoth = [
        { rack_id: 'rack_a', slot_index: 0, machine_item_id: 'g1' },
        { rack_id: 'rack_b', slot_index: 0, machine_item_id: 'g2' },
      ];
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          twoRacks,
          slotsBoth,
          prevMultEmpty,
          [
            { id: 'rack_a', itemId: 'c1', slots: ['g1'] },
            { id: 'rack_b', itemId: 'c2' },
          ],
          { userId: 1 }
        )
      ).toThrow(PlacedRackSlotsSaveGuardError);
    });

    it('rejeita multiplierSlots [] quando BD tinha mult', () => {
      const prevM = [{ rack_id: 'rack_a', slot_index: 0, multiplier_item_id: 'm1' }];
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevM,
          [{ id: 'rack_a', itemId: 'chassis_1', slots: [null, 'gpu_x'], multiplierSlots: [] }],
          { userId: 1 }
        )
      ).toThrow(PlacedRackSlotsSaveGuardError);
    });

    it('rejeita multiplierSlots curto (chassis igual)', () => {
      const prevM = [
        { rack_id: 'rack_a', slot_index: 0, multiplier_item_id: 'm1' },
        { rack_id: 'rack_a', slot_index: 2, multiplier_item_id: 'm2' },
      ];
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevM,
          [
            {
              id: 'rack_a',
              itemId: 'chassis_1',
              slots: [null, 'gpu_x'],
              multiplierSlots: [null, null],
            },
          ],
          { userId: 1 }
        )
      ).toThrow(PlacedRackSlotsSaveGuardError);
    });

    it('aceita miners + mults quando ambos os arrays cobrem índices', () => {
      const prevM = [
        { rack_id: 'rack_a', slot_index: 0, multiplier_item_id: 'm1' },
        { rack_id: 'rack_a', slot_index: 2, multiplier_item_id: 'm2' },
      ];
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevM,
          [
            {
              id: 'rack_a',
              itemId: 'chassis_1',
              slots: [null, 'gpu_x'],
              multiplierSlots: ['m1', null, 'm2'],
            },
          ],
          { userId: 1 }
        )
      ).not.toThrow();
    });

    it('ignora entradas não-objeto no array placedRacks', () => {
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevMultEmpty,
          [null, { id: 'rack_a', itemId: 'chassis_1', slots: [null, 'gpu_x'] }] as never,
          { userId: 1 }
        )
      ).not.toThrow();
    });

    it('chassis mudado: mult curto face ao índice antigo ainda permitido', () => {
      const prevM = [
        { rack_id: 'rack_a', slot_index: 0, multiplier_item_id: 'm1' },
        { rack_id: 'rack_a', slot_index: 2, multiplier_item_id: 'm2' },
      ];
      expect(() =>
        assertPlacedRacksSlotPayloadAgainstPrevDb(
          prevRacks,
          prevSlotsMiner,
          prevM,
          [
            {
              id: 'rack_a',
              itemId: 'chassis_novo',
              slots: ['x'],
              multiplierSlots: ['only'],
            },
          ],
          { userId: 1 }
        )
      ).not.toThrow();
    });
  });
});
