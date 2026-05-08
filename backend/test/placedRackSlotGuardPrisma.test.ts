import { describe, it, expect, vi } from 'vitest';
import { loadRackSlotGuardRowsForUserPrisma } from '../lib/placedRackSlotGuardPrisma.js';

describe('loadRackSlotGuardRowsForUserPrisma', () => {
  it('sem racks devolve arrays vazios', async () => {
    const tx = {
      placed_racks: { findMany: vi.fn().mockResolvedValue([]) },
      rack_slots: { findMany: vi.fn() },
      rack_multiplier_slots: { findMany: vi.fn() },
    } as never;
    const out = await loadRackSlotGuardRowsForUserPrisma(tx, 99);
    expect(out).toEqual({ prevSlotsRows: [], prevMultRows: [] });
    expect(tx.placed_racks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 99 }, select: { id: true } })
    );
    expect(tx.rack_slots.findMany).not.toHaveBeenCalled();
  });

  it('com racks chama findMany em slots e mults com rack_id in', async () => {
    const tx = {
      placed_racks: {
        findMany: vi.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]),
      },
      rack_slots: {
        findMany: vi.fn().mockResolvedValue([{ rack_id: 'r1', slot_index: 0, machine_item_id: 'gpu' }]),
      },
      rack_multiplier_slots: {
        findMany: vi.fn().mockResolvedValue([{ rack_id: 'r1', slot_index: 0, multiplier_item_id: 'm1' }]),
      },
    } as never;
    const out = await loadRackSlotGuardRowsForUserPrisma(tx, 7);
    expect(out.prevSlotsRows).toHaveLength(1);
    expect(out.prevMultRows).toHaveLength(1);
    expect(tx.rack_slots.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rack_id: { in: ['r1', 'r2'] } },
      })
    );
    expect(tx.rack_multiplier_slots.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rack_id: { in: ['r1', 'r2'] } },
      })
    );
  });
});
