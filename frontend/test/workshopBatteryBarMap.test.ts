import { describe, it, expect } from 'vitest';
import { resolveBatteryLayoutSlotIdForBatteryBar, resolveBatteryLayoutIndexForBatteryBar } from '../lib/workshopBatteryBarMap';
import type { SlotLayout } from '../types';

describe('resolveBatteryLayoutSlotIdForBatteryBar', () => {
  it('pareia battery_bar_0 / battery_bar_1 com battery_0 / battery_1 (Duo Power)', () => {
    const layout: SlotLayout[] = [
      { id: 'battery_0', type: 'battery', x: 0, y: 0, w: 1, h: 1 },
      { id: 'battery_1', type: 'battery', x: 0, y: 0, w: 1, h: 1 },
      { id: 'battery_bar_0', type: 'battery_bar', x: 0, y: 0, w: 1, h: 1 },
      { id: 'battery_bar_1', type: 'battery_bar', x: 0, y: 0, w: 1, h: 1 }
    ];
    expect(resolveBatteryLayoutSlotIdForBatteryBar(layout, { id: 'battery_bar_0' }, 0)).toBe('battery_0');
    expect(resolveBatteryLayoutSlotIdForBatteryBar(layout, { id: 'battery_bar_1' }, 1)).toBe('battery_1');
  });

  it('duas barras id battery_bar sem sufixo → ordem 0 e 1 nas baterias', () => {
    const layout: SlotLayout[] = [
      { id: 'a', type: 'charger_bar', x: 0, y: 0, w: 1, h: 1 },
      { id: 'bat_a', type: 'battery', x: 0, y: 0, w: 1, h: 1 },
      { id: 'bat_b', type: 'battery', x: 0, y: 0, w: 1, h: 1 },
      { id: 'battery_bar', type: 'battery_bar', x: 0, y: 0, w: 1, h: 1 },
      { id: 'battery_bar', type: 'battery_bar', x: 0, y: 0, w: 1, h: 1 }
    ];
    expect(resolveBatteryLayoutSlotIdForBatteryBar(layout, { id: 'battery_bar' }, 0)).toBe('bat_a');
    expect(resolveBatteryLayoutSlotIdForBatteryBar(layout, { id: 'battery_bar' }, 1)).toBe('bat_b');
  });

  it('legacy slot id "battery" com uma barra', () => {
    const layout: SlotLayout[] = [
      { id: 'battery', type: 'battery', x: 0, y: 0, w: 1, h: 1 },
      { id: 'battery_bar', type: 'battery_bar', x: 0, y: 0, w: 1, h: 1 }
    ];
    expect(resolveBatteryLayoutSlotIdForBatteryBar(layout, { id: 'battery_bar' }, 0)).toBe('battery');
  });

  it('resolveBatteryLayoutIndexForBatteryBar com duas baterias id "cell" → índices 0 e 2', () => {
    const layout: SlotLayout[] = [
      { id: 'cell', type: 'battery', x: 0, y: 0, w: 1, h: 1 },
      { id: 'mid', type: 'multiplier', x: 0, y: 0, w: 1, h: 1 },
      { id: 'cell', type: 'battery', x: 0, y: 0, w: 1, h: 1 },
      { id: 'battery_bar', type: 'battery_bar', x: 0, y: 0, w: 1, h: 1 },
      { id: 'battery_bar', type: 'battery_bar', x: 0, y: 0, w: 1, h: 1 }
    ];
    expect(resolveBatteryLayoutIndexForBatteryBar(layout, { id: 'battery_bar' }, 0)).toBe(0);
    expect(resolveBatteryLayoutIndexForBatteryBar(layout, { id: 'battery_bar' }, 1)).toBe(2);
  });
});
