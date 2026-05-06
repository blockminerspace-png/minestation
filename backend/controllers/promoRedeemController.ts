import type { Express, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { runPromoCodeRedeemInTransaction, type GrantAdminUpgradeRewardsFn } from '../models/promoRedeemModel.js';
import { RoletaAppError, normalizePromoCode } from '../validation/roletaValidation.js';
import { sendInternalErrorSafeMessage } from '../utils/apiErrorResponse.js';

export type PromoRedeemDeps = {
  parseCookies: (req: Request) => { sid?: string };
  grantAdminUpgradeRewards: GrantAdminUpgradeRewardsFn;
  appendGameActivityLog: (
    q: unknown,
    userId: number,
    action: string,
    meta: unknown
  ) => Promise<void>;
};

async function resolveRedeemUserId(
  req: Request,
  tx: Prisma.TransactionClient,
  parseCookies: PromoRedeemDeps['parseCookies'],
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

export function registerPromoRedeemRoutes(app: Express, deps: PromoRedeemDeps): void {
  const { parseCookies, grantAdminUpgradeRewards, appendGameActivityLog } = deps;

  app.post('/api/redeem-code', async (req: Request, res: Response) => {
    const normalizedCode = normalizePromoCode((req.body as { code?: unknown })?.code);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const serverNowMs = Date.now();
    try {
      const { userId, outcome } = await prisma.$transaction(
        async (tx) => {
          const uid = await resolveRedeemUserId(req, tx, parseCookies, serverNowMs);
          const result = await runPromoCodeRedeemInTransaction(tx, {
            userId: uid,
            normalizedCode,
            serverNowMs,
            grantAdminUpgradeRewards
          });
          return { userId: uid, outcome: result };
        },
        { timeout: 60_000, maxWait: 10_000 }
      );

      if (outcome.kind === 'roleta_reentry') {
        await appendGameActivityLog(null, userId, 'promo_redeem_roleta_reentry', {
          code: outcome.code,
          serverAtMs: serverNowMs
        });
        return res.json({ ok: true, type: 'roleta', code: outcome.code });
      }

      if (outcome.kind === 'roleta_new') {
        await appendGameActivityLog(null, userId, 'promo_redeem_roleta', {
          code: outcome.code,
          redeemedAtMs: outcome.serverNowMs
        });
        return res.json({ ok: true, type: 'roleta', code: outcome.code });
      }

      await appendGameActivityLog(null, userId, 'promo_redeem', {
        code: normalizedCode,
        lootBoxId: outcome.lootBoxId,
        upgradeId: outcome.upgradeId,
        adminUpgradeId: outcome.adminUpgradeId,
        redeemedAtMs: serverNowMs
      });

      return res.json({
        ok: true,
        unopenedBoxes: outcome.unopenedBoxes,
        stock: outcome.stock,
        lootBoxId: outcome.lootBoxId,
        upgradeId: outcome.upgradeId,
        adminUpgradeId: outcome.adminUpgradeId
      });
    } catch (e) {
      if (e instanceof RoletaAppError) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[redeem-code]', e);
      sendInternalErrorSafeMessage(res, 'POST /api/promo/redeem', e, 'Erro interno.');
      return;
    }
  });
}
