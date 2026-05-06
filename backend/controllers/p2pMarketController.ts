/**
 * P2P / mercado paralelo: estado e histórico transaccional em **PostgreSQL** (Prisma + SQL).
 * Trilho de **logs de auditoria** das mutações bem-sucedidas em **MongoDB** (`logUserAction` → `action_logs`),
 * quando `MONGODB_URI` está definido — ver `backend/docs/MONGO_LOG_CONTRACT.md`.
 */
import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { prismaSqlTx } from '../lib/sqlTransaction.js';
import { runReferralCommissionOnTx } from '../models/referralCommissionModel.js';
import {
  computeP2PBandReferenceUsd,
  getBlackMarketPriceBandPercent,
  isP2PMarketEnabled,
  MARKET_LISTING_TTL_MS,
  MARKET_RESERVE_MS,
  mapListingForClient,
  parseUsdFromDb,
  timestampMsFromDb,
  type PlayerListingRow
} from '../models/p2pMarketModel.js';
import { logUserAction } from '../lib/mongoLogs.js';
import { sendInternalErrorSafeMessageOrPrisma, sendInternalErrorShapeOrPrisma } from '../utils/apiErrorResponse.js';

export type P2pMarketDeps = {
  emitMarketWs: (payload: Record<string, unknown>) => void;
};

class P2pUserError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? String(body.error) : 'p2p');
    this.name = 'P2pUserError';
    this.status = status;
    this.body = body;
  }
}

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function listingQtyFromRow(qty: unknown): number {
  const n = parseInt(String(qty ?? 1), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseRequestedBuyQty(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const f = Math.floor(raw);
    return f >= 1 ? f : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) {
    const f = Math.floor(n);
    return f >= 1 ? f : null;
  }
  const p = parseInt(s, 10);
  return Number.isFinite(p) && p >= 1 ? p : null;
}

const txOpts = { timeout: 60_000, maxWait: 10_000 } as const;

export function registerP2pMarketRoutes(app: Express, deps: P2pMarketDeps): void {
  const { emitMarketWs } = deps;

  app.get('/api/market/listings', async (req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      if (!(await isP2PMarketEnabled())) {
        res.json([]);
        return;
      }
      const now = Date.now();
      await prisma.$executeRawUnsafe(
        `UPDATE player_listings SET reserved_by = NULL, reserved_until = NULL
         WHERE status = 'active' AND reserved_until IS NOT NULL AND reserved_until < $1`,
        now
      );
      const rows = await prisma.$queryRawUnsafe(
        `SELECT l.*, u.username, u.email, ru.username AS reserver_username
         FROM player_listings l
         JOIN users u ON l.user_id = u.id
         LEFT JOIN users ru ON ru.id = l.reserved_by
         WHERE l.status = 'active' AND l.expires_at > $1`,
        now
      );
      const list = Array.isArray(rows) ? rows : [];
      res.json(list.map((l: PlayerListingRow) => mapListingForClient(l, now)));
    } catch (e: unknown) {
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'p2p', e, 'Erro ao listar.');
    }
  });

  app.get('/api/market/history', async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 80;
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 80;
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
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
      const mapRow = (r: HistRow) => ({
        at: timestampMsFromDb(r.created_at),
        itemId: String(r.item_id || '').trim(),
        qty: Math.max(1, parseInt(String(r.qty ?? 1), 10) || 1),
        unitPrice: Number(r.unit_price) || 0,
        buyerPaidUsdc: Number(r.buyer_paid_usdc) || 0,
        sellerReceivedUsdc: Number(r.seller_received_usdc) || 0,
        taxUsdc: Number(r.tax_usdc) || 0,
        counterpartName: (r.counterpart_display && String(r.counterpart_display).trim()) || '—'
      });
      const purch = await prisma.$queryRawUnsafe(
        `SELECT t.created_at, t.item_id, t.qty, t.unit_price, t.buyer_paid_usdc, t.seller_received_usdc, t.tax_usdc,
                COALESCE(NULLIF(TRIM(su.username), ''), su.email, '') AS counterpart_display
         FROM p2p_market_trade_history t
         JOIN users su ON su.id = t.seller_id
         WHERE t.buyer_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2`,
        userId,
        limit
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
        limit
      );
      const pr = Array.isArray(purch) ? purch : [];
      const sr = Array.isArray(salesRes) ? salesRes : [];
      res.json({
        purchases: (pr as HistRow[]).map(mapRow),
        sales: (sr as HistRow[]).map(mapRow)
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[P2P] /api/market/history:', e);
      if (/p2p_market_trade_history|does not exist|relation.*not exist/i.test(msg)) {
        res.json({ purchases: [], sales: [] });
        return;
      }
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'p2p', e, 'Erro ao ler histórico.');
    }
  });

  app.post('/api/market/sell', async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const rawItemId = body?.itemId;
    const rawPrice = body?.price;
    const rawQty = body?.qty;
    const itemId = typeof rawItemId === 'string' ? rawItemId.trim().slice(0, 200) : '';
    const price =
      typeof rawPrice === 'number' && Number.isFinite(rawPrice)
        ? rawPrice
        : parseUsdFromDb(rawPrice);
    const qty = parseInt(String(rawQty ?? '1'), 10);
    if (!itemId || !/^[a-zA-Z0-9_.-]+$/.test(itemId)) {
      res.status(400).json({ error: 'Item inválido.' });
      return;
    }
    if (!Number.isFinite(price) || price <= 0 || price > 1e12) {
      res.status(400).json({ error: 'Preço inválido.' });
      return;
    }
    if (!Number.isFinite(qty) || qty < 1 || qty > 9999) {
      res.status(400).json({ error: 'Quantidade inválida.' });
      return;
    }
    if (!(await isP2PMarketEnabled())) {
      res.status(403).json({ error: 'Mercado negro desativado.' });
      return;
    }
    try {
      const lid = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', userId);
          const upRows = await tx.$queryRawUnsafe(
            'SELECT id, sell_in_black_market, base_cost::double precision AS base_cost FROM upgrades WHERE id = $1 AND COALESCE(is_active, 1) = 1',
            itemId
          );
          const upArr = Array.isArray(upRows) ? upRows : [];
          const up = upArr[0] as { sell_in_black_market?: number; base_cost?: number | string } | undefined;
          if (!up || Number(up.sell_in_black_market) === 0) {
            throw new P2pUserError(400, { error: 'Este item não pode ser vendido no mercado paralelo.' });
          }
          const baseCost = parseUsdFromDb(up.base_cost);
          let bookFallbackAsk: number | null = null;
          if (!(Number.isFinite(baseCost) && baseCost > 0)) {
            const nowMs = Date.now();
            const medRows = await tx.$queryRawUnsafe(
              `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price::double precision) AS m
               FROM player_listings
               WHERE item_id = $1 AND status = 'active' AND expires_at > $2`,
              itemId,
              nowMs
            );
            const medArr = Array.isArray(medRows) ? medRows : [];
            const rawMed = (medArr[0] as { m?: unknown } | undefined)?.m;
            const med =
              rawMed != null && Number.isFinite(Number(rawMed)) && Number(rawMed) > 0 ? Number(rawMed) : null;
            if (med != null) {
              bookFallbackAsk = med;
            } else {
              const minAskRows = await tx.$queryRawUnsafe(
                `SELECT MIN(price::double precision) AS m FROM player_listings
                 WHERE item_id = $1 AND status = 'active' AND expires_at > $2`,
                itemId,
                nowMs
              );
              const minArr = Array.isArray(minAskRows) ? minAskRows : [];
              const rawMin = (minArr[0] as { m?: unknown } | undefined)?.m;
              bookFallbackAsk =
                rawMin != null && Number.isFinite(Number(rawMin)) && Number(rawMin) > 0
                  ? Number(rawMin)
                  : null;
            }
          }
          const ref = computeP2PBandReferenceUsd(baseCost, bookFallbackAsk);
          const band = await getBlackMarketPriceBandPercent();
          const minF = 1 - band / 100;
          const maxF = 1 + band / 100;
          if (ref > 0) {
            const lo = ref * minF;
            const hi = ref * maxF;
            if (price < lo - 1e-9 || price > hi + 1e-9) {
              const baseOk = Number.isFinite(baseCost) && baseCost > 0;
              const hint = baseOk
                ? `Âncora: Genesis Supply (base_cost) USDC ${ref.toFixed(4)}.`
                : `Âncora: livro P2P (sem base_cost válido na BD) USDC ${ref.toFixed(4)} — confira upgrades.base_cost para este item.`;
              throw new P2pUserError(400, {
                error: `Preço fora do limite (±${band}% sobre USDC ${ref.toFixed(4)}). ${hint}`
              });
            }
          }
          const decRows = await tx.$queryRawUnsafe(
            'UPDATE stock SET qty = qty - $1 WHERE user_id = $2 AND item_id = $3 AND qty >= $1 RETURNING qty',
            qty,
            userId,
            itemId
          );
          const decArr = Array.isArray(decRows) ? decRows : [];
          if (decArr.length === 0) {
            throw new P2pUserError(400, { error: 'Stock insuficiente para listar.' });
          }
          const listingId =
            typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${Date.now()}_${userId}_${Math.random().toString(36).slice(2, 12)}`;
          const expiresAt = Date.now() + MARKET_LISTING_TTL_MS;
          await tx.$executeRawUnsafe(
            `INSERT INTO player_listings (id, user_id, item_id, price, expires_at, is_player, qty, status, buyer_paid_usdc)
             VALUES ($1, $2, $3, $4, $5, 1, $6, 'active', NULL)`,
            listingId,
            userId,
            itemId,
            price,
            expiresAt,
            qty
          );
          const bumpAt = Date.now();
          await tx.$executeRawUnsafe(
            'UPDATE game_states SET server_updated_at = $1, last_updated_at = $1 WHERE user_id = $2',
            bumpAt,
            userId
          );
          return listingId;
        },
        txOpts
      );
      emitMarketWs({ type: 'market', event: 'listing_created', listingId: lid });
      logUserAction(userId, 'p2p_listing_create', { listingId: lid, itemId, qty, price });
      res.json({ ok: true, listingId: lid });
    } catch (e: unknown) {
      if (e instanceof P2pUserError) {
        res.status(e.status).json(e.body);
        return;
      }
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'p2p', e, 'Erro ao criar anúncio.');
    }
  });

  app.post('/api/market/cancel', async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const listingId =
      typeof (req.body as { listingId?: string })?.listingId === 'string'
        ? (req.body as { listingId: string }).listingId.trim()
        : '';
    if (!listingId) {
      res.status(400).json({ error: 'listingId obrigatório' });
      return;
    }
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', userId);
          const lr = await tx.$queryRawUnsafe('SELECT * FROM player_listings WHERE id = $1 FOR UPDATE', listingId);
          const lrArr = Array.isArray(lr) ? lr : [];
          const l = lrArr[0] as { user_id?: number; status?: string; item_id?: string; qty?: number } | undefined;
          if (!l || Number(l.user_id) !== userId) {
            throw new P2pUserError(404, { error: 'Anúncio não encontrado.' });
          }
          if (l.status !== 'active') {
            throw new P2pUserError(400, { error: 'Este anúncio já não pode ser cancelado.' });
          }
          const q = listingQtyFromRow(l.qty);
          await tx.$executeRawUnsafe(
            `INSERT INTO stock (user_id, item_id, qty) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, item_id) DO UPDATE SET qty = stock.qty + EXCLUDED.qty`,
            userId,
            l.item_id,
            q
          );
          await tx.$executeRawUnsafe('DELETE FROM player_listings WHERE id = $1', listingId);
          const bumpAt = Date.now();
          await tx.$executeRawUnsafe(
            'UPDATE game_states SET server_updated_at = $1, last_updated_at = $1 WHERE user_id = $2',
            bumpAt,
            userId
          );
        },
        txOpts
      );
      emitMarketWs({ type: 'market', event: 'listing_cancelled', listingId });
      logUserAction(userId, 'p2p_listing_cancel', { listingId });
      res.json({ ok: true });
    } catch (e: unknown) {
      if (e instanceof P2pUserError) {
        res.status(e.status).json(e.body);
        return;
      }
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'p2p', e, 'Erro.');
    }
  });

  app.post('/api/market/reserve', async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const listingId =
      typeof (req.body as { listingId?: string })?.listingId === 'string'
        ? (req.body as { listingId: string }).listingId.trim()
        : '';
    if (!listingId) {
      res.status(400).json({ error: 'listingId obrigatório' });
      return;
    }
    if (!(await isP2PMarketEnabled())) {
      res.status(403).json({ ok: false, error: 'Mercado desativado.' });
      return;
    }
    try {
      const reservedUntil = await prisma.$transaction(
        async (tx) => {
          const now = Date.now();
          const until = now + MARKET_RESERVE_MS;
          const upRows = await tx.$queryRawUnsafe(
            `UPDATE player_listings
             SET reserved_by = $2, reserved_until = $3
             WHERE id = $1 AND status = 'active' AND expires_at > $4
               AND user_id <> $2
               AND (reserved_until IS NULL OR reserved_until < $4 OR reserved_by = $2)
             RETURNING id`,
            listingId,
            userId,
            until,
            now
          );
          const arr = Array.isArray(upRows) ? upRows : [];
          return arr.length > 0 ? until : 0;
        },
        txOpts
      );
      if (!reservedUntil) {
        res.json({ ok: false, error: 'Anúncio indisponível ou já reservado.' });
        return;
      }
      emitMarketWs({ type: 'market', event: 'listing_reserved', listingId });
      logUserAction(userId, 'p2p_listing_reserve', { listingId, reservedUntil });
      res.json({ ok: true, reservedUntil });
    } catch (e: unknown) {
      sendInternalErrorShapeOrPrisma(res, req.originalUrl || 'p2p', e, { ok: false }, 'Erro.');
    }
  });

  app.post('/api/market/cancel-reserve', async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const listingId =
      typeof (req.body as { listingId?: string })?.listingId === 'string'
        ? (req.body as { listingId: string }).listingId.trim()
        : '';
    if (!listingId) {
      res.status(400).json({ error: 'listingId obrigatório' });
      return;
    }
    try {
      const n = await prisma.$transaction(async (tx) => {
        const r = await tx.$queryRawUnsafe(
          `UPDATE player_listings SET reserved_by = NULL, reserved_until = NULL
           WHERE id = $1 AND status = 'active' AND reserved_by = $2
           RETURNING id`,
          listingId,
          userId
        );
        return Array.isArray(r) ? r.length : 0;
      }, txOpts);
      if (n > 0) {
        emitMarketWs({ type: 'market', event: 'listing_unreserved', listingId });
        logUserAction(userId, 'p2p_reserve_cancel', { listingId });
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'p2p', e, 'Erro.');
    }
  });

  app.post('/api/market/buy', async (req: Request, res: Response) => {
    const buyerId = uidNum(req);
    const bodyBuy = req.body as { listingId?: string; qty?: unknown; quantity?: unknown } | undefined;
    const rawLid = bodyBuy?.listingId;
    const listingId = typeof rawLid === 'string' ? rawLid.trim() : '';
    if (!buyerId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    if (!listingId) {
      res.status(400).json({ error: 'Listing ID required' });
      return;
    }
    if (!(await isP2PMarketEnabled())) {
      res.status(403).json({ error: 'Mercado negro desativado.' });
      return;
    }
    try {
      const out = await prisma.$transaction(
        async (tx) => {
          const listingRows = await tx.$queryRawUnsafe(
            `SELECT l.*, (COALESCE(NULLIF(l.qty, 0), 1))::int AS qty_effective
             FROM player_listings l WHERE l.id = $1 FOR UPDATE`,
            listingId
          );
          const lArr = Array.isArray(listingRows) ? listingRows : [];
          const listing = lArr[0] as
            | {
                status: string;
                expires_at: string | number | bigint;
                user_id: number;
                reserved_by?: number | null;
                reserved_until?: string | number | bigint | null;
                price: string | number;
                qty?: string | number | null;
                qty_effective?: number | string;
                item_id?: string;
                is_player?: number | null;
              }
            | undefined;
          const now = Date.now();
          if (!listing) throw new P2pUserError(400, { error: 'Anúncio não encontrado.' });
          if (listing.status !== 'active') throw new P2pUserError(400, { error: 'Anúncio não está mais disponível.' });
          if (timestampMsFromDb(listing.expires_at) < now) {
            throw new P2pUserError(400, { error: 'Anúncio expirado.' });
          }
          if (Number(listing.user_id) === buyerId) {
            throw new P2pUserError(400, { error: 'Você não pode comprar seu próprio item.' });
          }
          const rid = listing.reserved_by != null ? Number(listing.reserved_by) : null;
          const rt =
            listing.reserved_until != null ? timestampMsFromDb(listing.reserved_until) : 0;
          if (rid != null && rt > now && rid !== buyerId) {
            throw new P2pUserError(400, { error: 'Anúncio reservado por outro operador.' });
          }
          const sellerId = Number(listing.user_id);
          const ids = [buyerId, sellerId].sort((a, b) => a - b);
          await tx.$queryRawUnsafe('SELECT * FROM game_states WHERE user_id = $1 FOR UPDATE', ids[0]);
          await tx.$queryRawUnsafe('SELECT * FROM game_states WHERE user_id = $1 FOR UPDATE', ids[1]);
          const buyerRowArr = await tx.$queryRawUnsafe(
            'SELECT usdc FROM game_states WHERE user_id = $1',
            buyerId
          );
          const br = (Array.isArray(buyerRowArr) ? buyerRowArr : [])[0] as { usdc?: unknown } | undefined;
          const unitPrice = Number(listing.price);
          const lineQty = Math.max(1, parseInt(String(listing.qty_effective ?? listing.qty ?? 1), 10) || 1);
          const parsedReq = parseRequestedBuyQty(bodyBuy?.qty ?? bodyBuy?.quantity);
          let buyQty: number;
          if (lineQty > 1) {
            if (parsedReq == null) {
              throw new P2pUserError(400, {
                error:
                  'Para anúncios com mais de 1 unidade, envie o campo qty (número de unidades a comprar). Ex.: qty: 1 para comprar só uma.'
              });
            }
            buyQty = Math.min(lineQty, parsedReq);
          } else {
            buyQty = 1;
            if (parsedReq != null) {
              buyQty = Math.min(1, parsedReq);
            }
          }
          if (!Number.isFinite(buyQty) || buyQty < 1) {
            throw new P2pUserError(400, { error: 'Quantidade inválida.' });
          }
          const totalPrice = unitPrice * buyQty;
          if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(totalPrice) || totalPrice <= 0) {
            throw new P2pUserError(400, { error: 'Preço do anúncio inválido.' });
          }
          const itemIdForBand = String(listing.item_id || '').trim();
          if (itemIdForBand) {
            const upBandRows = await tx.$queryRawUnsafe(
              'SELECT base_cost::double precision AS base_cost FROM upgrades WHERE id = $1 AND COALESCE(is_active, 1) = 1',
              itemIdForBand
            );
            const uba = Array.isArray(upBandRows) ? upBandRows : [];
            const bcBand = parseUsdFromDb((uba[0] as { base_cost?: unknown } | undefined)?.base_cost);
            const refBuy = computeP2PBandReferenceUsd(bcBand, null);
            if (refBuy > 0) {
              const bandBuy = await getBlackMarketPriceBandPercent();
              const loB = refBuy * (1 - bandBuy / 100);
              const hiB = refBuy * (1 + bandBuy / 100);
              if (unitPrice < loB - 1e-9 || unitPrice > hiB + 1e-9) {
                throw new P2pUserError(400, {
                  error:
                    'Este anúncio está com preço fora do permitido (limites da loja). Atualize a lista — não é possível comprar.'
                });
              }
            }
          }
          const buyerUsdc = Number(br?.usdc || 0);
          if (buyerUsdc < totalPrice) {
            throw new P2pUserError(400, { error: 'Insufficient USDC', missing: totalPrice - buyerUsdc });
          }
          const settingsRows = await tx.$queryRawUnsafe(
            'SELECT market_tax_percent FROM economy_settings WHERE id = 1'
          );
          const se = (Array.isArray(settingsRows) ? settingsRows : [])[0] as { market_tax_percent?: unknown } | undefined;
          const taxPercent = Number(se?.market_tax_percent || 0);
          const taxAmount = (totalPrice * taxPercent) / 100;
          const sellerReceive = totalPrice - taxAmount;
          const payRows = await tx.$queryRawUnsafe(
            'UPDATE game_states SET usdc = usdc - $1, last_updated_at = $2, server_updated_at = $2 WHERE user_id = $3 AND usdc >= $1 RETURNING usdc',
            totalPrice,
            now,
            buyerId
          );
          const payArr = Array.isArray(payRows) ? payRows : [];
          if (payArr.length === 0) {
            throw new P2pUserError(400, {
              error: 'Insufficient USDC',
              missing: Math.max(0, totalPrice - buyerUsdc)
            });
          }
          await tx.$executeRawUnsafe(
            'UPDATE game_states SET black_market_balance = COALESCE(black_market_balance, 0) + $1, last_updated_at = $2, server_updated_at = $2 WHERE user_id = $3',
            sellerReceive,
            now,
            sellerId
          );
          const itemId = String(listing.item_id || '').trim();
          if (!itemId) {
            throw new P2pUserError(400, { error: 'Anúncio sem item.' });
          }
          const isPlayer = Number(listing.is_player ?? 1) ? 1 : 0;
          const expiresAtMs = timestampMsFromDb(listing.expires_at);
          if (buyQty >= lineQty) {
            const stRows = await tx.$queryRawUnsafe(
              `UPDATE player_listings
             SET status = 'awaiting_pickup',
                 reserved_by = $1,
                 reserved_until = NULL,
                 buyer_paid_usdc = $4
             WHERE id = $2 AND status = 'active'
               AND (COALESCE(NULLIF(qty, 0), 1))::int = $3
             RETURNING id`,
              buyerId,
              listingId,
              lineQty,
              totalPrice
            );
            const stArr = Array.isArray(stRows) ? stRows : [];
            if (stArr.length === 0) {
              throw new P2pUserError(400, {
                error:
                  'Anúncio indisponível ou a quantidade no servidor não coincide (atualiza a lista e tenta de novo).'
              });
            }
          } else {
            const shrinkRows = await tx.$queryRawUnsafe(
              `UPDATE player_listings
               SET qty = (COALESCE(NULLIF(qty, 0), 1) - $1)::int,
                   reserved_by = NULL, reserved_until = NULL
               WHERE id = $2 AND status = 'active'
                 AND (COALESCE(NULLIF(qty, 0), 1))::int >= $1
               RETURNING id`,
              buyQty,
              listingId
            );
            const shr = Array.isArray(shrinkRows) ? shrinkRows : [];
            if (shr.length === 0) {
              throw new P2pUserError(400, { error: 'Anúncio já foi vendido ou quantidade indisponível.' });
            }
            const custodyId =
              typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${Date.now()}_${buyerId}_${Math.random().toString(36).slice(2, 12)}`;
            await tx.$executeRawUnsafe(
              `INSERT INTO player_listings (id, user_id, item_id, price, expires_at, is_player, qty, status, reserved_by, reserved_until, buyer_paid_usdc)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'awaiting_pickup', $8, NULL, $9)`,
              custodyId,
              sellerId,
              itemId,
              unitPrice,
              expiresAtMs,
              isPlayer,
              buyQty,
              buyerId,
              totalPrice
            );
          }
          await runReferralCommissionOnTx(prismaSqlTx(tx), buyerId, totalPrice, 'black_market');
          await tx.$executeRawUnsafe(
            `INSERT INTO p2p_market_trade_history
             (created_at, buyer_id, seller_id, item_id, qty, unit_price, buyer_paid_usdc, seller_received_usdc, tax_usdc)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            now,
            buyerId,
            sellerId,
            itemId,
            buyQty,
            unitPrice,
            totalPrice,
            sellerReceive,
            taxAmount
          );
          return { buyQty, totalPrice, unitPrice, sellerId, itemId, listingId };
        },
        txOpts
      );
      emitMarketWs({ type: 'market', event: 'listing_sold', listingId });
      logUserAction(buyerId, 'p2p_listing_buy', {
        listingId: out.listingId,
        sellerId: out.sellerId,
        itemId: out.itemId,
        buyQty: out.buyQty,
        totalUsdc: out.totalPrice,
        unitPrice: out.unitPrice
      });
      res.json({
        ok: true,
        message: 'Compra realizada. Retire o item no cofre (P2P).',
        purchasedQty: out.buyQty,
        totalUsdc: out.totalPrice,
        unitPrice: out.unitPrice
      });
    } catch (e: unknown) {
      if (e instanceof P2pUserError) {
        res.status(e.status).json(e.body);
        return;
      }
      res.status(400).json({ error: e instanceof Error ? e.message : 'Erro na compra.' });
    }
  });

  app.post('/api/market/claim', async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    try {
      const claimed = await prisma.$transaction(
        async (tx) => {
          const gsRows = await tx.$queryRawUnsafe(
            'SELECT black_market_balance FROM game_states WHERE user_id = $1 FOR UPDATE',
            userId
          );
          const gsArr = Array.isArray(gsRows) ? gsRows : [];
          const bal = Number((gsArr[0] as { black_market_balance?: unknown } | undefined)?.black_market_balance || 0);
          if (bal <= 0) {
            throw new P2pUserError(400, { error: 'Sem proventos para liquidar.' });
          }
          const now = Date.now();
          await tx.$executeRawUnsafe(
            'UPDATE game_states SET black_market_balance = 0, usdc = COALESCE(usdc, 0) + $1, last_updated_at = $2, server_updated_at = $2 WHERE user_id = $3',
            bal,
            now,
            userId
          );
          return bal;
        },
        txOpts
      );
      emitMarketWs({ type: 'market', event: 'black_market_proceeds_claimed' });
      logUserAction(userId, 'p2p_proceeds_claim', { claimedUsdc: claimed });
      res.json({ ok: true, claimed });
    } catch (e: unknown) {
      if (e instanceof P2pUserError) {
        res.status(e.status).json(e.body);
        return;
      }
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'p2p', e, 'Erro.');
    }
  });

  app.get('/api/market/custody', async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      const rows = await prisma.$queryRawUnsafe(
        `SELECT l.*, u.username, u.email
         FROM player_listings l
         JOIN users u ON l.user_id = u.id
         WHERE l.status = 'awaiting_pickup' AND l.reserved_by = $1`,
        userId
      );
      const list = Array.isArray(rows) ? rows : [];
      res.json(
        list.map((l: PlayerListingRow & { buyer_paid_usdc?: number | string | null }) => {
          const qty = Math.max(1, parseInt(String(l.qty ?? 1), 10) || 1);
          const unit = Number(l.price);
          const paidRaw = l.buyer_paid_usdc;
          const paid =
            paidRaw != null && paidRaw !== '' && Number.isFinite(Number(paidRaw)) ? Number(paidRaw) : undefined;
          return {
            id: l.id,
            sellerName: l.username || l.email,
            itemId: l.item_id,
            price: unit,
            qty,
            lineTotal: unit * qty,
            buyerPaidUsdc: paid,
            expiresAt: timestampMsFromDb(l.expires_at)
          };
        })
      );
    } catch (e: unknown) {
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'p2p', e, 'Erro.');
    }
  });

  app.post('/api/market/claim-item', async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const listingId =
      typeof (req.body as { listingId?: string })?.listingId === 'string'
        ? (req.body as { listingId: string }).listingId.trim()
        : '';
    if (!listingId) {
      res.status(400).json({ error: 'listingId obrigatório' });
      return;
    }
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', userId);
          const lr = await tx.$queryRawUnsafe(
            'SELECT * FROM player_listings WHERE id = $1 AND status = $2 AND reserved_by = $3 FOR UPDATE',
            listingId,
            'awaiting_pickup',
            userId
          );
          const lrArr = Array.isArray(lr) ? lr : [];
          const l = lrArr[0] as { item_id?: string; qty?: number } | undefined;
          if (!l) {
            throw new P2pUserError(404, { error: 'Item não encontrado ou já recolhido.' });
          }
          const q = listingQtyFromRow(l.qty);
          await tx.$executeRawUnsafe(
            `INSERT INTO stock (user_id, item_id, qty) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, item_id) DO UPDATE SET qty = stock.qty + EXCLUDED.qty`,
            userId,
            l.item_id,
            q
          );
          await tx.$executeRawUnsafe('DELETE FROM player_listings WHERE id = $1', listingId);
          const bumpAt = Date.now();
          await tx.$executeRawUnsafe(
            'UPDATE game_states SET server_updated_at = $1, last_updated_at = $1 WHERE user_id = $2',
            bumpAt,
            userId
          );
        },
        txOpts
      );
      emitMarketWs({ type: 'market', event: 'custody_claimed', listingId });
      logUserAction(userId, 'p2p_custody_claim', { listingId });
      res.json({ ok: true });
    } catch (e: unknown) {
      if (e instanceof P2pUserError) {
        res.status(e.status).json(e.body);
        return;
      }
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'p2p', e, 'Erro.');
    }
  });
}
