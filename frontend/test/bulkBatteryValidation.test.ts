import { describe, it, expect } from 'vitest';
import { isValidBatteryRigSort, parseBooleanSmartFill } from '../validation/bulkBatteryValidation';

describe('bulkBatteryValidation', () => {
  it('isValidBatteryRigSort', () => {
    expect(isValidBatteryRigSort('slot_asc')).toBe(true);
    expect(isValidBatteryRigSort('hashrate_desc')).toBe(true);
    expect(isValidBatteryRigSort('nope')).toBe(false);
  });

  it('parseBooleanSmartFill', () => {
    expect(parseBooleanSmartFill(true)).toBe(true);
    expect(parseBooleanSmartFill('true')).toBe(true);
    expect(parseBooleanSmartFill('1')).toBe(true);
    expect(parseBooleanSmartFill(1)).toBe(true);
    expect(parseBooleanSmartFill(false)).toBe(false);
  });
});
