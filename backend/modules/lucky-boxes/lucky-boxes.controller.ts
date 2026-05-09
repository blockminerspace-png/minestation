import type { Application, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../../config/prisma.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import {
  executeLootBoxBuyInTransaction,
  executeLootBoxOpenInTransaction,
  LootBoxBuyError,
  LootBoxOpenError
} from '../../models/lootBoxModel.js';
import { assertEmailMatchesSession, bodyLootBoxId } from '../../validation/lootBoxValidation.js';
import { runPromoCodeRedeemInTransaction, type GrantAdminUpgradeRewardsFn } from '../../models/promoRedeemModel.js';
import { RoletaAppError, normalizePromoCode } from '../../validation/roletaValidation.js';
import { buildLuckyBoxesStateV1, getLuckyBoxOpeningForUser } from './lucky-boxes.state.service.js';
import {
  normalizeLuckyBoxIdempotencyKey,
  readLuckyBoxIdempotency,
  writeLuckyBoxIdempotency
} from './lucky-boxes.idempotency.js';
import type { LuckyBoxOpeningHistoryEntryV1 } from './lucky-boxes.types.js';

const lbLimiter = rateLimit({
  windowMs: 60_000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

export type LuckyBoxesModuleDeps = {
  authenticateToken: RequestHandler;
  appendGameActivityLog: (
    q: unknown,
    userId: number,
    action: string,
    meta: unknown
  ) => Promise<void>;
  grantAdminUpgradeRewards: GrantAdminUpgradeRewardsFn;
};

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapHistoryRow(
  o: {
    id: string;
    user_id: number;
    box_id: string;
    rewards_json: unknown;
    gained_usdc: { toString(): string } | unknown;
    created_at: bigint;
  },
  boxName: string
): LuckyBoxOpeningHistoryEntryV1 {
  const raw = o.rewards_json;
  const rewards = Array.isArray(raw)
    ? (raw as unknown[]).map((x) => {
        if (!x || typeof x !== 'object') return { type: 'unknown', id: '', qty: 0 };
        const r = x as Record<string, unknown>;
        return {
          type: typeof r.type === 'string' ? r.type : 'unknown',
          id: typeof r.id === 'string' ? r.id : '',
          qty: Math.max(0, Number(r.qty) || 0)
        };
      })
    : [];
  const g = o.gained_usdc;
  const gainedStr = g != null && typeof g === 'object' && 'toString' in g ? (g as { toString: () => string }).toString() : String(g ?? '0');
  return {
    id: o.id,
    at: Number(o.created_at),
    boxId: o.box_id,
    boxName,
    gainedUsdc: gainedStr,
    rewards
  };
}

export function registerLuckyBoxesModuleRoutes(app: Application, deps: LuckyBoxesModuleDeps): void {
  const { authenticateToken, appendGameActivityLog, grantAdminUpgradeRewards } = deps;

  app.get('/api/lucky-boxes/state', lbLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHORIZED' });
    try {
      const u = await prisma.users.findUnique({
        where: { id: userId },
        select: { id: true, is_blocked: true }
      });
      if (!u) return res.status(404).json({ error: 'Utilizador não encontrado.', code: 'NOT_FOUND' });
      if (u.is_blocked === 1) return res.status(403).json({ error: 'Conta bloqueada.', code: 'FORBIDDEN' });
      const dto = await buildLuckyBoxesStateV1(userId);
      return res.status(200).json(dto);
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/lucky-boxes/state', e, 'Não foi possível carregar as caixas.');
    }
  });

  app.get('/api/lucky-boxes/shop', lbLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      const st = await buildLuckyBoxesStateV1(userId);
      return res.status(200).json({ version: 1, shop: st.shop, shopEmptyMessage: st.shopEmptyMessage, usdc: st.usdc });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/lucky-boxes/shop', e, 'Erro ao listar a loja.');
    }
  });

  app.get('/api/lucky-boxes/inventory', lbLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      const st = await buildLuckyBoxesStateV1(userId);
      return res.status(200).json({ version: 1, inventory: st.inventory });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/lucky-boxes/inventory', e, 'Erro ao ler inventário.');
    }
  });

  app.get('/api/lucky-boxes/history', lbLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    const limRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 30;
    const offRaw = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;
    const limit = Number.isFinite(limRaw) ? Math.min(100, Math.max(1, limRaw)) : 30;
    const offset = Number.isFinite(offRaw) ? Math.min(10_000, Math.max(0, offRaw)) : 0;
    try {
      const rows = await prisma.lucky_box_openings.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit + 1
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const boxIds = [...new Set(page.map((r) => r.box_id))];
      const names =
        boxIds.length > 0
          ? await prisma.loot_boxes.findMany({ where: { id: { in: boxIds } }, select: { id: true, name: true } })
          : [];
      const nameMap = new Map(names.map((n) => [n.id, n.name]));
      const items: LuckyBoxOpeningHistoryEntryV1[] = page.map((o) =>
        mapHistoryRow(o, nameMap.get(o.box_id) || o.box_id)
      );
      return res.status(200).json({ version: 1, items, limit, offset, hasMore });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/lucky_box_openings|does not exist|relation.*not exist/i.test(msg)) {
        return res.status(200).json({ version: 1, items: [], limit, offset, hasMore: false });
      }
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/lucky-boxes/history', e, 'Erro ao ler histórico.');
    }
  });

  app.get('/api/lucky-boxes/openings/:openingId', lbLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    const openingId = String(req.params.openingId || '').trim();
    if (!openingId) return res.status(400).json({ error: 'ID inválido.' });
    try {
      const row = await getLuckyBoxOpeningForUser(userId, openingId);
      if (!row) return res.status(404).json({ error: 'Abertura não encontrada.' });
      return res.status(200).json({ version: 1, opening: row });
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/lucky-boxes/openings/:id', e, 'Erro.');
    }
  });

  app.post('/api/lucky-boxes/purchase', lbLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    const boxId = bodyLootBoxId(req.body);
    if (!boxId) return res.status(400).json({ error: 'Caixa inválida.' });
    const idem = normalizeLuckyBoxIdempotencyKey((req.body as { idempotencyKey?: unknown }).idempotencyKey);
    if (idem) {
      const cached = await readLuckyBoxIdempotency(userId, 'purchase', idem);
      if (cached != null && cached.http_status >= 200 && cached.http_status < 300) {
        try {
          return res.status(cached.http_status).json(JSON.parse(cached.body_json) as object);
        } catch {
          return res.status(cached.http_status).json({ ok: true, replay: true });
        }
      }
    }
    const body = req.body as { qty?: unknown; quantity?: unknown };
    const qtyRaw = body.quantity ?? body.qty;
    const qtyParsed =
      typeof qtyRaw === 'number' ? qtyRaw : typeof qtyRaw === 'string' ? parseInt(qtyRaw, 10) : NaN;
    const qty = Number.isFinite(qtyParsed) && qtyParsed >= 1 ? Math.floor(qtyParsed) : undefined;
    try {
      const emailGate = await assertEmailMatchesSession(
        prisma,
        userId,
        (req.body as { email?: unknown } | undefined)?.email
      );
      if (!emailGate.ok) return res.status(emailGate.status).json({ error: emailGate.error });

      const { newUsdc, boxName, trigger, price, qtyPurchased } = await prisma.$transaction(
        (tx) => executeLootBoxBuyInTransaction(tx, { userId, boxId, qty }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      await appendGameActivityLog(null, userId, 'lucky_box_purchase', {
        boxId,
        boxName,
        qtyPurchased,
        unitPriceUsdc: price,
        trigger
      });

      const payload = { ok: true, newUsdc, qtyPurchased, version: 1 as const };
      if (idem) await writeLuckyBoxIdempotency(userId, 'purchase', idem, 200, payload);
      return res.status(200).json(payload);
    } catch (err: unknown) {
      if (err instanceof LootBoxBuyError) {
        const bodyOut: Record<string, unknown> = { error: err.message, code: 'LUCKY_BOX_BUY' };
        if (err.missing != null) bodyOut.missing = err.missing;
        return res.status(err.statusCode).json(bodyOut);
      }
      return sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/lucky-boxes/purchase', err, 'Erro ao comprar.');
    }
  });

  app.post('/api/lucky-boxes/open', lbLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    const boxId = bodyLootBoxId(req.body);
    if (!boxId) return res.status(400).json({ error: 'Caixa inválida.' });
    const idem = normalizeLuckyBoxIdempotencyKey((req.body as { idempotencyKey?: unknown }).idempotencyKey);
    if (idem) {
      const cached = await readLuckyBoxIdempotency(userId, 'open', idem);
      if (cached != null && cached.http_status >= 200 && cached.http_status < 300) {
        try {
          return res.status(cached.http_status).json(JSON.parse(cached.body_json) as object);
        } catch {
          return res.status(cached.http_status).json({ ok: true, replay: true });
        }
      }
    }
    try {
      const emailGate = await assertEmailMatchesSession(
        prisma,
        userId,
        (req.body as { email?: unknown } | undefined)?.email
      );
      if (!emailGate.ok) return res.status(emailGate.status).json({ error: emailGate.error });

      const { rewards, gainedUsdc, boxName, openingId } = await prisma.$transaction(
        (tx) => executeLootBoxOpenInTransaction(tx, { userId, boxId, idempotencyKey: idem }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      await appendGameActivityLog(null, userId, 'lucky_box_open', {
        boxId,
        boxName,
        openingId,
        rewardCount: rewards.length,
        gainedUsdc
      });

      const payload = { ok: true, rewards, openingId, version: 1 as const };
      if (idem) await writeLuckyBoxIdempotency(userId, 'open', idem, 200, payload);
      return res.status(200).json(payload);
    } catch (err: unknown) {
      if (err instanceof LootBoxOpenError) {
        const bodyOut = { error: err.message, code: 'LUCKY_BOX_OPEN' };
        return res.status(err.statusCode).json(bodyOut);
      }
      return sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/lucky-boxes/open', err, 'Erro ao abrir.');
    }
  });

  app.post('/api/lucky-boxes/promocodes/redeem', lbLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (userId == null) return res.status(401).json({ error: 'Não autenticado.' });
    const normalizedCode = normalizePromoCode((req.body as { code?: unknown })?.code);
    if (!normalizedCode) return res.status(400).json({ error: 'Código inválido.' });
    const idem = normalizeLuckyBoxIdempotencyKey((req.body as { idempotencyKey?: unknown }).idempotencyKey);
    if (idem) {
      const cached = await readLuckyBoxIdempotency(userId, 'promo_redeem', idem);
      if (cached != null && cached.http_status >= 200 && cached.http_status < 300) {
        try {
          return res.status(cached.http_status).json(JSON.parse(cached.body_json) as object);
        } catch {
          return res.status(cached.http_status).json({ ok: true, replay: true });
        }
      }
    }
    const serverNowMs = Date.now();
    try {
      const outcome = await prisma.$transaction(
        (tx) =>
          runPromoCodeRedeemInTransaction(tx, {
            userId,
            normalizedCode,
            serverNowMs,
            grantAdminUpgradeRewards
          }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      if (outcome.kind === 'roleta_reentry') {
        await appendGameActivityLog(null, userId, 'promo_redeem_roleta_reentry', {
          code: outcome.code,
          serverAtMs: serverNowMs
        });
        const payload = { ok: true, type: 'roleta' as const, code: outcome.code, version: 1 as const };
        if (idem) await writeLuckyBoxIdempotency(userId, 'promo_redeem', idem, 200, payload);
        return res.json(payload);
      }

      if (outcome.kind === 'roleta_new') {
        await appendGameActivityLog(null, userId, 'promo_redeem_roleta', {
          code: outcome.code,
          redeemedAtMs: outcome.serverNowMs
        });
        const payload = { ok: true, type: 'roleta' as const, code: outcome.code, version: 1 as const };
        if (idem) await writeLuckyBoxIdempotency(userId, 'promo_redeem', idem, 200, payload);
        return res.json(payload);
      }

      await appendGameActivityLog(null, userId, 'promo_redeem', {
        code: normalizedCode,
        lootBoxId: outcome.lootBoxId,
        upgradeId: outcome.upgradeId,
        adminUpgradeId: outcome.adminUpgradeId,
        redeemedAtMs: serverNowMs
      });

      const payload = {
        ok: true,
        type: 'standard' as const,
        unopenedBoxes: outcome.unopenedBoxes,
        stock: outcome.stock,
        lootBoxId: outcome.lootBoxId,
        upgradeId: outcome.upgradeId,
        adminUpgradeId: outcome.adminUpgradeId,
        version: 1 as const
      };
      if (idem) await writeLuckyBoxIdempotency(userId, 'promo_redeem', idem, 200, payload);
      return res.json(payload);
    } catch (e) {
      if (e instanceof RoletaAppError) {
        const bodyOut = { error: e.message, code: 'PROMO_REDEEM' };
        return res.status(e.statusCode).json(bodyOut);
      }
      console.error('[POST /api/lucky-boxes/promocodes/redeem]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/lucky-boxes/promocodes/redeem', e, 'Erro interno.');
    }
  });
}
