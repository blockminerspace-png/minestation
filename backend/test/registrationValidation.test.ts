import { describe, it, expect } from 'vitest';
import {
  assertPublicSignupEmailAllowed,
  validateSignupUsername,
  validateSignupPassword,
  sanitizeOptionalReferralCode,
  validateOptionalPolygonWallet,
  validateOptionalAccessLevelId,
  validateAccessLevelIdsArray,
} from '../models/registrationValidation.js';

describe('registrationValidation', () => {
  it('assertPublicSignupEmailAllowed', () => {
    expect(assertPublicSignupEmailAllowed('a@gmail.com').ok).toBe(true);
    expect(assertPublicSignupEmailAllowed('a@yopmail.com').ok).toBe(false);
    expect(assertPublicSignupEmailAllowed('x@foo.com').ok).toBe(false);
    expect(assertPublicSignupEmailAllowed('invalid').ok).toBe(false);
  });

  it('validateSignupUsername', () => {
    expect(validateSignupUsername('ab').ok).toBe(false);
    expect(validateSignupUsername('valid_user-1').ok).toBe(true);
    expect(validateSignupUsername('<script>').ok).toBe(false);
  });

  it('validateSignupPassword', () => {
    expect(validateSignupPassword(undefined, false).ok).toBe(true);
    expect(validateSignupPassword('short', true).ok).toBe(false);
    expect(validateSignupPassword('longenough', true).ok).toBe(true);
  });

  it('sanitizeOptionalReferralCode', () => {
    expect(sanitizeOptionalReferralCode(null)).toBeNull();
    expect(sanitizeOptionalReferralCode('  ok  ')).toBe('ok');
  });

  it('validateOptionalPolygonWallet', () => {
    expect(validateOptionalPolygonWallet(null)).toBeNull();
    expect(validateOptionalPolygonWallet('0x' + '0'.repeat(39) + 'g')).toMatchObject({
      error: expect.any(String),
    });
    expect(validateOptionalPolygonWallet('0x' + '1'.repeat(40))).toBe('0x' + '1'.repeat(40));
  });

  it('validateOptionalAccessLevelId', () => {
    expect(validateOptionalAccessLevelId('')).toBeNull();
    expect(validateOptionalAccessLevelId('bad!')).toMatchObject({ error: expect.any(String) });
    expect(validateOptionalAccessLevelId('genesis')).toBe('genesis');
  });

  it('validateAccessLevelIdsArray', () => {
    expect(validateAccessLevelIdsArray('x').ok).toBe(false);
    expect(validateAccessLevelIdsArray(['a', 'b']).ok).toBe(true);
    expect(validateAccessLevelIdsArray(Array.from({ length: 60 }, () => 'x')).ok).toBe(false);
  });
});
