import { describe, it, expect, vi, afterEach } from 'vitest';

describe('jwtService', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
  });

  it('signAccessToken + verifyAccessToken roundtrip', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'x'.repeat(40);
    const { signAccessToken, verifyAccessToken } = await import('../src/auth/jwtService.js');
    const tok = signAccessToken(42);
    const v = verifyAccessToken(tok);
    expect(v.userId).toBe(42);
  });

  it('signAccessToken rejeita subject não numérico', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'y'.repeat(40);
    const { signAccessToken } = await import('../src/auth/jwtService.js');
    expect(() => signAccessToken('abc' as unknown as number)).toThrow(/inválido/);
  });

  it('verifyAccessToken rejeita token inválido', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'z'.repeat(40);
    const { verifyAccessToken } = await import('../src/auth/jwtService.js');
    expect(() => verifyAccessToken('não-é-jwt')).toThrow();
  });
});
