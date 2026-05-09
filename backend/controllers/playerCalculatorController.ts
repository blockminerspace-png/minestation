import type { Express, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/prisma.js';
import {
  loadPlayerCalculatorSnapshot,
  PlayerCalculatorScopeError
} from '../services/playerCalculatorService.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

const calculatorMeLimiter = rateLimit({
  windowMs: 60_000,
  max: 45,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos à calculadora. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

export type PlayerCalculatorControllerDeps = {
  authenticateToken: (req: Request, res: Response, next: () => void) => void;
};

/**
 * GET `/api/calculator/me?scope=total|roomId` — projeções de mineração a partir da BD e do runtime de rede.
 * O jogador vem só da sessão; `scope` é validado contra salas/rigs do utilizador.
 */
export function registerPlayerCalculatorRoutes(app: Express, deps: PlayerCalculatorControllerDeps): void {
  const { authenticateToken } = deps;

  app.get('/api/calculator/me', calculatorMeLimiter, authenticateToken, async (req: Request, res: Response) => {
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

      const scopeRaw =
        typeof req.query.scope === 'string'
          ? req.query.scope
          : Array.isArray(req.query.scope)
            ? String(req.query.scope[0] ?? '')
            : undefined;

      const snap = await loadPlayerCalculatorSnapshot(userId, scopeRaw);
      return res.json({ ok: true, ...snap });
    } catch (e) {
      if (e instanceof PlayerCalculatorScopeError) {
        return res.status(e.statusCode).json({ error: e.message, code: e.code });
      }
      console.error('[calculator/me]', e instanceof Error ? e.message : String(e));
      return sendInternalErrorSafeMessageOrPrisma(res, 'calculator/me', e, 'Não foi possível carregar a calculadora.');
    }
  });
}
