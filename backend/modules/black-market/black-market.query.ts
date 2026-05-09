/** Limites seguros para paginação do livro P2P. */

export const BLACK_MARKET_MAX_PAGE = 100;
export const BLACK_MARKET_DEFAULT_LIMIT = 60;

export function clampBlackMarketLimit(n: number | undefined): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return BLACK_MARKET_DEFAULT_LIMIT;
  return Math.min(BLACK_MARKET_MAX_PAGE, v);
}

export function clampBlackMarketOffset(n: number | undefined): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(50_000, v);
}
