import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('database buildPoolConfig', () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    process.env.PGUSER = 'u';
    process.env.PGHOST = 'h';
    process.env.PGDATABASE = 'd';
    process.env.PGPASSWORD = 'p';
    process.env.PGPORT = '5433';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('usa DATABASE_URL quando definido', async () => {
    process.env.DATABASE_URL = 'postgres://x:y@host:5432/db';
    const { buildPoolConfig } = await import('../config/database.js');
    const c = buildPoolConfig();
    expect(c).toHaveProperty('connectionString', 'postgres://x:y@host:5432/db');
    expect(c.max).toBeGreaterThan(0);
  });

  it('usa campos PG* sem DATABASE_URL', async () => {
    const { buildPoolConfig } = await import('../config/database.js');
    const c = buildPoolConfig() as Record<string, unknown>;
    expect(c.user).toBe('u');
    expect(c.host).toBe('h');
    expect(c.database).toBe('d');
    expect(c.port).toBe(5433);
  });

  it('getPgRestoreSpawnOptions', async () => {
    process.env.DATABASE_URL = 'postgres://a:b@c:1/d';
    const { getPgRestoreSpawnOptions } = await import('../config/database.js');
    const o = getPgRestoreSpawnOptions();
    expect(o.useConnectionString).toBe(true);
  });
});
