/**
 * Sistema de carregamento descontinuado: todas as baterias são tratadas como
 * infinitas. Constantes mantidas para compatibilidade com chamadores externos.
 */
export const BATTERY_FULL_CHARGE_RATIO = 0.999;
export const BATTERY_WORKSHOP_DISPLAY_FULL_RATIO = 0.995;

/** Sempre 100%: baterias passaram a ser ilimitadas. */
export function batteryChargePercentDisplay(_wh: number, _capacityWh: number): number {
  return 100;
}

/** No-op: sem transferência de Wh, mantemos o valor recebido. */
export function snapWorkshopBatteryWhToFullIfThreshold(wh: number, _capacityWh: number): number {
  return Number(wh) || 0;
}
