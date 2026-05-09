import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { Wallet, verifyMessage } from 'ethers';
import { isReservedProfileUsername, stripInvisibleUsernameChars } from '../models/profileUsernameReserved.js';
import { validateProfileNewPasswordStrength } from '../models/profilePasswordPolicy.js';

describe('profileUsernameReserved', () => {
  it('bloqueia nomes reservados', () => {
    expect(isReservedProfileUsername('admin')).toBe(true);
    expect(isReservedProfileUsername('Genesis')).toBe(true);
    expect(isReservedProfileUsername('support-team')).toBe(true);
    expect(isReservedProfileUsername('player_one')).toBe(false);
  });

  it('remove ZWSP', () => {
    expect(stripInvisibleUsernameChars('ab\u200bcd')).toBe('abcd');
  });
});

describe('profilePasswordPolicy', () => {
  it('rejeita curta / fraca / igual à atual', async () => {
    const hash = await bcrypt.hash('MyOldPass99', 4);
    expect((await validateProfileNewPasswordStrength('short', hash)).ok).toBe(false);
    expect((await validateProfileNewPasswordStrength('welcome1', hash)).ok).toBe(false);
    expect((await validateProfileNewPasswordStrength('NoDigitsHere!!', hash)).ok).toBe(false);
    expect((await validateProfileNewPasswordStrength('MyOldPass99', hash)).ok).toBe(false);
    expect((await validateProfileNewPasswordStrength('NewValid99x!', hash)).ok).toBe(true);
  });
});

describe('wallet message signing (EIP-191)', () => {
  it('verifyMessage alinha com signMessage', async () => {
    const w = Wallet.createRandom();
    const message = 'Genesis Miner test\nnonce: abc';
    const sig = await w.signMessage(message);
    expect(verifyMessage(message, sig)).toBe(w.address);
  });
});
