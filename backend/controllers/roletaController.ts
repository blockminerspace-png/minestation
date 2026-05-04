import type { Express, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { wheelRollInTransaction, roletaClaimInTransaction } from '../models/roletaModel.js';
import {
  RoletaAppError,
  normalizePromoCode,
  parseWonItemId
} from '../validation/roletaValidation.js';

export type RoletaPlayerDeps = {
  pool: Pool;
  authenticateToken: RequestHandler;
  appendGameActivityLog: (
    q: Pool | import('pg').PoolClient,
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
  const { pool, authenticateToken, appendGameActivityLog } = deps;

  /** Código de roleta já resgatado mas ainda sem prémio finalizado (girar/reivindicar). */
  app.get('/api/roleta/pending-code', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Auth failed' });
    }
    try {
      const r = await pool.query(
        `SELECT r.code
         FROM promo_code_redemptions r
         INNER JOIN promo_codes p ON p.code = r.code
         LEFT JOIN loot_boxes lb ON lb.id = p.loot_box_id
         WHERE r.user_id = $1
           AND r.reward_granted = 0
           AND (
             p.type LIKE 'roleta_%'
             OR lb.trigger = 'roleta_code'
           )
         ORDER BY r.redeemed_at DESC NULLS LAST
         LIMIT 1`,
        [userId]
      );
      const row = r.rows[0] as { code?: string } | undefined;
      const code = row?.code != null ? String(row.code).trim() : '';
      return res.json({ code: code || null });
    } catch (e) {
      console.error('[Roleta pending-code]', e);
      return res.status(500).json({ error: 'Erro interno' });
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await wheelRollInTransaction(client, {
        userId,
        normalizedCode,
        serverNowMs
      });
      await client.query('COMMIT');

      if (!result.idempotent) {
        await appendGameActivityLog(pool, userId, 'roleta_roll', {
          code: normalizedCode,
          wonItemId: result.wonItemId,
          serverAtMs: serverNowMs
        });
      }

      return res.json({ ok: true, wonItemId: result.wonItemId, item: result.item });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (e instanceof RoletaAppError) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[Wheel Roll]', e);
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Erro interno' });
    } finally {
      client.release();
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await roletaClaimInTransaction(client, {
        userId,
        normalizedCode,
        wonItemId,
        serverNowMs
      });
      await client.query('COMMIT');

      await appendGameActivityLog(pool, userId, 'roleta_claim', {
        code: normalizedCode,
        wonItemId,
        boxId: result.boxId,
        serverAtMs: serverNowMs
      });

      return res.json({ ok: true, boxId: result.boxId });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (e instanceof RoletaAppError) {
        if (e.statusCode === 403) {
          console.warn('[Roleta Security] claim rejected', { userId, normalizedCode, message: e.message });
        }
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[Roleta Claim]', e);
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Erro interno' });
    } finally {
      client.release();
    }
  });
}
