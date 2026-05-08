import { describe, it, expect } from 'vitest';
import {
  isValidGameItemId,
  parseValidGameItemId,
  parseValidStoredBatteryId,
  isValidUserEmailForRoomsFetch,
  sanitizeEmailForRoomsFetch,
  isValidRigRoomId,
  cssSafeBackgroundUrl,
  parseRigSlotPurchaseQuantity,
  previewRigSlotBulkPurchase,
  MAX_RIG_SLOTS_PURCHASE_PER_REQUEST,
} from '../validation/serverRoomValidation';
import type { RigRoom } from '../types';

describe('serverRoomValidation', () => {
  it('ids de jogo', () => {
    expect(isValidGameItemId('rig_1')).toBe(true);
    expect(parseValidGameItemId('  x.y  ')).toBe('x.y');
    expect(parseValidStoredBatteryId('')).toBeNull();
  });

  it('isValidRigRoomId', () => {
    expect(isValidRigRoomId('room_initial')).toBe(true);
    expect(isValidRigRoomId('')).toBe(false);
    expect(isValidRigRoomId('bad id')).toBe(false);
  });

  it('email fetch', () => {
    expect(isValidUserEmailForRoomsFetch('a@b.co')).toBe(true);
    expect(sanitizeEmailForRoomsFetch('  A@B.CO  ')).toBe('a@b.co');
  });

  it('cssSafeBackgroundUrl escapa aspas e barra invertida', () => {
    expect(cssSafeBackgroundUrl('plain')).toBe('url("plain")');
    expect(cssSafeBackgroundUrl('a\\b"c')).toBe('url("a\\\\b\\"c")');
    expect(cssSafeBackgroundUrl('   ')).toBeUndefined();
    expect(cssSafeBackgroundUrl(null)).toBeUndefined();
  });

  it('parseRigSlotPurchaseQuantity', () => {
    expect(parseRigSlotPurchaseQuantity(0)).toBeNull();
    expect(parseRigSlotPurchaseQuantity(MAX_RIG_SLOTS_PURCHASE_PER_REQUEST + 1)).toBeNull();
    expect(parseRigSlotPurchaseQuantity(3)).toBe(3);
  });

  it('previewRigSlotBulkPurchase', () => {
    const room = {
      unlockedSlots: 0,
      initialCapacity: 4,
      maxCapacity: 10,
      baseSlotPrice: 10,
      slotPriceIncreasePercent: 0,
    } as RigRoom;
    const p = previewRigSlotBulkPurchase(room, 2, 1000);
    expect(p.ok).toBe(true);
    expect(p.appliedQty).toBe(2);
  });

  it('previewRigSlotBulkPurchase sala cheia ou saldo insuficiente', () => {
    const full = {
      unlockedSlots: 6,
      initialCapacity: 4,
      maxCapacity: 10,
      baseSlotPrice: 10,
      slotPriceIncreasePercent: 0,
    } as RigRoom;
    expect(previewRigSlotBulkPurchase(full, 1, 1000).ok).toBe(false);

    const cheap = {
      unlockedSlots: 0,
      initialCapacity: 4,
      maxCapacity: 10,
      baseSlotPrice: 10,
      slotPriceIncreasePercent: 0,
    } as RigRoom;
    const broke = previewRigSlotBulkPurchase(cheap, 2, 5);
    expect(broke.ok).toBe(false);
    expect(broke.message).toMatch(/Saldo/i);
  });
});
