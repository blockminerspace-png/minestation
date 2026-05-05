import type { PoolClient } from 'pg';
import { RoletaAppError } from '../validation/roletaValidation.js';
import { promoCodeRowEligibleForRoletaFlow, throwIfPromoCodeExpired } from './promoCodeRoleta.js';

export type GrantAdminUpgradeRewardsFn = (
  userId: number,
  upgradeId: string,
  client: PoolClient
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
  is_active: number;
  expires_at?: number | null;
};

/**
 * Corpo da transação de resgate (já dentro de `BEGIN`).
 * Usa apenas queries parametrizadas.
 */
export async function runPromoCodeRedeemInTransaction(
  client: PoolClient,
  args: {
    userId: number;
    normalizedCode: string;
    serverNowMs: number;
    grantAdminUpgradeRewards: GrantAdminUpgradeRewardsFn;
  }
): Promise<PromoRedeemTransactionResult> {
  const { userId, normalizedCode, serverNowMs, grantAdminUpgradeRewards } = args;

  let codeRows = await client.query(`SELECT * FROM promo_codes WHERE code = $1`, [normalizedCode]);
  let promo = codeRows.rows[0] as PromoRow | undefined;

  if (!promo) {
    throw new RoletaAppError('Código inválido', 404);
  }

  if (!promo.is_active) {
    throw new RoletaAppError('Código desativado', 400);
  }

  throwIfPromoCodeExpired(promo, serverNowMs);

  const treatAsRoleta = await promoCodeRowEligibleForRoletaFlow(client, promo);

  if (
    promo.type === 'global_once' ||
    promo.type === 'roleta_global_1x' ||
    promo.type === 'roleta_player_1x'
  ) {
    codeRows = await client.query(`SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE`, [
      normalizedCode
    ]);
    promo = codeRows.rows[0] as PromoRow | undefined;
    if (!promo?.is_active) {
      throw new RoletaAppError('Expirado.', 404);
    }
    throwIfPromoCodeExpired(promo, serverNowMs);
  }

  if (
    promo.type === 'global_once' ||
    promo.type === 'roleta_global_1x' ||
    promo.type === 'roleta_player_1x'
  ) {
    const globalCheck = await client.query(
      `SELECT 1 FROM promo_code_redemptions WHERE code = $1 LIMIT 1`,
      [promo.code]
    );
    if (globalCheck.rowCount && globalCheck.rowCount > 0) {
      throw new RoletaAppError('Este código já foi resgatado.', 400);
    }
  }

  const userCheck = await client.query(
    `SELECT reward_granted FROM promo_code_redemptions WHERE code = $1 AND user_id = $2`,
    [promo.code, userId]
  );

  if (userCheck.rowCount && userCheck.rowCount > 0) {
    const rg = (userCheck.rows[0] as { reward_granted: number }).reward_granted;
    if (treatAsRoleta && rg === 0) {
      return { kind: 'roleta_reentry', code: promo.code };
    }
    throw new RoletaAppError('Você já resgatou este código.', 400);
  }

  if (treatAsRoleta) {
    await client.query(
      `INSERT INTO promo_code_redemptions (code, user_id, redeemed_at, reward_granted)
       VALUES ($1, $2, $3, 0)`,
      [promo.code, userId, serverNowMs]
    );
    return { kind: 'roleta_new', code: promo.code, serverNowMs };
  }

  await client.query(
    `INSERT INTO promo_code_redemptions (code, user_id, redeemed_at) VALUES ($1, $2, $3)`,
    [promo.code, userId, serverNowMs]
  );

  if (promo.loot_box_id) {
    await client.query(
      `INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1)
       ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1`,
      [userId, promo.loot_box_id]
    );
  } else if (promo.upgrade_id) {
    await client.query(
      `INSERT INTO stock (user_id, item_id, qty) VALUES ($1, $2, 1)
       ON CONFLICT (user_id, item_id) DO UPDATE SET qty = stock.qty + 1`,
      [userId, promo.upgrade_id]
    );
  } else if (promo.admin_upgrade_id) {
    await grantAdminUpgradeRewards(userId, promo.admin_upgrade_id, client);
  }

  if (promo.type === 'global_once') {
    await client.query(`UPDATE promo_codes SET is_active = 0 WHERE code = $1`, [normalizedCode]);
  }

  const boxesRes = await client.query(`SELECT box_id, qty FROM unopened_boxes WHERE user_id = $1`, [
    userId
  ]);
  const unopenedBoxes: Record<string, number> = {};
  for (const r of boxesRes.rows as Array<{ box_id: string; qty: number }>) {
    unopenedBoxes[r.box_id] = r.qty;
  }

  const stockRes = await client.query(`SELECT item_id, qty FROM stock WHERE user_id = $1`, [userId]);
  const stock: Record<string, number> = {};
  for (const r of stockRes.rows as Array<{ item_id: string; qty: number }>) {
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
