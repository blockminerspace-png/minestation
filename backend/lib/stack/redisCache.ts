import { getGenesisRedis } from '../genesisStack/init.js';

export async function redisJsonGet<T>(key: string): Promise<T | null> {
  const r = getGenesisRedis();
  if (!r) return null;
  const s = await r.get(key);
  if (s == null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function redisJsonSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  const r = getGenesisRedis();
  if (!r) return;
  await r.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSec)));
}

export async function redisDel(key: string): Promise<void> {
  const r = getGenesisRedis();
  if (!r) return;
  await r.del(key);
}
