import { describe, it, expect, vi, beforeEach } from 'vitest';

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  jwt_refresh_tokens: {
    delete: vi.fn(),
    create: vi.fn()
  }
}));

const prismaMock = vi.hoisted(() => ({
  jwt_refresh_tokens: {
    updateMany: vi.fn(),
    create: vi.fn()
  },
  $transaction: vi.fn()
}));

vi.mock('../config/prisma.js', () => ({ prisma: prismaMock }));

import { revokeAllRefreshForUser, insertRefreshToken, rotateRefreshToken } from '../src/auth/refreshTokenStore.js';

describe('refreshTokenStore', () => {
  beforeEach(() => {
    prismaMock.jwt_refresh_tokens.updateMany.mockReset();
    prismaMock.jwt_refresh_tokens.create.mockReset();
    prismaMock.$transaction.mockReset();
    txMock.$queryRaw.mockReset();
    txMock.jwt_refresh_tokens.delete.mockReset();
    txMock.jwt_refresh_tokens.create.mockReset();
  });

  it('revokeAllRefreshForUser', async () => {
    prismaMock.jwt_refresh_tokens.updateMany.mockResolvedValue({ count: 2 });
    await revokeAllRefreshForUser(7);
    expect(prismaMock.jwt_refresh_tokens.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 7, revoked_at: null }
      })
    );
  });

  it('insertRefreshToken faz hash e INSERT', async () => {
    prismaMock.jwt_refresh_tokens.create.mockResolvedValue({} as never);
    await insertRefreshToken({
      userId: 1,
      rawToken: 'secret-token',
      familyId: 'fam',
      expiresAt: 9e12,
      userAgent: 'ua',
      ip: '127.0.0.1'
    });
    expect(prismaMock.jwt_refresh_tokens.create).toHaveBeenCalled();
    const arg = prismaMock.jwt_refresh_tokens.create.mock.calls[0]![0].data;
    expect(arg.user_id).toBe(1);
    expect(arg.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(arg.family_id).toBe('fam');
  });

  it('rotateRefreshToken invalid quando token não existe', async () => {
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => {
      txMock.$queryRaw.mockResolvedValue([]);
      return fn(txMock as never);
    });
    const r = await rotateRefreshToken('qualquer-coisa', { userAgent: null, ip: null });
    expect(r).toEqual({ ok: false, code: 'invalid' });
  });

  it('rotateRefreshToken expired quando expires_at no passado', async () => {
    const past = Date.now() - 60_000;
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => {
      txMock.$queryRaw.mockResolvedValue([
        { id: 1n, user_id: 2, family_id: 'f', expires_at: BigInt(past) }
      ]);
      return fn(txMock as never);
    });
    const r = await rotateRefreshToken('raw-old-token-placeholder', { userAgent: null, ip: null });
    expect(r).toEqual({ ok: false, code: 'expired' });
  });

  it('rotateRefreshToken ok substitui token e devolve novo raw', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevSecret = process.env.JWT_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 't'.repeat(40);
    const future = Date.now() + 3_600_000;
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => {
      txMock.$queryRaw.mockResolvedValue([
        { id: 99n, user_id: 42, family_id: 'fam-z', expires_at: BigInt(future) }
      ]);
      txMock.jwt_refresh_tokens.delete.mockResolvedValue({} as never);
      txMock.jwt_refresh_tokens.create.mockResolvedValue({} as never);
      return fn(txMock as never);
    });
    const r = await rotateRefreshToken('old-refresh-raw-value', {
      userAgent: 'Mozilla',
      ip: '10.0.0.1'
    });
    process.env.NODE_ENV = prevNode;
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;

    expect(r).toMatchObject({ ok: true, userId: 42 });
    if (r.ok) {
      expect(r.newRefreshRaw.length).toBeGreaterThan(10);
    }
    expect(txMock.jwt_refresh_tokens.delete).toHaveBeenCalled();
    expect(txMock.jwt_refresh_tokens.create).toHaveBeenCalled();
  });
});
