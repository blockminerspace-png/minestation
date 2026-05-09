import { describe, expect, it } from 'vitest';
import { parseDeskLiquidationPercentagePoints } from '../modules/wallet/walletDeskPercent.js';

describe('parseDeskLiquidationPercentagePoints', () => {
  it('aceita 10, 50, 100 como número ou string', () => {
    expect(parseDeskLiquidationPercentagePoints(10)).toBe(10);
    expect(parseDeskLiquidationPercentagePoints(50)).toBe(50);
    expect(parseDeskLiquidationPercentagePoints(100)).toBe(100);
    expect(parseDeskLiquidationPercentagePoints('100')).toBe(100);
  });

  it('rejeita percentagens do desk inválidas', () => {
    expect(parseDeskLiquidationPercentagePoints(25)).toBeNull();
    expect(parseDeskLiquidationPercentagePoints(0)).toBeNull();
    expect(parseDeskLiquidationPercentagePoints(101)).toBeNull();
    expect(parseDeskLiquidationPercentagePoints(null)).toBeNull();
    expect(parseDeskLiquidationPercentagePoints('')).toBeNull();
  });
});
