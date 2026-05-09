/** DTO público da Lojinha Miner — sem segredos. */

export type ShopProductDto = {
  id: string;
  name: string;
  category: string;
  type: string;
  baseCost: number;
  baseProduction: number;
  powerConsumption?: number;
  powerCapacity?: number;
  multiplier?: number;
  slotsCapacity?: number;
  aiSlotsCapacity?: number;
  description: string;
  icon: string;
  status: string;
  isNft: boolean;
  maxGlobalStock?: number;
  totalSold: number;
  image?: string;
  compatibleRacks: string[];
  rewardWh: number;
  sellInHardwareMarket: boolean;
  isActive: boolean;
};

export type ShopCartLineDto = {
  lineId: string;
  productId: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type ShopStateV1Dto = {
  version: 1;
  hardwareMarketEnabled: boolean;
  usdc: number;
  products: ShopProductDto[];
  cart: {
    cartId: string;
    lines: ShopCartLineDto[];
    totalUsdc: number;
  };
};
