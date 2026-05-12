import type { Pool, PoolClient } from 'pg';
import { parseFiniteNumberLenient } from './miningNumeric.js';
import { sanitizeApiMessage, sanitizeForLog } from '../lib/safeText.js';
import { getMiningCoinsActiveMap } from '../lib/stack/miningCoinsPrismaCache.js';
import { miningCreditCapNowMs } from './miningWallClockGrid.js';
import {
  REDIS_LOCK_KEYS,
  releaseDistributedLock,
  tryAcquireDistributedLock,
  type LockHandle
} from '../lib/redisDistributedLock.js';
import { miningRuntimeStats } from './miningRuntimeStats.js';
import { brtDayFromMs } from '../modules/checkin/checkin.service.js';

const LOG_PREFIX = '[MiningProgress]';

let miningProgressLedgerSchemaWarned = false;

function miningProgressDistributedLockEffective(): boolean {
  return (
    String(process.env.REDIS_URL || '').trim().length > 0 &&
    String(process.env.GENESIS_REDIS_LOCKS_ENABLED ?? '1').trim() !== '0'
  );
}

function envFlagTrue(raw: string | undefined): boolean {
  const t = String(raw ?? '').trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes';
}

/** Alinhado à retenção de `mining_yield_history` — também limita quanto tempo pode ser creditado de uma vez (anti-farm / anti-manipulação de relógio). */
const MAX_EARNING_WINDOW_MS = 72 * 3600 * 1000;
const YIELD_HISTORY_LOOKBACK_MS = 73 * 3600 * 1000;
const CLOCK_SKEW_ALLOW_MS = 300_000;

let activeProgressCalculations = 0;

export function getActiveMiningProgressCalculations(): number {
  return activeProgressCalculations;
}

type YieldHistRow = { coin_id: string; yield_per_hash: unknown; effective_at: unknown };

export function calculateIntegratedYield(
  _coinId: string,
  startTimeMs: number,
  endTimeMs: number,
  sortedCoinHistory: YieldHistRow[] | undefined
): number {
  if (endTimeMs <= startTimeMs) return 0;
  if (!sortedCoinHistory || sortedCoinHistory.length === 0) return 0;

  const coinHistory = sortedCoinHistory;
  let totalYield = 0;
  let cursor = startTimeMs;

  let currentRate = parseFiniteNumberLenient(coinHistory[0]?.yield_per_hash, 'yield_hist.head');

  for (const h of coinHistory) {
    const effAt = parseFiniteNumberLenient(h.effective_at, 'yield_hist.effective_at');
    if (effAt <= startTimeMs) {
      currentRate = parseFiniteNumberLenient(h.yield_per_hash, 'yield_hist.rate');
    } else {
      break;
    }
  }

  for (const h of coinHistory) {
    const eff = parseFiniteNumberLenient(h.effective_at, 'yield_hist.effective_at');
    if (eff > startTimeMs && eff < endTimeMs) {
      const durationSec = (eff - cursor) / 1000;
      totalYield += durationSec * currentRate;
      cursor = eff;
      currentRate = parseFiniteNumberLenient(h.yield_per_hash, 'yield_hist.rate');
    }
  }

  const durationSec = (endTimeMs - cursor) / 1000;
  totalYield += durationSec * currentRate;

  return Number.isFinite(totalYield) ? totalYield : 0;
}

export type ComputeProgressResult = {
  ok: boolean;
  offlineMined?: Record<string, number>;
  error?: string;
};

function resolveUserId(uid: unknown): number | null {
  const n = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Calcula produção desde `last_updated_at`, credita `coin_balances`, actualiza racks / workshop / baterias.
 * Protecções: `FOR UPDATE` + re-leitura de `last_updated_at`, limite de janela offline, relógio alinhado ao servidor.
 *
 * Grelha de “blocos” de 10 min (meia-noite UTC + n·10 min): por defeito o tecto de crédito é o último limite
 * completo ≤ agora — nada conta dentro da janela 10 min até ela fechar. Desligar: MINING_WALL_CLOCK_TEN_MIN_GRID=0.
 */
export async function computeProgressForUser(
  pool: Pool,
  uid: unknown,
  nowArg: unknown,
  updateTimestamp = true
): Promise<ComputeProgressResult> {
  if (!updateTimestamp) return { ok: true };

  const userId = resolveUserId(uid);
  if (!userId) {
    console.warn(`${LOG_PREFIX} user id inválido: %s`, sanitizeForLog(String(uid), 48));
    return { ok: false, error: 'invalid user' };
  }

  if (String(process.env.MINING_PROGRESS_COMPUTE_ENABLED ?? '1').trim() === '0') {
    console.log(
      `${LOG_PREFIX} user=%s compute desligado (MINING_PROGRESS_COMPUTE_ENABLED=0)`,
      userId
    );
    return { ok: true };
  }

  if (envFlagTrue(process.env.MINING_PROGRESS_REQUIRE_REDIS_LOCK) && !miningProgressDistributedLockEffective()) {
    console.warn(
      `${LOG_PREFIX} user=%s ignorado (MINING_PROGRESS_REQUIRE_REDIS_LOCK sem Redis/locks efectivos — evita corrida multi-processo)`,
      userId
    );
    return { ok: true };
  }

  const wallClock = Date.now();
  let serverNow =
    typeof nowArg === 'number' && Number.isFinite(nowArg) ? (nowArg as number) : wallClock;

  if (serverNow > wallClock + CLOCK_SKEW_ALLOW_MS) {
    console.warn(`${LOG_PREFIX} user=%s now futuro clamped skewMs=%s`, userId, serverNow - wallClock);
    serverNow = wallClock;
  }

  const creditCap = miningCreditCapNowMs(serverNow);

  const lockTtlParsed = parseInt(String(process.env.MINING_PROGRESS_LOCK_TTL_SEC ?? '120').trim(), 10);
  const lockTtlSec = Number.isFinite(lockTtlParsed) ? Math.max(30, Math.min(600, lockTtlParsed)) : 120;

  let distLock: LockHandle | null = null;
  try {
    distLock = await tryAcquireDistributedLock(REDIS_LOCK_KEYS.miningProgressUser(userId), lockTtlSec);
    if (!distLock) {
      console.log(
        `${LOG_PREFIX} user=%s ignorado (lock Redis mining_progress — outro worker/pedido a processar)`,
        userId
      );
      return { ok: true };
    }

    const client = await pool.connect();
    activeProgressCalculations++;
    try {
      const coinMap = await getMiningCoinsActiveMap();
    const coinIds: string[] = [...coinMap.keys()];
    const coinEconomyRes =
      coinIds.length > 0
        ? await client.query(
            'SELECT id, block_reward, block_time, network_hashrate FROM mining_coins WHERE id = ANY($1) AND is_active = 1',
            [coinIds]
          )
        : { rows: [] };
    const fallbackYieldPerHashByCoin = new Map<string, number>();
    for (const coin of coinEconomyRes.rows as Array<Record<string, unknown>>) {
      const coinId = String(coin.id ?? '').trim();
      if (!coinId) continue;
      const blockReward = parseFiniteNumberLenient(coin.block_reward, `coin.${coinId}.block_reward`);
      const blockTime = parseFiniteNumberLenient(coin.block_time, `coin.${coinId}.block_time`);
      const configuredNetworkHash = parseFiniteNumberLenient(coin.network_hashrate, `coin.${coinId}.network_hashrate`);
      const liveNetworkHash = Number(miningRuntimeStats.globalNetworkHashrates.get(coinId) || 0);
      const effectiveHashrate = Math.max(liveNetworkHash, configuredNetworkHash > 0 ? configuredNetworkHash : 1);
      const rewardPerSec = blockTime > 0 ? blockReward / blockTime : 0;
      const fallbackRate = effectiveHashrate > 0 ? rewardPerSec / effectiveHashrate : 0;
      fallbackYieldPerHashByCoin.set(coinId, Number.isFinite(fallbackRate) && fallbackRate > 0 ? fallbackRate : 0);
    }

    const upgradesRes = await client.query('SELECT * FROM upgrades');
    const upgradesMap = new Map<string, Record<string, unknown>>();
    upgradesRes.rows.forEach((u) => upgradesMap.set(String(u.id), u as Record<string, unknown>));

    const gsResInitial = await client.query(
      'SELECT last_updated_at, start_time, last_checkin_day FROM game_states WHERE user_id = $1',
      [userId]
    );
    const gsInitial = gsResInitial.rows[0] as
      | { last_updated_at?: unknown; start_time?: unknown; last_checkin_day?: unknown }
      | undefined;
    if (!gsInitial) return { ok: true };

    const last = parseFiniteNumberLenient(gsInitial.last_updated_at ?? gsInitial.start_time, 'game_states.last');
    if (!Number.isFinite(last) || last <= 0) return { ok: true };

    // Check-in diário: se `last_checkin_day` ≠ dia BRT actual, a mineração
    // congela. `last_updated_at` continua a avançar para que o tempo passado
    // congelado não seja pago retroactivamente quando o jogador voltar a fazer
    // check-in.
    const checkinDay = typeof gsInitial.last_checkin_day === 'string' ? gsInitial.last_checkin_day : null;
    const todayBrt = brtDayFromMs(serverNow);
    const checkinFrozen = checkinDay !== todayBrt;

    if (serverNow < last) {
      console.warn(`${LOG_PREFIX} user=%s relógio atrás de last_updated (possível manipulação)`, userId);
      return { ok: true };
    }

    if (creditCap < last) {
      return { ok: true };
    }

    let dtMs = Math.max(0, creditCap - last);
    let lastWrite = creditCap;
    if (dtMs > MAX_EARNING_WINDOW_MS) {
      console.log(
        `${LOG_PREFIX} user=%s janela offline limitada dtMs=%s → maxMs=%s (próximo sync continua; evita pagar meses de uma vez ao reiniciar ou voltar depois de muito tempo)`,
        userId,
        dtMs,
        MAX_EARNING_WINDOW_MS
      );
      dtMs = MAX_EARNING_WINDOW_MS;
      lastWrite = last + MAX_EARNING_WINDOW_MS;
    }

    const dtSec = dtMs / 1000;
    if (dtMs <= 0 || !Number.isFinite(dtMs)) return { ok: true };

    const historyStart = Math.max(0, last - YIELD_HISTORY_LOOKBACK_MS);
    const yieldHistoryMap = new Map<string, YieldHistRow[]>();
    if (coinIds.length > 0) {
      const yhRes = await client.query(
        'SELECT * FROM mining_yield_history WHERE coin_id = ANY($1) AND effective_at >= $2',
        [coinIds, historyStart]
      );
      yhRes.rows.forEach((row: YieldHistRow) => {
        const cid = String(row.coin_id);
        if (!yieldHistoryMap.has(cid)) yieldHistoryMap.set(cid, []);
        yieldHistoryMap.get(cid)!.push(row);
      });
      for (const [, hist] of yieldHistoryMap.entries()) {
        hist.sort((a, b) => parseFiniteNumberLenient(a.effective_at) - parseFiniteNumberLenient(b.effective_at));
      }
    }

    const totalGained = new Map<string, number>();
    const rackUpdates: Array<{ id: string; isOn?: number }> = [];

    const racksRes = checkinFrozen
      ? { rows: [] as Array<Record<string, unknown>> }
      : await client.query('SELECT * FROM placed_racks WHERE user_id = $1', [userId]);
    const rows = racksRes.rows as Array<Record<string, unknown>>;

    if (rows.length > 0) {
      const rackIds = rows.map((r) => String(r.id));
      const allSlotsRes = await client.query(
        'SELECT rack_id, machine_item_id FROM rack_slots WHERE rack_id = ANY($1)',
        [rackIds]
      );
      const slotsMap = new Map<string, string[]>();
      allSlotsRes.rows.forEach((s) => {
        const rid = String(s.rack_id);
        if (!slotsMap.has(rid)) slotsMap.set(rid, []);
        slotsMap.get(rid)!.push(s.machine_item_id);
      });

      const allMultiRes = await client.query(
        'SELECT rack_id, multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = ANY($1)',
        [rackIds]
      );
      const multiMap = new Map<string, string[]>();
      allMultiRes.rows.forEach((m) => {
        const rid = String(m.rack_id);
        if (!multiMap.has(rid)) multiMap.set(rid, []);
        multiMap.get(rid)!.push(m.multiplier_item_id);
      });

      for (const r of rows) {
        const rid = String(r.id);
        const slots = slotsMap.get(rid) || [];
        const multiplierSlots = multiMap.get(rid) || [];

        // Baterias são instâncias UUID infinitas: rig opera se ligada, com cablagem e bateria.
        const isOn = Number(r.is_on) === 1;
        if (!isOn || !r.wiring_id || !r.battery_id) continue;

        const selectedCoinId = r.selected_coin_id ? String(r.selected_coin_id) : '';
        if (selectedCoinId) {
          const coin = coinMap.get(selectedCoinId);
          if (coin && !coin.isActive) {
            rackUpdates.push({ id: rid, isOn: 0 });
            continue;
          }
        }

        const timeAvailMs = dtMs;
        if (timeAvailMs > 0) {
          if (selectedCoinId) {
            const coin = coinMap.get(selectedCoinId);
            if (coin && coin.isActive) {
              let rackBaseProd = 0;
              slots.forEach((sid) => {
                if (sid) {
                  const up = upgradesMap.get(String(sid));
                  if (up) rackBaseProd += parseFiniteNumberLenient(up.base_production, 'rack.bp');
                }
              });
              let multiplierFactor = 1;
              multiplierSlots.forEach((sid) => {
                if (sid) {
                  const up = upgradesMap.get(String(sid));
                  if (up) multiplierFactor += parseFiniteNumberLenient(up.multiplier, 'rack.mult');
                }
              });
              const rackTotalProd = rackBaseProd * multiplierFactor;

              const historyYield = calculateIntegratedYield(
                selectedCoinId,
                last,
                last + timeAvailMs,
                yieldHistoryMap.get(selectedCoinId)
              );
              const fallbackYield =
                (fallbackYieldPerHashByCoin.get(selectedCoinId) || 0) * (timeAvailMs / 1000);
              const integratedYield = historyYield > 0 ? historyYield : fallbackYield;
              const gained = rackTotalProd * integratedYield;
              if (Number.isFinite(gained) && gained > 0) {
                totalGained.set(selectedCoinId, (totalGained.get(selectedCoinId) || 0) + gained);
              }
            }
          }
        }
      }
    }

    await client.query('BEGIN');
    await client.query("SET statement_timeout = '5s'");

    const gsVerify = await client.query(
      'SELECT last_updated_at, start_time FROM game_states WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (!gsVerify.rowCount) {
      await client.query('ROLLBACK');
      return { ok: true };
    }
    const lastConfirmed = parseFiniteNumberLenient(
      (gsVerify.rows[0] as { last_updated_at?: unknown; start_time?: unknown }).last_updated_at ??
        (gsVerify.rows[0] as { start_time?: unknown }).start_time,
      'verify.last'
    );
    if (!Number.isFinite(lastConfirmed) || lastConfirmed !== last) {
      await client.query('ROLLBACK');
      console.log(`${LOG_PREFIX} user=%s race evitada (last mudou durante compute)`, userId);
      return { ok: true };
    }

    const idempotencyKey = `mp:${userId}:${Math.floor(last)}:${Math.floor(lastWrite)}`.slice(0, 190);
    if (String(process.env.MINING_PROGRESS_LEDGER_ENABLED ?? '1').trim() !== '0') {
      try {
        await client.query('SAVEPOINT mining_progress_ledger_sp');
        const led = await client.query(
          `INSERT INTO mining_progress_commit_ledger (user_id, idempotency_key) VALUES ($1, $2)
           ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`,
          [userId, idempotencyKey]
        );
        if ((led.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          console.log(
            `${LOG_PREFIX} user=%s idempotência ledger duplicada — skip key=%s lockAcquired=true`,
            userId,
            sanitizeForLog(idempotencyKey, 120)
          );
          return { ok: true };
        }
        await client.query('RELEASE SAVEPOINT mining_progress_ledger_sp');
      } catch (e: unknown) {
        const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
        if (code === '42P01') {
          await client.query('ROLLBACK TO SAVEPOINT mining_progress_ledger_sp');
          await client.query('RELEASE SAVEPOINT mining_progress_ledger_sp');
          if (!miningProgressLedgerSchemaWarned) {
            miningProgressLedgerSchemaWarned = true;
            console.warn(
              `${LOG_PREFIX} tabela mining_progress_commit_ledger ausente (42P01) — aplicar migrate; idempotência por ledger desactivada neste arranque`
            );
          }
        } else {
          throw e;
        }
      }
    }

    if (totalGained.size > 0) {
      const cIds = Array.from(totalGained.keys());
      const cAmts = Array.from(totalGained.values());
      await client.query(
        `INSERT INTO coin_balances (user_id, coin_id, amount)
         SELECT $1, unnest($2::text[]), unnest($3::numeric[])
         ON CONFLICT (user_id, coin_id)
         DO UPDATE SET amount = coin_balances.amount + EXCLUDED.amount`,
        [userId, cIds, cAmts]
      );
    }

    if (rackUpdates.length > 0) {
      const rIds = rackUpdates.map((u) => u.id);
      const rIsOns = rackUpdates.map((u) => (u.isOn !== undefined ? u.isOn : null));
      await client.query(
        `UPDATE placed_racks SET
          is_on = COALESCE(data.is_on, placed_racks.is_on)
        FROM (SELECT unnest($1::text[]) as id, unnest($2::int[]) as is_on) as data
        WHERE placed_racks.id = data.id AND placed_racks.user_id = $3`,
        [rIds, rIsOns, userId]
      );
    }

    await client.query('UPDATE game_states SET last_updated_at = $1 WHERE user_id = $2', [lastWrite, userId]);
    await client.query('COMMIT');

    if (totalGained.size > 0) {
      console.log(
        `${LOG_PREFIX} user=%s credited coins=%s lastWrite=%s idempotencyKey=%s lockAcquired=true`,
        userId,
        sanitizeForLog(JSON.stringify(Object.fromEntries(totalGained)), 256),
        lastWrite,
        sanitizeForLog(idempotencyKey, 120)
      );
    } else if (rackUpdates.length > 0) {
      console.log(
        `${LOG_PREFIX} user=%s commit racks=%s idempotencyKey=%s lockAcquired=true`,
        userId,
        rackUpdates.length,
        sanitizeForLog(idempotencyKey, 120)
      );
    }

    return { ok: true, offlineMined: Object.fromEntries(totalGained) };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${LOG_PREFIX} user=%s erro: %s`, userId, sanitizeForLog(msg, 240));
      return { ok: false, error: sanitizeApiMessage(msg, 240) };
    } finally {
      client.release();
      activeProgressCalculations--;
    }
  } finally {
    await releaseDistributedLock(distLock);
  }
}
