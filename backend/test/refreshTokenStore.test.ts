import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { revokeAllRefreshForUser, insertRefreshToken, rotateRefreshToken } from '../src/auth/refreshTokenStore.js';

describe('refreshTokenStore', () => {
  it('revokeAllRefreshForUser', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 2 });
    await revokeAllRefreshForUser({ query } as unknown as Pool, 7);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jwt_refresh_tokens'),
      expect.arrayContaining([expect.any(Number), 7])
    );
  });

  it('insertRefreshToken faz hash e INSERT', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await insertRefreshToken({ query } as unknown as Pool, {
      userId: 1,
      rawToken: 'secret-token',
      familyId: 'fam',
      expiresAt: 9e12,
      userAgent: 'ua',
      ip: '127.0.0.1',
    });
    expect(query).toHaveBeenCalled();
    const [, params] = query.mock.calls[0]!;
    expect(params![0]).toBe(1);
    expect(params![1]).toMatch(/^[a-f0-9]{64}$/);
    expect(params![2]).toBe('fam');
  });

  it('rotateRefreshToken invalid quando token não existe', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const r = await rotateRefreshToken(pool, 'qualquer-coisa', { userAgent: null, ip: null });
    expect(r).toEqual({ ok: false, code: 'invalid' });
    expect(client.release).toHaveBeenCalled();
  });

  it('rotateRefreshToken expired quando expires_at no passado', async () => {
    const past = Date.now() - 60_000;
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{ id: 1, user_id: 2, family_id: 'f', expires_at: past }],
        })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const r = await rotateRefreshToken(pool, 'raw-old-token-placeholder', { userAgent: null, ip: null });
    expect(r).toEqual({ ok: false, code: 'expired' });
  });

  it('rotateRefreshToken ok substitui token e devolve novo raw', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevSecret = process.env.JWT_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 't'.repeat(40);
    const future = Date.now() + 3_600_000;
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{ id: 99, user_id: 42, family_id: 'fam-z', expires_at: future }],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const r = await rotateRefreshToken(pool, 'old-refresh-raw-value', {
      userAgent: 'Mozilla',
      ip: '10.0.0.1',
    });
    process.env.NODE_ENV = prevNode;
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;

    expect(r).toMatchObject({ ok: true, userId: 42 });
    if (r.ok) {
      expect(r.newRefreshRaw.length).toBeGreaterThan(10);
    }
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]).includes('DELETE FROM jwt_refresh_tokens'))).toBe(true);
    expect(calls.some((c) => String(c[0]).includes('INSERT INTO jwt_refresh_tokens'))).toBe(true);
    expect(calls.some((c) => String(c[0]).includes('COMMIT'))).toBe(true);
  });
});
