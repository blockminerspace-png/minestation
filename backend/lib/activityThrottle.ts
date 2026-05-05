/**
 * Estado in-memory por worker para reduzir writes em last_active_at e user_history_ips.
 */

export type ActivityThrottleConfig = {
  lastActiveMinMs: number;
  historyIpMinMs: number;
  mapMax: number;
};

export function parseActivityThrottleMs(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const n = parseInt(String(raw || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseActivityThrottleMapMax(raw: string | undefined): number {
  return Math.min(
    500_000,
    Math.max(5_000, parseInt(String(raw || '100000'), 10) || 100_000)
  );
}

export function resolveActivityThrottleConfig(
  env: NodeJS.ProcessEnv = process.env
): ActivityThrottleConfig {
  return {
    lastActiveMinMs: parseActivityThrottleMs(
      env.ACTIVITY_LAST_ACTIVE_MIN_MS,
      30_000,
      15_000,
      300_000
    ),
    historyIpMinMs: parseActivityThrottleMs(
      env.ACTIVITY_HISTORY_IP_MIN_MS,
      60_000,
      30_000,
      300_000
    ),
    mapMax: parseActivityThrottleMapMax(env.ACTIVITY_THROTTLE_MAP_MAX)
  };
}

const PRUNE_CUTOFF_MS = 600_000;

export class ActivityThrottleMaps {
  readonly lastActiveWriteAt = new Map<number, number>();
  readonly historyIpUpsertAt = new Map<string, number>();

  constructor(private readonly cfg: ActivityThrottleConfig) {}

  shouldWriteLastActive(userId: number, now: number): boolean {
    const prev = this.lastActiveWriteAt.get(userId);
    return prev == null || now - prev >= this.cfg.lastActiveMinMs;
  }

  markLastActiveWritten(userId: number, now: number): void {
    this.lastActiveWriteAt.set(userId, now);
  }

  historyIpKey(userId: number, ip: string): string {
    return `${userId}:${ip}`;
  }

  shouldWriteHistoryIp(userId: number, ip: string, now: number): boolean {
    const key = this.historyIpKey(userId, ip);
    const prev = this.historyIpUpsertAt.get(key);
    return prev == null || now - prev >= this.cfg.historyIpMinMs;
  }

  markHistoryIpWritten(userId: number, ip: string, now: number): void {
    this.historyIpUpsertAt.set(this.historyIpKey(userId, ip), now);
  }

  /** Remove entradas antigas quando os mapas excedem `mapMax`. */
  prune(now: number): void {
    if (
      this.lastActiveWriteAt.size <= this.cfg.mapMax &&
      this.historyIpUpsertAt.size <= this.cfg.mapMax
    ) {
      return;
    }
    const cutoff = now - PRUNE_CUTOFF_MS;
    for (const [k, t] of this.lastActiveWriteAt) {
      if (t < cutoff) this.lastActiveWriteAt.delete(k);
    }
    for (const [k, t] of this.historyIpUpsertAt) {
      if (t < cutoff) this.historyIpUpsertAt.delete(k);
    }
  }
}
