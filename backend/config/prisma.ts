import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma do Postgres principal (fonte de verdade).
 * O pool `pg` (`config/db.ts`) mantém-se em paralelo até as rotas migrarem para Prisma.
 */
const logLevels: ('warn' | 'error')[] = ['warn', 'error'];

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? logLevels : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function connectPrisma(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
