import type { Pool } from 'pg';

/**
 * Garante de forma idempotente que o schema necessário para o saque cripto/mineração existe.
 *
 * Justificação:
 *  - `initDb()` corre apenas no worker `BACKGROUND`/`ALL`. Workers `API` podiam aceitar `POST /api/withdraw`
 *    antes do BACKGROUND criar as tabelas/colunas, devolvendo 500 genérico.
 *  - A migration Prisma `20260510140000_wallet_idempotency_request_fingerprint` adicionou a coluna
 *    `request_fingerprint` em `wallet_idempotency`, mas a queda em `initDb` antiga ainda não a tinha.
 *    O fluxo de saque (`runWithdrawRequestIdempotent`) faz `SELECT request_fingerprint::text` — se a
 *    coluna não existir o `SELECT` rebenta com 500 "Erro interno. Tenta mais tarde.".
 *
 * Este ensure roda em todos os workers no boot e é seguro de invocar várias vezes (CREATE IF NOT EXISTS /
 * ADD COLUMN IF NOT EXISTS). Mantém-se totalmente compatível com bases já alinhadas.
 */
let ensureOncePromise: Promise<void> | null = null;

export function resetWalletWithdrawSchemaEnsureCache(): void {
  ensureOncePromise = null;
}

export async function ensureWalletWithdrawSchema(pool: Pool): Promise<void> {
  if (ensureOncePromise) return ensureOncePromise;
  ensureOncePromise = (async () => {
    const client = await pool.connect();
    try {
      /** `withdrawal_requests`: tabela base + colunas exigidas pelo fluxo legado e novo. */
      await client.query(`
        CREATE TABLE IF NOT EXISTS withdrawal_requests (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          coin_id TEXT NOT NULL,
          amount_crypto DOUBLE PRECISION NOT NULL,
          amount_usdc DOUBLE PRECISION,
          fee_amount DOUBLE PRECISION DEFAULT 0,
          net_amount DOUBLE PRECISION DEFAULT 0,
          tx_hash TEXT,
          wallet_address TEXT,
          status TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          processed_at BIGINT
        );
      `);
      await client.query(`
        ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS amount_usdc DOUBLE PRECISION;
        ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS fee_amount DOUBLE PRECISION DEFAULT 0;
        ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS net_amount DOUBLE PRECISION DEFAULT 0;
        ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS tx_hash TEXT;
        ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS wallet_address TEXT;
        ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS processed_at BIGINT;
        CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(user_id);
        CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created ON withdrawal_requests(status, created_at DESC);
      `);

      /** `wallet_idempotency`: tabela base + coluna `request_fingerprint` (migration 20260510140000). */
      await client.query(`
        CREATE TABLE IF NOT EXISTS wallet_idempotency (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scope TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          response_json TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, scope, idempotency_key)
        );
        ALTER TABLE wallet_idempotency ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);
      `);

      /** `coin_balances`: garante a tabela usada pelo `FOR UPDATE`. */
      await client.query(`
        CREATE TABLE IF NOT EXISTS coin_balances (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          coin_id TEXT NOT NULL,
          amount DOUBLE PRECISION NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, coin_id)
        );
      `);
    } catch (e) {
      ensureOncePromise = null;
      console.error('[Withdraw] ensureWalletWithdrawSchema falhou:', e instanceof Error ? e.message : e);
      throw e;
    } finally {
      client.release();
    }
  })();
  return ensureOncePromise;
}
