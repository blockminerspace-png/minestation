import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateReferralCode } from '../models/signupPolicy.js';

describe('signupPolicy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generateReferralCode tem formato estável com RNG fixo', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const code = generateReferralCode('PlayerOne');
    expect(code).toMatch(/^playerone-[a-f0-9]{8}_\d{5}$/);
  });

  it('generateReferralCode com username só símbolos gera base normalizada', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const code = generateReferralCode('   !!!   ');
    expect(code).toMatch(/^[a-z0-9_-]+-[a-f0-9]{8}_\d{5}$/);
  });
});
