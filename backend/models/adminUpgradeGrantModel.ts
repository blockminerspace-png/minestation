import type { Prisma } from '@prisma/client';

/** Item entregue por um bundle expandido (formato compatível com `LootRewardGrant`). */
export type AdminUpgradeBundleReward = {
  type: 'item' | 'currency' | 'coin' | 'box' | 'pass' | 'access_level';
  id: string;
  qty: number;
};

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

/** Prefixo do ID da caixa criada a partir de um pacote de upgrade. */
export const UPGRADE_PACKAGE_BOX_TRIGGER = 'upgrade_package';
/** Aceita apenas chars suportados por `parseLootBoxId` (`[a-zA-Z0-9_.-]+`). */
function upgradePackageBoxIdFromUpgradeId(upgradeId: string): string {
  const safe = String(upgradeId || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `upgrade_pkg_${safe}`.slice(0, 200);
}

type LootBoxItemDraft = {
  item_type: string;
  item_id: string;
  min_qty: number;
  max_qty: number;
  probability: number;
};

/**
 * Materializa um pacote de upgrade como **uma única caixa** em `loot_boxes` e
 * incrementa `unopened_boxes` do utilizador em +1.
 *
 * Estrutura da caixa:
 * - 1 linha de entrega (`item_type='bundle'`, `probability=100`) que, na abertura,
 *   delega em `grantAdminUpgradeRewardsInTx` (USDC + moedas + items + passes + access).
 * - N linhas de display (`probability=0`) para o frontend mostrar o conteúdo nominal
 *   sem afetar o sorteio.
 */
export async function materializeUpgradePackageAsLootBoxInTx(
  tx: Prisma.TransactionClient,
  args: { userId: number; upgradeId: string }
): Promise<{ boxId: string; boxName: string }> {
  const { userId, upgradeId } = args;
  const upgrade = await tx.admin_upgrades.findUnique({ where: { id: upgradeId } });
  if (!upgrade) {
    throw new Error('Upgrade não encontrado ao materializar caixa.');
  }

  const boxId = upgradePackageBoxIdFromUpgradeId(upgrade.id);
  const baseName = String(upgrade.name || '').trim();
  const boxName = (baseName ? `Pacote ${baseName}` : `Pacote ${upgrade.id}`).slice(0, 200);
  /**
   * Mantemos o sufixo `upgrade_package:<id>` machine-readable para troubleshooting,
   * mas prefixamos um título amigável que o frontend mostra acima do conteúdo do card.
   */
  const description = `Pacote de upgrade · abra para receber o conteúdo. (upgrade_package:${upgrade.id})`;
  /** Ícone reutilizável; nada exige asset dedicado para pacotes. */
  const icon = '/img/lootboxes/upgrade_package.png';

  await tx.loot_boxes.upsert({
    where: { id: boxId },
    create: {
      id: boxId,
      name: boxName,
      description,
      price: 0,
      trigger: UPGRADE_PACKAGE_BOX_TRIGGER,
      icon,
      /** Mantemos `is_active=0` para não aparecer na loja (`shop/shop_once/special`); inventário ignora este filtro. */
      is_active: 0,
      stock: null,
      max_per_order: 1,
      max_per_user: null
    },
    update: {
      name: boxName,
      description,
      trigger: UPGRADE_PACKAGE_BOX_TRIGGER,
      is_active: 0
    }
  });

  const [adminItems, adminCoins, adminBoxes] = await Promise.all([
    tx.admin_upgrade_items.findMany({ where: { upgrade_id: upgrade.id } }),
    tx.admin_upgrade_coins.findMany({ where: { upgrade_id: upgrade.id } }),
    tx.admin_upgrade_boxes.findMany({ where: { upgrade_id: upgrade.id } })
  ]);

  const drafts: LootBoxItemDraft[] = [];

  drafts.push({
    item_type: 'bundle',
    item_id: upgrade.id,
    min_qty: 1,
    max_qty: 1,
    probability: 100
  });

  for (const it of adminItems) {
    const q = Math.max(0, Math.floor(Number(it.qty) || 0));
    if (q <= 0) continue;
    drafts.push({
      item_type: 'item',
      item_id: String(it.item_id),
      min_qty: q,
      max_qty: q,
      probability: 0
    });
  }

  const usdc = Math.max(0, Number(upgrade.grant_usdc ?? 0));
  if (Number.isFinite(usdc) && usdc > 0) {
    drafts.push({
      item_type: 'currency',
      item_id: 'usdc',
      min_qty: Math.floor(usdc),
      max_qty: Math.floor(usdc),
      probability: 0
    });
  }

  for (const c of adminCoins) {
    const amt = Math.max(0, Math.floor(Number(c.amount) || 0));
    if (amt <= 0) continue;
    drafts.push({
      item_type: 'coin',
      item_id: String(c.coin_id),
      min_qty: amt,
      max_qty: amt,
      probability: 0
    });
  }

  /**
   * Caixas-recompensa (outras loot_boxes incluídas pelo pacote) ficam fora do display
   * para evitar nomes desconhecidos no card; continuam a ser entregues no `open` via
   * `grantAdminUpgradeRewardsInTx` (linha bundle).
   */
  void adminBoxes;

  await tx.loot_box_items.deleteMany({ where: { box_id: boxId } });
  if (drafts.length > 0) {
    await tx.loot_box_items.createMany({
      data: drafts.map((d) => ({
        box_id: boxId,
        item_type: d.item_type,
        item_id: d.item_id,
        min_qty: d.min_qty,
        max_qty: d.max_qty,
        probability: d.probability
      }))
    });
  }

  await tx.unopened_boxes.upsert({
    where: { user_id_box_id: { user_id: userId, box_id: boxId } },
    create: { user_id: userId, box_id: boxId, qty: 1 },
    update: { qty: { increment: 1 } }
  });

  return { boxId, boxName };
}

/**
 * Lê o conteúdo nominal de um pacote admin (`admin_upgrade_*`) e devolve uma lista
 * de recompensas em formato compatível com `LootRewardGrant`. Usado pelo
 * `executeLootBoxOpenInTransaction` para substituir a entrada interna `type='bundle'`
 * (que não tem nome próprio no catálogo do utilizador) pelos prémios reais —
 * é o que o modal "RECOMPENSAS" exibe ao jogador. Não faz writes na BD.
 *
 * `multiplier` permite suportar bundles abertos N vezes (mantemos a semântica do loop
 * que já existia em `executeLootBoxOpenInTransaction`).
 */
export async function expandAdminUpgradeBundleAsLootRewardsInTx(
  tx: Prisma.TransactionClient,
  upgradeId: string,
  multiplier: number
): Promise<AdminUpgradeBundleReward[]> {
  const m = Math.max(0, Math.floor(Number(multiplier) || 0));
  if (!m) return [];

  const upgrade = await tx.admin_upgrades.findUnique({
    where: { id: upgradeId },
    select: { grant_usdc: true, grant_access_level_id: true }
  });
  if (!upgrade) return [];

  const [items, coins, boxes, passes] = await Promise.all([
    tx.admin_upgrade_items.findMany({ where: { upgrade_id: upgradeId } }),
    tx.admin_upgrade_coins.findMany({ where: { upgrade_id: upgradeId } }),
    tx.admin_upgrade_boxes.findMany({ where: { upgrade_id: upgradeId } }),
    tx.admin_upgrade_passes.findMany({ where: { upgrade_id: upgradeId } })
  ]);

  const out: AdminUpgradeBundleReward[] = [];

  const usdc = Number(upgrade.grant_usdc ?? 0);
  if (Number.isFinite(usdc) && usdc > 0) {
    out.push({ type: 'currency', id: 'usdc', qty: usdc * m });
  }

  for (const it of items) {
    const q = Math.floor(Number(it.qty));
    if (!Number.isFinite(q) || q <= 0) continue;
    out.push({ type: 'item', id: String(it.item_id), qty: q * m });
  }

  for (const c of coins) {
    const q = Number(c.amount);
    if (!Number.isFinite(q) || q === 0) continue;
    out.push({ type: 'coin', id: String(c.coin_id), qty: q * m });
  }

  for (const b of boxes) {
    const q = Math.floor(Number(b.qty));
    if (!Number.isFinite(q) || q <= 0) continue;
    out.push({ type: 'box', id: String(b.box_id), qty: q * m });
  }

  /** Passes / acesso são marcadores de display (qty=1 cada); a entrega real continua em `grantAdminUpgradeRewardsInTx`. */
  for (const p of passes) {
    const passId = String(p.pass_id || '').trim();
    if (!passId) continue;
    out.push({ type: 'pass', id: passId, qty: 1 * m });
  }

  const alid = String(upgrade.grant_access_level_id ?? '').trim();
  if (alid) {
    out.push({ type: 'access_level', id: alid, qty: 1 });
  }

  return out;
}

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
