import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/prisma.js';
import {
  WorkshopMutationError,
  runWorkshopMutation,
  type WorkshopMutateBody
} from '../models/workshopMutationModel.js';
import { parseIdempotencyKey } from '../validation/roletaValidation.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

const workshopIntentLimiter = rateLimit({
  windowMs: 60_000,
  max: 64,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos de oficina. Aguarda um minuto.' }
});

export type WorkshopIntentControllerDeps = {
  authenticateToken: (req: Request, res: Response, next: () => void) => void;
};

function assertSlotIndexParam(raw: string): number | null {
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0 || n > 5) return null;
  return n;
}

function resolveWorkshopIdempotencyKey(raw: unknown): string {
  const parsed = parseIdempotencyKey(raw);
  if (parsed) return parsed;
  return `ws_${crypto.randomUUID()}`;
}

export function registerWorkshopIntentRoutes(app: Express, deps: WorkshopIntentControllerDeps): void {
  const { authenticateToken } = deps;

  const run = async (req: Request, res: Response, body: WorkshopMutateBody) => {
    const uid = req.userId;
    if (uid == null) return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Sessão inválida.', code: 'AUTH_REQUIRED' });
    }
    const u = await prisma.users.findUnique({
      where: { id: userId },
      select: { email: true, is_blocked: true }
    });
    if (!u?.email) return res.status(404).json({ error: 'Utilizador não encontrado.' });
    if (u.is_blocked === 1) return res.status(403).json({ error: 'Conta bloqueada.' });
    const out = await runWorkshopMutation(userId, body, u.email);
    return res.json(out);
  };

  app.post(
    '/api/workshop/batteries/:batteryId/charge/start',
    workshopIntentLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      try {
        const uid = req.userId;
        if (uid == null) return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
        const userId = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
        if (!Number.isFinite(userId) || userId <= 0) {
          return res.status(401).json({ error: 'Sessão inválida.', code: 'AUTH_REQUIRED' });
        }
        const batteryId = String(req.params.batteryId || '').trim();
        if (!batteryId) return res.status(400).json({ error: 'batteryId inválido.' });
        const raw = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const idem = resolveWorkshopIdempotencyKey(raw.idempotencyKey);
        const slotIndex = assertSlotIndexParam(String(raw.benchSlotIndex ?? raw.slotIndex ?? ''));
        if (slotIndex == null) return res.status(400).json({ error: 'benchSlotIndex inválido (0–5).' });
        const componentSlotId =
          raw.componentSlotId != null ? String(raw.componentSlotId).trim() : '';
        if (!componentSlotId) return res.status(400).json({ error: 'componentSlotId obrigatório.' });
        const liRaw = raw.componentSlotLayoutIndex;
        const componentSlotLayoutIndex =
          liRaw === undefined || liRaw === null
            ? undefined
            : typeof liRaw === 'number'
              ? liRaw
              : parseInt(String(liRaw), 10);
        const cv = raw.clientStateVersion ?? raw.expectedServerUpdatedAt;
        const exp = cv === undefined || cv === null ? undefined : Number(cv);
        const sb = await prisma.stored_batteries.findFirst({
          where: { user_id: userId, id: batteryId },
          select: { item_id: true }
        });
        if (!sb?.item_id) return res.status(404).json({ error: 'Bateria não encontrada.' });
        const body: WorkshopMutateBody = {
          action: 'equip_component',
          slotIndex,
          itemId: String(sb.item_id),
          componentSlotId,
          storedBatteryId: batteryId,
          componentSlotLayoutIndex: Number.isFinite(componentSlotLayoutIndex!) ? componentSlotLayoutIndex : undefined,
          expectedServerUpdatedAt: Number.isFinite(exp!) ? exp : undefined,
          clientStateVersion: Number.isFinite(exp!) ? exp : undefined,
          idempotencyKey: idem
        };
        return await run(req, res, body);
      } catch (e) {
        if (e instanceof WorkshopMutationError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.forceReload) payload.forceReload = true;
          if (e.statusCode === 409 && e.message.includes('idempotência')) payload.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
          else if (e.statusCode === 409) payload.code = 'STATE_VERSION_CONFLICT';
          return res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
        }
        console.error('[workshop/batteries/charge/start]', e);
        return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
      }
    }
  );

  app.post(
    '/api/workshop/batteries/:batteryId/charge/stop',
    workshopIntentLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      try {
        const batteryId = String(req.params.batteryId || '').trim();
        if (!batteryId) return res.status(400).json({ error: 'batteryId inválido.' });
        const raw = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const idem = resolveWorkshopIdempotencyKey(raw.idempotencyKey);
        const slotIndex = assertSlotIndexParam(String(raw.benchSlotIndex ?? raw.slotIndex ?? ''));
        if (slotIndex == null) return res.status(400).json({ error: 'benchSlotIndex inválido (0–5).' });
        const componentSlotId =
          raw.componentSlotId != null ? String(raw.componentSlotId).trim() : '';
        if (!componentSlotId) {
          return res.status(400).json({ error: 'componentSlotId obrigatório.', code: 'COMPONENT_SLOT_REQUIRED' });
        }
        const liRaw = raw.componentSlotLayoutIndex;
        const componentSlotLayoutIndex =
          liRaw === undefined || liRaw === null
            ? undefined
            : typeof liRaw === 'number'
              ? liRaw
              : parseInt(String(liRaw), 10);
        const cv = raw.clientStateVersion ?? raw.expectedServerUpdatedAt;
        const exp = cv === undefined || cv === null ? undefined : Number(cv);
        const body: WorkshopMutateBody = {
          action: 'unequip_component',
          slotIndex,
          componentSlotId,
          storedBatteryId: batteryId,
          componentSlotLayoutIndex: Number.isFinite(componentSlotLayoutIndex!) ? componentSlotLayoutIndex : undefined,
          expectedServerUpdatedAt: Number.isFinite(exp!) ? exp : undefined,
          clientStateVersion: Number.isFinite(exp!) ? exp : undefined,
          idempotencyKey: idem
        };
        return await run(req, res, body);
      } catch (e) {
        if (e instanceof WorkshopMutationError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.forceReload) payload.forceReload = true;
          if (e.statusCode === 409 && e.message.includes('idempotência')) payload.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
          else if (e.statusCode === 409) payload.code = 'STATE_VERSION_CONFLICT';
          return res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
        }
        console.error('[workshop/batteries/charge/stop]', e);
        return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
      }
    }
  );

  app.post(
    '/api/workshop/slots/:slotIndex/equip',
    workshopIntentLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      try {
        const slotIndex = assertSlotIndexParam(String(req.params.slotIndex ?? ''));
        if (slotIndex == null) return res.status(400).json({ error: 'slotIndex inválido (0–5).' });
        const raw = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const idem = resolveWorkshopIdempotencyKey(raw.idempotencyKey);
        const itemId = raw.itemId != null ? String(raw.itemId).trim() : '';
        if (!itemId) return res.status(400).json({ error: 'itemId obrigatório.' });
        const cv = raw.clientStateVersion ?? raw.expectedServerUpdatedAt;
        const exp = cv === undefined || cv === null ? undefined : Number(cv);
        const body: WorkshopMutateBody = {
          action: 'equip_bench',
          slotIndex,
          itemId,
          expectedServerUpdatedAt: Number.isFinite(exp!) ? exp : undefined,
          clientStateVersion: Number.isFinite(exp!) ? exp : undefined,
          idempotencyKey: idem
        };
        return await run(req, res, body);
      } catch (e) {
        if (e instanceof WorkshopMutationError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.forceReload) payload.forceReload = true;
          if (e.statusCode === 409 && e.message.includes('idempotência')) payload.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
          else if (e.statusCode === 409) payload.code = 'STATE_VERSION_CONFLICT';
          return res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
        }
        console.error('[workshop/slots/equip]', e);
        return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
      }
    }
  );

  app.post(
    '/api/workshop/slots/:slotIndex/unequip',
    workshopIntentLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      try {
        const slotIndex = assertSlotIndexParam(String(req.params.slotIndex ?? ''));
        if (slotIndex == null) return res.status(400).json({ error: 'slotIndex inválido (0–5).' });
        const raw = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const idem = resolveWorkshopIdempotencyKey(raw.idempotencyKey);
        const cv = raw.clientStateVersion ?? raw.expectedServerUpdatedAt;
        const exp = cv === undefined || cv === null ? undefined : Number(cv);
        const body: WorkshopMutateBody = {
          action: 'unequip_bench',
          slotIndex,
          expectedServerUpdatedAt: Number.isFinite(exp!) ? exp : undefined,
          clientStateVersion: Number.isFinite(exp!) ? exp : undefined,
          idempotencyKey: idem
        };
        return await run(req, res, body);
      } catch (e) {
        if (e instanceof WorkshopMutationError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.forceReload) payload.forceReload = true;
          if (e.statusCode === 409 && e.message.includes('idempotência')) payload.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
          else if (e.statusCode === 409) payload.code = 'STATE_VERSION_CONFLICT';
          return res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
        }
        console.error('[workshop/slots/unequip]', e);
        return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
      }
    }
  );
}
