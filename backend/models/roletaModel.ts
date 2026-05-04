import type { PoolClient } from 'pg';
import crypto from 'node:crypto';
import { RoletaAppError, sanitizeDisplayName } from '../validation/roletaValidation.js';
import { promoCodeRowEligibleForRoletaFlow } from './promoCodeRoleta.js';

export type WheelPrizeRow = {
  id: string;
  label: string;
  weight: number;
  color: string | null;
  item_id: string;
};

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

/**
 * Exige transação ativa. Bloqueia linha de resgate (`FOR UPDATE`) para evitar corrida em roll/claim.
 */
export async function wheelRollInTransaction(
  client: PoolClient,
  args: { userId: number; normalizedCode: string; serverNowMs: number }
): Promise<WheelRollResult> {
  const { userId, normalizedCode, serverNowMs } = args;

  const redRes = await client.query(
    `SELECT reward_granted, won_item_id
     FROM promo_code_redemptions
     WHERE code = $1 AND user_id = $2
     FOR UPDATE`,
    [normalizedCode, userId]
  );

  if (redRes.rowCount === 0) {
    throw new RoletaAppError('Você precisa resgatar o código primeiro.', 400);
  }

  const redemption = redRes.rows[0] as {
    reward_granted: number;
    won_item_id: string | null;
  };

  if (redemption.reward_granted === 1) {
    throw new RoletaAppError('Este código já foi totalmente utilizado.', 400);
  }

  const promoRowRes = await client.query(`SELECT type, loot_box_id FROM promo_codes WHERE code = $1`, [normalizedCode]);
  const prow = promoRowRes.rows[0] as { type?: string; loot_box_id?: string | null } | undefined;
  const wheelOk = prow ? await promoCodeRowEligibleForRoletaFlow(client, prow) : false;
  if (!wheelOk) {
    throw new RoletaAppError('Este código não permite giro de roleta.', 400);
  }

  if (redemption.won_item_id) {
    const prizeRes = await client.query(`SELECT * FROM wheel_prizes WHERE item_id = $1`, [
      redemption.won_item_id
    ]);
    const item = (prizeRes.rows[0] as WheelPrizeRow | undefined) ?? null;
    return { wonItemId: String(redemption.won_item_id), item, idempotent: true };
  }

  const prizesRes = await client.query(`SELECT * FROM wheel_prizes`);
  const prizes = prizesRes.rows as WheelPrizeRow[];
  if (prizes.length === 0) {
    throw new RoletaAppError('Configuração da roleta não encontrada.', 500);
  }

  const selected = pickWeightedPrize(prizes);

  const upd = await client.query(
    `UPDATE promo_code_redemptions
     SET won_item_id = $1, roulette_rolled_at = $2
     WHERE code = $3 AND user_id = $4
       AND won_item_id IS NULL
       AND reward_granted = 0`,
    [selected.item_id, serverNowMs, normalizedCode, userId]
  );

  if (upd.rowCount === 0) {
    const again = await client.query(
      `SELECT won_item_id FROM promo_code_redemptions WHERE code = $1 AND user_id = $2`,
      [normalizedCode, userId]
    );
    const wid = again.rows[0]?.won_item_id;
    if (wid) {
      const prizeRes = await client.query(`SELECT * FROM wheel_prizes WHERE item_id = $1`, [wid]);
      const item = (prizeRes.rows[0] as WheelPrizeRow | undefined) ?? null;
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
  client: PoolClient,
  args: {
    userId: number;
    normalizedCode: string;
    wonItemId: string;
    serverNowMs: number;
  }
): Promise<RoletaClaimResult> {
  const { userId, normalizedCode, wonItemId, serverNowMs } = args;

  const redRes = await client.query(
    `SELECT reward_granted, won_item_id
     FROM promo_code_redemptions
     WHERE code = $1 AND user_id = $2
     FOR UPDATE`,
    [normalizedCode, userId]
  );

  if (redRes.rowCount === 0) {
    throw new RoletaAppError('Código não resgatado.', 400);
  }

  const redemption = redRes.rows[0] as {
    reward_granted: number;
    won_item_id: string | null;
  };

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

  const codeRes = await client.query(`SELECT type, loot_box_id FROM promo_codes WHERE code = $1`, [normalizedCode]);
  const promo = codeRes.rows[0] as { type?: string; loot_box_id?: string | null } | undefined;
  const claimOk = promo ? await promoCodeRowEligibleForRoletaFlow(client, promo) : false;
  if (!claimOk) {
    throw new RoletaAppError('Tipo de código inválido.', 400);
  }

  const boxRes = await client.query(
    `SELECT id FROM loot_boxes
     WHERE trigger = 'roleta_reward' AND description = $1`,
    [`reward_for_${wonItemId}`]
  );

  let prizeBoxId: string;
  if (boxRes.rows[0]) {
    prizeBoxId = (boxRes.rows[0] as { id: string }).id;
  } else {
    prizeBoxId = crypto.randomUUID();
    const upgRes = await client.query(`SELECT name FROM upgrades WHERE id = $1`, [wonItemId]);
    const rawName = (upgRes.rows[0] as { name?: string } | undefined)?.name ?? wonItemId;
    const itemName = sanitizeDisplayName(String(rawName), 120);
    const boxName = `Prêmio: ${itemName}`;

    await client.query(
      `INSERT INTO loot_boxes (id, name, description, price, trigger, icon)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [prizeBoxId, boxName, `reward_for_${wonItemId}`, 0, 'roleta_reward', '🎁']
    );

    await client.query(
      `INSERT INTO loot_box_items (box_id, item_type, item_id, min_qty, max_qty, probability)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [prizeBoxId, 'item', wonItemId, 1, 1, 100]
    );
  }

  const boxNameRow = await client.query(`SELECT name FROM loot_boxes WHERE id = $1`, [prizeBoxId]);
  const boxName = sanitizeDisplayName(
    String((boxNameRow.rows[0] as { name?: string } | undefined)?.name ?? 'Prêmio'),
    200
  );

  await client.query(
    `INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1`,
    [userId, prizeBoxId]
  );

  const upd = await client.query(
    `UPDATE promo_code_redemptions
     SET reward_granted = 1, roulette_claimed_at = $1
     WHERE code = $2 AND user_id = $3 AND reward_granted = 0`,
    [serverNowMs, normalizedCode, userId]
  );

  if (upd.rowCount === 0) {
    throw new RoletaAppError('Falha ao finalizar resgate do código (nenhuma linha atualizada).', 409);
  }

  return { boxId: prizeBoxId, boxName };
}
