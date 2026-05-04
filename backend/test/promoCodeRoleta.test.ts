import { describe, it, expect } from 'vitest';
import { promoTypeLiteralIsRoleta } from '../models/promoCodeRoleta.js';

describe('promoCodeRoleta', () => {
  it('promoTypeLiteralIsRoleta', () => {
    expect(promoTypeLiteralIsRoleta('roleta_x')).toBe(true);
    expect(promoTypeLiteralIsRoleta('loot')).toBe(false);
    expect(promoTypeLiteralIsRoleta(null)).toBe(false);
  });
});
