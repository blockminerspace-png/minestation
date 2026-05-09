export { registerInventoryModuleRoutes, type InventoryModuleDeps } from './inventory.controller.js';
export {
  loadPlayerInventorySnapshot,
  buildInventoryStateV1,
  sortInventoryCategoryKeys,
  resolveStackableRowsForStock,
  groupStackablesByCategory
} from './inventory.snapshot.service.js';
export { recordInventoryMovement, type InventoryMovementInput } from './inventory.audit.js';
export type {
  InventoryStateV1Dto,
  InventoryBatteryInstanceDto,
  InventoryStackableRowDto,
  InventoryStackableCategoryDto,
  PlayerInventorySnapshot
} from './inventory.types.js';
