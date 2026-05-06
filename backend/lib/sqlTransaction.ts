import type { PoolClient } from 'pg';
import type { Prisma } from '@prisma/client';

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
