/** Converte o atalho do desk (10 / 50 / 100) para validação no pedido. */
export function parseDeskLiquidationPercentagePoints(raw: unknown): 10 | 50 | 100 | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(String(raw).trim(), 10) : NaN;
  if (n === 10) return 10;
  if (n === 50) return 50;
  if (n === 100) return 100;
  return null;
}
