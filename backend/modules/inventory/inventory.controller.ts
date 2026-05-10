import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../../config/prisma.js';
import { buildInventoryStateV1 } from './inventory.snapshot.service.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';

const inventoryStateLimiter = rateLimit({
  windowMs: 60_000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos de inventário. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

export type InventoryModuleDeps = {
  authenticateToken: (req: Request, res: Response, next: () => void) => void;
  pool: Pool;
};

/**
 * Rotas do monólito modular — inventário.
 * `GET /api/inventory/me` permanece em `inventoryController.ts` (compat).
 */
export function registerInventoryModuleRoutes(app: Express, deps: InventoryModuleDeps): void {
  const { authenticateToken, pool } = deps;

  app.get('/api/inventory/state', inventoryStateLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHORIZED' });
    }
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Sessão inválida.', code: 'UNAUTHORIZED' });
    }

    try {
      const u = await prisma.users.findUnique({
        where: { id: userId },
        select: { id: true, is_blocked: true }
      });
      if (!u) {
        return res.status(404).json({ error: 'Utilizador não encontrado.', code: 'NOT_FOUND' });
      }
      if (u.is_blocked === 1) {
        return res.status(403).json({ error: 'Conta bloqueada.', code: 'FORBIDDEN' });
      }

      const dto = await buildInventoryStateV1(pool, userId);
      return res.status(200).json(dto);
    } catch (e) {
      return sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/inventory/state',
        e,
        'Não foi possível carregar o inventário.'
      );
    }
  });
}
