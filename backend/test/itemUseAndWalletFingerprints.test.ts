import { describe, expect, it } from 'vitest';
import { inventoryItemUseIntentFingerprint } from '../modules/inventory/inventory.itemUse.intent.js';
import { walletExchangeLiquidateRequestFingerprint } from '../modules/wallet/walletExchangeLiquidation.js';
import { shopCheckoutCartFingerprint } from '../modules/shop/shop.checkout.service.js';
import { luckyBoxOpenRequestFingerprint, luckyBoxPurchaseRequestFingerprint } from '../modules/lucky-boxes/lucky-boxes.idempotency.js';
import { upgradePurchaseRequestFingerprint } from '../modules/upgrades/upgradesPurchase.service.js';
import { withdrawRequestFingerprint } from '../modules/wallet/walletWithdrawRequest.js';

describe('inventoryItemUseIntentFingerprint', () => {
  it('é estável para o mesmo pedido', () => {
    const a = inventoryItemUseIntentFingerprint({
      catalogItemId: 'energy_voucher',
      quantity: 2,
      workshopSlotIndex: 3
    });
    const b = inventoryItemUseIntentFingerprint({
      catalogItemId: 'energy_voucher',
      quantity: 2,
      workshopSlotIndex: 3
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  it('muda com quantidade ou slot', () => {
    const a = inventoryItemUseIntentFingerprint({
      catalogItemId: 'x',
      quantity: 1,
      workshopSlotIndex: 0
    });
    const b = inventoryItemUseIntentFingerprint({
      catalogItemId: 'x',
      quantity: 2,
      workshopSlotIndex: 0
    });
    const c = inventoryItemUseIntentFingerprint({
      catalogItemId: 'x',
      quantity: 1,
      workshopSlotIndex: 1
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('walletExchangeLiquidateRequestFingerprint', () => {
  it('desk: mesmo coin + pct → mesmo hash', () => {
    const fp = walletExchangeLiquidateRequestFingerprint({
      coinId: 'btc_test',
      fractionMode: 'desk_shortcuts',
      deskPercentagePoints: 50
    });
    expect(fp).toBe(
      walletExchangeLiquidateRequestFingerprint({
        coinId: 'btc_test',
        fractionMode: 'desk_shortcuts',
        deskPercentagePoints: 50
      })
    );
  });

  it('desk: pct diferente → hash diferente', () => {
    const a = walletExchangeLiquidateRequestFingerprint({
      coinId: 'btc_test',
      fractionMode: 'desk_shortcuts',
      deskPercentagePoints: 10
    });
    const b = walletExchangeLiquidateRequestFingerprint({
      coinId: 'btc_test',
      fractionMode: 'desk_shortcuts',
      deskPercentagePoints: 50
    });
    expect(a).not.toBe(b);
  });
});

describe('shopCheckoutCartFingerprint', () => {
  it('é estável para o mesmo carrinho canónico', () => {
    const a = shopCheckoutCartFingerprint({ b: 2, a: 1 });
    const b = shopCheckoutCartFingerprint({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  it('muda quando quantidades mudam', () => {
    const x = shopCheckoutCartFingerprint({ item_x: 1 });
    const y = shopCheckoutCartFingerprint({ item_x: 2 });
    expect(x).not.toBe(y);
  });
});

describe('luckyBoxOpenRequestFingerprint', () => {
  it('muda com boxId', () => {
    expect(luckyBoxOpenRequestFingerprint('a')).not.toBe(luckyBoxOpenRequestFingerprint('b'));
  });
});

describe('luckyBoxPurchaseRequestFingerprint', () => {
  it('muda com quantidade', () => {
    expect(luckyBoxPurchaseRequestFingerprint('box1', 1)).not.toBe(luckyBoxPurchaseRequestFingerprint('box1', 2));
  });
});

describe('upgradePurchaseRequestFingerprint', () => {
  it('muda com packageId ou versão cliente', () => {
    const a = upgradePurchaseRequestFingerprint('pkg_a', 1);
    const b = upgradePurchaseRequestFingerprint('pkg_b', 1);
    const c = upgradePurchaseRequestFingerprint('pkg_a', 2);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('withdrawRequestFingerprint', () => {
  it('é estável e muda com montante ou carteira', () => {
    const a = withdrawRequestFingerprint({ coinId: 'c1', amount: 1.5, walletAddress: '0xAbC' });
    const b = withdrawRequestFingerprint({ coinId: 'c1', amount: 1.5, walletAddress: '0xabc' });
    expect(a).toBe(b);
    expect(withdrawRequestFingerprint({ coinId: 'c1', amount: 1.5, walletAddress: '0xabc' })).not.toBe(
      withdrawRequestFingerprint({ coinId: 'c1', amount: 2, walletAddress: '0xabc' })
    );
  });
});
