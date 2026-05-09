/**
 * Lock distribuído opcional (Redis SET NX EX + libertação segura por token).
 * Usado para evitar ticks duplicados entre vários processos Node / contentores.
 *
 * Sem REDIS_URL ou com GENESIS_REDIS_LOCKS_ENABLED=0 → acquire devolve sempre `true` (comportamento legado).
 */
import { Redis } from 'ioredis';

const LOCKS_ENABLED =
  String(process.env.GENESIS_REDIS_LOCKS_ENABLED ?? '1').trim() !== '0' &&
  String(process.env.REDIS_URL || '').trim().length > 0;

let shared: Redis | null = null;

function getRedis(): Redis | null {
  if (!LOCKS_ENABLED) return null;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!shared) {
    shared = new Redis(url, { maxRetriesPerRequest: null });
  }
  return shared;
}

export type LockHandle = { key: string; token: string };

export async function tryAcquireDistributedLock(
  key: string,
  ttlSeconds: number,
  token?: string
): Promise<LockHandle | null> {
  const r = getRedis();
  if (!r) {
    return { key, token: token || 'no-redis' };
  }
  const t = token || `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const ttl = Math.max(1, Math.min(Math.floor(ttlSeconds), 600));
  const ok = await r.set(key, t, 'EX', ttl, 'NX');
  if (ok !== 'OK') return null;
  return { key, token: t };
}

export async function releaseDistributedLock(handle: LockHandle | null): Promise<void> {
  if (!handle) return;
  const r = getRedis();
  if (!r) return;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;
  try {
    await r.eval(script, 1, handle.key, handle.token);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.warn('[RedisLock] release falhou:', handle.key, m);
  }
}

export const REDIS_LOCK_KEYS = {
  miningYieldTick: 'genesis:lock:mining_yield_tick',
  miningProgressUser: (userId: number) => `genesis:lock:mining_progress:user:${userId}`
} as const;
