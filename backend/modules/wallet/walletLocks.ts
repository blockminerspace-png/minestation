/** Chave estável 63 bits para `pg_advisory_xact_lock` (carteira / câmbio). */
export function walletAdvisoryLockKey64(userId: number, scope: string, idempotencyKey: string): bigint {
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
