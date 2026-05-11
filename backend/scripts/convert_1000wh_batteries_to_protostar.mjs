#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const { Pool } = pg;
const APPLY = process.argv.includes('--apply');
const FULL_RATIO = 0.995;

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : '';
}

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return {
      connectionString,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }
  return {
    user: String(process.env.PGUSER || 'postgres'),
    host: String(process.env.PGHOST || 'localhost'),
    database: String(process.env.PGDATABASE || 'minestation'),
    password: String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres'),
    port: parseInt(process.env.PGPORT || '5432', 10) || 5432,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  };
}

function safeJsonObject(raw) {
  if (raw == null || raw === '') return {};
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
  } catch {
    return {};
  }
}

function rewriteJsonValues(raw, sourceSet, targetId) {
  const obj = safeJsonObject(raw);
  let changed = false;
  for (const [k, v] of Object.entries(obj)) {
    const t = v == null ? '' : String(v).trim();
    if (sourceSet.has(t)) {
      obj[k] = targetId;
      changed = true;
    }
  }
  return changed ? JSON.stringify(obj) : null;
}

async function findTarget(client) {
  const explicit = argValue('--target=');
  if (explicit) {
    const r = await client.query(
      `
        SELECT id, name, power_capacity, image
          FROM upgrades
         WHERE id = $1
           AND (LOWER(COALESCE(type, '')) = 'battery' OR LOWER(COALESCE(category, '')) = 'battery')
         LIMIT 1
      `,
      [explicit]
    );
    return r.rows[0] || null;
  }

  const r = await client.query(`
    SELECT id, name, power_capacity, image
      FROM upgrades
     WHERE (LOWER(COALESCE(type, '')) = 'battery' OR LOWER(COALESCE(category, '')) = 'battery')
       AND (
         LOWER(id) LIKE '%proto%'
         OR LOWER(name) LIKE '%proto%'
         OR LOWER(id) LIKE '%estelar%'
         OR LOWER(name) LIKE '%estelar%'
         OR LOWER(id) LIKE '%stellar%'
         OR LOWER(name) LIKE '%stellar%'
       )
     ORDER BY
       CASE
         WHEN LOWER(id) LIKE '%proto%' THEN 0
         WHEN LOWER(name) LIKE '%proto%' THEN 1
         WHEN LOWER(id) LIKE '%estelar%' THEN 2
         WHEN LOWER(name) LIKE '%estelar%' THEN 3
         ELSE 4
       END,
       id ASC
     LIMIT 1
  `);
  return r.rows[0] || null;
}

async function main() {
  const pool = new Pool(buildPoolConfig());
  const client = await pool.connect();
  const touchedUsers = new Set();

  try {
    await client.query('BEGIN');

    const target = await findTarget(client);
    if (!target?.id) {
      throw new Error('Bateria destino Protostar/Estelar não encontrada. Use --target=<upgrade_id>.');
    }

    const targetId = String(target.id);
    const targetCap = target.power_capacity != null ? Number(target.power_capacity) : null;
    const targetImage = target.image != null && String(target.image).trim() !== '' ? String(target.image).trim() : null;
    const targetName = target.name != null ? String(target.name).trim() : targetId;

    const sourceRes = await client.query(
      `
        SELECT id, name
          FROM upgrades
         WHERE id <> $1
           AND (LOWER(COALESCE(type, '')) = 'battery' OR LOWER(COALESCE(category, '')) = 'battery')
           AND power_capacity = 1000
         ORDER BY id ASC
      `,
      [targetId]
    );
    const sourceIds = sourceRes.rows.map((r) => String(r.id)).filter(Boolean);
    if (sourceIds.length === 0) {
      await client.query('ROLLBACK');
      console.log(JSON.stringify({ ok: true, mode: APPLY ? 'apply' : 'dry-run', targetId, sourceIds, changed: 0 }, null, 2));
      return;
    }
    const sourceSet = new Set(sourceIds);

    const stockUsers = await client.query('SELECT DISTINCT user_id FROM stock WHERE item_id = ANY($1::text[])', [sourceIds]);
    for (const r of stockUsers.rows) touchedUsers.add(Number(r.user_id));

    const stockCount = await client.query(
      'SELECT COALESCE(SUM(qty), 0)::int AS qty, COUNT(*)::int AS rows FROM stock WHERE item_id = ANY($1::text[])',
      [sourceIds]
    );

    const warehouseRes = await client.query(
      `
        SELECT sb.id, sb.user_id, sb.item_id
          FROM stored_batteries sb
         WHERE sb.item_id = ANY($1::text[])
           AND sb.workshop_slot_index IS NULL
           AND COALESCE(BTRIM(sb.workshop_component_slot_id::text), '') = ''
           AND COALESCE(BTRIM(sb.rack_id::text), '') = ''
           AND COALESCE(BTRIM(sb.room_id::text), '') = ''
           AND COALESCE(NULLIF(UPPER(BTRIM(sb.status::text)), ''), 'INVENTORY') = 'INVENTORY'
           AND NOT EXISTS (
             SELECT 1
               FROM placed_racks pr
              WHERE pr.user_id = sb.user_id
                AND pr.battery_id IS NOT NULL
                AND BTRIM(pr.battery_id::text) = BTRIM(sb.id::text)
           )
      `,
      [sourceIds]
    );
    for (const r of warehouseRes.rows) touchedUsers.add(Number(r.user_id));

    const remainingStoredUsers = await client.query(
      'SELECT DISTINCT user_id FROM stored_batteries WHERE item_id = ANY($1::text[])',
      [sourceIds]
    );
    for (const r of remainingStoredUsers.rows) touchedUsers.add(Number(r.user_id));

    const rackUsers = await client.query(
      `
        SELECT DISTINCT user_id
          FROM placed_racks
         WHERE battery_catalog_item_id = ANY($1::text[]) OR battery_id = ANY($1::text[])
      `,
      [sourceIds]
    );
    for (const r of rackUsers.rows) touchedUsers.add(Number(r.user_id));

    const listingUsers = await client.query(
      'SELECT DISTINCT user_id FROM player_listings WHERE item_id = ANY($1::text[])',
      [sourceIds]
    );
    for (const r of listingUsers.rows) touchedUsers.add(Number(r.user_id));

    const workshopRows = await client.query(`
      SELECT user_id, slot_index, slot_item_ids
        FROM workshop_slots
       WHERE slot_item_ids IS NOT NULL AND BTRIM(slot_item_ids::text) <> ''
       FOR UPDATE
    `);

    let workshopUpdated = 0;
    if (APPLY) {
      await client.query(
        `
          INSERT INTO stock (user_id, item_id, qty)
          SELECT user_id, $2, SUM(qty)::int
            FROM stock
           WHERE item_id = ANY($1::text[])
           GROUP BY user_id
          ON CONFLICT (user_id, item_id)
          DO UPDATE SET qty = stock.qty + EXCLUDED.qty
        `,
        [sourceIds, targetId]
      );

      await client.query('DELETE FROM stock WHERE item_id = ANY($1::text[])', [sourceIds]);

      if (warehouseRes.rows.length > 0) {
        await client.query(
          `
            INSERT INTO stock (user_id, item_id, qty)
            SELECT user_id, $2, COUNT(*)::int
              FROM stored_batteries
             WHERE id = ANY($1::text[])
             GROUP BY user_id
            ON CONFLICT (user_id, item_id)
            DO UPDATE SET qty = stock.qty + EXCLUDED.qty
          `,
          [warehouseRes.rows.map((r) => String(r.id)), targetId]
        );

        await client.query('DELETE FROM stored_batteries WHERE id = ANY($1::text[])', [
          warehouseRes.rows.map((r) => String(r.id))
        ]);
      }

      await client.query(
        `
          UPDATE stored_batteries
             SET item_id = $2::text,
                 power_capacity_wh = $3::double precision,
                 display_name = $4::text,
                 image_url = $5::text,
                 current_charge = CASE
                   WHEN $3::double precision = -1 THEN current_charge
                   WHEN $3::double precision > 0 THEN LEAST(current_charge, $3::double precision)
                   ELSE current_charge
                 END,
                 updated_at = now(),
                 version = COALESCE(version, 0) + 1
           WHERE item_id = ANY($1::text[])
        `,
        [sourceIds, targetId, targetCap, targetName, targetImage]
      );

      await client.query(
        `
          UPDATE placed_racks
             SET battery_catalog_item_id = $2::text,
                 battery_power_capacity_wh = $3::double precision,
                 battery_display_name = $4::text,
                 battery_image_url = $5::text
           WHERE battery_catalog_item_id = ANY($1::text[])
        `,
        [sourceIds, targetId, targetCap, targetName, targetImage]
      );

      await client.query(
        `
          UPDATE placed_racks
             SET battery_id = $2::text,
                 battery_catalog_item_id = $2::text,
                 battery_power_capacity_wh = $3::double precision,
                 battery_display_name = $4::text,
                 battery_image_url = $5::text
           WHERE battery_id = ANY($1::text[])
        `,
        [sourceIds, targetId, targetCap, targetName, targetImage]
      );

      await client.query('UPDATE player_listings SET item_id = $2 WHERE item_id = ANY($1::text[])', [
        sourceIds,
        targetId
      ]);

      await client.query('UPDATE p2p_market_trade_history SET item_id = $2 WHERE item_id = ANY($1::text[])', [
        sourceIds,
        targetId
      ]);

      await client.query('UPDATE wheel_paid_pending SET won_item_id = $2 WHERE won_item_id = ANY($1::text[])', [
        sourceIds,
        targetId
      ]);

      for (const row of workshopRows.rows) {
        const next = rewriteJsonValues(row.slot_item_ids, sourceSet, targetId);
        if (!next) continue;
        await client.query('UPDATE workshop_slots SET slot_item_ids = $3 WHERE user_id = $1 AND slot_index = $2', [
          row.user_id,
          row.slot_index,
          next
        ]);
        touchedUsers.add(Number(row.user_id));
        workshopUpdated += 1;
      }

      const now = Date.now();
      const touched = [...touchedUsers].filter((n) => Number.isInteger(n) && n > 0);
      if (touched.length > 0) {
        await client.query(
          `
            UPDATE game_states
               SET server_updated_at = $1::bigint,
                   last_updated_at = GREATEST(COALESCE(last_updated_at, 0), $1::bigint)
             WHERE user_id = ANY($2::int[])
          `,
          [String(now), touched]
        );
      }

      await client.query('COMMIT');
    } else {
      for (const row of workshopRows.rows) {
        if (rewriteJsonValues(row.slot_item_ids, sourceSet, targetId)) workshopUpdated += 1;
      }
      await client.query('ROLLBACK');
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: APPLY ? 'apply' : 'dry-run',
          target: {
            id: targetId,
            name: targetName,
            powerCapacity: targetCap
          },
          sourceIds,
          stockRows: Number(stockCount.rows[0]?.rows || 0),
          stockQuantity: Number(stockCount.rows[0]?.qty || 0),
          warehouseInstancesToStock: warehouseRes.rows.length,
          workshopSlotsUpdated: workshopUpdated,
          affectedUsers: touchedUsers.size
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[convert_1000wh_batteries_to_protostar] failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
