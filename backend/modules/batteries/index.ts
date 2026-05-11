/**
 * Módulo de baterias (monólito modular): regras de domínio, persistência de leitura,
 * recuperação/integridade e rota servidor para bulk por sala.
 */
export { STORED_BATTERY_CATALOG_PENDING_ID } from './batteries.constants.js';
export { resolvePlacedRackBatteryCatalogId } from './batteries.catalog.js';
export {
  isStoredBatteryFullyCharged,
  resolveBatteryNominalCapacityWh,
  STORED_BATTERY_FALLBACK_CAPACITY_WH,
  type UpgradeBatteryCapacityRow
} from './batteries.charge.js';
export {
  isValidBatteryRigSort,
  isValidBatterySelectionId,
  isValidRoomId,
  normalizePlacedRackRoomId,
  parseBooleanSmartFill
} from './batteries.validation.js';
export {
  applyBulkRoomBatteryChange,
  applyBulkRoomBatterySmartFill,
  batteryTierScore,
  compatibleRackIndicesForBattery,
  poolEntryEnergyWh,
  rackTheoreticalHash,
  runBulkRoomBattery,
  totalBatteryInstances,
  type BulkBatteryPrev,
  type BulkRoomBatteryRunOpts,
  type GameUpgrade,
  type PlacedRackState,
  type StoredBatteryRow
} from './batteries.bulk.js';
export {
  buildRackBatteryPersistSnapshot,
  collectMountedBatteryInstanceIdsFromPlacedRacks,
  fetchBatteryUpgradeRowsByIds,
  isRackBatteryInstanceUuid,
  loadStoredBatteryRowsForIds,
  loadUserStoredBatteries,
  RACK_BATTERY_INSTANCE_UUID_RE,
  type PrevPlacedRackBattRow,
  type RackBatteryPersistCols,
  type StoredBatteryRowSnap,
  type UpgradeBattSnap
} from './batteries.repository.js';
export {
  buildBatteryIntegrityRepairPlan,
  ensureStoredBatteriesIntegrity,
  reportBatteryIntegrityReadonly,
  type BatteryIntegrityRepairPlanAction
} from './batteries.integrity.js';
export { syncStoredBatterySemanticsForUser } from './batterySemanticSync.js';
export { recoverOrphanRackBatteryStorageRows, type RecoveredStoredBatteryRow } from './batteries.recovery.js';
export {
  ensureStoredBatteriesArrayFromDb,
  returnRackBatteryToChangesOnNftSanitize
} from './batteries.service.js';
export { registerBatteriesServerRoomRoutes, type BatteriesServerRoomDeps } from './batteries.controller.js';
