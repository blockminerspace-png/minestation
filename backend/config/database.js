import 'dotenv/config';

const poolMax = Math.min(50, Math.max(5, parseInt(process.env.PG_POOL_MAX || '20', 10) || 20));

/**
 * Opções do `pg.Pool` — única fonte de verdade para ligação Postgres (runtime + scripts).
 */
export function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }
  return {
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'minestation',
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres',
    port: parseInt(process.env.PGPORT || '5432', 10) || 5432,
    max: poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  };
}

/** Para `pg_restore` / `pg_dump` / `psql` CLI: env e ligação alinhados a `buildPoolConfig`. */
export function getPgRestoreSpawnOptions() {
  if (process.env.DATABASE_URL) {
    return {
      useConnectionString: true,
      databaseUrl: process.env.DATABASE_URL,
      extraEnv: {}
    };
  }
  const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres';
  return {
    useConnectionString: false,
    databaseUrl: null,
    extraEnv: { PGPASSWORD: password },
    host: process.env.PGHOST || 'localhost',
    port: String(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'postgres',
    database: process.env.PGDATABASE || 'minestation'
  };
}

/** Alias explícito para `pg_dump` / `psql` (mesma config que `pg_restore`). */
export function getPostgresCliSpawnOptions() {
  return getPgRestoreSpawnOptions();
}
