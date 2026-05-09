/**
 * Racks / economia no servidor: “cheio” para stock em >= 99,9% (mantém alinhado ao backend).
 * Na oficina a UI usa `BATTERY_WORKSHOP_DISPLAY_FULL_RATIO` — mais permissivo para nunca
 * ficar preso em 99,7–99,9% por float ou buffer do carregador.
 */
export const BATTERY_FULL_CHARGE_RATIO = 0.999;

/** Oficina + percentagem mostrada: a partir daqui mostra e grava como 100%. */
export const BATTERY_WORKSHOP_DISPLAY_FULL_RATIO = 0.995;

/** Percentagem para UI (oficina, armazém no modal, barras). */
export function batteryChargePercentDisplay(wh: number, capacityWh: number): number {
  const w = Number(wh) || 0;
  const cap = Number(capacityWh);
  if (cap === -1) return 100;
  if (!(cap > 0)) return Math.min(100, w);
  if (w >= cap * BATTERY_WORKSHOP_DISPLAY_FULL_RATIO) return 100;
  const raw = (w / cap) * 100;
  if (raw >= 99.5) return 100;
  return Math.min(100, raw);
}

/** Tick do carregador: fixa Wh na capacidade nominal quando já está “cheio” na UI. */
export function snapWorkshopBatteryWhToFullIfThreshold(wh: number, capacityWh: number): number {
  const w = Number(wh) || 0;
  const cap = Number(capacityWh);
  if (cap === -1 || !(cap > 0)) return w;
  if (w >= cap * BATTERY_WORKSHOP_DISPLAY_FULL_RATIO) return cap;
  if ((w / cap) * 100 >= 99.5) return cap;
  return w;
}
