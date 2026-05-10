import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

describe('computeProgressForUser guards', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('MINING_PROGRESS_REQUIRE_REDIS_LOCK=1 sem Redis efectivo devolve ok=true sem abrir pool', async () => {
    vi.stubEnv('MINING_PROGRESS_REQUIRE_REDIS_LOCK', '1');
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('GENESIS_REDIS_LOCKS_ENABLED', '1');
    vi.stubEnv('MINING_PROGRESS_COMPUTE_ENABLED', '1');
    vi.stubEnv('BATTERY_WORKERS_ENABLED', '1');
    const { computeProgressForUser } = await import('../cron/miningProgressComputer.js');
    const connect = vi.fn();
    const pool = { connect } as unknown as import('pg').Pool;
    const out = await computeProgressForUser(pool, 7, Date.now());
    expect(out.ok).toBe(true);
    expect(connect).not.toHaveBeenCalled();
  });

});
