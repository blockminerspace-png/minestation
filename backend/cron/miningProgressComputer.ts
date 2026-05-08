import type { Pool, PoolClient } from 'pg';
import { parseFiniteNumberLenient } from './miningNumeric.js';
import { sanitizeApiMessage, sanitizeForLog } from '../lib/safeText.js';
import { getMiningCoinsActiveMap } from '../lib/stack/miningCoinsPrismaCache.js';
import { miningCreditCapNowMs } from './miningWallClockGrid.js';

const LOG_PREFIX = '[MiningProgress]';

/** Alinhado à retenção de `mining_yield_history` — também limita quanto tempo pode ser creditado de uma vez (anti-farm / anti-manipulação de relógio). */
const MAX_EARNING_WINDOW_MS = 72 * 3600 * 1000;
const YIELD_HISTORY_LOOKBACK_MS = 73 * 3600 * 1000;
const CLOCK_SKEW_ALLOW_MS = 300_000;

let activeProgressCalculations = 0;

export function getActiveMiningProgressCalculations(): number {
  return activeProgressCalculations;
}

type YieldHistRow = { coin_id: string; yield_per_hash: unknown; effective_at: unknown };

function safeParseJsonRecord(value: unknown, maxChars: number, ctx: string): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  if (t.length > maxChars) {
    console.warn(`${LOG_PREFIX} %s: JSON demasiado grande (%s chars)`, sanitizeForLog(ctx, 64), t.length);
    return null;
  }
  try {
    const v = JSON.parse(t) as unknown;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    console.warn(`${LOG_PREFIX} %s: JSON inválido`, sanitizeForLog(ctx, 64));
    return null;
  }
}

type LayoutSlot = { type?: string; id?: string };

function parseChargerLayout(raw: unknown, itemId: string): LayoutSlot[] | null {
  const obj =
    typeof raw === 'string'
      ? safeParseJsonRecord(raw, 400_000, `charger_layout:${itemId}`)
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : null;
  if (!obj) return null;
  const slots = obj.slots;
  if (!Array.isArray(slots)) return null;
  const out: LayoutSlot[] = [];
  for (const s of slots) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    const type = typeof o.type === 'string' ? o.type : undefined;
    const id = typeof o.id === 'string' ? o.id : undefined;
    out.push({ type, id });
  }
  return out;
}

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

  const wallClock = Date.now();
  let serverNow =
    typeof nowArg === 'number' && Number.isFinite(nowArg) ? (nowArg as number) : wallClock;

  if (serverNow > wallClock + CLOCK_SKEW_ALLOW_MS) {
    console.warn(`${LOG_PREFIX} user=%s now futuro clamped skewMs=%s`, userId, serverNow - wallClock);
    serverNow = wallClock;
  }

  const creditCap = miningCreditCapNowMs(serverNow);

  activeProgressCalculations++;
  const client = await pool.connect();
  try {
    const coinMap = await getMiningCoinsActiveMap();
    const coinIds: string[] = [...coinMap.keys()];

    const upgradesRes = await client.query('SELECT * FROM upgrades');
    const upgradesMap = new Map<string, Record<string, unknown>>();
    upgradesRes.rows.forEach((u) => upgradesMap.set(String(u.id), u as Record<string, unknown>));

    const gsResInitial = await client.query('SELECT last_updated_at, start_time FROM game_states WHERE user_id = $1', [
      userId
    ]);
    const gsInitial = gsResInitial.rows[0] as { last_updated_at?: unknown; start_time?: unknown } | undefined;
    if (!gsInitial) return { ok: true };

    const last = parseFiniteNumberLenient(gsInitial.last_updated_at ?? gsInitial.start_time, 'game_states.last');
    if (!Number.isFinite(last) || last <= 0) return { ok: true };

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
    const rackUpdates: Array<{ id: string; charge: number; isOn?: number }> = [];
    const workshopUpdates: Array<{ uid: number; slot_index: number; charge: number; slot_charges: string }> = [];
    const batteryUpdates: Array<{ id: string; charge: number }> = [];

    const racksRes = await client.query('SELECT * FROM placed_racks WHERE user_id = $1', [userId]);
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
        const battDef = r.battery_id ? upgradesMap.get(String(r.battery_id)) : null;
        const powerCap = battDef ? parseFiniteNumberLenient(battDef.power_capacity, 'rack.batt_cap') : NaN;
        const isInfinite = battDef && powerCap === -1;

        const charge = parseFiniteNumberLenient(r.current_charge, 'rack.charge');
        const isOn = Number(r.is_on) === 1;
        if (!isInfinite && (!isOn || !r.wiring_id || !r.battery_id || charge <= 0)) continue;
        if (isInfinite && (!isOn || !r.wiring_id || !r.battery_id)) continue;

        const selectedCoinId = r.selected_coin_id ? String(r.selected_coin_id) : '';
        if (selectedCoinId) {
          const coin = coinMap.get(selectedCoinId);
          if (coin && !coin.isActive) {
            rackUpdates.push({ id: rid, charge, isOn: 0 });
            continue;
          }
        }

        let watts = 0;
        slots.forEach((sid) => {
          if (sid) {
            const up = upgradesMap.get(String(sid));
            if (up) watts += parseFiniteNumberLenient(up.power_consumption, 'rack.slot_w');
          }
        });
        multiplierSlots.forEach((sid) => {
          if (sid) {
            const up = upgradesMap.get(String(sid));
            if (up) watts += parseFiniteNumberLenient(up.power_consumption, 'rack.mult_w');
          }
        });

        let timeAvailMs = dtMs;
        if (watts > 0 && !isInfinite) {
          const tDrainSec = (charge * 3600) / watts;
          const tDrainMs = tDrainSec * 1000;
          timeAvailMs = Math.min(dtMs, tDrainMs);
        }

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

              const integratedYield = calculateIntegratedYield(
                selectedCoinId,
                last,
                last + timeAvailMs,
                yieldHistoryMap.get(selectedCoinId)
              );
              const gained = rackTotalProd * integratedYield;
              if (Number.isFinite(gained) && gained > 0) {
                totalGained.set(selectedCoinId, (totalGained.get(selectedCoinId) || 0) + gained);
              }
            }
          }
          const timeAvailSec = timeAvailMs / 1000;
          const chargeUsed = watts > 0 && !isInfinite ? (watts * timeAvailSec) / 3600 : 0;
          rackUpdates.push({ id: rid, charge: Math.max(0, charge - chargeUsed) });
        }
      }
    }

    const workshopRes = await client.query('SELECT * FROM workshop_slots WHERE user_id = $1', [userId]);
    for (const ws of workshopRes.rows as Array<Record<string, unknown>>) {
      if (!ws.item_id) continue;
      const def = upgradesMap.get(String(ws.item_id));
      if (!def || String(def.type) !== 'charger') continue;

      const layoutSlots = parseChargerLayout(def.layout, String(ws.item_id));
      if (!layoutSlots) continue;

      const batterySlots = layoutSlots.filter((s) => s.type === 'battery');
      const chargerBarSlot = layoutSlots.find((s) => s.type === 'charger_bar');
      const wiringSlot = layoutSlots.find((s) => s.type === 'wiring');

      if (batterySlots.length === 0 || !chargerBarSlot) continue;

      const internalSlots =
        safeParseJsonRecord(ws.internal_state, 200_000, 'workshop.internal_state') ??
        (ws.internal_state && typeof ws.internal_state === 'object'
          ? (ws.internal_state as Record<string, unknown>)
          : null) ??
        {};
      const slotItemIds =
        safeParseJsonRecord(ws.slot_item_ids, 200_000, 'workshop.slot_item_ids') ??
        (ws.slot_item_ids && typeof ws.slot_item_ids === 'object'
          ? (ws.slot_item_ids as Record<string, unknown>)
          : null) ??
        {};
      const slotCharges =
        safeParseJsonRecord(ws.slot_charges, 200_000, 'workshop.slot_charges') ??
        (ws.slot_charges && typeof ws.slot_charges === 'object'
          ? (ws.slot_charges as Record<string, unknown>)
          : null) ??
        {};

      const getSlotVal = (obj: Record<string, unknown>, sid: string | undefined): unknown => {
        if (!obj || !sid) return null;
        if (Object.prototype.hasOwnProperty.call(obj, sid) && obj[sid] != null) return obj[sid];
        const entry = Object.entries(obj).find(([k]) => k.toLowerCase().trim() === sid.toLowerCase().trim());
        return entry ? entry[1] : null;
      };

      if (wiringSlot?.id && !getSlotVal(internalSlots, wiringSlot.id)) continue;

      let internalWh = parseFiniteNumberLenient(ws.current_charge, 'workshop.internal_wh');
      if (internalWh <= 0) continue;

      const speedWhPerSec = parseFiniteNumberLenient(def.base_production, 'workshop.speed') || 0.5;
      let anyUpdate = false;

      for (const bSlot of batterySlots) {
        const batteryInstanceId = getSlotVal(internalSlots, bSlot.id);
        if (!batteryInstanceId) continue;

        let batteryDef = upgradesMap.get(String(getSlotVal(slotItemIds, bSlot.id)));
        if (!batteryDef) {
          const batRes = await client.query('SELECT item_id FROM stored_batteries WHERE id = $1', [batteryInstanceId]);
          const row = batRes.rows[0] as { item_id?: unknown } | undefined;
          if (row?.item_id != null) batteryDef = upgradesMap.get(String(row.item_id));
        }
        if (!batteryDef) continue;

        const maxBatteryWh = parseFiniteNumberLenient(batteryDef.power_capacity, 'bat.max_wh') || 0;
        let batteryWh = parseFiniteNumberLenient(getSlotVal(slotCharges, bSlot.id), 'bat.wh');

        if (batteryWh < maxBatteryWh && internalWh > 0) {
          const actualTransferWh = Math.min(speedWhPerSec * dtSec, internalWh, maxBatteryWh - batteryWh);

          if (actualTransferWh > 0) {
            batteryWh += actualTransferWh;
            internalWh -= actualTransferWh;
            if (bSlot.id) slotCharges[bSlot.id] = batteryWh;
            batteryUpdates.push({ id: String(batteryInstanceId), charge: batteryWh });
            anyUpdate = true;
          }
        }
      }

      if (anyUpdate) {
        workshopUpdates.push({
          uid: userId,
          slot_index: parseFiniteNumberLenient(ws.slot_index, 'ws.slot_index'),
          charge: internalWh,
          slot_charges: JSON.stringify(slotCharges)
        });
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
      const rCharges = rackUpdates.map((u) => u.charge);
      const rIsOns = rackUpdates.map((u) => (u.isOn !== undefined ? u.isOn : null));
      await client.query(
        `UPDATE placed_racks SET
          current_charge = data.charge,
          is_on = COALESCE(data.is_on, placed_racks.is_on)
        FROM (SELECT unnest($1::text[]) as id, unnest($2::numeric[]) as charge, unnest($3::int[]) as is_on) as data
        WHERE placed_racks.id = data.id`,
        [rIds, rCharges, rIsOns]
      );
    }

    for (const wu of workshopUpdates) {
      await client.query(
        'UPDATE workshop_slots SET current_charge = $1, slot_charges = $2 WHERE user_id = $3 AND slot_index = $4',
        [wu.charge, wu.slot_charges, wu.uid, wu.slot_index]
      );
    }
    if (batteryUpdates.length > 0) {
      const bIds = batteryUpdates.map((u) => u.id);
      const bCharges = batteryUpdates.map((u) => u.charge);
      await client.query(
        `UPDATE stored_batteries SET current_charge = data.charge
        FROM (SELECT unnest($1::text[]) as id, unnest($2::numeric[]) as charge) as data
        WHERE stored_batteries.id = data.id`,
        [bIds, bCharges]
      );
    }

    await client.query('UPDATE game_states SET last_updated_at = $1 WHERE user_id = $2', [lastWrite, userId]);
    await client.query('COMMIT');

    if (totalGained.size > 0) {
      console.log(
        `${LOG_PREFIX} user=%s credited coins=%s lastWrite=%s`,
        userId,
        sanitizeForLog(JSON.stringify(Object.fromEntries(totalGained)), 256),
        lastWrite
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
}
