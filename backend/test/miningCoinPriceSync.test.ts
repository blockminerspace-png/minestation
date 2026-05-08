import { describe, expect, it } from 'vitest';
import { miningSymbolToCoingeckoId } from '../cron/miningCoinPriceSync.js';

describe('miningSymbolToCoingeckoId', () => {
  it('mapeia símbolos comuns (incl. DAI)', () => {
    expect(miningSymbolToCoingeckoId('DAI')).toBe('dai');
    expect(miningSymbolToCoingeckoId('dai')).toBe('dai');
    expect(miningSymbolToCoingeckoId('WBTC')).toBe('wrapped-bitcoin');
    expect(miningSymbolToCoingeckoId('Pol')).toBe('polygon-ecosystem-token');
    expect(miningSymbolToCoingeckoId('POL')).toBe('polygon-ecosystem-token');
  });

  it('normaliza espaços e NBSP', () => {
    expect(miningSymbolToCoingeckoId('  BNB \u00a0')).toBe('binancecoin');
    expect(miningSymbolToCoingeckoId('ETH / WETH')).toBe('ethereum');
  });

  it('retorna null para símbolo desconhecido', () => {
    expect(miningSymbolToCoingeckoId('XYZUNKNOWN')).toBeNull();
    expect(miningSymbolToCoingeckoId('')).toBeNull();
  });
});
