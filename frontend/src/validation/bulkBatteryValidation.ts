import type { BatteryRigSortMode } from '../types/bulkRoomBattery';

export function isValidBatteryRigSort(raw: unknown): raw is BatteryRigSortMode {
  return raw === 'slot_asc' || raw === 'hashrate_desc';
}

export function parseBooleanSmartFill(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}
