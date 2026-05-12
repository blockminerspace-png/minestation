import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/prisma.js';
import { loadPlayerInventorySnapshot } from '../services/inventorySnapshotService.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

const inventoryMeLimiter = rateLimit({
  windowMs: 60_000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos de inventário. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

export type InventoryControllerDeps = {
  authenticateToken: (req: Request, res: Response, next: () => void) => void;
  pool: Pool;
};

/**
 * GET `/api/inventory/me` — leitura autoritária do depósito (stock + baterias em armazém),
 * com baterias separadas em carregadas (≥99,9% ou infinitas) vs parciais.
 * O `userId` vem sempre da sessão verificada; parâmetros de URL/query são ignorados para o dono do recurso.
 */
export function registerInventoryRoutes(app: Express, deps: InventoryControllerDeps): void {
  const { authenticateToken, pool } = deps;

  app.get('/api/inventory/me', inventoryMeLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Sessão inválida.', code: 'AUTH_REQUIRED' });
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

      const snap = await loadPlayerInventorySnapshot(pool, userId);
      console.info('[inventory/me]', {
        userId,
        nBatteries: snap.storedBatteries.length
      });

      return res.json({
        ok: true,
        stock: snap.stock,
        storedBatteries: snap.storedBatteries,
        serverUpdatedAt: snap.serverUpdatedAt
      });
    } catch (e) {
      console.error('[inventory/me]', e instanceof Error ? e.message : String(e));
      return sendInternalErrorSafeMessageOrPrisma(res, 'inventory/me', e, 'Não foi possível carregar o inventário.');
    }
  });
}
