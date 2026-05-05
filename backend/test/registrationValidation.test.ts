import { describe, it, expect } from 'vitest';
import {
  assertPublicSignupEmailAllowed,
  validateSignupUsername,
  validateSignupPassword,
  sanitizeOptionalReferralCode,
  validateLoginEmail,
  validateLoginFieldsPresent,
  validateLoginPassword,
  validateOptionalReferralCodeInput,
  REFERRAL_CODE_MAX,
  EMAIL_ADDRESS_MAX_LENGTH,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
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
    expect(validateSignupUsername('user_ab-1').ok).toBe(true);
    expect(validateSignupUsername('a'.repeat(USERNAME_MAX + 1)).ok).toBe(false);
    expect(validateSignupUsername('<script>').ok).toBe(false);
  });

  it('validateSignupPassword', () => {
    expect(validateSignupPassword(undefined, false).ok).toBe(true);
    expect(validateSignupPassword('short', true).ok).toBe(false);
    expect(validateSignupPassword('longenough', true).ok).toBe(true);
    expect(validateSignupPassword('x'.repeat(PASSWORD_MAX + 1), true).ok).toBe(false);
  });

  it('sanitizeOptionalReferralCode', () => {
    expect(sanitizeOptionalReferralCode(null)).toBeNull();
    expect(sanitizeOptionalReferralCode('  ok  ')).toBe('ok');
    expect(sanitizeOptionalReferralCode('a'.repeat(REFERRAL_CODE_MAX + 1))).toBeNull();
  });

  it('validateOptionalReferralCodeInput rejects long or bad chars', () => {
    expect(validateOptionalReferralCodeInput('x'.repeat(REFERRAL_CODE_MAX + 1)).ok).toBe(false);
    expect(validateOptionalReferralCodeInput("ab'cd").ok).toBe(false);
    expect(validateOptionalReferralCodeInput('  ok  ')).toEqual({ ok: true, code: 'ok' });
  });

  it('validateLoginEmail', () => {
    expect(validateLoginEmail('a@gmail.com').ok).toBe(true);
    expect(validateLoginEmail('').ok).toBe(false);
    expect(validateLoginEmail('x'.repeat(EMAIL_ADDRESS_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it('validateLoginFieldsPresent', () => {
    expect(validateLoginFieldsPresent('', '').ok).toBe(false);
    expect(validateLoginFieldsPresent(' ', '').ok).toBe(false);
    expect(validateLoginFieldsPresent('a@b.co', '').ok).toBe(false);
    expect(validateLoginFieldsPresent('', 'secret').ok).toBe(false);
    expect(validateLoginFieldsPresent('a@b.co', 'secret').ok).toBe(true);
  });

  it('validateLoginPassword length', () => {
    expect(validateLoginPassword('x'.repeat(PASSWORD_MAX)).ok).toBe(true);
    expect(validateLoginPassword('x'.repeat(PASSWORD_MAX + 1)).ok).toBe(false);
    expect(validateLoginPassword('x'.repeat(PASSWORD_MIN - 1)).ok).toBe(false);
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
