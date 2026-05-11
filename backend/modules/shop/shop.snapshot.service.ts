import { prisma } from '../../config/prisma.js';
import { filterProductsForMinerShop, loadHardwareShopProducts } from './shop.catalog.js';
import { getOrCreateShopCartId, listShopCartLines } from './shop.cart.service.js';
import { getSettingValue } from '../../lib/settingsPrisma.js';
import type { ShopCartLineDto, ShopStateV1Dto } from './shop.types.js';

function productByIdMap(products: Array<{ id: string; baseCost: number }>): Map<string, { baseCost: number }> {
  const m = new Map<string, { baseCost: number }>();
  for (const p of products) m.set(p.id, { baseCost: p.baseCost });
  return m;
}

export async function buildShopStateV1(userId: number): Promise<ShopStateV1Dto> {
  const uRow = await prisma.users.findUnique({
    where: { id: userId },
    select: { is_admin: true }
  });
  const isAdminUser = !!uRow?.is_admin;
  const rawProducts = await loadHardwareShopProducts(isAdminUser);
  const products = filterProductsForMinerShop(rawProducts);

  const gs = await prisma.game_states.findUnique({
    where: { user_id: userId },
    select: { usdc: true }
  });
  const usdc = gs != null && Number.isFinite(Number(gs.usdc)) ? Number(gs.usdc) : 0;

  const hwVal = await getSettingValue('hardware_market_enabled');
  const hardwareMarketEnabled = hwVal == null || hwVal === '1';

  let cartId = '';
  let rawLines: Awaited<ReturnType<typeof listShopCartLines>> = [];
  try {
    cartId = await getOrCreateShopCartId(userId);
    rawLines = await listShopCartLines(userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[ShopState] carrinho indisponível; loja será carregada com carrinho vazio:', msg.slice(0, 240));
  }
  const priceMap = productByIdMap(products);

  const lines: ShopCartLineDto[] = [];
  let totalUsdc = 0;
  for (const ln of rawLines) {
    const p = priceMap.get(ln.productId);
    if (!p) continue;
    const unit = p.baseCost;
    const lineTotal = unit * ln.qty;
    if (!Number.isFinite(lineTotal) || lineTotal < 0) continue;
    totalUsdc += lineTotal;
    lines.push({
      lineId: ln.lineId,
      productId: ln.productId,
      qty: ln.qty,
      unitPrice: unit,
      lineTotal
    });
  }

  return {
    version: 1,
    hardwareMarketEnabled,
    usdc,
    products,
    cart: { cartId, lines, totalUsdc }
  };
}
