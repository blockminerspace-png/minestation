import { describe, it, expect } from 'vitest';
import type { LuckyBoxShopEntryV1 } from '../modules/lucky-boxes/lucky-boxes.types.js';

function serverShopAvailability(entry: LuckyBoxShopEntryV1): { canBuy: boolean; label: string | null } {
  if (entry.stockRemaining === 0) return { canBuy: false, label: 'ESGOTADO' };
  if (entry.priceUsdc <= 0) return { canBuy: true, label: 'GRATIS' };
  return { canBuy: true, label: null };
}

describe('lucky-boxes module helpers', () => {
  it('serverShopAvailability bloqueia stock zero', () => {
    const e: LuckyBoxShopEntryV1 = {
      id: 'x',
      name: 'Box',
      description: '',
      icon: '🎁',
      priceUsdc: 10,
      currency: 'USDC',
      trigger: 'shop',
      maxPerOrder: 10,
      stockRemaining: 0,
      rewardSummary: { slotCount: 1, slots: [] }
    };
    expect(serverShopAvailability(e).canBuy).toBe(false);
  });

  it('serverShopAvailability permite stock null', () => {
    const e: LuckyBoxShopEntryV1 = {
      id: 'x',
      name: 'Box',
      description: '',
      icon: '🎁',
      priceUsdc: 1,
      currency: 'USDC',
      trigger: 'shop',
      maxPerOrder: 10,
      stockRemaining: null,
      rewardSummary: { slotCount: 1, slots: [] }
    };
    expect(serverShopAvailability(e).canBuy).toBe(true);
  });
});
