import type { Application, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../../config/prisma.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { buildBlackMarketStateV1, loadP2pHistoryForUser } from './black-market.snapshot.service.js';
import { loadActiveBlackMarketListingsPage, loadCustodyForBuyer, loadMyActiveListings } from './black-market.listings.service.js';

const bmLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos ao mercado. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

export type BlackMarketModuleDeps = {
  authenticateToken: (req: Request, res: Response, next: () => void) => void;
};

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function registerBlackMarketModuleRoutes(app: Application, deps: BlackMarketModuleDeps): void {
  const { authenticateToken } = deps;

  app.get('/api/black-market/state', bmLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHORIZED' });
    try {
      const u = await prisma.users.findUnique({
        where: { id: userId },
        select: { id: true, is_blocked: true }
      });
      if (!u) return res.status(404).json({ error: 'Utilizador não encontrado.', code: 'NOT_FOUND' });
      if (u.is_blocked === 1) return res.status(403).json({ error: 'Conta bloqueada.', code: 'FORBIDDEN' });
      const dto = await buildBlackMarketStateV1(userId);
      return res.status(200).json(dto);
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/black-market/state', e, 'Não foi possível carregar o mercado.');
    }
  });

  app.get('/api/black-market/listings', bmLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    const q = req.query;
    const search = typeof q.q === 'string' ? q.q : typeof q.search === 'string' ? q.search : '';
    const category = typeof q.category === 'string' ? q.category : '';
    const type = typeof q.type === 'string' ? q.type : '';
    const sortPrice = q.sort === 'desc' ? 'desc' : 'asc';
    const limit = typeof q.limit === 'string' ? parseInt(q.limit, 10) : undefined;
    const offset = typeof q.offset === 'string' ? parseInt(q.offset, 10) : undefined;
    try {
      const { items, total } = await loadActiveBlackMarketListingsPage({
        excludeSellerId: userId,
        search,
        category,
        type,
        sortPrice,
        limit,
        offset
      });
      return res.status(200).json({ version: 1, items, total, limit: limit ?? 60, offset: offset ?? 0 });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/black-market/listings', e, 'Erro ao listar ofertas.');
    }
  });

  app.get('/api/black-market/my-listings', bmLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      const items = await loadMyActiveListings(userId);
      return res.status(200).json({ version: 1, items });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/black-market/my-listings', e, 'Erro.');
    }
  });

  app.get('/api/black-market/escrow', bmLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      const items = await loadCustodyForBuyer(userId);
      return res.status(200).json({ version: 1, items });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/black-market/escrow', e, 'Erro.');
    }
  });

  app.get('/api/black-market/history', bmLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 80;
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 80;
    try {
      const h = await loadP2pHistoryForUser(userId, limit);
      return res.status(200).json({ version: 1, limit, ...h });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/p2p_market_trade_history|does not exist|relation.*not exist/i.test(msg)) {
        return res.status(200).json({ version: 1, limit, purchases: [], sales: [] });
      }
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/black-market/history', e, 'Erro ao ler histórico.');
    }
  });

  /**
   * Compra de listing (`POST /api/black-market/listings/:id/buy`) — pendência de produto:
   * o módulo actual só expõe leitura (state/listings/escrow/history). Idempotência de compra
   * fica para quando existir rota transaccional dedicada (sem comportamento inventado aqui).
   */
}
