import type { PrismaClient } from '@prisma/client';
import { WorkshopMutationError, runWorkshopMutation, type WorkshopMutateBody } from '../../models/workshopMutationModel.js';
import { parseIdempotencyKey } from '../../validation/roletaValidation.js';
import { parseClientStateVersionIntent } from '../../lib/gameIntentIdempotencyPrisma.js';

export type InventoryBatteryMoveResult = { status: number; body: Record<string, unknown> };

/**
 * Intenção: mover instância de bateria entre armazém e oficina.
 * Idempotência e `clientStateVersion` ficam em `runWorkshopMutation` (tabela `game_servers_intent_idempotency`, scope `workshop_mut:`).
 */
export async function runInventoryBatteryMoveIntent(args: {
  prisma: PrismaClient;
  userId: number;
  batteryId: string;
  body: Record<string, unknown>;
  userEmail: string;
}): Promise<InventoryBatteryMoveResult> {
  const { prisma: prismaClient, userId, batteryId, body, userEmail } = args;
  const idem = parseIdempotencyKey(body.idempotencyKey);
  if (!idem) {
    return {
      status: 400,
      body: { error: 'idempotencyKey inválido ou ausente (8–128 caracteres seguros).', code: 'IDEMPOTENCY_KEY_REQUIRED' }
    };
  }
  const action = String(body.action || '').trim();
  if (action !== 'to_workshop_charger' && action !== 'from_workshop_to_inventory') {
    return {
      status: 400,
      body: {
        error: 'action inválido: use to_workshop_charger ou from_workshop_to_inventory.',
        code: 'INVALID_ACTION'
      }
    };
  }

  const benchSlotIndex =
    typeof body.benchSlotIndex === 'number' ? body.benchSlotIndex : parseInt(String(body.benchSlotIndex ?? ''), 10);
  const componentSlotId =
    body.componentSlotId != null && body.componentSlotId !== undefined ? String(body.componentSlotId) : '';
  const liRaw = body.componentSlotLayoutIndex;
  const componentSlotLayoutIndex =
    liRaw === undefined || liRaw === null
      ? undefined
      : typeof liRaw === 'number'
        ? liRaw
        : parseInt(String(liRaw), 10);

  if (!Number.isFinite(benchSlotIndex) || benchSlotIndex < 0 || benchSlotIndex > 5) {
    return { status: 400, body: { error: 'benchSlotIndex inválido (0–5).', code: 'INVALID_BENCH_SLOT' } };
  }

  const row = await prismaClient.stored_batteries.findFirst({
    where: { user_id: userId, id: batteryId.trim() },
    select: { id: true }
  });
  if (!row) {
    return {
      status: 404,
      body: { error: 'Bateria não encontrada ou não pertence ao utilizador.', code: 'BATTERY_NOT_FOUND' }
    };
  }

  const exp = parseClientStateVersionIntent(body.clientStateVersion);

  let mutate: WorkshopMutateBody;
  if (action === 'to_workshop_charger') {
    if (!componentSlotId) {
      return {
        status: 400,
        body: { error: 'componentSlotId obrigatório para to_workshop_charger.', code: 'MISSING_COMPONENT_SLOT' }
      };
    }
    mutate = {
      action: 'equip_component',
      slotIndex: benchSlotIndex,
      componentSlotId,
      storedBatteryId: batteryId.trim(),
      componentSlotLayoutIndex: Number.isFinite(componentSlotLayoutIndex!) ? componentSlotLayoutIndex : undefined,
      expectedServerUpdatedAt: exp ?? undefined,
      clientStateVersion: exp ?? undefined,
      idempotencyKey: idem.length <= 120 ? `${idem}:inv` : idem.slice(0, 120)
    };
  } else {
    mutate = {
      action: 'unequip_component',
      slotIndex: benchSlotIndex,
      componentSlotId: componentSlotId || undefined,
      storedBatteryId: batteryId.trim(),
      componentSlotLayoutIndex: Number.isFinite(componentSlotLayoutIndex!) ? componentSlotLayoutIndex : undefined,
      expectedServerUpdatedAt: exp ?? undefined,
      clientStateVersion: exp ?? undefined,
      idempotencyKey: idem.length <= 120 ? `${idem}:inv` : idem.slice(0, 120)
    };
  }

  try {
    const out = await runWorkshopMutation(userId, mutate, userEmail);
    return { status: 200, body: out as unknown as Record<string, unknown> };
  } catch (e) {
    if (e instanceof WorkshopMutationError) {
      const payload: Record<string, unknown> = { error: e.message };
      if (e.forceReload) payload.forceReload = true;
      if (e.statusCode === 409) {
        if (e.message.includes('idempotência')) payload.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
        else payload.code = 'STATE_VERSION_CONFLICT';
      }
      return { status: e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400, body: payload };
    }
    throw e;
  }
}
