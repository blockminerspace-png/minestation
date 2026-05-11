/**
 * Suíte opcional contra Postgres real.
 *
 * Executar (após `npx prisma migrate deploy` e com dados de teste se aplicável):
 *   cd backend && RUN_BACKEND_PG_INTEGRATION=1 DATABASE_URL="postgres://..." npm run test -- pgIntegration.backendOptional
 *
 * Sem `RUN_BACKEND_PG_INTEGRATION=1` ou sem `DATABASE_URL` (carregado de `backend/.env` ou env), todos os casos são ignorados.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const RUN = String(process.env.RUN_BACKEND_PG_INTEGRATION ?? '').trim() === '1';
const DATABASE_URL = String(process.env.DATABASE_URL ?? '').trim();

describe.skipIf(!RUN || !DATABASE_URL)('Postgres integration (RUN_BACKEND_PG_INTEGRATION=1)', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });

  afterAll(async () => {
    await pool.end();
  });

  it('conecta e responde a SELECT 1', async () => {
    const r = await pool.query('SELECT 1 AS ok');
    expect(r.rows[0]?.ok).toBe(1);
  });

  it('shop_checkout_idempotency tem coluna request_fingerprint (migration aplicada)', async () => {
    const r = await pool.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'shop_checkout_idempotency'
         AND column_name = 'request_fingerprint'
    `
    );
    expect(parseInt(r.rows[0]?.c || '0', 10)).toBe(1);
  });

  it('lucky_box_idempotency tem request_fingerprint', async () => {
    const r = await pool.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'lucky_box_idempotency'
         AND column_name = 'request_fingerprint'
    `
    );
    expect(parseInt(r.rows[0]?.c || '0', 10)).toBe(1);
  });

  it('upgrade_purchase_idempotency tem request_fingerprint', async () => {
    const r = await pool.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'upgrade_purchase_idempotency'
         AND column_name = 'request_fingerprint'
    `
    );
    expect(parseInt(r.rows[0]?.c || '0', 10)).toBe(1);
  });

  it('wallet_idempotency tem request_fingerprint', async () => {
    const r = await pool.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'wallet_idempotency'
         AND column_name = 'request_fingerprint'
    `
    );
    expect(parseInt(r.rows[0]?.c || '0', 10)).toBe(1);
  });
});
