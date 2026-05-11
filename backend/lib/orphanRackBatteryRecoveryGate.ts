/**
 * Recriação automática de linhas `stored_batteries` a partir de `placed_racks.battery_id` (órfãos).
 * Por defeito **desligada**: GET e save legado não devem mutar armazém de baterias.
 * Ativar só em cenários controlados: `ORPHAN_RACK_BATTERY_AUTO_RECOVER=1|true|yes`.
 */
export function orphanRackBatteryAutoRecoverEnabled(): boolean {
  return ['1', 'true', 'yes'].includes(String(process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER ?? '').trim().toLowerCase());
}
