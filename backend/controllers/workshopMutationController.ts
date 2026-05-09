import type { Express, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/prisma.js';
import {
  WorkshopMutationError,
  runWorkshopMutation,
  type WorkshopMutateBody
} from '../models/workshopMutationModel.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

const workshopMutateLimiter = rateLimit({
  windowMs: 60_000,
  max: 48,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas alterações na oficina. Aguarda um minuto.' }
});

function parseMutateBody(raw: unknown): WorkshopMutateBody | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const action = o.action;
  if (
    action !== 'equip_bench' &&
    action !== 'unequip_bench' &&
    action !== 'equip_component' &&
    action !== 'unequip_component'
  ) {
    return null;
  }
  const slotIndex = typeof o.slotIndex === 'number' ? o.slotIndex : parseInt(String(o.slotIndex ?? ''), 10);
  const itemId = o.itemId !== undefined && o.itemId !== null ? String(o.itemId) : undefined;
  const componentSlotId =
    o.componentSlotId !== undefined && o.componentSlotId !== null ? String(o.componentSlotId) : undefined;
  const storedBatteryId =
    o.storedBatteryId !== undefined && o.storedBatteryId !== null ? String(o.storedBatteryId) : undefined;
  const exp = o.expectedServerUpdatedAt;
  const expectedServerUpdatedAt =
    exp === undefined || exp === null ? undefined : Number(exp);
  const liRaw = o.componentSlotLayoutIndex;
  const componentSlotLayoutIndex =
    liRaw === undefined || liRaw === null
      ? undefined
      : typeof liRaw === 'number'
        ? liRaw
        : parseInt(String(liRaw), 10);

  return {
    action,
    slotIndex,
    itemId,
    componentSlotId,
    storedBatteryId,
    componentSlotLayoutIndex: Number.isFinite(componentSlotLayoutIndex) ? componentSlotLayoutIndex : undefined,
    expectedServerUpdatedAt: Number.isFinite(expectedServerUpdatedAt) ? expectedServerUpdatedAt : undefined
  };
}

export type WorkshopMutationControllerDeps = {
  authenticateToken: (req: Request, res: Response, next: () => void) => void;
};

export function registerWorkshopMutationRoutes(app: Express, deps: WorkshopMutationControllerDeps): void {
  const { authenticateToken } = deps;

  app.post('/api/workshop/mutate', workshopMutateLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = req.userId;
    if (uid == null) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Sessão inválida.', code: 'AUTH_REQUIRED' });
    }

    const body = parseMutateBody(req.body);
    if (!body) {
      return res.status(400).json({ error: 'Corpo do pedido inválido.' });
    }

    try {
      const u = await prisma.users.findUnique({
        where: { id: userId },
        select: { email: true, is_blocked: true }
      });
      if (!u?.email) {
        return res.status(404).json({ error: 'Utilizador não encontrado.' });
      }
      if (u.is_blocked === 1) {
        return res.status(403).json({ error: 'Conta bloqueada.' });
      }

      const out = await runWorkshopMutation(userId, body, u.email);
      return res.json(out);
    } catch (e) {
      if (e instanceof WorkshopMutationError) {
        const payload: Record<string, unknown> = { error: e.message };
        if (e.forceReload) payload.forceReload = true;
        return res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
      }
      console.error('[workshop/mutate]', e instanceof Error ? e.message : String(e));
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao processar a oficina.');
    }
  });
}
