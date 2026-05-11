import { describe, expect, it } from 'vitest';
import {
  isWorkshopBatteryChargeFull,
  snapWorkshopBatteryChargeWh
} from '../lib/workshopBatteryCharge.js';

describe('workshopBatteryCharge', () => {
  it('alinha o cheio da oficina com a UI em 99,5%', () => {
    expect(snapWorkshopBatteryChargeWh(99.49, 100)).toBe(99.49);
    expect(isWorkshopBatteryChargeFull(99.49, 100)).toBe(false);

    expect(snapWorkshopBatteryChargeWh(99.5, 100)).toBe(100);
    expect(isWorkshopBatteryChargeFull(99.5, 100)).toBe(true);
  });

  it('usa a capacidade nominal de qualquer bateria', () => {
    expect(snapWorkshopBatteryChargeWh(9.95, 10)).toBe(10);
    expect(isWorkshopBatteryChargeFull(4975, 5000)).toBe(true);
    expect(isWorkshopBatteryChargeFull(4974.9, 5000)).toBe(false);
  });
});
