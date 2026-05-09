import { prisma } from '../../config/prisma.js';
import { getSettingValue } from '../../lib/settingsPrisma.js';
import { assertMinerShopProductQuantity } from './shop.productRules.js';

const PRODUCT_ID_RE = /^[a-zA-Z0-9_.-]{1,160}$/;
const MAX_LINE_QTY = 50000;

export async function getOrCreateShopCartId(userId: number): Promise<string> {
  const now = BigInt(Date.now());
  const existing = await prisma.shop_carts.findUnique({
    where: { user_id: userId },
    select: { id: true }
  });
  if (existing?.id) return existing.id;
  const created = await prisma.shop_carts.create({
    data: { user_id: userId, updated_at: now },
    select: { id: true }
  });
  return created.id;
}

export async function listShopCartLines(userId: number): Promise<Array<{ lineId: string; productId: string; qty: number }>> {
  const cart = await prisma.shop_carts.findUnique({
    where: { user_id: userId },
    select: { id: true }
  });
  if (!cart) return [];
  const lines = await prisma.shop_cart_lines.findMany({
    where: { cart_id: cart.id, qty: { gt: 0 } },
    select: { id: true, product_id: true, qty: true }
  });
  return lines.map((l) => ({ lineId: l.id, productId: l.product_id, qty: l.qty }));
}

export async function setShopCartLineQuantity(
  userId: number,
  productId: string,
  qty: number
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const pid = String(productId || '').trim();
  if (!PRODUCT_ID_RE.test(pid)) {
    return { ok: false, error: 'Produto inválido.', status: 400 };
  }
  const q = Math.floor(Number(qty));
  if (!Number.isInteger(q) || q < 0 || q > MAX_LINE_QTY) {
    return { ok: false, error: 'Quantidade inválida.', status: 400 };
  }
  const hwVal = await getSettingValue('hardware_market_enabled');
  if (hwVal != null && hwVal !== '1') {
    return { ok: false, error: 'Mercado de hardware pausado.', status: 403 };
  }

  const cartId = await getOrCreateShopCartId(userId);
  const now = BigInt(Date.now());
  if (q === 0) {
    await prisma.shop_cart_lines.deleteMany({ where: { cart_id: cartId, product_id: pid } });
  } else {
    const okSell = await assertMinerShopProductQuantity(pid, q);
    if (!okSell.ok) {
      return { ok: false, error: okSell.error, status: okSell.status };
    }
    await prisma.shop_cart_lines.upsert({
      where: { cart_id_product_id: { cart_id: cartId, product_id: pid } },
      create: { cart_id: cartId, product_id: pid, qty: q, updated_at: now },
      update: { qty: q, updated_at: now }
    });
  }
  await prisma.shop_carts.update({
    where: { id: cartId },
    data: { updated_at: now }
  });
  return { ok: true };
}

export async function setShopCartLineQuantityByLineId(
  userId: number,
  lineId: string,
  qty: number
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const lid = String(lineId || '').trim();
  if (!lid) return { ok: false, error: 'Linha inválida.', status: 400 };
  const cart = await prisma.shop_carts.findUnique({
    where: { user_id: userId },
    select: { id: true }
  });
  if (!cart) return { ok: false, error: 'Carrinho não encontrado.', status: 404 };
  const line = await prisma.shop_cart_lines.findFirst({
    where: { id: lid, cart_id: cart.id },
    select: { product_id: true }
  });
  if (!line) return { ok: false, error: 'Linha não encontrada.', status: 404 };
  return setShopCartLineQuantity(userId, line.product_id, qty);
}

export async function deleteShopCartLine(userId: number, lineId: string): Promise<boolean> {
  const lid = String(lineId || '').trim();
  if (!lid) return false;
  const cart = await prisma.shop_carts.findUnique({
    where: { user_id: userId },
    select: { id: true }
  });
  if (!cart) return false;
  const res = await prisma.shop_cart_lines.deleteMany({ where: { id: lid, cart_id: cart.id } });
  return res.count > 0;
}

export async function clearShopCart(userId: number): Promise<void> {
  const cart = await prisma.shop_carts.findUnique({
    where: { user_id: userId },
    select: { id: true }
  });
  if (!cart) return;
  await prisma.shop_cart_lines.deleteMany({ where: { cart_id: cart.id } });
  await prisma.shop_carts.update({
    where: { id: cart.id },
    data: { updated_at: BigInt(Date.now()) }
  });
}
