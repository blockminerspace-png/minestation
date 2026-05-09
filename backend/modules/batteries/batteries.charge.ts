/**
 * Regras alinhadas a bulk de sala / racks: bateria "cheia" no armazém =
 * capacidade infinita (`power_capacity === -1`) OU carga ≥ 99,9% da capacidade nominal.
 */

export type UpgradeBatteryCapacityRow = {
  type: string;
  power_capacity: number | null;
};

const FULL_CHARGE_RATIO = 0.999;

/** Capacidade efectiva para classificação quando o catálogo falha (mesma ordem de grandeza que a oficina). */
export const STORED_BATTERY_FALLBACK_CAPACITY_WH = 100;

export function resolveBatteryNominalCapacityWh(row: UpgradeBatteryCapacityRow | undefined): number | null {
  if (!row) return STORED_BATTERY_FALLBACK_CAPACITY_WH;
  const raw = row.power_capacity;
  if (raw == null || !Number.isFinite(Number(raw))) {
    return row.type === 'battery' ? STORED_BATTERY_FALLBACK_CAPACITY_WH : null;
  }
  const c = Number(raw);
  if (c === -1) return -1;
  return c;
}

export function isStoredBatteryFullyCharged(
  currentCharge: number,
  row: UpgradeBatteryCapacityRow | undefined
): boolean {
  const cap = resolveBatteryNominalCapacityWh(row);
  if (cap === -1) return true;
  if (cap == null || !(cap > 0)) return false;
  const q = typeof currentCharge === 'number' && Number.isFinite(currentCharge) ? currentCharge : 0;
  return q >= cap * FULL_CHARGE_RATIO;
}
