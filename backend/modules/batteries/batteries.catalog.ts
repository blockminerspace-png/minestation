/**
 * `placed_racks.battery_id` pode ser o id de catálogo (upgrades.id) ou o id de instância em `stored_batteries`.
 * Cron / ranking devem resolver para o id de catálogo antes de consultar `upgrades`.
 */
export function resolvePlacedRackBatteryCatalogId(
  batteryIdRaw: unknown,
  storedInstanceIdToCatalogId: Map<string, string>
): string {
  const s = batteryIdRaw == null ? '' : String(batteryIdRaw).trim();
  if (!s) return '';
  return storedInstanceIdToCatalogId.get(s) || s;
}
