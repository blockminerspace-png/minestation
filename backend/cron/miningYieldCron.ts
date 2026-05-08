import type { Pool, PoolClient } from 'pg';
import { resolvePlacedRackBatteryCatalogId } from '../lib/placedRackBatteryCatalog.js';
import { parseFiniteNumberLenient } from './miningNumeric.js';
import { sanitizeForLog } from '../lib/safeText.js';
import { miningRuntimeStats } from './miningRuntimeStats.js';
import { setGlobalNetworkStats, type GlobalNetworkStatsState } from './miningGlobalStatsStore.js';
import { getStackIo } from '../lib/stack/stackIoSingleton.js';
import { enqueueGenesisJob } from '../lib/stack/genesisBullQueue.js';
import { logGameEvent, logAnalyticsEvent } from '../lib/mongoLogs.js';
import { maybeSyncLiveUsdToMiningCoinsPostgres } from '../lib/miningLivePrices.js';
import type { MiningUsdDbSyncResult } from '../lib/miningLivePrices.js';
import { miningTenMinuteGridEnabled, lastCompletedTenMinuteUtcGrid } from './miningWallClockGrid.js';

const LOG_PREFIX = '[MiningYieldCron]';

/** Alinhado à retenção em mining_yield_history (server legado). */
const HISTORY_RETENTION_MS = 72 * 3600 * 1000;

let isUpdateRunning = false;
/** Último `effective_at` de grelha 10 min UTC já gravado no histórico global (evita duplicar entre ticks do cron). */
let lastYieldHistoryBoundaryMs = 0;
/** Evita re-hidratar em cada tick; só falha silenciosamente até conseguir. */
let yieldHistoryBoundaryHydrated = false;

async function hydrateYieldHistoryBoundaryFromDb(c: PoolClient): Promise<void> {
  if (!miningTenMinuteGridEnabled() || yieldHistoryBoundaryHydrated) return;
  try {
    const r = await c.query(
      `SELECT (MAX(effective_at))::float8 AS m FROM mining_yield_history WHERE effective_at IS NOT NULL`
    );
    const raw = r.rows[0]?.m;
    const mx = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
    if (Number.isFinite(mx) && mx > 0) {
      lastYieldHistoryBoundaryMs = lastCompletedTenMinuteUtcGrid(mx);
    }
    yieldHistoryBoundaryHydrated = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG_PREFIX} hydrate yield boundary (re-tenta no próximo tick):`, sanitizeForLog(msg, 180));
  }
}

function safeRollback(client: PoolClient): void {
  client
    .query('ROLLBACK')
    .catch(() => {
      /* ignore */
    });
}

type RackRow = {
  selected_coin_id: string;
  id: string;
  user_id: number;
  battery_id: string;
  current_charge: unknown;
  username: unknown;
};

type UserStat = {
  user_id: number;
  username: unknown;
  coins: Record<string, number>;
};

function resolveDefaultIntervalMs(optsInterval?: number): number {
  if (optsInterval != null && Number.isFinite(optsInterval)) {
    return Math.max(15_000, Math.floor(optsInterval));
  }
  const raw = process.env.MINING_YIELD_CRON_INTERVAL_MS;
  const envMs = raw ? parseInt(String(raw).trim(), 10) : NaN;
  if (Number.isFinite(envMs) && envMs >= 15_000) {
    return Math.floor(envMs);
  }
  return 120_000;
}

/**
 * Um único scan de racks + upgrades + slots + multipliers:
 * actualiza yields em BD, stats em memória, ranking + app_cache (evita segundo job em server.js).
 */
export async function updateMiningYields(pool: Pool): Promise<void> {
  if (isUpdateRunning) {
    console.log(`${LOG_PREFIX} tick ignorado (execução anterior ainda a correr)`);
    return;
  }
  isUpdateRunning = true;
  const tickStart = Date.now();

  const client = await pool.connect();
  try {
    await hydrateYieldHistoryBoundaryFromDb(client);

    const activeRes = await client.query(`
      SELECT pr.selected_coin_id, pr.id, pr.user_id, pr.battery_id, pr.current_charge, u.username
      FROM placed_racks pr
      JOIN users u ON pr.user_id = u.id
      JOIN mining_coins mc ON pr.selected_coin_id = mc.id
      WHERE pr.is_on = 1
      AND mc.is_active = 1
      AND pr.wiring_id IS NOT NULL
      AND pr.battery_id IS NOT NULL
      AND u.is_blocked = 0
      AND u.ranking_excluded = 0
    `);

    const upsRes = await client.query('SELECT id, base_production, multiplier, power_capacity FROM upgrades');
    const upsMap = new Map<string, { base_production?: unknown; multiplier?: unknown; power_capacity?: unknown }>();
    upsRes.rows.forEach((u) => upsMap.set(String(u.id), u));

    const storedBattAll = await client.query('SELECT id, item_id FROM stored_batteries');
    const storedBattCatalogByInstanceId = new Map<string, string>();
    for (const sb of storedBattAll.rows as Array<{ id?: unknown; item_id?: unknown }>) {
      const iid = String(sb.id ?? '').trim();
      const itemId = String(sb.item_id ?? '').trim();
      if (iid && itemId) storedBattCatalogByInstanceId.set(iid, itemId);
    }

    const slotRes = await client.query('SELECT rack_id, machine_item_id FROM rack_slots');
    const slotsMap: Record<string, string[]> = {};
    slotRes.rows.forEach((s) => {
      const rid = String(s.rack_id);
      if (!slotsMap[rid]) slotsMap[rid] = [];
      slotsMap[rid].push(s.machine_item_id);
    });

    const multiRes = await client.query('SELECT rack_id, multiplier_item_id FROM rack_multiplier_slots');
    const multiMap: Record<string, string[]> = {};
    multiRes.rows.forEach((m) => {
      const rid = String(m.rack_id);
      if (!multiMap[rid]) multiMap[rid] = [];
      multiMap[rid].push(m.multiplier_item_id);
    });

    const realNetworkHashratesMap = new Map<string, number>();
    const activeUsersSet = new Set<number>();
    const activeUsersByCoinVar = new Map<string, Set<number>>();
    const userStats = new Map<number, UserStat>();

    const racks = activeRes.rows as RackRow[];
    const BATCH_SIZE = 200;

    for (let i = 0; i < racks.length; i += BATCH_SIZE) {
      const batch = racks.slice(i, i + BATCH_SIZE);

      for (const rack of batch) {
        const cid = String(rack.selected_coin_id);
        if (!cid) continue;

        const battKey = resolvePlacedRackBatteryCatalogId(rack.battery_id, storedBattCatalogByInstanceId);
        const batt = battKey ? upsMap.get(String(battKey)) : undefined;
        const powerCap = batt ? parseFiniteNumberLenient(batt.power_capacity, 'rack.battery_power_cap') : 0;
        const isInfinite = powerCap === -1;
        const charge = parseFiniteNumberLenient(rack.current_charge, 'rack.charge');
        if (!isInfinite && charge <= 0) continue;

        let base = 0;
        (slotsMap[rack.id] || []).forEach((mid) => {
          const u = upsMap.get(String(mid));
          if (u) base += parseFiniteNumberLenient(u.base_production, 'slot.base_production');
        });
        if (base === 0) continue;

        let mult = 1;
        (multiMap[rack.id] || []).forEach((mid) => {
          const u = upsMap.get(String(mid));
          if (u) mult += parseFiniteNumberLenient(u.multiplier, 'slot.multiplier');
        });

        const power = base * mult;
        if (!Number.isFinite(power) || power <= 0) continue;

        realNetworkHashratesMap.set(cid, (realNetworkHashratesMap.get(cid) || 0) + power);

        activeUsersSet.add(rack.user_id);
        if (!activeUsersByCoinVar.has(cid)) activeUsersByCoinVar.set(cid, new Set());
        activeUsersByCoinVar.get(cid)!.add(rack.user_id);

        if (!userStats.has(rack.user_id)) {
          userStats.set(rack.user_id, {
            user_id: rack.user_id,
            username: rack.username,
            coins: {},
          });
        }
        const uStat = userStats.get(rack.user_id)!;
        uStat.coins[cid] = (uStat.coins[cid] || 0) + power;
      }

      if (i + BATCH_SIZE < racks.length) {
        await new Promise<void>((resolve) => setImmediate(() => resolve()));
      }
    }

    miningRuntimeStats.globalNetworkHashrates.clear();
    miningRuntimeStats.globalActiveMinersByCoin.clear();
    for (const [cid, total] of realNetworkHashratesMap.entries()) {
      miningRuntimeStats.globalNetworkHashrates.set(cid, total);
    }
    miningRuntimeStats.globalActiveMiners = activeUsersSet.size;
    for (const [cid, userSet] of activeUsersByCoinVar.entries()) {
      miningRuntimeStats.globalActiveMinersByCoin.set(cid, userSet.size);
    }

    const coinTotals: Record<string, number> = {};
    for (const [cid, v] of realNetworkHashratesMap.entries()) {
      coinTotals[cid] = v;
    }

    const activeMinersByCoin: Record<string, number> = {};
    let totalActiveUsers = 0;
    const rankingList: GlobalNetworkStatsState['ranking'] = [];

    userStats.forEach((u) => {
      const userCoins = Object.keys(u.coins);
      if (userCoins.length > 0) {
        totalActiveUsers++;
        rankingList.push({
          ...u,
          totalPower: Object.values(u.coins).reduce((a, b) => Number(a) + Number(b), 0),
        });
        userCoins.forEach((coinId) => {
          if (u.coins[coinId] > 0) {
            activeMinersByCoin[coinId] = (activeMinersByCoin[coinId] || 0) + 1;
          }
        });
      }
    });

    rankingList.sort((a, b) => b.totalPower - a.totalPower);

    const newState: GlobalNetworkStatsState = {
      hashrates: coinTotals,
      activeMiners: totalActiveUsers,
      activeMinersByCoin: activeMinersByCoin,
      ranking: rankingList,
    };
    setGlobalNetworkStats(newState);

    try {
      await client.query(
        `
        INSERT INTO app_cache (key, value, updated_at)
        VALUES ('network_stats', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
      `,
        [newState]
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${LOG_PREFIX} app_cache network_stats:`, sanitizeForLog(msg, 200));
    }

    const wallAt = Date.now();
    const coinsRes = await client.query(
      'SELECT id, block_reward, block_time, network_hashrate FROM mining_coins WHERE is_active = 1'
    );
    const boundaryAligned = miningTenMinuteGridEnabled()
      ? lastCompletedTenMinuteUtcGrid(wallAt)
      : wallAt;

    let doYieldHistoryInsert = true;
    if (miningTenMinuteGridEnabled()) {
      doYieldHistoryInsert = boundaryAligned > lastYieldHistoryBoundaryMs;
    }

    await client.query('BEGIN');

    if (doYieldHistoryInsert) {
      const tickNow = boundaryAligned;
      for (const coin of coinsRes.rows) {
      const coinId = String(coin.id);
      const realNetHash = realNetworkHashratesMap.get(coinId) || 0;

      const blockReward = parseFiniteNumberLenient(coin.block_reward, `coin.${coinId}.block_reward`);
      const blockTime = parseFiniteNumberLenient(coin.block_time, `coin.${coinId}.block_time`);
      const networkHashrate = parseFiniteNumberLenient(coin.network_hashrate, `coin.${coinId}.network_hashrate`);
      const floorHash = networkHashrate > 0 ? networkHashrate : 1;

      let yieldPerHash = 0;
      if (realNetHash > 0) {
        if (!(blockTime > 0)) {
          console.warn(`${LOG_PREFIX} block_time inválido coin=%s`, sanitizeForLog(coinId));
          yieldPerHash = 0;
        } else {
          const rewardPerSec = blockReward / blockTime;
          const effectiveHashrate = Math.max(realNetHash, floorHash);
          yieldPerHash = rewardPerSec / effectiveHashrate;
        }
      }

      if (!Number.isFinite(yieldPerHash) || yieldPerHash < 0) {
        console.warn(`${LOG_PREFIX} yieldPerHash inválido coin=%s — forçado a 0`, sanitizeForLog(coinId));
        yieldPerHash = 0;
      }

      await client.query(
        `INSERT INTO mining_yield_history (coin_id, yield_per_hash, block_reward, network_hashrate, effective_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [coin.id, yieldPerHash, blockReward, floorHash, tickNow]
      );
      }
    }

    const retention = Date.now() - HISTORY_RETENTION_MS;
    await client.query('DELETE FROM mining_yield_history WHERE effective_at < $1', [retention]);

    await client.query('COMMIT');

    if (doYieldHistoryInsert && miningTenMinuteGridEnabled()) {
      lastYieldHistoryBoundaryMs = boundaryAligned;
    }

    const duration = Date.now() - tickStart;
    if (duration > 1500) {
      console.log(
        `${LOG_PREFIX} tick ${duration}ms racks=${racks.length} users=${totalActiveUsers}`
      );
    }

    const payload = {
      durationMs: duration,
      rackCount: racks.length,
      activeUsers: totalActiveUsers,
      at: wallAt,
      yieldHistoryBoundary: miningTenMinuteGridEnabled() ? boundaryAligned : null
    };
    getStackIo()?.emit('mining:tick', payload);
    void enqueueGenesisJob('miningYieldTick', payload);
    logGameEvent('mining_yield_tick', payload);
    logAnalyticsEvent('mining_yield_tick', { durationMs: duration, rackCount: racks.length });

    void maybeSyncLiveUsdToMiningCoinsPostgres(pool)
      .then((r: MiningUsdDbSyncResult) => {
        if (r && 'ok' in r && r.ok && r.updated > 0) {
          console.log(`${LOG_PREFIX} price_usd/usdc_rate na BD: moedas actualizadas=${r.updated}`);
        }
      })
      .catch((e: unknown) => {
        const m = e instanceof Error ? e.message : String(e);
        console.warn(`${LOG_PREFIX} sync USD→BD:`, sanitizeForLog(m, 200));
      });
  } catch (e) {
    safeRollback(client);
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG_PREFIX} erro:`, sanitizeForLog(msg, 200));
  } finally {
    client.release();
    isUpdateRunning = false;
  }
}

export type StartMiningYieldCronOptions = {
  intervalMs?: number;
  startupDelayMs?: number;
  /** default: process.env.WORKER_ROLE || 'ALL' */
  workerRole?: string;
};

/**
 * Agenda o job só em BACKGROUND ou ALL (cluster-safe).
 */
export function startMiningYieldCron(pool: Pool, opts: StartMiningYieldCronOptions = {}): void {
  const role = opts.workerRole ?? process.env.WORKER_ROLE ?? 'ALL';
  if (role !== 'BACKGROUND' && role !== 'ALL') {
    console.log(`${LOG_PREFIX} não agendado (WORKER_ROLE=%s)`, sanitizeForLog(role, 32));
    return;
  }

  const intervalMs = resolveDefaultIntervalMs(opts.intervalMs);
  const startupDelayMs = Math.max(0, Math.floor(opts.startupDelayMs ?? 5000));

  setTimeout(() => {
    void updateMiningYields(pool).catch((e) => {
      console.error(`${LOG_PREFIX} tick inicial:`, sanitizeForLog(e instanceof Error ? e.message : String(e), 200));
    });
    setInterval(() => {
      void updateMiningYields(pool).catch((e) => {
        console.error(`${LOG_PREFIX} tick:`, sanitizeForLog(e instanceof Error ? e.message : String(e), 200));
      });
    }, intervalMs);
  }, startupDelayMs);

  console.log(
    `${LOG_PREFIX} agendado intervalMs=%s startupDelayMs=%s role=%s`,
    intervalMs,
    startupDelayMs,
    sanitizeForLog(role, 32)
  );
}
