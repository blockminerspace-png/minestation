/**
 * Worker BullMQ (processo dedicado). Compose: serviço `bull-worker`.
 */
import '../utils/loadEnv.js';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { initGenesisStackServices } from '../lib/genesisStack/init.js';
import { connectPrisma } from '../config/prisma.js';
import { logAnalyticsEvent } from '../lib/mongoLogs.js';

const redisUrlRaw = process.env.REDIS_URL?.trim();
if (!redisUrlRaw) {
  console.error('[BullWorker] REDIS_URL é obrigatório');
  process.exit(1);
}
const redisUrl = redisUrlRaw;

async function main(): Promise<void> {
  await initGenesisStackServices();
  try {
    await connectPrisma();
  } catch {
    /* Prisma opcional para jobs que só usam Mongo */
  }

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queueName = process.env.GENESIS_BULL_QUEUE?.trim() || 'genesis-maintenance';

  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name === 'miningYieldTick') {
        logAnalyticsEvent('bull_mining_yield_tick', (job.data || {}) as Record<string, unknown>);
        return { ok: true, kind: 'miningYieldTick' };
      }
      console.log('[BullWorker] job', job.id, job.name);
      return { ok: true };
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    console.error('[BullWorker] falha', job?.id, err?.message || err);
  });

  worker.on('completed', (job) => {
    console.log('[BullWorker] concluído', job.id, job.name);
  });

  console.log(`[BullWorker] à escuta da fila "${queueName}"`);
}

main().catch((e) => {
  console.error('[BullWorker]', e);
  process.exit(1);
});
