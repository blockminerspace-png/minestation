import { prisma } from '../../config/prisma.js';
import { redisDel, redisJsonGet, redisJsonSet } from './redisCache.js';

const CACHE_KEY = 'cache:mining_coins:active_map_v1';
const TTL_SEC = 45;

export type MiningCoinActiveRow = { id: string; is_active: boolean };

/**
 * Mapa id → is_active com Redis + Prisma (menos pressão no pool `pg` no hot path de mineração).
 */
export async function getMiningCoinsActiveMap(): Promise<Map<string, { isActive: boolean }>> {
  const cached = await redisJsonGet<Record<string, { isActive: boolean }>>(CACHE_KEY);
  if (cached) {
    return new Map(Object.entries(cached));
  }

  const rows = await prisma.mining_coins.findMany({
    select: { id: true, is_active: true },
  });

  const obj: Record<string, { isActive: boolean }> = {};
  for (const r of rows) {
    obj[String(r.id)] = { isActive: !!r.is_active };
  }
  await redisJsonSet(CACHE_KEY, obj, TTL_SEC);
  return new Map(Object.entries(obj));
}

export async function invalidateMiningCoinsCache(): Promise<void> {
  await redisDel(CACHE_KEY);
}
