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

/**
 * Catálogo canónico único: toda bateria do sistema é `battery_estelar`, infinita
 * por design. Migração `20260516120000_all_batteries_become_estelar` colapsa todas
 * as instâncias e o stock para este id; o normalizador abaixo cobre referências
 * em código / payloads enviados por clientes antigos.
 */
export const CANONICAL_1000WH_BATTERY_ID = 'battery_estelar';

/** Ids legados conhecidos que devem ser tratados como `battery_estelar`. */
export const LEGACY_1000WH_BATTERY_IDS = new Set([
  'small_battery',
  'battery_protostar',
  'battery_stellar'
]);

export const KNOWN_INFINITE_BATTERY_IDS = new Set([
  'battery_estelar',
  'battery_protostar',
  'battery_stellar'
]);

export function normalizeKnown1000WhBatteryCatalogId(itemIdRaw: unknown): string {
  const itemId = itemIdRaw == null ? '' : String(itemIdRaw).trim();
  if (!itemId) return '';
  return LEGACY_1000WH_BATTERY_IDS.has(itemId) ? CANONICAL_1000WH_BATTERY_ID : itemId;
}

/**
 * Sistema de baterias é infinito por design: qualquer bateria existente é tratada
 * como ilimitada, sem necessidade de carregar. Mantemos guard para id vazio para
 * preservar semântica "sem bateria equipada" nos chamadores.
 */
export function isKnownInfiniteBatteryCatalogId(itemIdRaw: unknown): boolean {
  const itemId = normalizeKnown1000WhBatteryCatalogId(itemIdRaw).toLowerCase();
  if (!itemId) return false;
  return true;
}
