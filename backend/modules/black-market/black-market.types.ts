/** DTO público do Mercado Negro P2P — versão 1. */

export type BlackMarketListingClientDto = {
  id: string;
  sellerName: string;
  itemId: string;
  price: number;
  qty: number;
  lineTotal: number;
  expiresAt: number;
  reservedBy?: string;
  reservedUntil?: number;
};

export type BlackMarketCustodyDto = {
  id: string;
  sellerName: string;
  itemId: string;
  price: number;
  qty: number;
  lineTotal: number;
  buyerPaidUsdc?: number;
  expiresAt: number;
};

export type BlackMarketHistoryEntryDto = {
  at: number;
  itemId: string;
  qty: number;
  unitPrice: number;
  buyerPaidUsdc: number;
  sellerReceivedUsdc: number;
  taxUsdc: number;
  counterpartName: string;
};

export type BlackMarketStateV1Dto = {
  version: 1;
  enabled: boolean;
  usdc: number;
  blackMarketBalance: number;
  priceBandPercent: number;
  /** Primeira página de ofertas (sem as do utilizador). */
  listings: {
    items: BlackMarketListingClientDto[];
    total: number;
    limit: number;
    offset: number;
  };
  myActiveListings: BlackMarketListingClientDto[];
  custody: BlackMarketCustodyDto[];
  sellableStock: Array<{ itemId: string; qty: number }>;
  /** Categorias presentes no livro (para filtros). */
  buyFilterCategories: string[];
  history: {
    purchases: BlackMarketHistoryEntryDto[];
    sales: BlackMarketHistoryEntryDto[];
    limit: number;
  };
};
