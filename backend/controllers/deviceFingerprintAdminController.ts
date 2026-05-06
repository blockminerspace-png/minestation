import type { Express, Request, Response, RequestHandler } from 'express';
import { listDeviceFingerprintLogs } from '../models/deviceFingerprintModel.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

export type DeviceFingerprintAdminDeps = {
  isAdmin: RequestHandler;
};

export function registerDeviceFingerprintAdminRoutes(app: Express, deps: DeviceFingerprintAdminDeps): void {
  const { isAdmin } = deps;

  app.get('/api/admin/device-fingerprints', isAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
      const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
      const et = req.query.eventType;
      const eventType = et === 'login' || et === 'register' ? et : null;
      const uidRaw = req.query.userId;
      const userIdParsed =
        uidRaw != null && String(uidRaw).trim() !== '' ? Math.floor(Number(uidRaw)) : NaN;
      const userId = Number.isFinite(userIdParsed) && userIdParsed > 0 ? userIdParsed : null;
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;

      const { rows, total } = await listDeviceFingerprintLogs({
        limit,
        offset,
        eventType,
        userId,
        q
      });
      res.json({ rows, total, limit, offset });
    } catch (e: unknown) {
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/admin/device-fingerprints', e, 'Erro ao listar fingerprints.');
    }
  });
}
