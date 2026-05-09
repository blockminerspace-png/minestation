/** DTO público — Caixas da Sorte (API `/api/lucky-boxes/*`), versão 1. */

export type LuckyBoxRewardSlotPublicDto = {
  kind: string;
  label: string;
  rangeText: string;
};

export type LuckyBoxShopEntryV1 = {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Preço unitário em USDC (servidor). */
  priceUsdc: number;
  currency: 'USDC';
  trigger: string;
  maxPerOrder: number;
  stockRemaining: number | null;
  rewardSummary: {
    slotCount: number;
    slots: LuckyBoxRewardSlotPublicDto[];
  };
};

export type LuckyBoxInventoryEntryV1 = {
  boxId: string;
  qty: number;
  name: string;
  description: string;
  icon: string;
  trigger: string;
  openableHere: boolean;
  rewardSummary: {
    slotCount: number;
    slots: LuckyBoxRewardSlotPublicDto[];
  };
};

export type LuckyBoxOpeningHistoryEntryV1 = {
  id: string;
  at: number;
  boxId: string;
  boxName: string;
  gainedUsdc: string;
  rewards: Array<{ type: string; id: string; qty: number }>;
};

export type LuckyBoxesStateV1Dto = {
  version: 1;
  usdc: number;
  banner: { text: string; variant: 'info' | 'warning' } | null;
  promoHelp: string;
  roulettePromoNote: string;
  shop: LuckyBoxShopEntryV1[];
  shopEmptyMessage: string;
  inventory: LuckyBoxInventoryEntryV1[];
  history: { items: LuckyBoxOpeningHistoryEntryV1[]; limit: number; nextCursor: string | null };
};
