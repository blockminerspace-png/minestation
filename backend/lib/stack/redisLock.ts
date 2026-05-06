import { getGenesisRedis } from '../genesisStack/init.js';

const LOCK_PREFIX = 'lock:';

/**
 * Lock distribuído simples (SET NX EX). Sem Redis, executa `fn` na mesma.
 */
export async function withRedisLock<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T | null> {
  const r = getGenesisRedis();
  if (!r) {
    return fn();
  }
  const lockKey = `${LOCK_PREFIX}${key}`;
  const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const ok = await r.set(lockKey, token, 'EX', Math.max(1, Math.floor(ttlSec)), 'NX');
  if (ok !== 'OK') {
    return null;
  }
  try {
    return await fn();
  } finally {
    const v = await r.get(lockKey);
    if (v === token) {
      await r.del(lockKey);
    }
  }
}
