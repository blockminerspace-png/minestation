/**
 * Grelha global de “blocos” de 10 minutos: início de cada dia UTC em 00:00, depois 00:10, 00:20, …
 * (= 144 janelas / dia). Usado para tecto de crédito de mineração e para alinhar ticks de yield em BD.
 *
 * Desligar (comportamento antigo, tempo contínuo até `Date.now()`): MINING_WALL_CLOCK_TEN_MIN_GRID=0
 */

const TEN_MIN_MS = 600_000;

export function utcMidnightMs(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

/**
 * Maior instante T ≤ ts tal que T = meia-noite UTC do dia de `ts` + n·10 min (n inteiro ≥ 0).
 */
export function lastCompletedTenMinuteUtcGrid(ts: number): number {
  const day0 = utcMidnightMs(ts);
  const rel = ts - day0;
  if (rel < 0) return day0;
  return day0 + Math.floor(rel / TEN_MIN_MS) * TEN_MIN_MS;
}

/** `true` por defeito; só `0` ou `false` desliga. */
export function miningTenMinuteGridEnabled(): boolean {
  const v = String(process.env.MINING_WALL_CLOCK_TEN_MIN_GRID ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  return true;
}

/** Instant até onde se pode creditar mineração (ou `now` se grelha desligada). */
export function miningCreditCapNowMs(nowMs: number): number {
  if (!miningTenMinuteGridEnabled()) return nowMs;
  return lastCompletedTenMinuteUtcGrid(nowMs);
}
