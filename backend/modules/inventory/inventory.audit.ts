import { prisma } from '../../config/prisma.js';

export type InventoryMovementInput = {
  userId: number;
  action: string;
  catalogItemId?: string | null;
  instanceId?: string | null;
  quantityBefore?: number | null;
  quantityAfter?: number | null;
  /** Objeto pequeno (sem secrets); gravado como JSON string. */
  meta?: Record<string, unknown> | null;
};

const META_MAX = 4000;

/**
 * Regista movimento de inventário (compras, instalações, etc.).
 * Falhas de escrita não devem derrubar o fluxo principal — apenas logam aviso.
 */
export async function recordInventoryMovement(input: InventoryMovementInput): Promise<void> {
  const uid = Number(input.userId);
  if (!Number.isFinite(uid) || uid <= 0) return;
  const action = String(input.action || '').trim().slice(0, 64);
  if (!action) return;

  let metaStr: string | null = null;
  if (input.meta && typeof input.meta === 'object') {
    try {
      metaStr = JSON.stringify(input.meta).slice(0, META_MAX);
    } catch {
      metaStr = null;
    }
  }

  try {
    await prisma.inventory_movements.create({
      data: {
        user_id: uid,
        action,
        catalog_item_id: input.catalogItemId != null ? String(input.catalogItemId).slice(0, 200) : null,
        instance_id: input.instanceId != null ? String(input.instanceId).slice(0, 200) : null,
        quantity_before: input.quantityBefore != null && Number.isFinite(input.quantityBefore) ? input.quantityBefore : null,
        quantity_after: input.quantityAfter != null && Number.isFinite(input.quantityAfter) ? input.quantityAfter : null,
        meta: metaStr,
        created_at: BigInt(Date.now())
      }
    });
  } catch (e) {
    console.warn(
      '[inventory_movements] falha ao gravar:',
      e instanceof Error ? e.message : String(e)
    );
  }
}
