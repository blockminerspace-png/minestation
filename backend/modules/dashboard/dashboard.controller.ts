/**
 * Rotas da Dashboard principal (`/api/dashboard/...`).
 *
 * Segue o padrão dos outros módulos do projeto:
 *  - middleware `authenticateToken` (cookie/JWT já resolvido em `req.userId`);
 *  - `uidNum(req)` para obter `userId` validado;
 *  - `sendInternalErrorSafeMessageOrPrisma` para erros internos com mensagem segura.
 */

import type { Express, Request, RequestHandler, Response } from 'express';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { buildDashboardStatePayload } from './dashboard.service.js';

export type DashboardModuleDeps = {
  authenticateToken: RequestHandler;
};

function uidNum(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function registerDashboardModuleRoutes(app: Express, deps: DashboardModuleDeps): void {
  const { authenticateToken } = deps;

  app.get('/api/dashboard/state', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }
    try {
      const payload = await buildDashboardStatePayload(userId);
      return res.json(payload);
    } catch (e) {
      console.error('[dashboard/state]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/dashboard/state',
        e,
        'Não foi possível carregar a dashboard agora.'
      );
    }
  });
}
