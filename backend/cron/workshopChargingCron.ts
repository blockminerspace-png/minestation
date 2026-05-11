import type { Pool, PoolClient } from 'pg';
import { sanitizeForLog } from '../lib/safeText.js';
import { snapWorkshopBatteryChargeWh, isWorkshopBatteryChargeFull } from '../lib/workshopBatteryCharge.js';

const LOG_PREFIX = '[WorkshopCharging]';
const ADVISORY_LOCK_A = 6102026;
const ADVISORY_LOCK_B = 5010;
const DEFAULT_INTERVAL_MS = 30_000;
const MAX_TICK_DT_SEC = 120;

let isTickRunning = false;
let lastWorkshopChargeTickAt = Date.now();

type ChargingRow = {
  user_id: unknown;
  battery_id: unknown;
  current_charge: unknown;
  stored_capacity_wh: unknown;
  catalog_capacity_wh: unknown;
  workshop_slot_index: unknown;
  workshop_component_slot_id: unknown;
  charger_internal_charge: unknown;
  slot_charges: unknown;
  charger_speed: unknown;
};

type SlotGroup = {
  userId: number;
  slotIndex: number;
  internalWh: number;
  slotCharges: Record<string, unknown>;
  rows: ChargingRow[];
};

function parseFiniteNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseSlotCharges(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

async function tryAcquireTickLock(client: PoolClient): Promise<boolean> {
  const res = await client.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [ADVISORY_LOCK_A, ADVISORY_LOCK_B]);
  return res.rows[0]?.locked === true;
}

async function releaseTickLock(client: PoolClient): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_A, ADVISORY_LOCK_B]);
  } catch {
    /* best effort */
  }
}

export async function tickWorkshopCharging(pool: Pool, nowMs = Date.now()): Promise<void> {
  if (isTickRunning) return;
  const previousTickAt = lastWorkshopChargeTickAt;
  lastWorkshopChargeTickAt = nowMs;
  const dtSec = Math.min(MAX_TICK_DT_SEC, Math.max(0, (nowMs - previousTickAt) / 1000));
  if (!(dtSec > 0)) return;

  isTickRunning = true;
  const client = await pool.connect();
  let locked = false;
  let startedTransaction = false;

  try {
    locked = await tryAcquireTickLock(client);
    if (!locked) return;

    const chargingRes = await client.query(
      `
      SELECT
        sb.user_id,
        sb.id AS battery_id,
        sb.current_charge,
        sb.power_capacity_wh AS stored_capacity_wh,
        bu.power_capacity AS catalog_capacity_wh,
        sb.workshop_slot_index,
        sb.workshop_component_slot_id,
        ws.current_charge AS charger_internal_charge,
        ws.slot_charges,
        cu.base_production AS charger_speed
      FROM stored_batteries sb
      JOIN workshop_slots ws
        ON ws.user_id = sb.user_id
       AND ws.slot_index = sb.workshop_slot_index
      LEFT JOIN upgrades bu ON bu.id = sb.item_id
      LEFT JOIN upgrades cu ON cu.id = ws.item_id
      WHERE sb.status = 'CHARGING'
        AND sb.workshop_slot_index IS NOT NULL
        AND sb.workshop_component_slot_id IS NOT NULL
        AND ws.item_id IS NOT NULL
      ORDER BY sb.user_id, sb.workshop_slot_index, sb.workshop_component_slot_id
      `
    );

    const groups = new Map<string, SlotGroup>();
    for (const row of chargingRes.rows as ChargingRow[]) {
      const userId = Math.trunc(parseFiniteNumber(row.user_id));
      const slotIndex = Math.trunc(parseFiniteNumber(row.workshop_slot_index));
      if (!(userId > 0) || !(slotIndex >= 0)) continue;

      const key = `${userId}:${slotIndex}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          userId,
          slotIndex,
          internalWh: Math.max(0, parseFiniteNumber(row.charger_internal_charge)),
          slotCharges: parseSlotCharges(row.slot_charges),
          rows: []
        };
        groups.set(key, group);
      }
      group.rows.push(row);
    }

    if (groups.size === 0) return;

    await client.query('BEGIN');
    startedTransaction = true;

    let updatedSlots = 0;
    let updatedBatteries = 0;

    for (const group of groups.values()) {
      let anySlotUpdate = false;

      for (const row of group.rows) {
        const batteryId = typeof row.battery_id === 'string' ? row.battery_id.trim() : '';
        const storageKey =
          typeof row.workshop_component_slot_id === 'string' ? row.workshop_component_slot_id.trim() : '';
        if (!batteryId || !storageKey) continue;

        const storedCapacityWh = parseFiniteNumber(row.stored_capacity_wh);
        const catalogCapacityWh = parseFiniteNumber(row.catalog_capacity_wh);
        const maxBatteryWh = storedCapacityWh !== 0 ? storedCapacityWh : catalogCapacityWh;
        let batteryWh = Math.max(0, parseFiniteNumber(row.current_charge));

        if (maxBatteryWh === -1) {
          if (group.slotCharges[storageKey] !== -1 || batteryWh !== -1) {
            group.slotCharges[storageKey] = -1;
            await client.query('UPDATE stored_batteries SET current_charge = -1 WHERE user_id = $1 AND id = $2', [
              group.userId,
              batteryId
            ]);
            updatedBatteries++;
            anySlotUpdate = true;
          }
          continue;
        }

        if (!(maxBatteryWh > 0)) continue;

        const snappedBefore = snapWorkshopBatteryChargeWh(batteryWh, maxBatteryWh);
        if (snappedBefore !== batteryWh) {
          batteryWh = snappedBefore;
          group.slotCharges[storageKey] = batteryWh;
          await client.query('UPDATE stored_batteries SET current_charge = $1 WHERE user_id = $2 AND id = $3', [
            batteryWh,
            group.userId,
            batteryId
          ]);
          updatedBatteries++;
          anySlotUpdate = true;
        }

        if (isWorkshopBatteryChargeFull(batteryWh, maxBatteryWh) || group.internalWh <= 0) continue;

        const speedWhPerSec = Math.max(0, parseFiniteNumber(row.charger_speed) || 0.5);
        const transferWh = Math.min(speedWhPerSec * dtSec, group.internalWh, maxBatteryWh - batteryWh);
        if (!(transferWh > 0)) continue;

        batteryWh = snapWorkshopBatteryChargeWh(batteryWh + transferWh, maxBatteryWh);
        group.internalWh = Math.max(0, group.internalWh - transferWh);
        group.slotCharges[storageKey] = batteryWh;

        await client.query('UPDATE stored_batteries SET current_charge = $1 WHERE user_id = $2 AND id = $3', [
          batteryWh,
          group.userId,
          batteryId
        ]);
        updatedBatteries++;
        anySlotUpdate = true;
      }

      if (anySlotUpdate) {
        await client.query(
          'UPDATE workshop_slots SET current_charge = $1, slot_charges = $2 WHERE user_id = $3 AND slot_index = $4',
          [group.internalWh, JSON.stringify(group.slotCharges), group.userId, group.slotIndex]
        );
        updatedSlots++;
      }
    }

    await client.query('COMMIT');
    startedTransaction = false;

    if (updatedSlots > 0 || updatedBatteries > 0) {
      console.log(`${LOG_PREFIX} tick slots=%s batteries=%s dtSec=%s`, updatedSlots, updatedBatteries, dtSec.toFixed(2));
    }
  } catch (e) {
    if (startedTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG_PREFIX} erro:`, sanitizeForLog(msg, 240));
  } finally {
    if (locked) await releaseTickLock(client);
    client.release();
    isTickRunning = false;
  }
}

export type StartWorkshopChargingCronOptions = {
  intervalMs?: number;
  startupDelayMs?: number;
  workerRole?: string;
};

export function startWorkshopChargingCron(pool: Pool, opts: StartWorkshopChargingCronOptions = {}): void {
  const role = opts.workerRole ?? process.env.WORKER_ROLE ?? 'ALL';
  if (role !== 'BACKGROUND' && role !== 'ALL') {
    console.log(`${LOG_PREFIX} não agendado (WORKER_ROLE=%s)`, sanitizeForLog(role, 32));
    return;
  }
  if (String(process.env.BATTERY_WORKERS_ENABLED ?? '1').trim() === '0') {
    console.log(`${LOG_PREFIX} não agendado (BATTERY_WORKERS_ENABLED=0)`);
    return;
  }
  if (
    String(process.env.SCHEDULER_ENABLED ?? '1').trim() === '0' ||
    String(process.env.WORKSHOP_CHARGING_SCHEDULER_ENABLED ?? '1').trim() === '0'
  ) {
    console.log(`${LOG_PREFIX} não agendado (SCHEDULER_ENABLED=0 ou WORKSHOP_CHARGING_SCHEDULER_ENABLED=0)`);
    return;
  }

  const intervalMs = Math.max(5_000, Math.floor(opts.intervalMs ?? DEFAULT_INTERVAL_MS));
  const startupDelayMs = Math.max(0, Math.floor(opts.startupDelayMs ?? 10_000));
  lastWorkshopChargeTickAt = Date.now();

  setTimeout(() => {
    void tickWorkshopCharging(pool).catch((e) => {
      console.error(`${LOG_PREFIX} tick inicial:`, sanitizeForLog(e instanceof Error ? e.message : String(e), 200));
    });
    setInterval(() => {
      void tickWorkshopCharging(pool).catch((e) => {
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
