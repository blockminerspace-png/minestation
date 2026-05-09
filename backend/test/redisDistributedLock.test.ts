import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

describe('redisDistributedLock', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('com GENESIS_REDIS_LOCKS_ENABLED=0 devolve handle (sem Redis) e release não rebenta', async () => {
    vi.stubEnv('GENESIS_REDIS_LOCKS_ENABLED', '0');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    const { tryAcquireDistributedLock, releaseDistributedLock, REDIS_LOCK_KEYS } = await import(
      '../lib/redisDistributedLock.js'
    );
    const h = await tryAcquireDistributedLock(REDIS_LOCK_KEYS.miningYieldTick, 60);
    expect(h).not.toBeNull();
    expect(h!.key).toContain('mining_yield');
    await expect(releaseDistributedLock(h)).resolves.toBeUndefined();
  });

  it('sem REDIS_URL devolve handle compatível (legado single-process)', async () => {
    vi.stubEnv('GENESIS_REDIS_LOCKS_ENABLED', '1');
    vi.stubEnv('REDIS_URL', '');
    const { tryAcquireDistributedLock, releaseDistributedLock, REDIS_LOCK_KEYS } = await import(
      '../lib/redisDistributedLock.js'
    );
    const h = await tryAcquireDistributedLock(REDIS_LOCK_KEYS.miningProgressUser(42), 60);
    expect(h).not.toBeNull();
    expect(h!.key).toContain('42');
    await releaseDistributedLock(h);
  });
});
