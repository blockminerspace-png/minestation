import { describe, expect, it } from 'vitest';
import { normalizePublicAssetUrl } from '../utils/publicUrl';

describe('normalizePublicAssetUrl', () => {
  it('preserves absolute /img and remote URLs', () => {
    expect(normalizePublicAssetUrl('/img/miner/x.png')).toBe('/img/miner/x.png');
    expect(normalizePublicAssetUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
    expect(normalizePublicAssetUrl('data:image/png;base64,xx')).toMatch(/^data:/);
  });

  it('prefixes game asset folders and bare filenames with /img/', () => {
    expect(normalizePublicAssetUrl('miner/gpu.png')).toBe('/img/miner/gpu.png');
    expect(normalizePublicAssetUrl('baterias/pack.png')).toBe('/img/baterias/pack.png');
    expect(normalizePublicAssetUrl('shop_gpu.png')).toBe('/img/shop_gpu.png');
  });

  it('fixes wrong leading slash without /img (SPA-safe)', () => {
    expect(normalizePublicAssetUrl('/miner/gpu.png')).toBe('/img/miner/gpu.png');
    expect(normalizePublicAssetUrl('/moedas/coin.png')).toBe('/img/moedas/coin.png');
  });

  it('strips ./ and backend/ prefixes', () => {
    expect(normalizePublicAssetUrl('./miner/gpu.png')).toBe('/img/miner/gpu.png');
    expect(normalizePublicAssetUrl('backend/img/miner/gpu.png')).toBe('/img/miner/gpu.png');
  });

  it('returns non-image ids unchanged', () => {
    expect(normalizePublicAssetUrl('temp_legacy_1')).toBe('temp_legacy_1');
    expect(normalizePublicAssetUrl('📦')).toBe('📦');
  });
});
