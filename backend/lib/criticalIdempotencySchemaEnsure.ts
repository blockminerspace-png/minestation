import type { Pool } from 'pg';

/**
 * Garante de forma idempotente que as colunas `request_fingerprint` existem em todas as
 * tabelas de idempotência críticas do jogo (Caixas da Sorte, Lojinha, Loja de upgrades,
 * intents de jogo).
 *
 * Justificação:
 *  - As migrations Prisma `20260510140000_wallet_idempotency_request_fingerprint`,
 *    `20260510150000_shop_checkout_idempotency_fingerprint` e
 *    `20260510240000_financial_idempotency_fingerprints` adicionam estas colunas.
 *  - Em algumas bases de produção as migrations estavam marcadas como `done` no
 *    `_prisma_migrations` mas as colunas não existiam (rollback acidental ou
 *    `migrate resolve` antigo). Sem as colunas, qualquer abertura/compra/saque caía em 500
 *    porque o INSERT/SELECT lia `request_fingerprint` que não existia.
 *  - O bug visível: «botão fica preso em ABRINDO…» — o cliente esperava pelo timeout
 *    (300s) porque o backend devolvia 500 silenciosamente e o frontend não tinha sinal.
 *
 * Este ensure é seguro de invocar em todos os workers no boot e várias vezes — usa apenas
 * `ADD COLUMN IF NOT EXISTS`.
 */
let ensureOncePromise: Promise<void> | null = null;

export function resetCriticalIdempotencySchemaEnsureCache(): void {
  ensureOncePromise = null;
}

export async function ensureCriticalIdempotencySchema(pool: Pool): Promise<void> {
  if (ensureOncePromise) return ensureOncePromise;
  ensureOncePromise = (async () => {
    const client = await pool.connect();
    try {
      /** Caixas da Sorte: `executeLootBoxOpenInTransaction` insere com `request_fingerprint`. */
      await client.query(`
        ALTER TABLE IF EXISTS lucky_box_idempotency
          ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);
      `);

      /** Lojinha: `runHardwareCheckoutTransaction` lê `request_fingerprint` antes do INSERT. */
      await client.query(`
        ALTER TABLE IF EXISTS shop_checkout_idempotency
          ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);
      `);

      /** Loja de Upgrades segura: idem. */
      await client.query(`
        ALTER TABLE IF EXISTS upgrade_purchase_idempotency
          ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);
      `);
    } catch (e) {
      ensureOncePromise = null;
      console.error(
        '[CriticalIdempotencySchema] falhou:',
        e instanceof Error ? e.message : e
      );
      throw e;
    } finally {
      client.release();
    }
  })();
  return ensureOncePromise;
}
