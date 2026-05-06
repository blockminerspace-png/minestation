import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';

let redis: Redis | null = null;
let mongo: MongoClient | null = null;

export function getGenesisRedis(): Redis | null {
    return redis;
}

/** Cliente Mongo — só para logs / analytics (`lib/mongoLogs.ts`). */
export function getGenesisMongo(): MongoClient | null {
    return mongo;
}

/**
 * Redis opcional; Mongo opcional em dev (compose define MONGODB_URI em produção).
 * Prisma do Postgres principal: `config/prisma.ts` + `connectPrisma()` no arranque do servidor.
 */
export async function initGenesisStackServices(): Promise<void> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
        try {
            const client = new Redis(redisUrl, { maxRetriesPerRequest: 20 });
            await client.ping();
            redis = client;
            console.log('[GenesisStack] Redis conectado');
        }
        catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[GenesisStack] Redis indisponível:', msg);
            redis = null;
        }
    }
    else {
        console.log('[GenesisStack] REDIS_URL não definido — Redis ignorado');
    }

    const mongoUri = process.env.MONGODB_URI?.trim();
    if (mongoUri) {
        try {
            const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            await client.db().command({ ping: 1 });
            mongo = client;
            console.log('[GenesisStack] MongoDB (logs) conectado');
        }
        catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[GenesisStack] MongoDB indisponível:', msg);
            mongo = null;
        }
    }
    else {
        console.log('[GenesisStack] MONGODB_URI não definido — logs Mongo desativados');
        if (process.env.NODE_ENV === 'production') {
            console.warn('[GenesisStack] Produção sem MONGODB_URI: analytics só em Postgres/consola');
        }
    }
}
