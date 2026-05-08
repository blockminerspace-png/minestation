#!/usr/bin/env node
/**
 * Correção one-off / operação: stored_batteries.item_id + racks órfãos / UUID duplicado em racks.
 * Requer `dist/lib/ensureStoredBatteriesIntegrity.js` — use `npm run db:ensure-stored-batteries`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });
import { ensureStoredBatteriesIntegrity } from '../dist/lib/ensureStoredBatteriesIntegrity.js';

const { Pool } = pg;

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return {
      connectionString,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }
  return {
    user: String(process.env.PGUSER || 'postgres'),
    host: String(process.env.PGHOST || 'localhost'),
    database: String(process.env.PGDATABASE || 'minestation'),
    password: String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres'),
    port: parseInt(process.env.PGPORT || '5432', 10) || 5432,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  };
}

async function main() {
  const pool = new Pool(buildPoolConfig());
  try {
    await ensureStoredBatteriesIntegrity(pool);
    console.log('[ensure_stored_batteries_integrity] concluído.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[ensure_stored_batteries_integrity] falhou:', e);
  process.exit(1);
});
