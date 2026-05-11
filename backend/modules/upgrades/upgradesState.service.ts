import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { loadAdminUpgradesForUser } from '../../lib/meUpgradeShopBundlePayload.js';
import { computeDiscountPercent, usdcDecimalFromRow } from './upgrades.catalog.js';

type AdminPackRow = {
  id: string;
  name: string;
  description?: string | null;
  priceUsdc: unknown;
  grantUsdc?: unknown;
  grantAccessLevelId?: string | null;
  isActive: boolean;
  items: { itemId: string; qty: number }[];
  boxes: { boxId: string; qty: number }[];
  passes: string[];
  coins: { coinId: string; amount: unknown }[];
  visibleToAccessLevelIds: string[];
  alreadyOwned: boolean;
  version?: number;
  slug?: string | null;
  category?: string;
  originalPriceUsdc?: string | null;
  stockRemaining?: number | null;
  maxPerUser?: number;
  startsAt?: number | null;
  endsAt?: number | null;
  sortOrder?: number;
  imageUrl?: string | null;
};

function itemPreviewLabel(
  nameById: Map<string, string>,
  boxNameById: Map<string, string>,
  row: AdminPackRow
): Array<{ rewardType: string; catalogId: string; quantity: number; label: string }> {
  const out: Array<{ rewardType: string; catalogId: string; quantity: number; label: string }> = [];
  for (const it of row.items || []) {
    const q = Math.max(1, Math.floor(Number(it.qty) || 0));
    out.push({
      rewardType: 'STOCK_ITEM',
      catalogId: it.itemId,
      quantity: q,
      label: nameById.get(it.itemId) || it.itemId
    });
  }
  for (const b of row.boxes || []) {
    const q = Math.max(1, Math.floor(Number(b.qty) || 0));
    out.push({
      rewardType: 'LOOT_BOX',
      catalogId: b.boxId,
      quantity: q,
      label: boxNameById.get(b.boxId) || b.boxId
    });
  }
  for (const pid of row.passes || []) {
    out.push({
      rewardType: 'SEASON_PASS',
      catalogId: pid,
      quantity: 1,
      label: 'Season pass'
    });
  }
  for (const c of row.coins || []) {
    const amt = Number(c.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    out.push({
      rewardType: 'MINED_COIN',
      catalogId: c.coinId,
      quantity: amt,
      label: c.coinId
    });
  }
  const grant = Number(row.grantUsdc ?? 0);
  if (Number.isFinite(grant) && grant > 0) {
    out.push({
      rewardType: 'USDC_GRANT',
      catalogId: 'usdc',
      quantity: grant,
      label: 'USDC (bónus do pacote)'
    });
  }
  if (row.grantAccessLevelId) {
    out.push({
      rewardType: 'ACCESS_LEVEL',
      catalogId: row.grantAccessLevelId,
      quantity: 1,
      label: 'Nível de acesso'
    });
  }
  return out;
}

function visibleToUser(p: AdminPackRow, levelIds: Set<string>): boolean {
  const v = p.visibleToAccessLevelIds || [];
  if (!v.length) return true;
  return v.some((id) => levelIds.has(String(id)));
}

export async function buildUpgradesStatePayload(userId: number, nowMs?: number): Promise<Record<string, unknown>> {
  const nowBi = BigInt(nowMs ?? Date.now());

  const [usr, levelRows, gs, packsRaw, upgradeNames, lootRows, recentPurch] = await Promise.all([
    prisma.users.findUnique({
      where: { id: userId },
      select: { access_level_id: true }
    }),
    prisma.user_access_levels.findMany({
      where: { user_id: userId },
      select: { access_level_id: true }
    }),
    prisma.game_states.findUnique({
      where: { user_id: userId },
      select: { usdc: true }
    }),
    loadAdminUpgradesForUser(userId),
    prisma.upgrades.findMany({ select: { id: true, name: true } }),
    prisma.loot_boxes.findMany({ select: { id: true, name: true } }),
    prisma.admin_upgrade_purchases.findMany({
      where: { user_id: userId },
      orderBy: { purchased_at: 'desc' },
      take: 30
    })
  ]);

  const purchIds = [...new Set(recentPurch.map((r) => r.upgrade_id))];
  const purchMeta =
    purchIds.length > 0
      ? await prisma.admin_upgrades.findMany({
          where: { id: { in: purchIds } },
          select: { id: true, name: true, price_usdc: true }
        })
      : [];
  const purchMetaById = new Map(purchMeta.map((x) => [x.id, x]));

  const levelIds = new Set<string>();
  if (usr?.access_level_id) levelIds.add(String(usr.access_level_id));
  for (const r of levelRows) levelIds.add(String(r.access_level_id));

  const packsVisible = (packsRaw as AdminPackRow[]).filter((p) => visibleToUser(p, levelIds));

  const nameById = new Map(upgradeNames.map((u) => [u.id, u.name]));
  const boxNameById = new Map(lootRows.map((b) => [b.id, b.name]));

  const usdcBal = usdcDecimalFromRow(gs?.usdc ?? 0);
  const packs = packsVisible
    .map((p) => {
    const final = usdcDecimalFromRow(p.priceUsdc);
    const original =
      p.originalPriceUsdc != null && String(p.originalPriceUsdc).trim() !== ''
        ? new Prisma.Decimal(String(p.originalPriceUsdc))
        : null;
    const discountPct = original ? computeDiscountPercent(original, final) : null;

    let unpurchasableReason: string | null = null;
    if (!p.isActive) unpurchasableReason = 'Pacote inativo.';
    else if (p.startsAt != null && nowBi < BigInt(p.startsAt)) unpurchasableReason = 'Venda ainda não iniciou.';
    else if (p.endsAt != null && nowBi > BigInt(p.endsAt)) unpurchasableReason = 'Oferta expirada.';
    else if (p.stockRemaining != null && p.stockRemaining <= 0) unpurchasableReason = 'Esgotado.';
    else if (usdcBal.lt(final)) unpurchasableReason = 'Saldo USDC insuficiente.';

    const isPurchasable = unpurchasableReason == null;

    return {
      id: p.id,
      slug: p.slug ?? null,
      name: p.name,
      description: p.description ?? null,
      imageUrl: p.imageUrl ?? null,
      category: p.category || 'PROMO_PACK',
      currency: 'USDC',
      finalPrice: final.toFixed(6),
      originalPrice: original ? original.toFixed(6) : null,
      discountPercent: discountPct,
      version: p.version ?? 1,
      isPurchasable,
      unpurchasableReason,
      stockRemaining: p.stockRemaining != null ? p.stockRemaining : null,
      maxPerUser: p.maxPerUser ?? 1,
      startsAt: p.startsAt ?? null,
      endsAt: p.endsAt ?? null,
      sortOrder: p.sortOrder ?? 0,
      alreadyOwned: !!p.alreadyOwned,
      itemsPreview: itemPreviewLabel(nameById, boxNameById, p)
    };
  })
    .sort((a, b) => {
      const pa = Number(a.finalPrice);
      const pb = Number(b.finalPrice);
      if (pa !== pb) return pa - pb;
      const oa = Number(a.sortOrder) || 0;
      const ob = Number(b.sortOrder) || 0;
      if (oa !== ob) return oa - ob;
      return String(a.name).localeCompare(String(b.name), 'pt', { sensitivity: 'base' });
    });

  const categories = Array.from(new Set(packs.map((p) => String(p.category || 'PROMO_PACK')))).sort();

  const purchaseHistory = recentPurch.map((r) => {
    const meta = purchMetaById.get(r.upgrade_id);
    return {
      upgradeId: r.upgrade_id,
      name: meta?.name ?? r.upgrade_id,
      paidUsdc: meta != null ? String(meta.price_usdc) : '',
      purchasedAt: Number(r.purchased_at)
    };
  });

  return {
    ok: true,
    title: 'Pacotes e upgrades',
    usdcBalance: usdcBal.toNumber(),
    categories,
    packages: packs,
    purchaseHistory,
    notice:
      'Preços, descontos, stock e conteúdo são definidos no servidor. Envie apenas o id do pacote e idempotência na compra.'
  };
}
