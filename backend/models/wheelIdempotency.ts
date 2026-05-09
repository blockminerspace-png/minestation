import type { RoletaDbTx } from './roletaDbTypes.js';

/** Chave estável para `pg_advisory_xact_lock` (64 bits). */
export function wheelAdvisoryLockKey64(userId: number, scope: string, idempotencyKey: string): bigint {
  const s = `${userId}\0${scope}\0${idempotencyKey}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const low = BigInt(h >>> 0);
  const hi = BigInt(userId & 0xffff) << 32n;
  return (hi | low) & ((1n << 63n) - 1n);
}

export async function wheelAcquireAdvisoryLock(tx: RoletaDbTx, key64: bigint): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key64})`;
}

export async function wheelIdempotencyGetJson(
  tx: RoletaDbTx,
  userId: number,
  scope: string,
  idempotencyKey: string
): Promise<string | null> {
  const row = await tx.wheel_idempotency.findUnique({
    where: {
      user_id_scope_idempotency_key: { user_id: userId, scope, idempotency_key: idempotencyKey }
    },
    select: { response_json: true }
  });
  const j = row?.response_json;
  return j != null && String(j).trim().length > 0 ? String(j) : null;
}

export async function wheelIdempotencyPutJson(
  tx: RoletaDbTx,
  args: {
    userId: number;
    scope: string;
    idempotencyKey: string;
    responseJson: string;
    createdAtMs: bigint;
  }
): Promise<void> {
  const { userId, scope, idempotencyKey, responseJson, createdAtMs } = args;
  await tx.wheel_idempotency.upsert({
    where: {
      user_id_scope_idempotency_key: { user_id: userId, scope, idempotency_key: idempotencyKey }
    },
    create: {
      user_id: userId,
      scope,
      idempotency_key: idempotencyKey,
      response_json: responseJson,
      created_at: createdAtMs
    },
    update: { response_json: responseJson, created_at: createdAtMs }
  });
}
