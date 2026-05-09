/**
 * Marcador no payload sanitizado quando `itemId` vem vazio ou inválido.
 * `validateStoredBatteriesForSave` substitui por valor da BD ou pela primeira bateria ativa do catálogo.
 */
export const STORED_BATTERY_CATALOG_PENDING_ID = 'legacy_battery_missing_catalog';
