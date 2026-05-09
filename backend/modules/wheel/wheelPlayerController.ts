import type { Express, Request, RequestHandler, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { runPromoCodeRedeemInTransaction, type GrantAdminUpgradeRewardsFn } from '../../models/promoRedeemModel.js';
import {
  fetchWheelPrizesForApiConfig,
  fetchWheelRuntimeConfig,
  paidWheelSpinAtomicInTransaction,
  queryWheelPrizeByItemIdJoined
} from '../../models/roletaModel.js';
import {
  RoletaAppError,
  normalizePromoCode,
  parseIdempotencyKey
} from '../../validation/roletaValidation.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import {
  wheelAcquireAdvisoryLock,
  wheelAdvisoryLockKey64,
  wheelIdempotencyGetJson,
  wheelIdempotencyPutJson
} from '../../models/wheelIdempotency.js';

export type WheelPlayerDeps = {
  authenticateToken: RequestHandler;
  appendGameActivityLog: (
    q: unknown,
    userId: number,
    action: string,
    meta: unknown
  ) => Promise<void>;
  grantAdminUpgradeRewards: GrantAdminUpgradeRewardsFn;
  parseCookies: (req: Request) => { sid?: string };
};

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resolveRedeemUserIdWheel(
  req: Request,
  tx: Prisma.TransactionClient,
  parseCookies: WheelPlayerDeps['parseCookies'],
  serverNow: number
): Promise<number> {
  const v = req.userId;
  if (v != null) {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const sid = parseCookies(req).sid;
  if (!sid) {
    throw new RoletaAppError('Auth failed', 401);
  }
  const row = await tx.sessions.findFirst({
    where: {
      session_id: sid,
      expires_at: { gt: BigInt(serverNow) }
    },
    select: { user_id: true }
  });
  const uid = row?.user_id;
  if (uid == null) {
    throw new RoletaAppError('Auth failed', 401);
  }
  return uid;
}

function parseLimit(raw: unknown, max: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(Math.floor(n), max);
}

export function registerWheelPlayerRoutes(app: Express, deps: WheelPlayerDeps): void {
  const { authenticateToken, appendGameActivityLog, grantAdminUpgradeRewards, parseCookies } = deps;

  app.get('/api/wheel/state', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      const cfg = await fetchWheelRuntimeConfig();
      const prizes = await fetchWheelPrizesForApiConfig();
      const gs = await prisma.game_states.findUnique({
        where: { user_id: userId },
        select: { usdc: true }
      });
      const usdc = gs?.usdc != null ? Number(gs.usdc) : 0;
      const legacyPend = await prisma.wheel_paid_pending.findUnique({
        where: { user_id: userId },
        select: { won_item_id: true }
      });
      const legacyPaidPending =
        legacyPend?.won_item_id != null && String(legacyPend.won_item_id).trim()
          ? { wonItemId: String(legacyPend.won_item_id).trim() }
          : null;
      const recent = await prisma.wheel_spins.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 8,
        select: {
          id: true,
          kind: true,
          won_item_id: true,
          charged_usdc: true,
          status: true,
          created_at: true
        }
      });
      const history = await Promise.all(
        recent.map(async (r) => {
          const item = await queryWheelPrizeByItemIdJoined(prisma, String(r.won_item_id));
          return {
            spinId: r.id,
            kind: r.kind,
            wonItemId: r.won_item_id,
            label: item?.label ?? r.won_item_id,
            chargedUsdc: r.charged_usdc != null ? Number(r.charged_usdc) : null,
            status: r.status,
            createdAtMs: String(r.created_at)
          };
        })
      );
      return res.json({
        ok: true,
        config: cfg,
        spinPriceUsdc: cfg.spinPriceUsdc,
        usdcBalance: usdc,
        legacyPaidPending,
        prizes,
        history,
        notice:
          'A roleta entrega apenas recompensas básicas de baixo impacto. O sorteio e o preço são definidos no servidor.'
      });
    } catch (e) {
      console.error('[wheel/state]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/wheel/state', e, 'Erro interno.');
    }
  });

  app.post('/api/wheel/spin', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    const idem = parseIdempotencyKey((req.body as { idempotencyKey?: unknown })?.idempotencyKey);
    if (!idem) {
      return res.status(400).json({ error: 'idempotencyKey inválido ou ausente (8–128 caracteres seguros).' });
    }
    const serverNowMs = Date.now();
    try {
      const result = await prisma.$transaction(
        async (tx) =>
          paidWheelSpinAtomicInTransaction(tx, {
            userId,
            serverNowMs,
            idempotencyKey: idem
          }),
        { timeout: 60_000, maxWait: 10_000 }
      );
      if (!result.idempotentReplay) {
        await appendGameActivityLog(null, userId, 'wheel_paid_spin_atomic', {
          spinId: result.spinId,
          wonItemId: result.wonItemId,
          chargedUsdc: result.chargedUsdc,
          boxId: result.boxId,
          serverAtMs: serverNowMs
        });
      }
      return res.json({
        ok: true,
        spinId: result.spinId,
        wonItemId: result.wonItemId,
        item: result.item,
        newUsdc: result.newUsdc,
        chargedUsdc: result.chargedUsdc,
        boxId: result.boxId,
        boxName: result.boxName,
        idempotentReplay: result.idempotentReplay
      });
    } catch (e) {
      if (e instanceof RoletaAppError) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      if (e && typeof e === 'object' && String((e as { code?: unknown }).code) === 'P2002') {
        return res.status(409).json({ error: 'Pedido em conflito ou duplicado. Recarrega o estado da roleta.' });
      }
      console.error('[wheel/spin]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/wheel/spin', e, 'Erro interno.');
    }
  });

  app.post('/api/wheel/redeem-code', authenticateToken, async (req: Request, res: Response) => {
    const normalizedCode = normalizePromoCode((req.body as { code?: unknown })?.code);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Código inválido.' });
    }
    const idem = parseIdempotencyKey((req.body as { idempotencyKey?: unknown })?.idempotencyKey);
    if (!idem) {
      return res.status(400).json({ error: 'idempotencyKey inválido ou ausente (8–128 caracteres seguros).' });
    }
    const serverNowMs = Date.now();
    try {
      const payload = await prisma.$transaction(
        async (tx) => {
          const uid = await resolveRedeemUserIdWheel(req, tx, parseCookies, serverNowMs);
          const lockKey = wheelAdvisoryLockKey64(uid, 'wheel_redeem_code', idem);
          await wheelAcquireAdvisoryLock(tx, lockKey);
          const cached = await wheelIdempotencyGetJson(tx, uid, 'wheel_redeem_code', idem);
          if (cached) {
            try {
              return JSON.parse(cached) as Record<string, unknown>;
            } catch {
              /* continuar */
            }
          }
          const outcome = await runPromoCodeRedeemInTransaction(tx, {
            userId: uid,
            normalizedCode,
            serverNowMs,
            grantAdminUpgradeRewards
          });
          let body: Record<string, unknown>;
          if (outcome.kind === 'roleta_reentry' || outcome.kind === 'roleta_new') {
            body = { ok: true, type: 'roleta', code: outcome.code };
          } else {
            body = {
              ok: true,
              unopenedBoxes: outcome.unopenedBoxes,
              stock: outcome.stock,
              lootBoxId: outcome.lootBoxId,
              upgradeId: outcome.upgradeId,
              adminUpgradeId: outcome.adminUpgradeId
            };
          }
          await wheelIdempotencyPutJson(tx, {
            userId: uid,
            scope: 'wheel_redeem_code',
            idempotencyKey: idem,
            responseJson: JSON.stringify(body),
            createdAtMs: BigInt(serverNowMs)
          });
          return body;
        },
        { timeout: 60_000, maxWait: 10_000 }
      );

      const userId = uidNum(req);
      if (userId && payload.ok === true && payload.type === 'roleta') {
        await appendGameActivityLog(null, userId, 'wheel_redeem_code', {
          code: normalizedCode,
          serverAtMs: serverNowMs
        });
      }
      return res.json(payload);
    } catch (e) {
      if (e instanceof RoletaAppError) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[wheel/redeem-code]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/wheel/redeem-code', e, 'Erro interno.');
    }
  });

  app.get('/api/wheel/history', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    const limit = parseLimit(req.query.limit, 50);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';
    try {
      const rows = await prisma.wheel_spins.findMany({
        where: {
          user_id: userId,
          ...(cursor
            ? {
                created_at: { lt: BigInt(cursor) }
              }
            : {})
        },
        orderBy: { created_at: 'desc' },
        take: limit + 1,
        select: {
          id: true,
          kind: true,
          code: true,
          won_item_id: true,
          box_id: true,
          charged_usdc: true,
          status: true,
          created_at: true
        }
      });
      const page = rows.slice(0, limit);
      const next = rows.length > limit ? String(page[page.length - 1]!.created_at) : null;
      const items = await Promise.all(
        page.map(async (r) => {
          const item = await queryWheelPrizeByItemIdJoined(prisma, String(r.won_item_id));
          return {
            spinId: r.id,
            kind: r.kind,
            code: r.code,
            wonItemId: r.won_item_id,
            label: item?.label ?? r.won_item_id,
            boxId: r.box_id,
            chargedUsdc: r.charged_usdc != null ? Number(r.charged_usdc) : null,
            status: r.status,
            createdAtMs: String(r.created_at)
          };
        })
      );
      return res.json({ ok: true, items, nextCursor: next });
    } catch (e) {
      console.error('[wheel/history]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/wheel/history', e, 'Erro interno.');
    }
  });

  app.get('/api/wheel/spins/:spinId', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    const spinId = typeof req.params.spinId === 'string' ? req.params.spinId.trim() : '';
    if (!spinId || spinId.length > 80) {
      return res.status(400).json({ error: 'spinId inválido.' });
    }
    try {
      const r = await prisma.wheel_spins.findFirst({
        where: { id: spinId, user_id: userId },
        select: {
          id: true,
          kind: true,
          code: true,
          won_item_id: true,
          box_id: true,
          charged_usdc: true,
          status: true,
          created_at: true
        }
      });
      if (!r) return res.status(404).json({ error: 'Giro não encontrado.' });
      const item = await queryWheelPrizeByItemIdJoined(prisma, String(r.won_item_id));
      return res.json({
        ok: true,
        spin: {
          spinId: r.id,
          kind: r.kind,
          code: r.code,
          wonItemId: r.won_item_id,
          label: item?.label ?? r.won_item_id,
          boxId: r.box_id,
          chargedUsdc: r.charged_usdc != null ? Number(r.charged_usdc) : null,
          status: r.status,
          createdAtMs: String(r.created_at)
        }
      });
    } catch (e) {
      console.error('[wheel/spins/:id]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/wheel/spins/:spinId', e, 'Erro interno.');
    }
  });
}
