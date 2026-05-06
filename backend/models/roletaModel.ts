import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { RoletaAppError, sanitizeDisplayName } from '../validation/roletaValidation.js';
import { promoCodeRowEligibleForRoletaFlow, throwIfPromoCodeExpired } from './promoCodeRoleta.js';
import type { RoletaDbTx } from './roletaDbTypes.js';

export type { RoletaDbTx } from './roletaDbTypes.js';

export type WheelPrizeRow = {
  id: string;
  label: string;
  weight: number;
  color: string | null;
  item_id: string;
};

/** `label` exibido: nome atual do upgrade quando `item_id` existe; senão etiqueta em `wheel_prizes`. */
function mapWheelPrizeJoinedRow(row: Record<string, unknown>): WheelPrizeRow {
  const un = row.upgrade_name;
  const live =
    un != null && typeof un === 'string' && String(un).trim().length > 0 ? String(un).trim() : null;
  const stored = row.stored_label != null ? String(row.stored_label) : String(row.label ?? '');
  return {
    id: String(row.id ?? ''),
    label: live ?? stored,
    weight: Number(row.weight),
    color: row.color != null ? String(row.color) : null,
    item_id: row.item_id != null ? String(row.item_id) : ''
  };
}

export async function queryAllWheelPrizesJoined(tx: RoletaDbTx): Promise<WheelPrizeRow[]> {
  const prizesRes = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT wp.id,
           wp.label AS stored_label,
           wp.weight,
           wp.color,
           wp.item_id,
           u.name AS upgrade_name
    FROM wheel_prizes wp
    LEFT JOIN upgrades u ON u.id = wp.item_id
    ORDER BY wp.id ASC
  `;
  return prizesRes.map((r) => mapWheelPrizeJoinedRow(r));
}

export async function queryWheelPrizeByItemIdJoined(tx: RoletaDbTx, itemId: string): Promise<WheelPrizeRow | null> {
  const prizeRes = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT wp.id,
           wp.label AS stored_label,
           wp.weight,
           wp.color,
           wp.item_id,
           u.name AS upgrade_name
    FROM wheel_prizes wp
    LEFT JOIN upgrades u ON u.id = wp.item_id
    WHERE wp.item_id = ${itemId}
    LIMIT 1
  `;
  const r = prizeRes[0];
  return r ? mapWheelPrizeJoinedRow(r) : null;
}

/** Resposta JSON de `/api/wheel/config` e GET admin (camelCase). */
export async function fetchWheelPrizesForApiConfig(): Promise<
  Array<{ id: string; label: string; color: string | null; weight: number; itemId: string }>
> {
  const rows = await queryAllWheelPrizesJoined(prisma);
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    color: row.color,
    weight: row.weight,
    itemId: row.item_id
  }));
}

function assertFinitePositiveWeight(w: unknown): number {
  const n = typeof w === 'number' ? w : Number(w);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Sorteio ponderado determinístico no servidor; `prizes` já validados não vazios. */
export function pickWeightedPrize(prizes: WheelPrizeRow[]): WheelPrizeRow {
  const weights = prizes.map((p) => assertFinitePositiveWeight(p.weight));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    throw new RoletaAppError('Configuração da roleta inválida (pesos).', 500);
  }
  let r = Math.random() * total;
  for (let i = 0; i < prizes.length; i++) {
    const w = weights[i]!;
    if (r < w) return prizes[i]!;
    r -= w;
  }
  return prizes[prizes.length - 1]!;
}

export type WheelRollResult = {
  wonItemId: string;
  item: WheelPrizeRow | null;
  /** true quando já existia `won_item_id` (repetição do endpoint). */
  idempotent: boolean;
};

/** Giro pago (USDC): cobrança fixa por giro; `newUsdc` é o saldo após cobrar ou o atual em replay idempotente. */
export type PaidWheelRollResult = {
  wonItemId: string;
  item: WheelPrizeRow | null;
  idempotent: boolean;
  newUsdc: number;
  chargedUsdc: number;
};

export const PAID_WHEEL_SPIN_PRICE_USDC = 1;

/**
 * Cria ou reutiliza caixa `roleta_reward` e incrementa `unopened_boxes` (mesma lógica do resgate por código).
 * Não altera `promo_code_redemptions`.
 */
export async function grantWheelPrizeUnopenedBox(
  tx: RoletaDbTx,
  userId: number,
  wonItemId: string
): Promise<RoletaClaimResult> {
  const existing = await tx.loot_boxes.findFirst({
    where: { trigger: 'roleta_reward', description: `reward_for_${wonItemId}` },
    select: { id: true }
  });

  let prizeBoxId: string;
  if (existing?.id) {
    prizeBoxId = existing.id;
  } else {
    prizeBoxId = crypto.randomUUID();
    const upg = await tx.$queryRaw<{ name: string }[]>`
      SELECT name FROM upgrades WHERE id = ${wonItemId} LIMIT 1
    `;
    const rawName = upg[0]?.name ?? wonItemId;
    const itemName = sanitizeDisplayName(String(rawName), 120);
    const boxName = `Prêmio: ${itemName}`;

    await tx.loot_boxes.create({
      data: {
        id: prizeBoxId,
        name: boxName,
        description: `reward_for_${wonItemId}`,
        price: 0,
        trigger: 'roleta_reward',
        icon: '🎁'
      }
    });

    await tx.loot_box_items.create({
      data: {
        box_id: prizeBoxId,
        item_type: 'item',
        item_id: wonItemId,
        min_qty: 1,
        max_qty: 1,
        probability: 100
      }
    });
  }

  const boxRow = await tx.loot_boxes.findUnique({
    where: { id: prizeBoxId },
    select: { name: true }
  });
  const boxName = sanitizeDisplayName(String(boxRow?.name ?? 'Prêmio'), 200);

  await tx.unopened_boxes.upsert({
    where: { user_id_box_id: { user_id: userId, box_id: prizeBoxId } },
    create: { user_id: userId, box_id: prizeBoxId, qty: 1 },
    update: { qty: { increment: 1 } }
  });

  return { boxId: prizeBoxId, boxName };
}

/**
 * Exige transação ativa. Bloqueia linha de resgate (`FOR UPDATE`) para evitar corrida em roll/claim.
 */
export async function wheelRollInTransaction(
  tx: RoletaDbTx,
  args: { userId: number; normalizedCode: string; serverNowMs: number }
): Promise<WheelRollResult> {
  const { userId, normalizedCode, serverNowMs } = args;

  const redRes = await tx.$queryRaw<
    Array<{ reward_granted: number | null; won_item_id: string | null }>
  >`
    SELECT reward_granted, won_item_id
    FROM promo_code_redemptions
    WHERE code = ${normalizedCode} AND user_id = ${userId}
    FOR UPDATE
  `;

  if (redRes.length === 0) {
    throw new RoletaAppError('Você precisa resgatar o código primeiro.', 400);
  }

  const redemption = redRes[0]!;

  if (redemption.reward_granted === 1) {
    throw new RoletaAppError('Este código já foi totalmente utilizado.', 400);
  }

  const prowRows = await tx.$queryRaw<Array<{ type: string; loot_box_id: string | null; expires_at: bigint | null }>>`
    SELECT type, loot_box_id, expires_at FROM promo_codes WHERE code = ${normalizedCode} LIMIT 1
  `;
  const prow = prowRows[0];
  if (prow) throwIfPromoCodeExpired(prow, serverNowMs);
  const wheelOk = prow ? await promoCodeRowEligibleForRoletaFlow(tx, prow) : false;
  if (!wheelOk) {
    throw new RoletaAppError('Este código não permite giro de roleta.', 400);
  }

  if (redemption.won_item_id) {
    const item = await queryWheelPrizeByItemIdJoined(tx, String(redemption.won_item_id));
    return { wonItemId: String(redemption.won_item_id), item, idempotent: true };
  }

  const prizes = await queryAllWheelPrizesJoined(tx);
  if (prizes.length === 0) {
    throw new RoletaAppError('Configuração da roleta não encontrada.', 500);
  }

  const selected = pickWeightedPrize(prizes);

  const upd = await tx.promo_code_redemptions.updateMany({
    where: {
      code: normalizedCode,
      user_id: userId,
      won_item_id: null,
      reward_granted: 0
    },
    data: {
      won_item_id: selected.item_id,
      roulette_rolled_at: BigInt(serverNowMs)
    }
  });

  if (upd.count === 0) {
    const again = await tx.promo_code_redemptions.findUnique({
      where: { code_user_id: { code: normalizedCode, user_id: userId } },
      select: { won_item_id: true }
    });
    const wid = again?.won_item_id;
    if (wid) {
      const item = await queryWheelPrizeByItemIdJoined(tx, String(wid));
      return { wonItemId: String(wid), item, idempotent: true };
    }
    throw new RoletaAppError('Não foi possível registrar o giro. Tente novamente.', 409);
  }

  return { wonItemId: selected.item_id, item: selected, idempotent: false };
}

export type RoletaClaimResult = {
  boxId: string;
  boxName: string;
};

export async function roletaClaimInTransaction(
  tx: RoletaDbTx,
  args: {
    userId: number;
    normalizedCode: string;
    wonItemId: string;
    serverNowMs: number;
  }
): Promise<RoletaClaimResult> {
  const { userId, normalizedCode, wonItemId, serverNowMs } = args;

  const redRes = await tx.$queryRaw<
    Array<{ reward_granted: number | null; won_item_id: string | null }>
  >`
    SELECT reward_granted, won_item_id
    FROM promo_code_redemptions
    WHERE code = ${normalizedCode} AND user_id = ${userId}
    FOR UPDATE
  `;

  if (redRes.length === 0) {
    throw new RoletaAppError('Código não resgatado.', 400);
  }

  const redemption = redRes[0]!;

  if (redemption.reward_granted === 1) {
    throw new RoletaAppError('Recompensa já reivindicada.', 400);
  }
  if (!redemption.won_item_id) {
    throw new RoletaAppError('Você precisa girar a roleta primeiro.', 400);
  }

  if (String(redemption.won_item_id) !== String(wonItemId)) {
    throw new RoletaAppError(
      'Integridade do sorteio violada. O item reivindicado não corresponde ao sorteado.',
      403
    );
  }

  const codeRows = await tx.$queryRaw<Array<{ type: string; loot_box_id: string | null; expires_at: bigint | null }>>`
    SELECT type, loot_box_id, expires_at FROM promo_codes WHERE code = ${normalizedCode} LIMIT 1
  `;
  const promo = codeRows[0];
  if (promo) throwIfPromoCodeExpired(promo, serverNowMs);
  const claimOk = promo ? await promoCodeRowEligibleForRoletaFlow(tx, promo) : false;
  if (!claimOk) {
    throw new RoletaAppError('Tipo de código inválido.', 400);
  }

  const granted = await grantWheelPrizeUnopenedBox(tx, userId, wonItemId);

  const upd = await tx.promo_code_redemptions.updateMany({
    where: {
      code: normalizedCode,
      user_id: userId,
      reward_granted: 0
    },
    data: {
      reward_granted: 1,
      roulette_claimed_at: BigInt(serverNowMs)
    }
  });

  if (upd.count === 0) {
    throw new RoletaAppError('Falha ao finalizar resgate do código (nenhuma linha atualizada).', 409);
  }

  return granted;
}

/**
 * Giro pago: cobra USDC em `game_states`, regista prémio pendente até `paidWheelClaimInTransaction`.
 * No máximo um giro pendente por jogador (repetir POST devolve o mesmo resultado sem cobrar de novo).
 */
export async function paidWheelRollInTransaction(
  tx: RoletaDbTx,
  args: { userId: number; serverNowMs: number }
): Promise<PaidWheelRollResult> {
  const { userId, serverNowMs } = args;
  const price = PAID_WHEEL_SPIN_PRICE_USDC;

  /** `game_states` primeiro: serializa giros pagos do mesmo jogador e evita cobrança dupla. */
  const gsRows = await tx.$queryRaw<Array<{ usdc: number }>>`
    SELECT usdc::float AS usdc FROM game_states WHERE user_id = ${userId} FOR UPDATE
  `;
  const gs = gsRows[0];
  if (!gs) {
    throw new RoletaAppError('Estado de jogo não encontrado.', 400);
  }

  const pendRows = await tx.$queryRaw<Array<{ won_item_id: string }>>`
    SELECT won_item_id FROM wheel_paid_pending WHERE user_id = ${userId} FOR UPDATE
  `;
  const existingWon = pendRows[0]?.won_item_id;
  if (existingWon) {
    const newUsdc = Number(gs.usdc) || 0;
    const item = await queryWheelPrizeByItemIdJoined(tx, String(existingWon));
    return {
      wonItemId: String(existingWon),
      item,
      idempotent: true,
      newUsdc,
      chargedUsdc: 0
    };
  }

  const bal = Number(gs.usdc) || 0;
  if (bal < price) {
    throw new RoletaAppError('Saldo USDC insuficiente (mínimo US$1,00 por giro).', 400);
  }

  const payRows = await tx.$queryRaw<Array<{ usdc: number }>>`
    UPDATE game_states
    SET usdc = usdc - ${price},
        last_updated_at = ${BigInt(serverNowMs)},
        server_updated_at = ${BigInt(serverNowMs)}
    WHERE user_id = ${userId} AND usdc >= ${price}
    RETURNING usdc::float AS usdc
  `;
  if (payRows.length === 0) {
    throw new RoletaAppError('Saldo USDC insuficiente (mínimo US$1,00 por giro).', 400);
  }

  const prizes = await queryAllWheelPrizesJoined(tx);
  if (prizes.length === 0) {
    throw new RoletaAppError('Configuração da roleta não encontrada.', 500);
  }
  const selected = pickWeightedPrize(prizes);

  await tx.wheel_paid_pending.create({
    data: {
      user_id: userId,
      won_item_id: selected.item_id,
      charged_usdc: price,
      rolled_at: BigInt(serverNowMs)
    }
  });

  const newUsdc = Number(payRows[0]!.usdc) || 0;
  return {
    wonItemId: selected.item_id,
    item: selected,
    idempotent: false,
    newUsdc,
    chargedUsdc: price
  };
}

export async function paidWheelClaimInTransaction(
  tx: RoletaDbTx,
  args: { userId: number; wonItemId: string }
): Promise<RoletaClaimResult> {
  const { userId, wonItemId } = args;

  const pendRows = await tx.$queryRaw<Array<{ won_item_id: string }>>`
    SELECT won_item_id FROM wheel_paid_pending WHERE user_id = ${userId} FOR UPDATE
  `;
  if (pendRows.length === 0) {
    throw new RoletaAppError('Não há prémio pendente. Gire a roleta paga primeiro.', 400);
  }
  const rowWon = String(pendRows[0]!.won_item_id || '');
  if (rowWon !== String(wonItemId)) {
    throw new RoletaAppError(
      'Integridade do sorteio violada. O item reivindicado não corresponde ao sorteado.',
      403
    );
  }

  const granted = await grantWheelPrizeUnopenedBox(tx, userId, wonItemId);

  const del = await tx.wheel_paid_pending.deleteMany({ where: { user_id: userId } });
  if (del.count === 0) {
    throw new RoletaAppError('Estado da roleta paga alterado. Recarregue a página.', 409);
  }

  return granted;
}
