/**
 * Rotas do check-in diário (`/api/checkin/...`).
 *
 *  - GET  `/api/checkin/status` → snapshot (idempotente).
 *  - POST `/api/checkin`        → tenta aplicar check-in para hoje BRT.
 *
 * Segue o mesmo padrão dos outros módulos (Dashboard, Profile):
 *  - middleware `authenticateToken` recebido por dependency injection;
 *  - `uidNum` para resolver o `userId`;
 *  - `sendInternalErrorSafeMessageOrPrisma` para erros não previstos.
 */

import type { Express, Request, RequestHandler, Response } from 'express';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { getCheckinStatus, performCheckin } from './checkin.service.js';

export type CheckinModuleDeps = {
  authenticateToken: RequestHandler;
};

function uidNum(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function registerCheckinModuleRoutes(app: Express, deps: CheckinModuleDeps): void {
  const { authenticateToken } = deps;

  app.get('/api/checkin/status', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }
    try {
      const status = await getCheckinStatus(userId);
      return res.json({ ok: true, ...status });
    } catch (e) {
      console.error('[checkin/status]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/checkin/status',
        e,
        'Não foi possível ler o estado do check-in agora.'
      );
    }
  });

  app.post('/api/checkin', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }
    try {
      const result = await performCheckin(userId);
      return res.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'GAME_STATE_NOT_FOUND') {
        return res.status(404).json({
          error: 'Estado de jogo não encontrado para este utilizador.',
          code: 'GAME_STATE_NOT_FOUND'
        });
      }
      console.error('[checkin/perform]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'POST /api/checkin',
        e,
        'Não foi possível registar o check-in agora.'
      );
    }
  });
}
