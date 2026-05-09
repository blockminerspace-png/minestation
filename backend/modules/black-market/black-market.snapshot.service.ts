import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import {
  getBlackMarketPriceBandPercent,
  isP2PMarketEnabled,
  timestampMsFromDb
} from '../../models/p2pMarketModel.js';
import {
  loadActiveBlackMarketListingsPage,
  loadCustodyForBuyer,
  loadMyActiveListings,
  loadSellableStockRows
} from './black-market.listings.service.js';
import type { BlackMarketHistoryEntryDto, BlackMarketStateV1Dto } from './black-market.types.js';

const STATE_LISTINGS_LIMIT = 60;
const HISTORY_LIMIT = 80;

type HistRow = {
  created_at: unknown;
  item_id: string;
  qty: unknown;
  unit_price: unknown;
  buyer_paid_usdc: unknown;
  seller_received_usdc: unknown;
  tax_usdc: unknown;
  counterpart_display: string | null;
};

function mapHistRow(r: HistRow): BlackMarketHistoryEntryDto {
  return {
    at: timestampMsFromDb(r.created_at),
    itemId: String(r.item_id || '').trim(),
    qty: Math.max(1, parseInt(String(r.qty ?? 1), 10) || 1),
    unitPrice: Number(r.unit_price) || 0,
    buyerPaidUsdc: Number(r.buyer_paid_usdc) || 0,
    sellerReceivedUsdc: Number(r.seller_received_usdc) || 0,
    taxUsdc: Number(r.tax_usdc) || 0,
    counterpartName: (r.counterpart_display && String(r.counterpart_display).trim()) || '—'
  };
}

export async function loadP2pHistoryForUser(
  userId: number,
  limit: number
): Promise<{ purchases: BlackMarketHistoryEntryDto[]; sales: BlackMarketHistoryEntryDto[] }> {
  const lim = Math.min(200, Math.max(1, Math.floor(limit)));
  const purch = await prisma.$queryRawUnsafe(
    `SELECT t.created_at, t.item_id, t.qty, t.unit_price, t.buyer_paid_usdc, t.seller_received_usdc, t.tax_usdc,
            COALESCE(NULLIF(TRIM(su.username), ''), su.email, '') AS counterpart_display
     FROM p2p_market_trade_history t
     JOIN users su ON su.id = t.seller_id
     WHERE t.buyer_id = $1
     ORDER BY t.created_at DESC
     LIMIT $2`,
    userId,
    lim
  );
  const salesRes = await prisma.$queryRawUnsafe(
    `SELECT t.created_at, t.item_id, t.qty, t.unit_price, t.buyer_paid_usdc, t.seller_received_usdc, t.tax_usdc,
            COALESCE(NULLIF(TRIM(bu.username), ''), bu.email, '') AS counterpart_display
     FROM p2p_market_trade_history t
     JOIN users bu ON bu.id = t.buyer_id
     WHERE t.seller_id = $1
     ORDER BY t.created_at DESC
     LIMIT $2`,
    userId,
    lim
  );
  const pr = Array.isArray(purch) ? purch : [];
  const sr = Array.isArray(salesRes) ? salesRes : [];
  return {
    purchases: (pr as HistRow[]).map(mapHistRow),
    sales: (sr as HistRow[]).map(mapHistRow)
  };
}

export async function loadBuyFilterCategoriesExcludingSeller(sellerId: number): Promise<string[]> {
  const now = BigInt(Date.now());
  const rows = await prisma.$queryRaw<{ c: string }[]>(Prisma.sql`
    SELECT DISTINCT u.category AS c
    FROM player_listings l
    JOIN upgrades u ON u.id = l.item_id AND COALESCE(u.is_active, 1) = 1
    WHERE l.status = 'active'
      AND l.expires_at > ${now}
      AND l.user_id <> ${sellerId}
      AND COALESCE(TRIM(u.category), '') <> ''
    ORDER BY 1 ASC
  `);
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r) => String(r.c || '').trim()).filter(Boolean);
}

export async function buildBlackMarketStateV1(userId: number): Promise<BlackMarketStateV1Dto> {
  const enabled = await isP2PMarketEnabled();
  const priceBandPercent = await getBlackMarketPriceBandPercent();
  const gs = await prisma.game_states.findUnique({
    where: { user_id: userId },
    select: { usdc: true, black_market_balance: true }
  });
  const usdc = gs != null && Number.isFinite(Number(gs.usdc)) ? Number(gs.usdc) : 0;
  const blackMarketBalance =
    gs != null && Number.isFinite(Number(gs.black_market_balance)) ? Number(gs.black_market_balance) : 0;

  const { items, total } = await loadActiveBlackMarketListingsPage({
    excludeSellerId: userId,
    limit: STATE_LISTINGS_LIMIT,
    offset: 0,
    sortPrice: 'asc'
  });
  const myActiveListings = await loadMyActiveListings(userId);
  const custody = await loadCustodyForBuyer(userId);
  const sellableStock = await loadSellableStockRows(userId);
  const hist = await loadP2pHistoryForUser(userId, HISTORY_LIMIT);
  let buyFilterCategories: string[] = [];
  try {
    buyFilterCategories = await loadBuyFilterCategoriesExcludingSeller(userId);
  } catch {
    buyFilterCategories = [];
  }

  return {
    version: 1,
    enabled,
    usdc,
    blackMarketBalance,
    priceBandPercent,
    listings: { items, total, limit: STATE_LISTINGS_LIMIT, offset: 0 },
    myActiveListings,
    custody,
    sellableStock,
    buyFilterCategories,
    history: { ...hist, limit: HISTORY_LIMIT }
  };
}
