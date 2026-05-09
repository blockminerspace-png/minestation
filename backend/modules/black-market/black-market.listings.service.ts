import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { mapListingForClient, timestampMsFromDb, type PlayerListingRow } from '../../models/p2pMarketModel.js';
import { clampBlackMarketLimit, clampBlackMarketOffset } from './black-market.query.js';

export type BlackMarketListingsQuery = {
  excludeSellerId?: number | null;
  search?: string;
  category?: string;
  type?: string;
  sortPrice?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

async function clearExpiredReservations(nowMs: number): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE player_listings SET reserved_by = NULL, reserved_until = NULL
     WHERE status = 'active' AND reserved_until IS NOT NULL AND reserved_until < $1`,
    nowMs
  );
}

/**
 * Lista ofertas ativas com filtros no servidor.
 * `excludeSellerId`: não mostra ofertas desse vendedor (regra “as tuas não aparecem na compra”).
 */
export async function loadActiveBlackMarketListingsPage(
  q: BlackMarketListingsQuery
): Promise<{ items: ReturnType<typeof mapListingForClient>[]; total: number }> {
  const nowMs = Date.now();
  const now = BigInt(nowMs);
  await clearExpiredReservations(nowMs);

  const limit = clampBlackMarketLimit(q.limit);
  const offset = clampBlackMarketOffset(q.offset);
  const exclude = q.excludeSellerId != null && Number.isFinite(q.excludeSellerId) ? Math.floor(q.excludeSellerId) : null;
  const search = (q.search || '').trim().slice(0, 120);
  const category = (q.category || '').trim().slice(0, 120);
  const type = (q.type || '').trim().slice(0, 64);
  const sortDesc = q.sortPrice === 'desc';
  const like =
    search.length > 0 ? `%${search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%` : null;

  const whereParts: Prisma.Sql[] = [
    Prisma.sql`l.status = 'active'`,
    Prisma.sql`l.expires_at > ${now}`
  ];
  if (exclude != null && exclude > 0) {
    whereParts.push(Prisma.sql`l.user_id <> ${exclude}`);
  }
  if (category.length > 0) {
    whereParts.push(Prisma.sql`u.category = ${category}`);
  }
  if (type.length > 0) {
    whereParts.push(Prisma.sql`u.type = ${type}`);
  }
  if (like) {
    whereParts.push(
      Prisma.sql`(u.name ILIKE ${like} OR l.item_id ILIKE ${like} OR usr.username ILIKE ${like} OR COALESCE(usr.email::text, '') ILIKE ${like})`
    );
  }
  const whereSql = Prisma.join(whereParts, ' AND ');
  const orderSql = sortDesc ? Prisma.sql`l.price DESC, l.id DESC` : Prisma.sql`l.price ASC, l.id ASC`;

  const countRows = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS c
    FROM player_listings l
    JOIN users usr ON l.user_id = usr.id
    JOIN upgrades u ON u.id = l.item_id AND COALESCE(u.is_active, 1) = 1
    WHERE ${whereSql}
  `);
  const total = Number(countRows[0]?.c ?? 0n) || 0;

  const listRows = await prisma.$queryRaw<PlayerListingRow[]>(Prisma.sql`
    SELECT l.*, usr.username, usr.email, ru.username AS reserver_username
    FROM player_listings l
    JOIN users usr ON l.user_id = usr.id
    LEFT JOIN users ru ON ru.id = l.reserved_by
    JOIN upgrades u ON u.id = l.item_id AND COALESCE(u.is_active, 1) = 1
    WHERE ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ${limit} OFFSET ${offset}
  `);

  const items = (Array.isArray(listRows) ? listRows : []).map((l) => mapListingForClient(l, nowMs));
  return { items, total };
}

export async function loadMyActiveListings(sellerId: number): Promise<ReturnType<typeof mapListingForClient>[]> {
  const nowMs = Date.now();
  await clearExpiredReservations(nowMs);
  const now = BigInt(nowMs);
  const rows = await prisma.$queryRaw<PlayerListingRow[]>(Prisma.sql`
    SELECT l.*, u.username, u.email, ru.username AS reserver_username
    FROM player_listings l
    JOIN users u ON l.user_id = u.id
    LEFT JOIN users ru ON ru.id = l.reserved_by
    WHERE l.user_id = ${sellerId} AND l.status = 'active' AND l.expires_at > ${now}
    ORDER BY l.expires_at ASC
  `);
  return (Array.isArray(rows) ? rows : []).map((l) => mapListingForClient(l, nowMs));
}

export type CustodyRowDto = {
  id: string;
  sellerName: string;
  itemId: string;
  price: number;
  qty: number;
  lineTotal: number;
  buyerPaidUsdc?: number;
  expiresAt: number;
};

export async function loadCustodyForBuyer(userId: number): Promise<CustodyRowDto[]> {
  const rows = await prisma.$queryRaw<
    (PlayerListingRow & { buyer_paid_usdc?: number | string | null })[]
  >(Prisma.sql`
    SELECT l.*, u.username, u.email
    FROM player_listings l
    JOIN users u ON l.user_id = u.id
    WHERE l.status = 'awaiting_pickup' AND l.reserved_by = ${userId}
  `);
  const list = Array.isArray(rows) ? rows : [];
  return list.map((l) => {
    const qty = Math.max(1, parseInt(String(l.qty ?? 1), 10) || 1);
    const unit = Number(l.price);
    const paidRaw = l.buyer_paid_usdc;
    const paid =
      paidRaw != null && paidRaw !== '' && Number.isFinite(Number(paidRaw)) ? Number(paidRaw) : undefined;
    return {
      id: l.id,
      sellerName: l.username || l.email || '',
      itemId: l.item_id,
      price: unit,
      qty,
      lineTotal: unit * qty,
      buyerPaidUsdc: paid,
      expiresAt: timestampMsFromDb(l.expires_at)
    };
  });
}

export type SellableStockRow = { itemId: string; qty: number };

export async function loadSellableStockRows(userId: number): Promise<SellableStockRow[]> {
  const rows = await prisma.$queryRaw<{ item_id: string; qty: number }[]>(Prisma.sql`
    SELECT s.item_id, s.qty::int AS qty
    FROM stock s
    JOIN upgrades u ON u.id = s.item_id AND COALESCE(u.is_active, 1) = 1
    WHERE s.user_id = ${userId} AND s.qty > 0 AND COALESCE(u.sell_in_black_market, 1) <> 0
    ORDER BY s.item_id ASC
  `);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    itemId: String(r.item_id || '').trim(),
    qty: Math.max(0, Math.floor(Number(r.qty)) || 0)
  }));
}
