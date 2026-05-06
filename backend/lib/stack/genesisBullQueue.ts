import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const QUEUE_NAME = process.env.GENESIS_BULL_QUEUE?.trim() || 'genesis-maintenance';

let sharedConnection: Redis | null = null;
let queue: Queue | null = null;

function getQueueConnection(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!sharedConnection) {
    sharedConnection = new Redis(url, { maxRetriesPerRequest: null });
  }
  return sharedConnection;
}

export function getGenesisJobQueue(): Queue | null {
  const conn = getQueueConnection();
  if (!conn) return null;
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: conn });
  }
  return queue;
}

/** Enfileira trabalho assíncrono (BullMQ). Falha silenciosa se Redis ausente. */
export async function enqueueGenesisJob(name: string, data: Record<string, unknown> = {}): Promise<void> {
  try {
    const q = getGenesisJobQueue();
    if (!q) return;
    await q.add(name, data, { removeOnComplete: 200, attempts: 2, backoff: { type: 'exponential', delay: 3000 } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[BullMQ] enqueue falhou:', name, msg);
  }
}
