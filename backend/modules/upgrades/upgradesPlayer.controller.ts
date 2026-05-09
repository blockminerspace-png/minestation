import type { Express, Request, RequestHandler, Response } from 'express';
import { parseIdempotencyKey, RoletaAppError } from '../../validation/roletaValidation.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { parseUpgradePackageId } from './upgrades.catalog.js';
import { buildUpgradesStatePayload } from './upgradesState.service.js';
import { runUpgradePackagePurchase } from './upgradesPurchase.service.js';
import { prisma } from '../../config/prisma.js';

export type UpgradesPlayerDeps = {
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

export function registerUpgradesPlayerRoutes(app: Express, deps: UpgradesPlayerDeps): void {
  const { authenticateToken, appendGameActivityLog } = deps;

  app.get('/api/upgrades/state', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      const payload = await buildUpgradesStatePayload(userId);
      return res.json(payload);
    } catch (e) {
      console.error('[upgrades/state]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/upgrades/state', e, 'Erro interno.');
    }
  });

  app.get('/api/upgrades/purchases', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    const lim = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
    try {
      const rows = await prisma.admin_upgrade_purchases.findMany({
        where: { user_id: userId },
        orderBy: { purchased_at: 'desc' },
        take: lim
      });
      const ids = [...new Set(rows.map((r) => r.upgrade_id))];
      const meta =
        ids.length > 0
          ? await prisma.admin_upgrades.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true, price_usdc: true, category: true, version: true }
            })
          : [];
      const metaById = new Map(meta.map((m) => [m.id, m]));
      return res.json({
        ok: true,
        purchases: rows.map((r) => {
          const m = metaById.get(r.upgrade_id);
          return {
            upgradeId: r.upgrade_id,
            purchasedAt: Number(r.purchased_at),
            name: m?.name ?? r.upgrade_id,
            chargedUsdc: m != null ? String(m.price_usdc) : null,
            category: m?.category ?? null,
            packageVersion: m?.version ?? null
          };
        })
      });
    } catch (e) {
      console.error('[upgrades/purchases]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/upgrades/purchases', e, 'Erro interno.');
    }
  });

  app.post('/api/upgrades/purchase', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) return res.status(401).json({ error: 'Não autenticado.' });
    const body = req.body as Record<string, unknown>;
    const idem = parseIdempotencyKey(body.idempotencyKey);
    if (!idem) {
      return res.status(400).json({ error: 'idempotencyKey inválido ou ausente (8–128 caracteres seguros).' });
    }
    const pkg = parseUpgradePackageId(body.packageId);
    if (!pkg) {
      return res.status(400).json({ error: 'packageId inválido.' });
    }
    const clientVRaw = body.clientPackageVersion;
    const clientPackageVersion =
      clientVRaw == null || clientVRaw === ''
        ? null
        : typeof clientVRaw === 'number'
          ? clientVRaw
          : parseInt(String(clientVRaw), 10);
    const clientPackageVersionNorm =
      clientPackageVersion != null && Number.isFinite(clientPackageVersion) ? clientPackageVersion : null;

    try {
      const out = await runUpgradePackagePurchase({
        userId,
        packageIdRaw: pkg,
        idempotencyKey: idem,
        clientPackageVersion: clientPackageVersionNorm
      });

      if (!out.idempotentReplay) {
        await appendGameActivityLog(null, userId, 'upgrade_package_purchase', {
          packageId: pkg,
          newUsdc: out.newUsdc,
          packageVersion: out.packageVersion
        });
      }

      return res.json(out);
    } catch (e) {
      if (e instanceof RoletaAppError) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      console.error('[upgrades/purchase]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/upgrades/purchase', e, 'Erro interno.');
    }
  });
}
