/**
 * Espelho de `backend/lib/workshopBatterySlotStorageKey.ts` — manter lógica alinhada.
 * Chaves canónicas para carga / instância por célula de bateria no layout do carregador.
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
  const dups = duplicateBatteryIds(layoutSlots);
  const rawId = String(layoutSlots[layoutIndex]?.id || '').trim();
  if (!rawId || dups.has(rawId)) {
    return `__ms_bat_${layoutIndex}`;
  }
  return rawId;
}

export function workshopBatteryLayoutIndices(layoutSlots: WorkshopBatteryLayoutSlot[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < layoutSlots.length; i++) {
    if (isBatterySlot(layoutSlots[i])) out.push(i);
  }
  return out;
}
