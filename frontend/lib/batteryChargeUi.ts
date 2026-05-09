/** Mesmo limiar que racks / servidor: carga “cheia” a partir de 99,9% da capacidade nominal (Wh). */
export const BATTERY_FULL_CHARGE_RATIO = 0.999;

/** Percentagem para UI: evita ficar preso em 99,7–99,9% por float ou buffer do carregador. */
export function batteryChargePercentDisplay(wh: number, capacityWh: number): number {
  const w = Number(wh) || 0;
  const cap = Number(capacityWh);
  if (cap === -1) return 100;
  if (!(cap > 0)) return Math.min(100, w);
  if (w >= cap * BATTERY_FULL_CHARGE_RATIO) return 100;
  return Math.min(100, (w / cap) * 100);
}

/** Após carregar no carregador: fixa em capacidade nominal quando já está na faixa “cheia”. */
export function snapWorkshopBatteryWhToFullIfThreshold(wh: number, capacityWh: number): number {
  const w = Number(wh) || 0;
  const cap = Number(capacityWh);
  if (cap === -1 || !(cap > 0)) return w;
  return w >= cap * BATTERY_FULL_CHARGE_RATIO ? cap : w;
}
