import 'dotenv/config';
import type { PoolConfig } from 'pg';

const poolMax = Math.min(50, Math.max(5, parseInt(process.env.PG_POOL_MAX || '20', 10) || 20));

/** Opções alinhadas para `spawn` de `pg_restore` / `pg_dump` / `psql` (sem concatenar credenciais na shell). */
export type PgCliSpawnOptions =
  | {
      useConnectionString: true;
      databaseUrl: string;
      extraEnv: Record<string, string>;
    }
  | {
      useConnectionString: false;
      databaseUrl: null;
      extraEnv: Record<string, string>;
      host: string;
      port: string;
      user: string;
      database: string;
    };

function trimEnv(value: string | undefined, fallback: string): string {
  const t = String(value ?? '').trim();
  return t || fallback;
}

/**
 * Opções do `pg.Pool` — única fonte de verdade para ligação Postgres (runtime + scripts).
 * Credenciais vêm só de variáveis de ambiente (nunca hardcoded em produção).
 */
export function buildPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return {
      connectionString,
      max: poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }
  const port = parseInt(process.env.PGPORT || '5432', 10) || 5432;
  return {
    user: trimEnv(process.env.PGUSER, 'postgres'),
    host: trimEnv(process.env.PGHOST, 'localhost'),
    database: trimEnv(process.env.PGDATABASE, 'minestation'),
    password: String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres'),
    port,
    max: poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  };
}

/** Para `pg_restore` / `pg_dump` / `psql` CLI: env e ligação alinhados a `buildPoolConfig`. */
export function getPgRestoreSpawnOptions(): PgCliSpawnOptions {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return {
      useConnectionString: true,
      databaseUrl,
      extraEnv: {}
    };
  }
  const password = String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres');
  return {
    useConnectionString: false,
    databaseUrl: null,
    extraEnv: { PGPASSWORD: password },
    host: trimEnv(process.env.PGHOST, 'localhost'),
    port: String(parseInt(process.env.PGPORT || '5432', 10) || 5432),
    user: trimEnv(process.env.PGUSER, 'postgres'),
    database: trimEnv(process.env.PGDATABASE, 'minestation')
  };
}

/** Alias explícito para `pg_dump` / `psql` (mesma config que `pg_restore`). */
export function getPostgresCliSpawnOptions(): PgCliSpawnOptions {
  return getPgRestoreSpawnOptions();
}
