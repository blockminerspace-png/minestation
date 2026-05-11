/**
 * Uso autoritário de itens de stock (`POST /api/inventory/items/:itemId/use`).
 * Idempotência: `game_servers_intent_idempotency` com scope `inv_item_use:<userId>`.
 */
import type { PrismaClient } from '@prisma/client';
import { parseIdempotencyKey, RoletaAppError } from '../../validation/roletaValidation.js';
import {
  advisoryLockPairFromIntent,
  attachIntentFingerprint,
  GAME_INTENT_IDEM_FP_KEY,
  parseClientStateVersionIntent,
  readGameIntentIdempotencyReplay,
  stableIntentFingerprint,
  stripIntentFingerprint,
  writeGameIntentIdempotencySuccess
} from '../../lib/gameIntentIdempotencyPrisma.js';
import { recordInventoryMovement } from './inventory.audit.js';

export function inventoryItemUseIntentScope(userId: number): string {
  return `inv_item_use:${userId}`;
}

export function inventoryItemUseIntentFingerprint(parts: {
  catalogItemId: string;
  quantity: number;
  workshopSlotIndex: number | null;
}): string {
  return stableIntentFingerprint({
    item: parts.catalogItemId,
    qty: parts.quantity,
    ws: parts.workshopSlotIndex
  });
}

function isBatteryUpgradeRow(type: string | null | undefined, category: string | null | undefined): boolean {
  const t = String(type || '').toLowerCase();
  const c = String(category || '').toLowerCase();
  return t === 'battery' || c === 'battery';
}

function parseUseQuantity(raw: unknown): number {
  if (raw === undefined || raw === null) return 1;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1 || n > 99) {
    throw new RoletaAppError('Quantidade inválida (1–99).', 400);
  }
  return Math.floor(n);
}

function parseWorkshopTargetSlot(target: unknown): number {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new RoletaAppError('target.workshopSlotIndex obrigatório para este item.', 400);
  }
  const o = target as Record<string, unknown>;
  const raw = o.workshopSlotIndex ?? o.slotIndex;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(n) || n < 0 || n > 5) {
    throw new RoletaAppError('target.workshopSlotIndex inválido (0–5).', 400);
  }
  return n;
}

type TxSuccess = {
  kind: 'applied';
  responseBody: Record<string, unknown>;
  prevQty: number;
  nextQty: number;
  rewardWhPerUnit: number;
};

type TxOutcome = { kind: 'replay'; body: Record<string, unknown> } | TxSuccess;

export async function runInventoryItemUseIntent(input: {
  prisma: PrismaClient;
  userId: number;
  userEmail: string;
  catalogItemId: string;
  body: Record<string, unknown>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { prisma, userId, userEmail, catalogItemId, body } = input;
  const itemId = String(catalogItemId || '').trim();
  if (!itemId) {
    return { status: 400, body: { error: 'itemId inválido.', code: 'INVALID_ITEM_ID' } };
  }

  const idem = parseIdempotencyKey(body.idempotencyKey);
  if (!idem) {
    return {
      status: 400,
      body: { error: 'idempotencyKey obrigatório (8–128 caracteres seguros).', code: 'IDEMPOTENCY_KEY_REQUIRED' }
    };
  }

  let quantity = 1;
  try {
    quantity = parseUseQuantity(body.quantity);
  } catch (e) {
    if (e instanceof RoletaAppError) {
      return { status: e.statusCode, body: { error: e.message, code: 'INVALID_QUANTITY' } };
    }
    throw e;
  }

  const target = body.target;
  let workshopSlotIndex: number | null = null;
  try {
    if (target !== undefined && target !== null) {
      workshopSlotIndex = parseWorkshopTargetSlot(target);
    }
  } catch (e) {
    if (e instanceof RoletaAppError) {
      return { status: e.statusCode, body: { error: e.message, code: 'INVALID_TARGET' } };
    }
    throw e;
  }

  const clientCv = parseClientStateVersionIntent(body.clientStateVersion);
  const scope = inventoryItemUseIntentScope(userId);
  const fp = inventoryItemUseIntentFingerprint({
    catalogItemId: itemId,
    quantity,
    workshopSlotIndex
  });

  const replayPre = await readGameIntentIdempotencyReplay(prisma, userId, scope, idem);
  if (replayPre) {
    const stored = replayPre.body as Record<string, unknown>;
    const prevFp = typeof stored[GAME_INTENT_IDEM_FP_KEY] === 'string' ? stored[GAME_INTENT_IDEM_FP_KEY] : '';
    if (prevFp && prevFp !== fp) {
      console.warn(
        JSON.stringify({
          event: 'inventory_item_use_idempotency_mismatch',
          userId,
          itemId: itemId.slice(0, 24)
        })
      );
      return {
        status: 409,
        body: {
          error: 'Mesma chave de idempotência com pedido diferente.',
          code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
          forceReload: true
        }
      };
    }
    return {
      status: replayPre.httpStatus,
      body: { ...(stripIntentFingerprint(stored) as Record<string, unknown>), idempotentReplay: true }
    };
  }

  try {
    const txOutcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      const [lkA, lkB] = advisoryLockPairFromIntent(userId, scope, idem);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1::int, $2::int)', lkA, lkB);

      const replayIn = await readGameIntentIdempotencyReplay(prisma, userId, scope, idem);
      if (replayIn) {
        const stored = replayIn.body as Record<string, unknown>;
        const prevFp = typeof stored[GAME_INTENT_IDEM_FP_KEY] === 'string' ? stored[GAME_INTENT_IDEM_FP_KEY] : '';
        if (prevFp && prevFp !== fp) {
          throw new RoletaAppError('Mesma chave de idempotência com pedido diferente.', 409);
        }
        return { kind: 'replay', body: stripIntentFingerprint(stored as Record<string, unknown>) };
      }

      await tx.game_states.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          usdc: 0,
          start_time: BigInt(Date.now()),
          claimed_referrals: 0,
          referral_bonus_claimed: 0,
          last_updated_at: BigInt(Date.now()),
          server_updated_at: BigInt(Date.now()),
          black_market_balance: 0
        },
        update: {}
      });

      const gs = await tx.game_states.findUnique({
        where: { user_id: userId },
        select: { server_updated_at: true }
      });
      const dbVer = Number(gs?.server_updated_at ?? 0);
      if (clientCv != null && clientCv !== dbVer) {
        throw new RoletaAppError('O estado do jogo foi atualizado. Recarregue e tente novamente.', 409);
      }

      const u = await tx.upgrades.findUnique({
        where: { id: itemId },
        select: { id: true, type: true, category: true, reward_wh: true, is_active: true, name: true }
      });
      if (!u || (u.is_active != null && u.is_active === 0)) {
        throw new RoletaAppError('Item não encontrado ou inativo.', 404);
      }

      if (isBatteryUpgradeRow(u.type, u.category)) {
        console.warn(
          JSON.stringify({
            event: 'inventory_item_use_battery_redirect',
            userId,
            itemId: itemId.slice(0, 24)
          })
        );
        throw new RoletaAppError('ITEM_USE_BATTERY_USE_ROUTES_ONLY', 422);
      }

      const t = String(u.type || '').toLowerCase();
      if (t === 'charger') {
        throw new RoletaAppError('Carregadores são instalados pela oficina, não por item/use.', 422);
      }

      const rewardWh = u.reward_wh != null && Number.isFinite(Number(u.reward_wh)) ? Number(u.reward_wh) : 0;
      if (rewardWh <= 0) {
        throw new RoletaAppError('Este item ainda não possui uso direto disponível.', 422);
      }

      if (workshopSlotIndex == null) {
        throw new RoletaAppError('Este item requer target.workshopSlotIndex (carregador 0–5).', 400);
      }

      const slot = await tx.workshop_slots.findUnique({
        where: { user_id_slot_index: { user_id: userId, slot_index: workshopSlotIndex } }
      });
      if (!slot?.item_id) {
        throw new RoletaAppError('Não há estrutura nesta bancada da oficina.', 400);
      }

      const struct = await tx.upgrades.findUnique({
        where: { id: String(slot.item_id) },
        select: { type: true, power_capacity: true }
      });
      if (!struct || String(struct.type || '').toLowerCase() !== 'charger') {
        throw new RoletaAppError('O alvo não é um carregador.', 400);
      }

      const cap = struct.power_capacity != null ? Number(struct.power_capacity) : 100;
      const cur = Number(slot.current_charge ?? 0) || 0;
      const add = rewardWh * quantity;
      const isInf = cap === -1;
      const nextCharge = isInf ? cur + add : Math.min(Math.max(cap, 0), cur + add);

      const st = await tx.stock.findUnique({
        where: { user_id_item_id: { user_id: userId, item_id: itemId } }
      });
      const prevQty = st?.qty ?? 0;
      if (prevQty < quantity) {
        throw new RoletaAppError('Stock insuficiente.', 422);
      }

      await tx.stock.update({
        where: { user_id_item_id: { user_id: userId, item_id: itemId } },
        data: { qty: prevQty - quantity }
      });

      await tx.workshop_slots.update({
        where: { user_id_slot_index: { user_id: userId, slot_index: workshopSlotIndex } },
        data: { current_charge: nextCharge }
      });

      const nowMs = Date.now();
      const newServerUpdatedAt = BigInt(nowMs);
      await tx.game_states.update({
        where: { user_id: userId },
        data: { server_updated_at: newServerUpdatedAt, last_updated_at: newServerUpdatedAt }
      });

      const responseBody: Record<string, unknown> = {
        ok: true,
        itemId,
        consumedQty: quantity,
        workshopSlotIndex,
        newWorkshopCharge: nextCharge,
        serverUpdatedAt: nowMs,
        stateVersion: nowMs,
        rewardWhApplied: rewardWh,
        idempotentReplay: false
      };
      attachIntentFingerprint(responseBody, fp);

      await writeGameIntentIdempotencySuccess(prisma, userId, scope, idem, 200, responseBody);

      return {
        kind: 'applied',
        responseBody,
        prevQty,
        nextQty: prevQty - quantity,
        rewardWhPerUnit: rewardWh
      };
    });

    if (txOutcome.kind === 'replay') {
      return { status: 200, body: { ...txOutcome.body, idempotentReplay: true } };
    }

    await recordInventoryMovement({
      userId,
      action: 'item_use_energy_voucher',
      catalogItemId: itemId,
      quantityBefore: txOutcome.prevQty,
      quantityAfter: txOutcome.nextQty,
      meta: {
        workshopSlotIndex,
        rewardWhPerUnit: txOutcome.rewardWhPerUnit,
        emailHint: String(userEmail || '')
          .split('@')[0]
          ?.slice(0, 32)
      }
    });

    console.warn(
      JSON.stringify({
        event: 'inventory_item_use_applied',
        userId,
        itemId: itemId.slice(0, 24),
        qty: quantity
      })
    );

    return {
      status: 200,
      body: stripIntentFingerprint(txOutcome.responseBody) as Record<string, unknown>
    };
  } catch (e) {
    if (e instanceof RoletaAppError) {
      let code = 'ITEM_USE_ERROR';
      if (e.statusCode === 409) {
        code =
          e.message.includes('estado do jogo') || e.message.includes('Recarregue')
            ? 'STATE_VERSION_CONFLICT'
            : 'STATE_OR_IDEM_CONFLICT';
      }
      else if (e.statusCode === 422) {
        if (e.message === 'ITEM_USE_BATTERY_USE_ROUTES_ONLY') code = 'ITEM_USE_BATTERY_USE_ROUTES';
        else if (e.message.includes('não possui uso direto')) {
          code = 'ITEM_USE_NOT_SUPPORTED';
          console.warn(
            JSON.stringify({
              event: 'inventory_item_use_not_supported',
              userId,
              itemId: itemId.slice(0, 24)
            })
          );
        }
      }
      return {
        status: e.statusCode,
        body: {
          error:
            e.message === 'ITEM_USE_BATTERY_USE_ROUTES_ONLY'
              ? 'Baterias não são usadas por esta rota. Use mover bateria / oficina / servidores.'
              : e.message,
          code,
          ...(e.statusCode === 409 ? { forceReload: true } : {})
        }
      };
    }
    throw e;
  }
}
