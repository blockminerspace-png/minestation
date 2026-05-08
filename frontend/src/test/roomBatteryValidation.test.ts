import { describe, it, expect } from 'vitest';
import { isValidRoomId, isValidBatterySelectionId } from '../validation/roomBatteryValidation';

describe('roomBatteryValidation', () => {
  it('isValidRoomId', () => {
    expect(isValidRoomId('room-1')).toBe(true);
    expect(isValidRoomId('')).toBe(false);
    expect(isValidRoomId('a<x')).toBe(false);
  });

  it('isValidBatterySelectionId', () => {
    expect(isValidBatterySelectionId(null)).toBe(true);
    expect(isValidBatterySelectionId('bat_1')).toBe(true);
    expect(isValidBatterySelectionId('bad id')).toBe(false);
  });
});
