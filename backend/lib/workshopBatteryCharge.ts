/**
 * Oficina: a UI mostra 100% a partir de 99,5%; o backend deve usar o mesmo
 * limite para não deixar baterias visualmente completas voltarem a carregar.
 */
export const WORKSHOP_BATTERY_FULL_RATIO = 0.995;

export function snapWorkshopBatteryChargeWh(currentWh: number, capacityWh: number): number {
  const wh = Number.isFinite(Number(currentWh)) ? Number(currentWh) : 0;
  const cap = Number(capacityWh);
  if (cap === -1 || !(cap > 0)) return Math.max(0, wh);
  if (wh >= cap * WORKSHOP_BATTERY_FULL_RATIO) return cap;
  if ((wh / cap) * 100 >= 99.5) return cap;
  return Math.max(0, wh);
}

export function isWorkshopBatteryChargeFull(currentWh: number, capacityWh: number): boolean {
  const cap = Number(capacityWh);
  if (cap === -1) return true;
  if (!(cap > 0)) return false;
  return snapWorkshopBatteryChargeWh(currentWh, cap) >= cap;
}
