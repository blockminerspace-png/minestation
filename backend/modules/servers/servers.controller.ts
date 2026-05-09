import type { Application, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { buildServersAuthoritativeStateDto } from './servers.snapshot.service.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';

export type ServersModuleDeps = {
  prisma: PrismaClient;
  pool: Pool;
};

/**
 * Rotas REST do monólito modular — área Servidores.
 * Mantém compatibilidade com rotas legadas (`/api/my-rig-rooms`, `game-state`, etc.).
 */
export function registerServersModuleRoutes(app: Application, deps: ServersModuleDeps): void {
  const { prisma, pool } = deps;

  app.get('/api/servers/state', async (req: Request, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
      return;
    }
    const uid = Number(req.userId);
    if (!Number.isFinite(uid) || uid <= 0) {
      res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
      return;
    }

    try {
      const u = await prisma.users.findUnique({
        where: { id: uid },
        select: { id: true, email: true }
      });
      if (!u) {
        res.status(404).json({ error: 'Utilizador não encontrado.', code: 'NOT_FOUND' });
        return;
      }

      const dto = await buildServersAuthoritativeStateDto(prisma, pool, uid, String(u.email || ''));
      res.status(200).json(dto);
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/servers/state',
        e,
        'Erro ao carregar o estado dos servidores.'
      );
    }
  });
}
