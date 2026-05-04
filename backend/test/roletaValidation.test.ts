import { describe, it, expect } from 'vitest';
import {
  RoletaAppError,
  normalizePromoCode,
  parseWonItemId,
  sanitizeDisplayName,
} from '../validation/roletaValidation.js';

describe('roletaValidation', () => {
  it('RoletaAppError', () => {
    const e = new RoletaAppError('x', 418);
    expect(e.statusCode).toBe(418);
  });

  it('normalizePromoCode', () => {
    expect(normalizePromoCode('  abc  ')).toBe('ABC');
    expect(normalizePromoCode(null)).toBeNull();
    expect(normalizePromoCode('a'.repeat(200))).toBeNull();
  });

  it('parseWonItemId', () => {
    expect(parseWonItemId('item_1')).toBe('item_1');
    expect(parseWonItemId('bad space')).toBeNull();
  });

  it('sanitizeDisplayName', () => {
    expect(sanitizeDisplayName('  hi  ', 10)).toBe('hi');
    expect(sanitizeDisplayName('', 5)).toBe('Prêmio');
    expect(sanitizeDisplayName('x'.repeat(100), 3)).toBe('xxx');
  });
});
