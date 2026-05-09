import { prisma } from '../../config/prisma.js';
import { normalizePublicAssetUrl } from '../../lib/publicAssetUrl.js';
import type { ShopProductDto } from './shop.types.js';

/**
 * Catálogo alinhado a `GET /api/upgrades` + filtros da Lojinha (sem NFT, mercado hardware).
 */
export async function loadHardwareShopProducts(isAdminUser: boolean): Promise<ShopProductDto[]> {
  const rows = await prisma.upgrades.findMany({
    where: isAdminUser
      ? {
          AND: [
            { NOT: { id: { startsWith: 'temp_legacy_' } } },
            { category: { not: 'legacy-temp' } },
            { type: { not: 'legacy-temp' } }
          ]
        }
      : { is_active: 1 }
  });
  const compatRows = await prisma.upgrade_compat_racks.findMany();
  const compatMap = compatRows.reduce<Record<string, string[]>>((acc, r) => {
    acc[r.upgrade_id] = acc[r.upgrade_id] || [];
    acc[r.upgrade_id].push(r.rack_id);
    return acc;
  }, {});

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    type: r.type,
    baseCost: Number(r.base_cost) || 0,
    baseProduction: Number(r.base_production) || 0,
    powerConsumption: r.power_consumption ?? undefined,
    powerCapacity: r.power_capacity ?? undefined,
    multiplier: r.multiplier ?? undefined,
    slotsCapacity: r.slots_capacity ?? undefined,
    aiSlotsCapacity: r.ai_slots_capacity ?? undefined,
    description: r.description,
    icon: r.icon,
    status: r.status,
    isNft: !!r.is_nft,
    maxGlobalStock: r.max_global_stock ?? undefined,
    totalSold: Number(r.total_sold) || 0,
    image: normalizePublicAssetUrl(r.image != null ? String(r.image) : undefined) ?? undefined,
    compatibleRacks: compatMap[r.id] || [],
    rewardWh: r.reward_wh ?? 0,
    sellInHardwareMarket: r.sell_in_hardware_market !== 0,
    isActive: r.is_active !== 0
  }));
}

export function filterProductsForMinerShop(products: ShopProductDto[]): ShopProductDto[] {
  return products.filter((u) => {
    if (u.status === 'legacy' || u.status === 'exclusive') return false;
    if (!u.sellInHardwareMarket) return false;
    if (u.isNft) return false;
    if (!u.isActive) return false;
    return true;
  });
}
