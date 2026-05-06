import type { PoolClient, QueryResult } from 'pg';
import type { Prisma } from '@prisma/client';

/**
 * Cliente só com `query(sql, params)` em texto — compatível com o uso no save-game,
 * sem as sobrecargas de objeto do `PoolClient.query` (evita erro de atribuição em `prismaTxToPoolLikeClient`).
 */
export type SaveGameQueryClient = {
  query(queryText: string, values?: unknown[]): Promise<QueryResult>;
};

/** SQL parametrizado numa transação `pg` ou Prisma. */
export type SqlTransaction = {
  queryRows<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<number>;
};

export function pgSqlTx(client: PoolClient): SqlTransaction {
  return {
    async queryRows<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const r = await client.query(sql, params);
      return r.rows as unknown as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      const r = await client.query(sql, params);
      return r.rowCount ?? 0;
    }
  };
}

export function prismaSqlTx(tx: Prisma.TransactionClient): SqlTransaction {
  return {
    async queryRows<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const rows = await tx.$queryRawUnsafe(sql, ...params);
      return (Array.isArray(rows) ? rows : []) as unknown as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      return tx.$executeRawUnsafe(sql, ...params);
    }
  };
}

/**
 * Expõe `client.query` no formato node-pg sobre `prisma.$transaction`, para reutilizar o mesmo
 * SQL e ordem de locks do save-game sem duplicar lógica.
 */
export function prismaTxToPoolLikeClient(tx: Prisma.TransactionClient): SaveGameQueryClient {
  const run = prismaSqlTx(tx);
  return {
    async query(queryText: string, values?: unknown[]): Promise<QueryResult> {
      const trimmed = queryText.trim();
      const first = trimmed.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (first === 'BEGIN' || first === 'COMMIT' || first === 'ROLLBACK') {
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as unknown as QueryResult;
      }
      const isRead =
        first === 'SELECT' ||
        first === 'WITH' ||
        first === 'SHOW' ||
        first === 'EXPLAIN' ||
        first === 'TABLE';
      if (isRead) {
        const rows = await run.queryRows(trimmed, values ?? []);
        return {
          rows,
          rowCount: rows.length,
          command: 'SELECT',
          oid: 0,
          fields: []
        } as unknown as QueryResult;
      }
      const n = await run.execute(trimmed, values ?? []);
      return {
        rows: [],
        rowCount: n,
        command: 'UPDATE',
        oid: 0,
        fields: []
      } as unknown as QueryResult;
    }
  };
}
