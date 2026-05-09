/**
 * Espelho de `backend/lib/workshopBatterySlotStorageKey.ts` — manter lógica alinhada.
 */

export type WorkshopBatteryLayoutSlot = { type?: string; id?: string };

function isBatterySlot(s: WorkshopBatteryLayoutSlot | undefined): boolean {
  return String(s?.type || '').toLowerCase() === 'battery';
}

function duplicateBatteryIds(layoutSlots: WorkshopBatteryLayoutSlot[]): Set<string> {
  const counts = new Map<string, number>();
  for (let i = 0; i < layoutSlots.length; i++) {
    if (!isBatterySlot(layoutSlots[i])) continue;
    const id = String(layoutSlots[i]?.id || '').trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const dups = new Set<string>();
  for (const [id, c] of counts) {
    if (c > 1) dups.add(id);
  }
  return dups;
}

export function workshopBatteryStorageKeyAtLayoutIndex(
  layoutSlots: WorkshopBatteryLayoutSlot[],
  layoutIndex: number
): string | null {
  if (layoutIndex < 0 || layoutIndex >= layoutSlots.length) return null;
  if (!isBatterySlot(layoutSlots[layoutIndex])) return null;
  return `__ms_bat_${layoutIndex}`;
}

export function readWorkshopBatterySlotField(
  map: Record<string, unknown> | null | undefined,
  layoutSlots: WorkshopBatteryLayoutSlot[],
  layoutIndex: number
): unknown {
  if (!map) return undefined;
  const canonKey = workshopBatteryStorageKeyAtLayoutIndex(layoutSlots, layoutIndex);
  if (!canonKey) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, canonKey) && map[canonKey] != null) return map[canonKey];
  const leg = String(layoutSlots[layoutIndex]?.id || '').trim();
  if (!leg || leg === canonKey) return undefined;
  if (!Object.prototype.hasOwnProperty.call(map, leg) || map[leg] == null) return undefined;
  const dups = duplicateBatteryIds(layoutSlots);
  if (dups.has(leg)) {
    let first = -1;
    for (let i = 0; i < layoutSlots.length; i++) {
      if (!isBatterySlot(layoutSlots[i])) continue;
      if (String(layoutSlots[i]?.id || '').trim() === leg) {
        first = i;
        break;
      }
    }
    if (layoutIndex !== first) return undefined;
  }
  return map[leg];
}

export function workshopBatteryLayoutIndices(layoutSlots: WorkshopBatteryLayoutSlot[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < layoutSlots.length; i++) {
    if (isBatterySlot(layoutSlots[i])) out.push(i);
  }
  return out;
}
