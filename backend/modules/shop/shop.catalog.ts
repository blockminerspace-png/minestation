import { prisma } from '../../config/prisma.js';
import { normalizePublicAssetUrl } from '../../lib/publicAssetUrl.js';
import type { ShopProductDto } from './shop.types.js';

/**
 * Catálogo alinhado a `GET /api/upgrades` + filtros da Lojinha (mercado hardware).
 * Itens NFT entram na listagem para o jogador filtrar / consultar; checkout USDC continua bloqueado no API.
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
      : {
          AND: [
            { NOT: { id: { startsWith: 'temp_legacy_' } } },
            { category: { not: 'legacy-temp' } },
            { type: { not: 'legacy-temp' } },
            { OR: [{ is_active: null }, { is_active: { not: 0 } }] }
          ]
        }
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
  const base = products.filter((u) => {
    if (u.status === 'legacy' || u.status === 'exclusive') return false;
    if (!u.isActive) return false;
    return true;
  });
  const nonNft = base.filter((u) => !u.isNft);
  const explicitHardware = nonNft.filter((u) => u.sellInHardwareMarket);
  const core = explicitHardware.length > 0 ? explicitHardware : nonNft;
  const nftRows = base.filter((u) => u.isNft);
  const byId = new Map<string, ShopProductDto>();
  for (const p of core) byId.set(p.id, p);
  for (const p of nftRows) byId.set(p.id, p);
  return Array.from(byId.values());
}
