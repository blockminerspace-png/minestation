import type { SlotLayout } from '../types';

/**
 * Resolve qual slot `type: battery` alimenta uma `battery_bar` no layout do carregador.
 * Regra: cada barra é independente — usa (1) par id `battery_bar_X` → `battery_X`, (2) sufixo numérico,
 * (3) substituição `battery_bar`→`battery`, (4) N-ésima `battery_bar` na ordem do JSON → N-ésima bateria na ordem.
 */
export function resolveBatteryLayoutSlotIdForBatteryBar(
  layoutSlots: SlotLayout[],
  batteryBarSlot: Pick<SlotLayout, 'id'>,
  /** Índice 0-based desta barra entre todas as `battery_bar` no layout (ordem do array). */
  batteryBarOrdinal: number
): string | null {
  const batteries = layoutSlots.filter((s) => s.type === 'battery' && s.id);
  if (batteries.length === 0) return null;

  const rawId = String(batteryBarSlot.id ?? '').trim();

  const tryId = (candidate: string): string | null => {
    const hit = batteries.find((b) => b.id === candidate);
    return hit?.id ?? null;
  };

  // Par directo: battery_bar_left → battery_left
  if (rawId.startsWith('battery_bar')) {
    const rest = rawId.slice('battery_bar'.length).replace(/^[_-]/, '');
    if (rest) {
      const candidate = `battery_${rest}`;
      const found = tryId(candidate);
      if (found) return found;
      const candidate2 = rest; // ex.: battery_bar_aux → battery_aux se existir
      const found2 = tryId(candidate2);
      if (found2) return found2;
    }
  }

  // Sufixo só com dígitos no fim: foo_12 → índice 12 na lista de baterias (se existir)
  const tail = rawId.match(/(\d+)\s*$/);
  if (tail) {
    const n = parseInt(tail[1], 10);
    if (Number.isFinite(n) && n >= 0) {
      const byIdx = batteries[n];
      if (byIdx?.id) return byIdx.id;
      const byNumId = batteries.find((b) => {
        const m = String(b.id).match(/(\d+)\s*$/);
        return m && parseInt(m[1], 10) === n;
      });
      if (byNumId?.id) return byNumId.id;
    }
  }

  // Ordem no layout: 1ª barra → 1ª bateria, etc.
  const idx = Math.max(0, Math.min(batteryBarOrdinal, batteries.length - 1));
  return batteries[idx]?.id ?? null;
}

/** Índices no array `layoutSlots` onde `type === 'battery'`, pela ordem do JSON. */
function batteryLayoutIndices(layoutSlots: SlotLayout[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < layoutSlots.length; i++) {
    if (layoutSlots[i]?.type === 'battery' && layoutSlots[i]?.id) out.push(i);
  }
  return out;
}

/**
 * Índice no layout (array completo) da bateria associada a esta `battery_bar`.
 * Preferir isto a `resolveBatteryLayoutSlotIdForBatteryBar` quando `slot.id` de bateria se repete.
 */
export function resolveBatteryLayoutIndexForBatteryBar(
  layoutSlots: SlotLayout[],
  batteryBarSlot: Pick<SlotLayout, 'id'>,
  batteryBarOrdinal: number
): number | null {
  const batteries = batteryLayoutIndices(layoutSlots);
  if (batteries.length === 0) return null;

  const rawId = String(batteryBarSlot.id ?? '').trim();

  const tryId = (candidate: string): number | null => {
    for (const li of batteries) {
      if (String(layoutSlots[li]?.id || '').trim() === candidate) return li;
    }
    return null;
  };

  if (rawId.startsWith('battery_bar')) {
    const rest = rawId.slice('battery_bar'.length).replace(/^[_-]/, '');
    if (rest) {
      const hit = tryId(`battery_${rest}`);
      if (hit != null) return hit;
      const hit2 = tryId(rest);
      if (hit2 != null) return hit2;
    }
  }

  const tail = rawId.match(/(\d+)\s*$/);
  if (tail) {
    const n = parseInt(tail[1], 10);
    if (Number.isFinite(n) && n >= 0) {
      if (n < batteries.length) return batteries[n];
      for (const li of batteries) {
        const m = String(layoutSlots[li]?.id || '').match(/(\d+)\s*$/);
        if (m && parseInt(m[1], 10) === n) return li;
      }
    }
  }

  const idx = Math.max(0, Math.min(batteryBarOrdinal, batteries.length - 1));
  return batteries[idx] ?? null;
}
