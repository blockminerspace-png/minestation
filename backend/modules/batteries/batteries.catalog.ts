/**
 * `placed_racks.battery_id` pode ser o id de catálogo (upgrades.id) ou o id de instância em `stored_batteries`.
 * Cron / ranking devem resolver para o id de catálogo antes de consultar `upgrades`.
 */
export function resolvePlacedRackBatteryCatalogId(
  batteryIdRaw: unknown,
  storedInstanceIdToCatalogId: Map<string, string>,
  snapshotCatalogIdRaw?: unknown
): string {
  const s = batteryIdRaw == null ? '' : String(batteryIdRaw).trim();
  if (!s) return '';
  const snap = snapshotCatalogIdRaw == null ? '' : normalizeKnown1000WhBatteryCatalogId(snapshotCatalogIdRaw);
  if (snap) return snap;
  return storedInstanceIdToCatalogId.get(s) || s;
}

export const CANONICAL_1000WH_BATTERY_ID = 'battery_protostar';
export const LEGACY_1000WH_BATTERY_IDS = new Set(['small_battery']);
export const KNOWN_INFINITE_BATTERY_IDS = new Set([
  'battery_protostar',
  'battery_estelar',
  'battery_stellar'
]);

export function normalizeKnown1000WhBatteryCatalogId(itemIdRaw: unknown): string {
  const itemId = itemIdRaw == null ? '' : String(itemIdRaw).trim();
  if (!itemId) return '';
  return LEGACY_1000WH_BATTERY_IDS.has(itemId) ? CANONICAL_1000WH_BATTERY_ID : itemId;
}

export function isKnownInfiniteBatteryCatalogId(itemIdRaw: unknown): boolean {
  const itemId = normalizeKnown1000WhBatteryCatalogId(itemIdRaw).toLowerCase();
  if (!itemId) return false;
  return (
    KNOWN_INFINITE_BATTERY_IDS.has(itemId) ||
    itemId.includes('protostar') ||
    itemId.includes('estelar') ||
    itemId.includes('stellar')
  );
}
