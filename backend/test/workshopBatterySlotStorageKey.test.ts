import { describe, it, expect } from 'vitest';
import {
  resolveWorkshopBatteryLayoutIndex,
  workshopBatteryStorageKeyAtLayoutIndex
} from '../lib/workshopBatterySlotStorageKey.js';

describe('workshopBatteryStorageKeyAtLayoutIndex', () => {
  it('ids únicos mantêm a chave do layout', () => {
    const layout = [
      { type: 'battery', id: 'battery_0' },
      { type: 'battery', id: 'battery_1' }
    ];
    expect(workshopBatteryStorageKeyAtLayoutIndex(layout, 0)).toBe('battery_0');
    expect(workshopBatteryStorageKeyAtLayoutIndex(layout, 1)).toBe('battery_1');
  });

  it('ids duplicados → chaves estáveis por índice', () => {
    const layout = [
      { type: 'battery', id: 'cell' },
      { type: 'charger_bar', id: 'cb' },
      { type: 'battery', id: 'cell' }
    ];
    expect(workshopBatteryStorageKeyAtLayoutIndex(layout, 0)).toBe('__ms_bat_0');
    expect(workshopBatteryStorageKeyAtLayoutIndex(layout, 2)).toBe('__ms_bat_2');
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
