import type { Prisma } from '@prisma/client';

/** Linhas de `rack_slots` / `rack_multiplier_slots` só para o guard (save-game em transação Prisma). */
export type RackSlotGuardMinerRow = {
  rack_id: string;
  slot_index: number;
  machine_item_id: string | null;
};

export type RackSlotGuardMultRow = {
  rack_id: string;
  slot_index: number;
  multiplier_item_id: string | null;
};

/**
 * Lê slots existentes na BD para o utilizador, via Prisma no **mesmo** `tx` do save-game.
 * Equivale ao JOIN `rack_*` + `placed_racks` por `user_id`, sem segunda conexão.
 */
export async function loadRackSlotGuardRowsForUserPrisma(
  tx: Prisma.TransactionClient,
  userId: number
): Promise<{ prevSlotsRows: RackSlotGuardMinerRow[]; prevMultRows: RackSlotGuardMultRow[] }> {
  const racks = await tx.placed_racks.findMany({
    where: { user_id: userId },
    select: { id: true }
  });
  if (racks.length === 0) {
    return { prevSlotsRows: [], prevMultRows: [] };
  }
  const ids = racks.map((r) => r.id);
  const [prevSlotsRows, prevMultRows] = await Promise.all([
    tx.rack_slots.findMany({
      where: { rack_id: { in: ids } },
      orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }],
      select: { rack_id: true, slot_index: true, machine_item_id: true }
    }),
    tx.rack_multiplier_slots.findMany({
      where: { rack_id: { in: ids } },
      orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }],
      select: { rack_id: true, slot_index: true, multiplier_item_id: true }
    })
  ]);
  return { prevSlotsRows, prevMultRows };
}
