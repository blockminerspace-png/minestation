import type { Application, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { prisma } from '../../config/prisma.js';
import { appendGameActivityLogMongo } from '../../lib/mongoLogs.js';
import { buildShopStateV1 } from './shop.snapshot.service.js';
import {
  clearShopCart,
  deleteShopCartLine,
  getOrCreateShopCartId,
  listShopCartLines,
  setShopCartLineQuantity,
  setShopCartLineQuantityByLineId
} from './shop.cart.service.js';
import { parseHardwareCartOrError, runHardwareCheckoutTransaction } from './shop.checkout.service.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';

const shopLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos à loja. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

const LINE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ShopModuleDeps = {
  pool: Pool;
  authenticateToken: (req: Request, res: Response, next: () => void) => void;
};

export function registerShopModuleRoutes(app: Application, deps: ShopModuleDeps): void {
  const { pool, authenticateToken } = deps;

  app.get('/api/shop/state', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHORIZED' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Sessão inválida.', code: 'UNAUTHORIZED' });
    }
    try {
      const u = await prisma.users.findUnique({
        where: { id: userId },
        select: { id: true, is_blocked: true }
      });
      if (!u) return res.status(404).json({ error: 'Utilizador não encontrado.', code: 'NOT_FOUND' });
      if (u.is_blocked === 1) return res.status(403).json({ error: 'Conta bloqueada.', code: 'FORBIDDEN' });
      const dto = await buildShopStateV1(userId);
      return res.status(200).json(dto);
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/shop/state', e, 'Não foi possível carregar a loja.');
    }
  });

  app.post('/api/shop/cart/items', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Sessão inválida.' });
    const body = req.body || {};
    const productId = typeof body.productId === 'string' ? body.productId.trim() : '';
    const qty = Math.floor(Number(body.quantity));
    if (!productId) return res.status(400).json({ error: 'Produto em falta.' });
    if (!Number.isInteger(qty) || qty < 0) return res.status(400).json({ error: 'Quantidade inválida.' });
    try {
      const r = await setShopCartLineQuantity(userId, productId, qty);
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      await appendGameActivityLogMongo(userId, 'shop_cart_set', { productId, qty });
      const dto = await buildShopStateV1(userId);
      return res.status(200).json({ ok: true, shop: dto });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/shop/cart/items', e, 'Erro ao atualizar o carrinho.');
    }
  });

  app.patch('/api/shop/cart/items/:lineId', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Sessão inválida.' });
    const lineId = String(req.params.lineId || '').trim();
    if (!LINE_ID_RE.test(lineId)) return res.status(400).json({ error: 'Linha inválida.' });
    const body = req.body || {};
    const qty = Math.floor(Number(body.quantity));
    if (!Number.isInteger(qty) || qty < 0) return res.status(400).json({ error: 'Quantidade inválida.' });
    try {
      const r = await setShopCartLineQuantityByLineId(userId, lineId, qty);
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      await appendGameActivityLogMongo(userId, 'shop_cart_patch', { lineId, qty });
      const dto = await buildShopStateV1(userId);
      return res.status(200).json({ ok: true, shop: dto });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'PATCH /api/shop/cart/items', e, 'Erro ao atualizar o carrinho.');
    }
  });

  app.delete('/api/shop/cart/items/:lineId', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Sessão inválida.' });
    const lineId = String(req.params.lineId || '').trim();
    if (!LINE_ID_RE.test(lineId)) return res.status(400).json({ error: 'Linha inválida.' });
    try {
      const ok = await deleteShopCartLine(userId, lineId);
      if (!ok) return res.status(404).json({ error: 'Linha não encontrada.' });
      await appendGameActivityLogMongo(userId, 'shop_cart_line_delete', { lineId });
      const dto = await buildShopStateV1(userId);
      return res.status(200).json({ ok: true, shop: dto });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'DELETE /api/shop/cart/items', e, 'Erro ao remover linha.');
    }
  });

  app.delete('/api/shop/cart', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Sessão inválida.' });
    try {
      await clearShopCart(userId);
      await appendGameActivityLogMongo(userId, 'shop_cart_clear', {});
      const dto = await buildShopStateV1(userId);
      return res.status(200).json({ ok: true, shop: dto });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'DELETE /api/shop/cart', e, 'Erro ao limpar o carrinho.');
    }
  });

  app.get('/api/shop/products', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHORIZED' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Sessão inválida.', code: 'UNAUTHORIZED' });
    }
    try {
      const dto = await buildShopStateV1(userId);
      return res.status(200).json({ version: dto.version, products: dto.products, hardwareMarketEnabled: dto.hardwareMarketEnabled });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/shop/products', e, 'Não foi possível listar produtos.');
    }
  });

  app.get('/api/shop/products/:productId', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHORIZED' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Sessão inválida.', code: 'UNAUTHORIZED' });
    }
    const productId = String(req.params.productId || '').trim();
    if (!productId || productId.length > 200) return res.status(400).json({ error: 'Produto inválido.' });
    try {
      const dto = await buildShopStateV1(userId);
      const p = dto.products.find((x) => x.id === productId);
      if (!p) return res.status(404).json({ error: 'Produto não encontrado.', code: 'NOT_FOUND' });
      return res.status(200).json(p);
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/shop/products/:productId', e, 'Erro ao carregar produto.');
    }
  });

  app.get('/api/shop/orders/:orderId', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Sessão inválida.' });
    const orderId = String(req.params.orderId || '').trim().slice(0, 128);
    if (!orderId) return res.status(400).json({ error: 'Pedido inválido.' });
    try {
      const row = await prisma.shop_checkout_idempotency.findFirst({
        where: { user_id: userId, idempotency_key: orderId },
        select: {
          idempotency_key: true,
          new_usdc: true,
          total_cost: true,
          lines_json: true,
          created_at: true
        }
      });
      if (!row) return res.status(404).json({ error: 'Pedido não encontrado.', code: 'NOT_FOUND' });
      let lines: unknown = [];
      try {
        lines = JSON.parse(row.lines_json || '[]');
      } catch {
        lines = [];
      }
      return res.status(200).json({
        orderId: row.idempotency_key,
        newUsdc: row.new_usdc,
        totalUsdc: row.total_cost,
        lines,
        createdAt: Number(row.created_at)
      });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/shop/orders/:orderId', e, 'Erro ao carregar pedido.');
    }
  });

  app.post('/api/shop/checkout', shopLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Sessão inválida.' });
    const idem =
      typeof (req.body || {}).idempotencyKey === 'string'
        ? String((req.body as { idempotencyKey: string }).idempotencyKey).trim()
        : '';
    try {
      const lines = await listShopCartLines(userId);
      if (lines.length === 0 && idem.length === 0) {
        return res.status(422).json({ error: 'Carrinho vazio.' });
      }
      const cart: Record<string, number> = {};
      for (const ln of lines) {
        cart[ln.productId] = (cart[ln.productId] || 0) + ln.qty;
      }
      const cartId = await getOrCreateShopCartId(userId);
      await appendGameActivityLogMongo(userId, 'shop_checkout_attempt', {
        idempotencyKey: idem.length > 0 ? idem : undefined,
        lineCount: lines.length
      });
      const out = await runHardwareCheckoutTransaction(pool, userId, cart, {
        idempotencyKey: idem.length > 0 ? idem : undefined,
        clearCartId: cartId
      });
      if (!out.ok) {
        await appendGameActivityLogMongo(userId, 'shop_checkout_denied', {
          status: out.status,
          error: out.error,
          idempotencyKey: idem.length > 0 ? idem : undefined,
          code: out.code
        });
        return res
          .status(out.status)
          .json({ error: out.error, missing: out.missing, ...(out.code ? { code: out.code } : {}) });
      }
      await appendGameActivityLogMongo(userId, 'shop_checkout_ok', {
        newUsdc: out.newUsdc,
        totalPaid: out.totalCost,
        cached: !!out.cached,
        idempotencyKey: idem.length > 0 ? idem : undefined
      });
      const shop = await buildShopStateV1(userId);
      return res.status(200).json({
        ok: true,
        newUsdc: out.newUsdc,
        totalPaid: out.totalCost,
        cached: !!out.cached,
        orderId: idem.length > 0 ? idem : undefined,
        shop
      });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/shop/checkout', e, 'Erro ao finalizar a compra.');
    }
  });
}
