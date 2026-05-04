import type { Express, Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { runPromoCodeRedeemInTransaction, type GrantAdminUpgradeRewardsFn } from '../models/promoRedeemModel.js';
import { RoletaAppError, normalizePromoCode } from '../validation/roletaValidation.js';
import { sendInternalErrorSafeMessage } from '../utils/apiErrorResponse.js';

export type PromoRedeemDeps = {
  pool: Pool;
  parseCookies: (req: Request) => { sid?: string };
  grantAdminUpgradeRewards: GrantAdminUpgradeRewardsFn;
  appendGameActivityLog: (
    q: Pool | PoolClient,
    userId: number,
    action: string,
    meta: unknown
  ) => Promise<void>;
};

async function resolveRedeemUserId(
  req: Request,
  client: PoolClient,
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
  const sRes = await client.query(
    `SELECT user_id FROM sessions WHERE session_id = $1 AND expires_at > $2`,
    [sid, serverNow]
  );
  const uid = sRes.rows[0]?.user_id as number | undefined;
  if (!uid) {
    throw new RoletaAppError('Auth failed', 401);
  }
  return uid;
}

export function registerPromoRedeemRoutes(app: Express, deps: PromoRedeemDeps): void {
  const { pool, parseCookies, grantAdminUpgradeRewards, appendGameActivityLog } = deps;

  app.post('/api/redeem-code', async (req: Request, res: Response) => {
    const normalizedCode = normalizePromoCode((req.body as { code?: unknown })?.code);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const serverNowMs = Date.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userId = await resolveRedeemUserId(req, client, parseCookies, serverNowMs);

      const outcome = await runPromoCodeRedeemInTransaction(client, {
        userId,
        normalizedCode,
        serverNowMs,
        grantAdminUpgradeRewards
      });

      if (outcome.kind === 'roleta_reentry') {
        await client.query('ROLLBACK');
        await appendGameActivityLog(pool, userId, 'promo_redeem_roleta_reentry', {
          code: outcome.code,
          serverAtMs: serverNowMs
        });
        return res.json({ ok: true, type: 'roleta', code: outcome.code });
      }

      await client.query('COMMIT');

      if (outcome.kind === 'roleta_new') {
        await appendGameActivityLog(pool, userId, 'promo_redeem_roleta', {
          code: outcome.code,
          redeemedAtMs: outcome.serverNowMs
        });
        return res.json({ ok: true, type: 'roleta', code: outcome.code });
      }

      await appendGameActivityLog(pool, userId, 'promo_redeem', {
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
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (e instanceof RoletaAppError) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[redeem-code]', e);
      sendInternalErrorSafeMessage(res, 'POST /api/promo/redeem', e, 'Erro interno.');
      return;
    } finally {
      client.release();
    }
  });
}
