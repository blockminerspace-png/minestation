/**
 * Estado de bateria no carregador: uma entrada por posição no array `layout.slots`.
 * Chave canónica = `__ms_bat_${layoutIndex}` — nunca usar só o `id` do JSON como chave global,
 * porque vários slots podem repetir o mesmo `id` e um objeto JSON não pode ter duas chaves iguais.
 * Leitura: canónica primeiro, depois só a chave literal `layout[layoutIndex].id` nessa célula
 * (compat. saves antigos). Sem varrer o objeto nem casar case-insensitive (isso misturava células).
 */

export type WorkshopBatteryLayoutSlot = { type?: string; id?: string };

function isBatterySlot(s: WorkshopBatteryLayoutSlot | undefined): boolean {
  return String(s?.type || '').toLowerCase() === 'battery';
}

/** Slots `battery` que partilham o mesmo `id` no layout (uma chave JSON não chega para todos). */
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

/** Chave em `internal_state` / `slot_charges` / `slot_item_ids` para a bateria nessa posição do layout. */
export function workshopBatteryStorageKeyAtLayoutIndex(
  layoutSlots: WorkshopBatteryLayoutSlot[],
  layoutIndex: number
): string | null {
  if (layoutIndex < 0 || layoutIndex >= layoutSlots.length) return null;
  if (!isBatterySlot(layoutSlots[layoutIndex])) return null;
  return `__ms_bat_${layoutIndex}`;
}

/**
 * Lê um campo (instância, carga, catálogo) para a célula de bateria em `layoutIndex`.
 * Ordem: chave canónica → chave literal `layout[layoutIndex].id` se for diferente da canónica.
 */
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
