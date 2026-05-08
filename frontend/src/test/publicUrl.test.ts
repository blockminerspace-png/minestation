import { describe, it, expect } from 'vitest';
import { normalizePublicAssetUrl } from '../utils/publicUrl';

describe('normalizePublicAssetUrl', () => {
  it('passa URLs absolutas e data', () => {
    expect(normalizePublicAssetUrl('https://x/y.png')).toBe('https://x/y.png');
    expect(normalizePublicAssetUrl('data:image/png;base64,xx')).toMatch(/^data:/);
  });

  it('prefixa assets relativos', () => {
    expect(normalizePublicAssetUrl('img/x.png')).toBe('/img/x.png');
    expect(normalizePublicAssetUrl('/x')).toBe('/x');
  });

  it('null e vazio', () => {
    expect(normalizePublicAssetUrl(null)).toBeUndefined();
    expect(normalizePublicAssetUrl('  ')).toBeUndefined();
  });
});
