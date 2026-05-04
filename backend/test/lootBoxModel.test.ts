import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseLootBoxId,
  rollLootBoxOnce,
  rollLootBoxGrantAll,
  type LootBoxItemRow,
} from '../models/lootBoxModel.js';

describe('lootBoxModel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parseLootBoxId', () => {
    expect(parseLootBoxId('  box_1  ')).toBe('box_1');
    expect(parseLootBoxId('')).toBeNull();
    expect(parseLootBoxId('bad id')).toBeNull();
    expect(parseLootBoxId(null)).toBeNull();
  });

  it('rollLootBoxOnce vazio ou sem peso', () => {
    expect(rollLootBoxOnce([]).rewards).toEqual([]);
    expect(rollLootBoxOnce([{ item_type: 'item', item_id: 'x', min_qty: 1, max_qty: 1, probability: 0 }]).rewards).toEqual(
      []
    );
  });

  it('rollLootBoxOnce escolhe linha ponderada', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const items: LootBoxItemRow[] = [
      { item_type: 'currency', item_id: 'usdc', min_qty: 5, max_qty: 5, probability: 10 },
      { item_type: 'item', item_id: 'rig', min_qty: 1, max_qty: 1, probability: 90 },
    ];
    const p = rollLootBoxOnce(items);
    expect(p.rewards.length).toBe(1);
    expect(p.rewards[0]!.type).toBe('currency');
    expect(p.gainedUsdc).toBe(5);
  });

  it('rollLootBoxGrantAll inclui todas com probability > 0', () => {
    const items: LootBoxItemRow[] = [
      { item_type: 'item', item_id: 'a', min_qty: 1, max_qty: 1, probability: 1 },
      { item_type: 'item', item_id: 'b', min_qty: 2, max_qty: 2, probability: 2 },
      { item_type: 'item', item_id: 'c', min_qty: 0, max_qty: 0, probability: 0 },
    ];
    const p = rollLootBoxGrantAll(items);
    expect(p.rewards.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
