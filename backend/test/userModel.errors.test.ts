import { describe, it, expect } from 'vitest';
import { EmailPolicyError, IpLimitError } from '../models/userModel.js';

describe('userModel errors', () => {
  it('EmailPolicyError', () => {
    const e = new EmailPolicyError('msg');
    expect(e.code).toBe('EMAIL_POLICY');
    expect(e.message).toBe('msg');
  });

  it('IpLimitError', () => {
    const accs = [{ username: 'u', email: 'e@e.com' }];
    const e = new IpLimitError('limite', accs);
    expect(e.existingAccounts).toEqual(accs);
  });
});
