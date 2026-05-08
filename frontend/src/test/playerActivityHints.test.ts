import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectPlayerActivityClientHintsAsync } from '../utils/playerActivityHints';

describe('playerActivityHints', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sem navigator devolve objeto vazio', async () => {
    vi.stubGlobal('navigator', undefined);
    const h = await collectPlayerActivityClientHintsAsync();
    expect(Object.keys(h).length).toBe(0);
  });

  it('com navigator preenche campos básicos', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'TestAgent/1.0',
      language: 'pt-BR',
      maxTouchPoints: 0,
      vendor: 'v',
      platform: 'linux',
    } as Navigator);
    vi.stubGlobal('screen', { width: 1920, height: 1080 });
    const h = await collectPlayerActivityClientHintsAsync();
    expect(h.userAgent).toContain('TestAgent');
    expect(h.language).toBe('pt-BR');
  });
});
