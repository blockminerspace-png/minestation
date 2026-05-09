/**
 * Chaves canónicas para `internal_state` / `slot_charges` / `slot_item_ids` por célula de bateria.
 * Se o layout do carregador repete o mesmo `id` em vários slots `type: battery`, um objeto JSON
 * não pode guardar dois valores sob a mesma chave — todas as leituras/escritas têm de usar uma
 * chave estável única (índice no array do layout).
 */

export type WorkshopBatteryLayoutSlot = { type?: string; id?: string };

function isBatterySlot(s: WorkshopBatteryLayoutSlot | undefined): boolean {
  return String(s?.type || '').toLowerCase() === 'battery';
}

/** Conta quantos slots `battery` partilham exactamente o mesmo `id` (trim, case-sensitive). */
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

/**
 * Chave usada em `workshop_slots.internal_state` / `slot_charges` / `slot_item_ids` para a
 * bateria na posição `layoutIndex` (índice no array `layout.slots` do carregador).
 */
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

/** Índices no layout onde `type === 'battery'`, na ordem do JSON. */
export function workshopBatteryLayoutIndices(layoutSlots: WorkshopBatteryLayoutSlot[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < layoutSlots.length; i++) {
    if (isBatterySlot(layoutSlots[i])) out.push(i);
  }
  return out;
}

export type ResolveWorkshopBatteryLayoutResult =
  | { ok: true; layoutIndex: number }
  | { ok: false; reason: 'notfound' | 'ambiguous' };

/**
 * Resolve o índice no layout para uma mutação: preferir `layoutSlotIndex` (disambigua ids duplicados).
 */
export function resolveWorkshopBatteryLayoutIndex(
  layoutSlots: WorkshopBatteryLayoutSlot[],
  componentSlotId: string,
  layoutSlotIndex: number | undefined
): ResolveWorkshopBatteryLayoutResult {
  const want = String(componentSlotId || '').trim();
  const hits: number[] = [];
  for (let i = 0; i < layoutSlots.length; i++) {
    if (!isBatterySlot(layoutSlots[i])) continue;
    const sid = String(layoutSlots[i]?.id || '').trim();
    if (sid === want) hits.push(i);
  }
  if (
    layoutSlotIndex != null &&
    Number.isInteger(layoutSlotIndex) &&
    layoutSlotIndex >= 0 &&
    layoutSlotIndex < layoutSlots.length &&
    isBatterySlot(layoutSlots[layoutSlotIndex])
  ) {
    if (hits.length <= 1) {
      if (hits.length === 0) return { ok: true, layoutIndex: layoutSlotIndex };
      if (hits[0] === layoutSlotIndex) return { ok: true, layoutIndex: layoutSlotIndex };
      const sidAt = String(layoutSlots[layoutSlotIndex]?.id || '').trim();
      if (sidAt === want) return { ok: true, layoutIndex: layoutSlotIndex };
    } else if (hits.includes(layoutSlotIndex)) {
      return { ok: true, layoutIndex: layoutSlotIndex };
    }
  }
  if (hits.length === 1) return { ok: true, layoutIndex: hits[0] };
  if (hits.length === 0) return { ok: false, reason: 'notfound' };
  return { ok: false, reason: 'ambiguous' };
}
