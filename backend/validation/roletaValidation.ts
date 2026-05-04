/** ID de item/upgrade (wheel / stock) — alinhado a `parseLootBoxId` (sem espaços nem injeção). */
const SAFE_ITEM_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

export class RoletaAppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'RoletaAppError';
  }
}

export function normalizePromoCode(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmed)) return null;
  const upper = trimmed.toUpperCase();
  if (upper.length < 1 || upper.length > 80) return null;
  return upper;
}

export function parseWonItemId(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || !SAFE_ITEM_ID_RE.test(s)) return null;
  return s;
}

/** Nome de caixa exibido — limita tamanho e remove caracteres típicos de XSS em texto plano. */
export function sanitizeDisplayName(raw: string, maxLen: number): string {
  let s = String(raw).replace(/[\x00-\x1f<>]/g, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s || 'Prêmio';
}
