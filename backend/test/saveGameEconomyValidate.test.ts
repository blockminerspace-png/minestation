import { describe, it, expect } from 'vitest';
import {
  SAVE_GAME_ITEM_ID_RE,
  isClientDailyActionKey,
  isAdminDailyActionKey,
  validateDailyActionsForSave,
} from '../lib/saveGameEconomyValidate.js';

describe('saveGameEconomyValidate', () => {
  it('SAVE_GAME_ITEM_ID_RE', () => {
    expect(SAVE_GAME_ITEM_ID_RE.test('item_1')).toBe(true);
    expect(SAVE_GAME_ITEM_ID_RE.test('bad id')).toBe(false);
  });

  it('isClientDailyActionKey', () => {
    expect(isClientDailyActionKey('reward_ad_slot_0')).toBe(true);
    expect(isClientDailyActionKey('reward_ad_slot_16')).toBe(false);
    expect(isClientDailyActionKey('tx_foo')).toBe(false);
  });

  it('isAdminDailyActionKey', () => {
    expect(isAdminDailyActionKey('custom_key-1')).toBe(true);
    expect(isAdminDailyActionKey('valid:key_1')).toBe(true);
    expect(isAdminDailyActionKey('tx_abc')).toBe(false);
    expect(isAdminDailyActionKey('a'.repeat(200))).toBe(false);
  });

  it('isClientDailyActionKey slots daily_boost e instant', () => {
    expect(isClientDailyActionKey('daily_boost_slot_15')).toBe(true);
    expect(isClientDailyActionKey('instant_recharge_slot_0')).toBe(true);
    expect(isClientDailyActionKey('instant_recharge_slot_20')).toBe(false);
  });

  it('validateDailyActionsForSave ignora tx_ e aceita chaves cliente', () => {
    const now = 1_700_000_000_000;
    const r = validateDailyActionsForSave(
      { tx_dep: now, reward_ad_slot_0: now - 1000 },
      false,
      now
    );
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.keys).toEqual(['reward_ad_slot_0']);
      expect(r.vals).toEqual([Math.floor(now - 1000)]);
    }
  });

  it('validateDailyActionsForSave admin aceita chave custom e rejeita chave inválida', () => {
    const now = 1_700_000_000_000;
    const ok = validateDailyActionsForSave({ admin_note: now }, true, now);
    expect(ok).toMatchObject({ ok: true });

    const bad = validateDailyActionsForSave({ 'no spaces': now }, true, now);
    expect(bad).toMatchObject({ ok: false });
  });

  it('validateDailyActionsForSave cliente rejeita futuro > now+1d', () => {
    const now = 1_700_000_000_000;
    const r = validateDailyActionsForSave({ reward_ad_slot_0: now + 2 * 86400000 }, false, now);
    expect(r).toMatchObject({ ok: false });
  });
});
