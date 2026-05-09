import type { Express, Request, RequestHandler, Response } from 'express';
import { prisma } from '../config/prisma.js';
import {
  wheelRollInTransaction,
  roletaClaimInTransaction,
  paidWheelRollInTransaction,
  paidWheelClaimInTransaction,
  fetchPaidWheelSpinPriceUsdcNumber
} from '../models/roletaModel.js';
import {
  RoletaAppError,
  normalizePromoCode,
  parseWonItemId
} from '../validation/roletaValidation.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

export type RoletaPlayerDeps = {
  authenticateToken: RequestHandler;
  appendGameActivityLog: (
    q: unknown,
    userId: number,
    action: string,
    meta: unknown
  ) => Promise<void>;
};

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function registerRoletaPlayerRoutes(app: Express, deps: RoletaPlayerDeps): void {
  const { authenticateToken, appendGameActivityLog } = deps;

  /** Código de roleta já resgatado mas ainda sem prémio finalizado (girar/reivindicar). */
  app.get('/api/roleta/pending-code', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Auth failed' });
    }
    try {
      const r = await prisma.$queryRaw<Array<{ code: string }>>`
        SELECT r.code
        FROM promo_code_redemptions r
        INNER JOIN promo_codes p ON p.code = r.code
        LEFT JOIN loot_boxes lb ON lb.id = p.loot_box_id
        WHERE r.user_id = ${userId}
          AND r.reward_granted = 0
          AND (
            p.type LIKE 'roleta_%'
            OR lb.trigger = 'roleta_code'
          )
        ORDER BY r.redeemed_at DESC NULLS LAST
        LIMIT 1
      `;
      const row = r[0];
      const code = row?.code != null ? String(row.code).trim() : '';
      return res.json({ code: code || null });
    } catch (e) {
      console.error('[Roleta pending-code]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/roleta/pending-code', e, 'Erro interno.');
      return;
    }
  });

  app.post('/api/wheel/roll', authenticateToken, async (req: Request, res: Response) => {
    const normalizedCode = normalizePromoCode((req.body as { code?: unknown })?.code);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Código inválido ou ausente.' });
    }
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Auth failed' });
    }

    const serverNowMs = Date.now();
    try {
      const result = await prisma.$transaction(
        async (tx) =>
          wheelRollInTransaction(tx, {
            userId,
            normalizedCode,
            serverNowMs
          }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      if (!result.idempotent) {
        await appendGameActivityLog(null, userId, 'roleta_roll', {
          code: normalizedCode,
          wonItemId: result.wonItemId,
          serverAtMs: serverNowMs
        });
      }

      return res.json({ ok: true, wonItemId: result.wonItemId, item: result.item });
    } catch (e) {
      if (e instanceof RoletaAppError) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[Wheel Roll]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/wheel/roll', e, 'Erro interno.');
      return;
    }
  });

  /** Prémio da roleta paga (US$1) ainda por resgatar — para retomar UI após recarregar. */
  app.get('/api/wheel/paid-pending', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Auth failed' });
    }
    try {
      const row = await prisma.wheel_paid_pending.findUnique({
        where: { user_id: userId },
        select: { won_item_id: true }
      });
      const won = row?.won_item_id;
      const wonItemId = won != null && String(won).trim() ? String(won).trim() : null;
      return res.json({ pending: Boolean(wonItemId), wonItemId });
    } catch (e) {
      console.error('[Wheel paid-pending]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/wheel/paid-pending', e, 'Erro interno.');
      return;
    }
  });

  app.post('/api/wheel/paid-roll', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Auth failed' });
    }
    const serverNowMs = Date.now();
    try {
      const result = await prisma.$transaction(
        async (tx) => paidWheelRollInTransaction(tx, { userId, serverNowMs }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      if (!result.idempotent) {
        await appendGameActivityLog(null, userId, 'roleta_paid_roll', {
          wonItemId: result.wonItemId,
          chargedUsdc: result.chargedUsdc,
          newUsdc: result.newUsdc,
          serverAtMs: serverNowMs
        });
      }

      const spinPriceUsdc = await fetchPaidWheelSpinPriceUsdcNumber();
      return res.json({
        ok: true,
        wonItemId: result.wonItemId,
        item: result.item,
        newUsdc: result.newUsdc,
        idempotent: result.idempotent,
        spinPriceUsdc
      });
    } catch (e) {
      if (e instanceof RoletaAppError) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[Wheel paid-roll]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/wheel/paid-roll', e, 'Erro interno.');
      return;
    }
  });

  app.post('/api/wheel/paid-claim', authenticateToken, async (req: Request, res: Response) => {
    const wonItemId = parseWonItemId((req.body as { wonItemId?: unknown })?.wonItemId);
    if (!wonItemId) {
      return res.status(400).json({ error: 'Dados inválidos ou campos obrigatórios ausentes.' });
    }
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Auth failed' });
    }

    const serverNowMs = Date.now();
    try {
      const result = await prisma.$transaction(
        async (tx) => paidWheelClaimInTransaction(tx, { userId, wonItemId }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      await appendGameActivityLog(null, userId, 'roleta_paid_claim', {
        wonItemId,
        boxId: result.boxId,
        serverAtMs: serverNowMs
      });

      return res.json({ ok: true, boxId: result.boxId });
    } catch (e) {
      if (e instanceof RoletaAppError) {
        if (e.statusCode === 403) {
          console.warn('[Roleta paid-claim] rejected', { userId, wonItemId, message: e.message });
        }
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[Wheel paid-claim]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/wheel/paid-claim', e, 'Erro interno.');
      return;
    }
  });

  app.post('/api/roleta/claim', authenticateToken, async (req: Request, res: Response) => {
    const body = req.body as { code?: unknown; wonItemId?: unknown };
    const normalizedCode = normalizePromoCode(body?.code);
    const wonItemId = parseWonItemId(body?.wonItemId);
    if (!normalizedCode || !wonItemId) {
      return res.status(400).json({ error: 'Dados inválidos ou campos obrigatórios ausentes.' });
    }
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Auth failed' });
    }

    const serverNowMs = Date.now();
    try {
      const result = await prisma.$transaction(
        async (tx) =>
          roletaClaimInTransaction(tx, {
            userId,
            normalizedCode,
            wonItemId,
            serverNowMs
          }),
        { timeout: 60_000, maxWait: 10_000 }
      );

      await appendGameActivityLog(null, userId, 'roleta_claim', {
        code: normalizedCode,
        wonItemId,
        boxId: result.boxId,
        serverAtMs: serverNowMs
      });

      return res.json({ ok: true, boxId: result.boxId });
    } catch (e) {
      if (e instanceof RoletaAppError) {
        if (e.statusCode === 403) {
          console.warn('[Roleta Security] claim rejected', { userId, normalizedCode, message: e.message });
        }
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[Roleta Claim]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/roleta/claim', e, 'Erro interno.');
      return;
    }
  });
}
