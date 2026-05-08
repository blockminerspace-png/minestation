/**
 * Parsing seguro de números vindos da BD / JSON para evitar NaN silencioso
 * e ambiguidade entre separador decimal "," e "." (locale).
 *
 * Segurança (texto / XSS / reflexão): ver `lib/safeText.ts` — `sanitizeForLog` / `sanitizeApiMessage`.
 */

import { sanitizeForLog } from '../lib/safeText.js';

export { sanitizeForLog, sanitizeApiMessage } from '../lib/safeText.js';

export class MiningNumericError extends Error {
  constructor(
    readonly context: string | undefined,
    message: string
  ) {
    super(context ? `[${context}] ${message}` : message);
    this.name = 'MiningNumericError';
  }
}

/**
 * Converte string/número para número finito.
 * Aceita "12,34" só quando não ambíguo; rejeita múltiplos separadores estilo milhares.
 */
export function parseFiniteNumber(value: unknown, context?: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MiningNumericError(context, 'número não finito');
    }
    return value;
  }
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  if (/[<>'"`;\\]/.test(raw)) {
    throw new MiningNumericError(context, 'caracteres inválidos no valor numérico');
  }

  const commaCount = (raw.match(/,/g) ?? []).length;
  const dotCount = (raw.match(/\./g) ?? []).length;
  let norm = raw.replace(/\s/g, '');

  if (commaCount > 1 && dotCount === 0) {
    throw new MiningNumericError(context, 'vírgulas múltiplas ambíguas');
  }
  if (dotCount > 1 && commaCount === 0) {
    throw new MiningNumericError(context, 'pontos múltiplos ambíguos');
  }

  if (commaCount === 1 && dotCount === 0) {
    norm = norm.replace(',', '.');
  } else if (commaCount === 1 && dotCount === 1) {
    const lastComma = norm.lastIndexOf(',');
    const lastDot = norm.lastIndexOf('.');
    if (lastComma > lastDot) {
      norm = norm.replace(/\./g, '').replace(',', '.');
    } else {
      norm = norm.replace(/,/g, '');
    }
  } else if (commaCount > 0 && dotCount > 0 && commaCount + dotCount > 2) {
    throw new MiningNumericError(context, 'separadores decimais ambíguos');
  }

  const n = Number(norm);
  if (!Number.isFinite(n)) {
    throw new MiningNumericError(context, `valor não numérico: ${sanitizeForLog(raw, 48)}`);
  }
  return n;
}

/** Para campos opcionais: falha → 0 + nunca lança. */
export function parseFiniteNumberLenient(value: unknown, context?: string): number {
  try {
    return parseFiniteNumber(value, context);
  } catch (e) {
    if (e instanceof MiningNumericError) {
      console.warn('[MiningNumeric]', sanitizeForLog(e.message, 200));
    }
    return 0;
  }
}
