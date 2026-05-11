import { prisma } from '../../config/prisma.js';

export async function assertMinerShopProductQuantity(
  productId: string,
  requestedQty: number
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const pid = String(productId || '').trim();
  const q = Math.floor(Number(requestedQty));
  if (!Number.isInteger(q) || q < 1) {
    return { ok: false, status: 400, error: 'Quantidade inválida.' };
  }

  const row = await prisma.upgrades.findUnique({
    where: { id: pid },
    select: {
      id: true,
      name: true,
      category: true,
      type: true,
      status: true,
      is_nft: true,
      sell_in_hardware_market: true,
      is_active: true,
      max_global_stock: true,
      total_sold: true
    }
  });
  if (!row) return { ok: false, status: 404, error: 'Produto não encontrado.' };
  if (pid.startsWith('temp_legacy_') || row.category === 'legacy-temp' || row.type === 'legacy-temp') {
    return { ok: false, status: 422, error: 'Item não disponível para compra.' };
  }
  if (row.is_active === 0) return { ok: false, status: 422, error: 'Produto indisponível.' };
  const hasExplicitHardwareProducts = await prisma.upgrades.count({
    where: {
      OR: [{ is_active: null }, { is_active: { not: 0 } }],
      is_nft: { not: 1 },
      sell_in_hardware_market: { not: 0 },
      AND: [{ status: { notIn: ['legacy', 'exclusive'] } }],
      category: { not: 'legacy-temp' },
      type: { not: 'legacy-temp' },
      NOT: { id: { startsWith: 'temp_legacy_' } }
    }
  });
  if (hasExplicitHardwareProducts > 0 && row.sell_in_hardware_market === 0) {
    return { ok: false, status: 422, error: 'Este item não está à venda na Lojinha.' };
  }
  if (row.is_nft === 1) {
    return { ok: false, status: 422, error: 'Itens NFT não são compráveis na Lojinha com USDC.' };
  }
  if (row.status === 'legacy' || row.status === 'exclusive') {
    return { ok: false, status: 422, error: 'Item não disponível para compra.' };
  }
  if (row.status === 'limited') {
    const max = Number(row.max_global_stock) || 0;
    const sold = Number(row.total_sold) || 0;
    const available = Math.max(0, max - sold);
    if (q > available) {
      return {
        ok: false,
        status: 422,
        error: `Estoque insuficiente para "${row.name}". Disponível: ${available}.`
      };
    }
  }
  return { ok: true };
}
