import type { Pool } from 'pg';

export type MiningUsdDbSyncResult =
  | { skipped: true; reason: string }
  | { ok: true; updated: number }
  | { ok: false; error: string };

export function fetchLiveUsdByMiningCoinRowIds(
  rows: Array<Record<string, unknown>>,
  opts?: { ttlMs?: number; timeoutMs?: number }
): Promise<Record<string, number | null>>;

export function maybeSyncLiveUsdToMiningCoinsPostgres(
  pool: Pool,
  opts?: { enabled?: boolean; intervalMs?: number }
): Promise<MiningUsdDbSyncResult>;

export const MINING_ECONOMY_PUBLIC_META: Readonly<{
  blockIntervalMinutes: number;
  blocksPerDay: number;
  blocksPer28Days: number;
  notePt: string;
  livePriceProvider: string;
  livePriceHintPt: string;
  priceDbSyncHintPt: string;
  blockGridHintPt: string;
}>;
