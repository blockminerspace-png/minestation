/**
 * Layout JSON dos carregadores/oficina (catálogo `upgrades.layout`).
 * Usado pelo modelo de mutações da oficina e alinhado ao parser do cron de mineração.
 */
export type WorkshopLayoutSlot = { type?: string; id?: string };

const MAX_LAYOUT_CHARS = 400_000;

export function parseWorkshopStructureLayout(raw: string | null | undefined, itemId: string): WorkshopLayoutSlot[] | null {
  if (raw == null || raw === '') return null;
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t || t.length > MAX_LAYOUT_CHARS) return null;
  try {
    const v = JSON.parse(t) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const slots = (v as Record<string, unknown>).slots;
    if (!Array.isArray(slots)) return null;
    const out: WorkshopLayoutSlot[] = [];
    for (const s of slots) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
      const o = s as Record<string, unknown>;
      const type = typeof o.type === 'string' ? o.type : undefined;
      const id = typeof o.id === 'string' ? o.id : undefined;
      out.push({ type, id });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export function findLayoutSlot(layout: WorkshopLayoutSlot[] | null, slotId: string): WorkshopLayoutSlot | null {
  if (!layout || !slotId) return null;
  const sid = slotId.trim();
  for (const s of layout) {
    if (s.id && s.id.trim() === sid) return s;
  }
  for (const s of layout) {
    if (s.id && s.id.trim().toLowerCase() === sid.toLowerCase()) return s;
  }
  return null;
}
