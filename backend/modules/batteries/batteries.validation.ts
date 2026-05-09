/** Alinha com a sala inicial do admin (`room_initial`). Saves antigos usavam NULL / '' / 'main'. */
export function normalizePlacedRackRoomId(raw: unknown): string {
  const s = raw != null ? String(raw).trim() : '';
  if (!s || s === 'main') return 'room_initial';
  return s;
}

const BATTERY_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

export function isValidRoomId(raw: unknown): boolean {
  const s = raw != null ? String(raw).trim() : '';
  return s.length > 0 && s.length <= 120 && !/[\x00-\x1f<>]/.test(s);
}

export function isValidBatterySelectionId(raw: unknown): boolean {
  if (raw == null || raw === '') return true;
  const s = String(raw).trim();
  return BATTERY_ID_RE.test(s);
}

export function isValidBatteryRigSort(raw: unknown): boolean {
  return raw === 'slot_asc' || raw === 'hashrate_desc';
}

export function parseBooleanSmartFill(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}
