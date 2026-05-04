import type { Pool } from 'pg';

export type PlayerGameHeaderPayload = {
  coinBalances: Record<string, number>;
  usdc: number;
  hashByCoinId: Record<string, number>;
  totalHash: number;
  serverUpdatedAt: number;
};

function num(v: unknown, def = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : def;
}

type UpgradeRow = { base: number; mult: number; cap: number | null };

function parsePowerCapacity(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw === -1 ? -1 : num(raw);
  const s = String(raw).trim();
  if (s === '-1') return -1;
  return num(s);
}

/**
 * Saldos USDC/moedas e hashrate por moeda + total, a partir da BD (alinhado ao cálculo de produção do cliente).
 */
export async function computePlayerGameHeaderSnapshot(
  pool: Pool,
  userId: number
): Promise<PlayerGameHeaderPayload> {
  const gsRes = await pool.query(
    `SELECT COALESCE(usdc, 0)::float AS usdc,
            COALESCE(server_updated_at, 0)::bigint AS server_updated_at
     FROM game_states WHERE user_id = $1`,
    [userId]
  );
  if (!gsRes.rowCount) {
    return {
      coinBalances: {},
      usdc: 0,
      hashByCoinId: {},
      totalHash: 0,
      serverUpdatedAt: Date.now()
    };
  }
  const usdc = num(gsRes.rows[0].usdc);
  const serverUpdatedAt = Number(gsRes.rows[0].server_updated_at) || Date.now();

  const balRes = await pool.query(
    'SELECT coin_id, COALESCE(amount, 0)::float AS amount FROM coin_balances WHERE user_id = $1',
    [userId]
  );
  const coinBalances: Record<string, number> = {};
  for (const row of balRes.rows) {
    coinBalances[String(row.coin_id)] = num(row.amount);
  }

  const upRes = await pool.query(
    `SELECT id,
            COALESCE(base_production, 0)::float AS base_production,
            COALESCE(multiplier, 0)::float AS multiplier,
            power_capacity
     FROM upgrades`
  );
  const upgrades = new Map<string, UpgradeRow>();
  for (const u of upRes.rows) {
    const cap = parsePowerCapacity(u.power_capacity);
    upgrades.set(String(u.id), {
      base: num(u.base_production),
      mult: num(u.multiplier),
      cap
    });
  }

  const racksRes = await pool.query(
    `SELECT id::text AS id,
            is_on,
            wiring_id::text AS wiring_id,
            battery_id::text AS battery_id,
            COALESCE(current_charge, 0)::float AS current_charge,
            NULLIF(TRIM(selected_coin_id::text), '') AS selected_coin_id
     FROM placed_racks WHERE user_id = $1`,
    [userId]
  );
  const rackIds = racksRes.rows.map((r) => String(r.id));
  const slotsMap = new Map<string, string[]>();
  const multiMap = new Map<string, string[]>();
  if (rackIds.length > 0) {
    const slots = await pool.query(
      `SELECT rack_id::text AS rack_id, slot_index, machine_item_id::text AS machine_item_id
       FROM rack_slots WHERE rack_id = ANY($1::text[]) ORDER BY rack_id, slot_index`,
      [rackIds]
    );
    for (const s of slots.rows) {
      const rid = String(s.rack_id);
      if (!slotsMap.has(rid)) slotsMap.set(rid, []);
      const arr = slotsMap.get(rid)!;
      const idx = Math.max(0, Math.floor(num(s.slot_index, 0)));
      while (arr.length <= idx) arr.push('');
      arr[idx] = s.machine_item_id ? String(s.machine_item_id) : '';
    }
    const mults = await pool.query(
      `SELECT rack_id::text AS rack_id, slot_index, multiplier_item_id::text AS multiplier_item_id
       FROM rack_multiplier_slots WHERE rack_id = ANY($1::text[]) ORDER BY rack_id, slot_index`,
      [rackIds]
    );
    for (const m of mults.rows) {
      const rid = String(m.rack_id);
      if (!multiMap.has(rid)) multiMap.set(rid, []);
      const arr = multiMap.get(rid)!;
      const idx = Math.max(0, Math.floor(num(m.slot_index, 0)));
      while (arr.length <= idx) arr.push('');
      arr[idx] = m.multiplier_item_id ? String(m.multiplier_item_id) : '';
    }
  }

  const hashByCoinId: Record<string, number> = {};
  let totalHash = 0;

  for (const r of racksRes.rows) {
    const isOn = Number(r.is_on) === 1;
    const wiringId = r.wiring_id ? String(r.wiring_id).trim() : '';
    const batteryId = r.battery_id ? String(r.battery_id).trim() : '';
    const charge = num(r.current_charge);
    const selectedCoinId = r.selected_coin_id ? String(r.selected_coin_id).trim() : '';

    const batt = batteryId ? upgrades.get(batteryId) : undefined;
    const isInfinite = batt != null && batt.cap === -1;
    if (!isOn || !wiringId || !batteryId || (!isInfinite && charge <= 0)) continue;
    if (!selectedCoinId) continue;

    const rid = String(r.id);
    const slots = slotsMap.get(rid) || [];
    let rackBaseProd = 0;
    for (const sid of slots) {
      if (!sid) continue;
      const up = upgrades.get(sid);
      if (up) rackBaseProd += up.base;
    }
    let multFactor = 1;
    for (const sid of multiMap.get(rid) || []) {
      if (!sid) continue;
      const up = upgrades.get(sid);
      if (up && up.mult) multFactor += up.mult;
    }
    const power = rackBaseProd * multFactor;
    if (!Number.isFinite(power) || power <= 0) continue;

    hashByCoinId[selectedCoinId] = (hashByCoinId[selectedCoinId] || 0) + power;
    totalHash += power;
  }

  return { coinBalances, usdc, hashByCoinId, totalHash, serverUpdatedAt };
}
