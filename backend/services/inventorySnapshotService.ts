/**
 * Ponto de entrada legado — implementação no módulo `modules/inventory`.
 */
export {
  loadPlayerInventorySnapshot,
  buildInventoryStateV1,
  sortInventoryCategoryKeys,
  resolveStackableRowsForStock,
  groupStackablesByCategory
} from '../modules/inventory/inventory.snapshot.service.js';
export type {
  PlayerInventorySnapshot,
  InventoryStateV1Dto,
  InventoryBatteryInstanceDto,
  InventoryStackableRowDto,
  InventoryStackableCategoryDto
} from '../modules/inventory/inventory.types.js';
