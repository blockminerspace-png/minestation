/**
 * Texto seguro para logs e respostas JSON (ver comentário longo em `miningNumeric.ts` histórico;
 * XSS é sobretudo no browser; aqui evitamos reflexão perigosa e injeção em pipelines de log).
 */

const CTRL_AND_C1 = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g;
const ZW_AND_BIDI = /[\u200B-\u200D\uFEFF\u202A-\u202E]/g;

export function sanitizeForLog(value: unknown, maxLen = 96): string {
  let s = typeof value === 'string' ? value : String(value);
  s = s
    .replace(ZW_AND_BIDI, '')
    .replace(CTRL_AND_C1, ' ')
    .replace(/[<>&`|$\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxLen) return `${s.slice(0, maxLen)}…`;
  return s;
}

export function sanitizeApiMessage(value: unknown, maxLen = 200): string {
  const raw = typeof value === 'string' ? value : String(value);
  if (/^(javascript|data|vbscript)\s*:/i.test(raw.trim()) || /<script/i.test(raw)) {
    return 'Pedido inválido.';
  }
  const s = sanitizeForLog(value, maxLen);
  if (!s) return 'Erro interno.';
  return s;
}
