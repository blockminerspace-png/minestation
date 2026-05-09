import type { Prisma } from '@prisma/client';

/** Cliente Prisma dentro de `$transaction` (roleta, roda paga, idempotência). */
export type RoletaDbTx = Prisma.TransactionClient;
