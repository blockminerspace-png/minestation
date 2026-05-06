import type { Prisma } from '@prisma/client';

/**
 * Recompensas de season pass (ordem USDC → moedas → stock → caixas legacy).
 * Deve correr dentro do mesmo `prisma.$transaction` que o resgate/compra.
 */
export async function grantPassRewardsInTx(
  tx: Prisma.TransactionClient,
  userId: number,
  passId: string,
  seasonId: string
): Promise<void> {
  const rewards = await tx.season_pass_rewards.findMany({
    where: { pass_id: passId }
  });

  const usdcRewards = rewards.filter((r) => r.type === 'currency' && r.coin_id === 'usdc');
  const coinRewards = rewards.filter((r) => r.type === 'currency' && r.coin_id && r.coin_id !== 'usdc');
  const itemRewards = rewards.filter((r) => r.type === 'item');

  for (const reward of usdcRewards) {
    const q = Number(reward.qty);
    if (!Number.isFinite(q) || q === 0) continue;
    await tx.game_states.updateMany({
      where: { user_id: userId },
      data: { usdc: { increment: q } }
    });
  }

  for (const reward of coinRewards) {
    const cid = String(reward.coin_id || '');
    const q = Number(reward.qty);
    if (!cid || !Number.isFinite(q) || q === 0) continue;
    await tx.coin_balances.upsert({
      where: { user_id_coin_id: { user_id: userId, coin_id: cid } },
      create: { user_id: userId, coin_id: cid, amount: q },
      update: { amount: { increment: q } }
    });
  }

  for (const reward of itemRewards) {
    const iid = String(reward.item_id || '');
    const q = Math.floor(Number(reward.qty));
    if (!iid || !Number.isFinite(q) || q <= 0) continue;
    await tx.stock.upsert({
      where: { user_id_item_id: { user_id: userId, item_id: iid } },
      create: { user_id: userId, item_id: iid, qty: q },
      update: { qty: { increment: q } }
    });
  }

  const passT = passId.trim();
  const seasonT = `season:${seasonId.trim()}`;
  const boxRewards = await tx.loot_boxes.findMany({
    where: {
      OR: [
        { trigger: { equals: passT, mode: 'insensitive' } },
        { trigger: { equals: seasonT, mode: 'insensitive' } }
      ]
    },
    select: { id: true }
  });

  for (const box of boxRewards) {
    await tx.unopened_boxes.upsert({
      where: { user_id_box_id: { user_id: userId, box_id: box.id } },
      create: { user_id: userId, box_id: box.id, qty: 1 },
      update: { qty: { increment: 1 } }
    });
  }
}

const GENESIS_BUNDLE_UPGRADE_ID = '53f0c699-0471-4e65-a147-17064e3aafe0';
const GENESIS_ROOM_ID = 'room_1765936323521';

/**
 * Concede um pacote admin (loja / promo) dentro de uma transação Prisma.
 * Concede pacote admin (única implementação usada em Prisma).
 */
export async function grantAdminUpgradeRewardsInTx(
  userId: number,
  upgradeId: string,
  tx: Prisma.TransactionClient
): Promise<Record<string, unknown>> {
  const upgrade = await tx.admin_upgrades.findUnique({
    where: { id: upgradeId }
  });
  if (!upgrade) {
    throw new Error('Upgrade não encontrado');
  }

  const grantUsdc = Number(upgrade.grant_usdc ?? 0);
  if (Number.isFinite(grantUsdc) && grantUsdc > 0) {
    await tx.game_states.updateMany({
      where: { user_id: userId },
      data: { usdc: { increment: grantUsdc } }
    });
  }

  const coins = await tx.admin_upgrade_coins.findMany({ where: { upgrade_id: upgrade.id } });
  for (const c of coins) {
    const amt = Number(c.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    await tx.coin_balances.upsert({
      where: { user_id_coin_id: { user_id: userId, coin_id: c.coin_id } },
      create: { user_id: userId, coin_id: c.coin_id, amount: amt },
      update: { amount: { increment: amt } }
    });
  }

  const items = await tx.admin_upgrade_items.findMany({ where: { upgrade_id: upgrade.id } });
  for (const it of items) {
    const q = Math.floor(Number(it.qty));
    if (!Number.isFinite(q) || q <= 0) continue;
    await tx.stock.upsert({
      where: { user_id_item_id: { user_id: userId, item_id: it.item_id } },
      create: { user_id: userId, item_id: it.item_id, qty: q },
      update: { qty: { increment: q } }
    });
  }

  const boxes = await tx.admin_upgrade_boxes.findMany({ where: { upgrade_id: upgrade.id } });
  for (const b of boxes) {
    const q = Math.floor(Number(b.qty));
    if (!Number.isFinite(q) || q <= 0) continue;
    await tx.unopened_boxes.upsert({
      where: { user_id_box_id: { user_id: userId, box_id: b.box_id } },
      create: { user_id: userId, box_id: b.box_id, qty: q },
      update: { qty: { increment: q } }
    });
  }

  const passes = await tx.admin_upgrade_passes.findMany({ where: { upgrade_id: upgrade.id } });
  const now = BigInt(Date.now());
  for (const p of passes) {
    const sp = await tx.season_passes.findUnique({
      where: { id: p.pass_id },
      select: { season_id: true }
    });
    if (!sp?.season_id) continue;
    const seasonId = String(sp.season_id);
    await tx.season_purchases.createMany({
      data: [{ user_id: userId, pass_id: p.pass_id, season_id: seasonId, purchased_at: now }],
      skipDuplicates: true
    });
    await grantPassRewardsInTx(tx, userId, p.pass_id, seasonId);
  }

  const al = upgrade.grant_access_level_id;
  if (al != null && String(al).trim() !== '') {
    const alid = String(al).trim();
    await tx.users.update({
      where: { id: userId },
      data: { access_level_id: alid }
    });
    await tx.user_access_levels.createMany({
      data: [{ user_id: userId, access_level_id: alid, granted_at: now }],
      skipDuplicates: true
    });
  }

  const boxRewards = await tx.loot_boxes.findMany({
    where: { trigger: upgradeId },
    select: { id: true }
  });
  for (const box of boxRewards) {
    await tx.unopened_boxes.upsert({
      where: { user_id_box_id: { user_id: userId, box_id: box.id } },
      create: { user_id: userId, box_id: box.id, qty: 1 },
      update: { qty: { increment: 1 } }
    });
  }

  if (upgradeId === GENESIS_BUNDLE_UPGRADE_ID) {
    await tx.user_rig_rooms.createMany({
      data: [
        {
          user_id: userId,
          room_id: GENESIS_ROOM_ID,
          purchased_at: now,
          unlocked_slots: 0
        }
      ],
      skipDuplicates: true
    });
  }

  return upgrade as unknown as Record<string, unknown>;
}
