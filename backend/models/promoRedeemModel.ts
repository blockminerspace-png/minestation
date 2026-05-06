import type { Prisma } from '@prisma/client';
import { RoletaAppError } from '../validation/roletaValidation.js';
import { promoCodeRowEligibleForRoletaFlow, throwIfPromoCodeExpired } from './promoCodeRoleta.js';

export type GrantAdminUpgradeRewardsFn = (
  userId: number,
  upgradeId: string,
  tx: Prisma.TransactionClient
) => Promise<unknown>;

export type PromoRedeemTransactionResult =
  | {
      kind: 'roleta_new';
      code: string;
      serverNowMs: number;
    }
  | {
      kind: 'roleta_reentry';
      code: string;
    }
  | {
      kind: 'standard';
      unopenedBoxes: Record<string, number>;
      stock: Record<string, number>;
      lootBoxId: string | null;
      upgradeId: string | null;
      adminUpgradeId: string | null;
    };

type PromoRow = {
  code: string;
  loot_box_id: string | null;
  upgrade_id: string | null;
  admin_upgrade_id: string | null;
  type: string;
  is_active: number | null;
  expires_at?: bigint | number | null;
};

function promoRowFromPrisma(p: {
  code: string;
  loot_box_id: string | null;
  upgrade_id: string | null;
  admin_upgrade_id: string | null;
  type: string;
  is_active: number | null;
  expires_at: bigint | null;
}): PromoRow {
  return {
    code: p.code,
    loot_box_id: p.loot_box_id,
    upgrade_id: p.upgrade_id,
    admin_upgrade_id: p.admin_upgrade_id,
    type: p.type,
    is_active: p.is_active,
    expires_at: p.expires_at
  };
}

function mapRawPromoRow(r: Record<string, unknown>): PromoRow {
  return {
    code: String(r.code),
    loot_box_id: (r.loot_box_id as string | null) ?? null,
    upgrade_id: (r.upgrade_id as string | null) ?? null,
    admin_upgrade_id: (r.admin_upgrade_id as string | null) ?? null,
    type: String(r.type),
    is_active: r.is_active == null ? null : Number(r.is_active),
    expires_at: r.expires_at as bigint | number | null | undefined
  };
}

/**
 * Corpo da transação de resgate (dentro de `prisma.$transaction`).
 */
export async function runPromoCodeRedeemInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    userId: number;
    normalizedCode: string;
    serverNowMs: number;
    grantAdminUpgradeRewards: GrantAdminUpgradeRewardsFn;
  }
): Promise<PromoRedeemTransactionResult> {
  const { userId, normalizedCode, serverNowMs, grantAdminUpgradeRewards } = args;

  let promoRow = await tx.promo_codes.findUnique({
    where: { code: normalizedCode }
  });
  let promo = promoRow ? promoRowFromPrisma(promoRow) : undefined;

  if (!promo) {
    throw new RoletaAppError('Código inválido', 404);
  }

  if (!promo.is_active) {
    throw new RoletaAppError('Código desativado', 400);
  }

  throwIfPromoCodeExpired(promo, serverNowMs);

  const treatAsRoleta = await promoCodeRowEligibleForRoletaFlow(tx, promo);

  if (
    promo.type === 'global_once' ||
    promo.type === 'roleta_global_1x' ||
    promo.type === 'roleta_player_1x'
  ) {
    const locked = await tx.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM promo_codes WHERE code = ${normalizedCode} FOR UPDATE
    `;
    const raw = locked[0];
    if (!raw) {
      throw new RoletaAppError('Código inválido', 404);
    }
    promo = mapRawPromoRow(raw);
    if (!promo.is_active) {
      throw new RoletaAppError('Expirado.', 404);
    }
    throwIfPromoCodeExpired(promo, serverNowMs);
  }

  if (
    promo.type === 'global_once' ||
    promo.type === 'roleta_global_1x' ||
    promo.type === 'roleta_player_1x'
  ) {
    const globalRedeem = await tx.promo_code_redemptions.findFirst({
      where: { code: promo.code },
      select: { code: true }
    });
    if (globalRedeem) {
      throw new RoletaAppError('Este código já foi resgatado.', 400);
    }
  }

  const existingUserRedeem = await tx.promo_code_redemptions.findUnique({
    where: { code_user_id: { code: promo.code, user_id: userId } },
    select: { reward_granted: true }
  });

  if (existingUserRedeem) {
    const rg = existingUserRedeem.reward_granted ?? 1;
    if (treatAsRoleta && rg === 0) {
      return { kind: 'roleta_reentry', code: promo.code };
    }
    throw new RoletaAppError('Você já resgatou este código.', 400);
  }

  const redeemedAt = BigInt(serverNowMs);

  if (treatAsRoleta) {
    await tx.promo_code_redemptions.create({
      data: {
        code: promo.code,
        user_id: userId,
        redeemed_at: redeemedAt,
        reward_granted: 0
      }
    });
    return { kind: 'roleta_new', code: promo.code, serverNowMs };
  }

  await tx.promo_code_redemptions.create({
    data: {
      code: promo.code,
      user_id: userId,
      redeemed_at: redeemedAt
    }
  });

  if (promo.loot_box_id) {
    const bid = String(promo.loot_box_id).trim();
    await tx.unopened_boxes.upsert({
      where: { user_id_box_id: { user_id: userId, box_id: bid } },
      create: { user_id: userId, box_id: bid, qty: 1 },
      update: { qty: { increment: 1 } }
    });
  } else if (promo.upgrade_id) {
    const iid = String(promo.upgrade_id).trim();
    await tx.stock.upsert({
      where: { user_id_item_id: { user_id: userId, item_id: iid } },
      create: { user_id: userId, item_id: iid, qty: 1 },
      update: { qty: { increment: 1 } }
    });
  } else if (promo.admin_upgrade_id) {
    await grantAdminUpgradeRewards(userId, String(promo.admin_upgrade_id).trim(), tx);
  }

  if (promo.type === 'global_once') {
    await tx.promo_codes.update({
      where: { code: normalizedCode },
      data: { is_active: 0 }
    });
  }

  const boxesRes = await tx.unopened_boxes.findMany({
    where: { user_id: userId },
    select: { box_id: true, qty: true }
  });
  const unopenedBoxes: Record<string, number> = {};
  for (const r of boxesRes) {
    unopenedBoxes[r.box_id] = r.qty;
  }

  const stockRes = await tx.stock.findMany({
    where: { user_id: userId },
    select: { item_id: true, qty: true }
  });
  const stock: Record<string, number> = {};
  for (const r of stockRes) {
    stock[r.item_id] = r.qty;
  }

  return {
    kind: 'standard',
    unopenedBoxes,
    stock,
    lootBoxId: promo.loot_box_id,
    upgradeId: promo.upgrade_id,
    adminUpgradeId: promo.admin_upgrade_id
  };
}
