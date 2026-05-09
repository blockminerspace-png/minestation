import { describe, it, expect } from 'vitest';
import {
  readWorkshopBatterySlotField,
  resolveWorkshopBatteryLayoutIndex,
  workshopBatteryStorageKeyAtLayoutIndex
} from '../lib/workshopBatterySlotStorageKey.js';

describe('workshopBatteryStorageKeyAtLayoutIndex', () => {
  it('sempre chave canónica por índice no array (ids únicos ou duplicados)', () => {
    const layoutUnique = [
      { type: 'battery', id: 'battery_0' },
      { type: 'battery', id: 'battery_1' }
    ];
    expect(workshopBatteryStorageKeyAtLayoutIndex(layoutUnique, 0)).toBe('__ms_bat_0');
    expect(workshopBatteryStorageKeyAtLayoutIndex(layoutUnique, 1)).toBe('__ms_bat_1');

    const layoutDup = [
      { type: 'battery', id: 'cell' },
      { type: 'charger_bar', id: 'cb' },
      { type: 'battery', id: 'cell' }
    ];
    expect(workshopBatteryStorageKeyAtLayoutIndex(layoutDup, 0)).toBe('__ms_bat_0');
    expect(workshopBatteryStorageKeyAtLayoutIndex(layoutDup, 2)).toBe('__ms_bat_2');
  });
});

describe('readWorkshopBatterySlotField', () => {
  it('lê canónica antes da chave literal do layout nessa posição', () => {
    const layout = [
      { type: 'battery', id: 'same' },
      { type: 'battery', id: 'same' }
    ];
    const map = { __ms_bat_0: 'a', __ms_bat_1: 'b', same: 'wrong' };
    expect(readWorkshopBatterySlotField(map, layout, 0)).toBe('a');
    expect(readWorkshopBatterySlotField(map, layout, 1)).toBe('b');
  });

  it('fallback só à chave literal do slot (não a outra célula com o mesmo id legado)', () => {
    const layout = [
      { type: 'battery', id: 'cell' },
      { type: 'battery', id: 'cell' }
    ];
    const map = { cell: 'only-one-json-key' };
    expect(readWorkshopBatterySlotField(map, layout, 0)).toBe('only-one-json-key');
    expect(readWorkshopBatterySlotField(map, layout, 1)).toBeUndefined();
  });
});

describe('resolveWorkshopBatteryLayoutIndex', () => {
  it('com id único resolve sem layoutSlotIndex', () => {
    const layout = [
      { type: 'battery', id: 'a' },
      { type: 'battery', id: 'b' }
    ];
    const r = resolveWorkshopBatteryLayoutIndex(layout, 'b', undefined);
    expect(r).toEqual({ ok: true, layoutIndex: 1 });
  });

  it('com ids duplicados exige layoutSlotIndex', () => {
    const layout = [
      { type: 'battery', id: 'x' },
      { type: 'battery', id: 'x' }
    ];
    expect(resolveWorkshopBatteryLayoutIndex(layout, 'x', undefined)).toEqual({ ok: false, reason: 'ambiguous' });
    expect(resolveWorkshopBatteryLayoutIndex(layout, 'x', 1)).toEqual({ ok: true, layoutIndex: 1 });
  });
});
