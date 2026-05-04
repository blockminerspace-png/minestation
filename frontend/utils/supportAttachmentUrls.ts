/** Só liga a media servida em `/img/…` na mesma origem (evita javascript:, //evil, etc.). */
export function safeSupportAttachmentHref(raw: unknown): string | undefined {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || /\s|[\r\n]/.test(s)) return undefined;
  const lower = s.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return undefined;
  if (s.startsWith('/img/') && !s.startsWith('//') && !s.includes('://')) return s;
  return undefined;
}
