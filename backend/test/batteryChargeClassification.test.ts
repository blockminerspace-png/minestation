import { describe, expect, it } from 'vitest';
import { isStoredBatteryFullyCharged, type UpgradeBatteryCapacityRow } from '../lib/batteryChargeClassification.js';

describe('isStoredBatteryFullyCharged', () => {
  it('considera infinito (-1) sempre cheio', () => {
    const row: UpgradeBatteryCapacityRow = { type: 'battery', power_capacity: -1 };
    expect(isStoredBatteryFullyCharged(0, row)).toBe(true);
    expect(isStoredBatteryFullyCharged(-1, row)).toBe(true);
  });

  it('99,9% da capacidade nominal conta como cheio', () => {
    const row: UpgradeBatteryCapacityRow = { type: 'battery', power_capacity: 1000 };
    expect(isStoredBatteryFullyCharged(999, row)).toBe(true);
    expect(isStoredBatteryFullyCharged(998.9, row)).toBe(false);
  });

  it('sem catálogo usa fallback 100 Wh', () => {
    expect(isStoredBatteryFullyCharged(99.9, undefined)).toBe(true);
    expect(isStoredBatteryFullyCharged(50, undefined)).toBe(false);
  });
});
