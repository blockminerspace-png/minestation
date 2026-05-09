import { describe, it, expect } from 'vitest';
import {
  sortInventoryCategoryKeys,
  groupStackablesByCategory
} from '../modules/inventory/inventory.snapshot.service.js';
import type { InventoryStackableRowDto } from '../modules/inventory/inventory.types.js';

describe('inventory.snapshot.service', () => {
  it('sortInventoryCategoryKeys prioriza Infraestrutura e Energia & Cabeamento', () => {
    const keys = ['Outros', 'Infraestrutura', 'Energia & Cabeamento', 'Zeta'];
    expect(sortInventoryCategoryKeys(keys)).toEqual(['Infraestrutura', 'Energia & Cabeamento', 'Outros', 'Zeta']);
  });

  it('groupStackablesByCategory agrupa e ordena categorias', () => {
    const rows: InventoryStackableRowDto[] = [
      {
        stockKey: 'a',
        catalogItemId: 'a',
        displayQuantity: 1,
        availableQuantity: 1,
        name: 'A',
        description: '',
        category: 'Outros',
        type: 'other',
        image: null,
        icon: '',
        baseProduction: 0,
        powerConsumption: 0,
        powerCapacity: 0,
        slotsCapacity: 0,
        aiSlotsCapacity: 0,
        isNft: false
      },
      {
        stockKey: 'b',
        catalogItemId: 'b',
        displayQuantity: 2,
        availableQuantity: 2,
        name: 'B',
        description: '',
        category: 'Infraestrutura',
        type: 'infrastructure',
        image: null,
        icon: '',
        baseProduction: 0,
        powerConsumption: 0,
        powerCapacity: 0,
        slotsCapacity: 6,
        aiSlotsCapacity: 0,
        isNft: false
      }
    ];
    const g = groupStackablesByCategory(rows);
    expect(g.map((x) => x.category)).toEqual(['Infraestrutura', 'Outros']);
    expect(g[0].items).toHaveLength(1);
    expect(g[0].items[0].stockKey).toBe('b');
  });
});
