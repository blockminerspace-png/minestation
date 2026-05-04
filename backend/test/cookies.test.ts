import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Response } from 'express';

describe('auth cookies', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
  });

  it('buildSetCookieHeader sem Secure fora de produção', async () => {
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    const { buildSetCookieHeader } = await import('../src/auth/cookies.js');
    const h = buildSetCookieHeader('c', 'v', { maxAgeSec: 60, path: '/' });
    expect(h).toContain('c=v');
    expect(h).toContain('HttpOnly');
    expect(h).toContain('SameSite=Strict');
    expect(h).toContain('Max-Age=60');
    expect(h).not.toMatch(/;\s*Secure/);
  });

  it('buildSetCookieHeader com Secure em produção', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { buildSetCookieHeader } = await import('../src/auth/cookies.js');
    expect(buildSetCookieHeader('a', 'b', {})).toMatch(/Secure/);
  });

  it('appendAccessCookie chama append', async () => {
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    const { appendAccessCookie } = await import('../src/auth/cookies.js');
    const append = vi.fn();
    appendAccessCookie({ append } as unknown as Response, 'tok', 120);
    expect(append).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('tok'));
  });
});
