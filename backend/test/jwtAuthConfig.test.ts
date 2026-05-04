import { describe, it, expect, vi, afterEach } from 'vitest';

describe('getJwtAuthConfig', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
  });

  it('em dev usa segredo fallback quando JWT_SECRET vazio', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    const { getJwtAuthConfig, COOKIE_ACCESS } = await import('../src/auth/config.js');
    const c = getJwtAuthConfig();
    expect(c.secret.length).toBeGreaterThanOrEqual(32);
    expect(c.accessTtlSec).toBeGreaterThanOrEqual(60);
    expect(COOKIE_ACCESS).toBe('gm_access');
  });

  it('em produção exige JWT_SECRET longo', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';
    const { getJwtAuthConfig } = await import('../src/auth/config.js');
    expect(() => getJwtAuthConfig()).toThrow(/32/);
  });
});
