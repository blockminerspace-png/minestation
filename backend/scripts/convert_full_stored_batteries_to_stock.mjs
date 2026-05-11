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

async function main() {
  const pool = new Pool(buildPoolConfig());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TEMP TABLE tmp_full_batteries_to_stock ON COMMIT DROP AS
      SELECT sb.id, sb.user_id, sb.item_id
        FROM stored_batteries sb
        JOIN upgrades u ON u.id = sb.item_id
       WHERE (LOWER(COALESCE(u.type, '')) = 'battery' OR LOWER(COALESCE(u.category, '')) = 'battery')
         AND (
           u.power_capacity = -1
           OR (
             u.power_capacity > 0
             AND sb.current_charge >= u.power_capacity * ${FULL_RATIO}
           )
         )
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
    `);

    const countRes = await client.query(`
      SELECT COUNT(*)::int AS batteries, COUNT(DISTINCT user_id)::int AS users
        FROM tmp_full_batteries_to_stock
    `);

    const byItemRes = await client.query(`
      SELECT item_id, COUNT(*)::int AS count
        FROM tmp_full_batteries_to_stock
       GROUP BY item_id
       ORDER BY count DESC, item_id ASC
       LIMIT 50
    `);

    if (APPLY) {
      await client.query(`
        INSERT INTO stock (user_id, item_id, qty)
        SELECT user_id, item_id, COUNT(*)::int
          FROM tmp_full_batteries_to_stock
         GROUP BY user_id, item_id
        ON CONFLICT (user_id, item_id)
        DO UPDATE SET qty = stock.qty + EXCLUDED.qty
      `);

      await client.query(`
        DELETE FROM stored_batteries sb
        USING tmp_full_batteries_to_stock t
        WHERE sb.id = t.id AND sb.user_id = t.user_id
      `);

      const now = Date.now();
      await client.query(
        `
          UPDATE game_states
             SET server_updated_at = $1::bigint,
                 last_updated_at = GREATEST(COALESCE(last_updated_at, 0), $1::bigint)
           WHERE user_id IN (SELECT DISTINCT user_id FROM tmp_full_batteries_to_stock)
        `,
        [String(now)]
      );

      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: APPLY ? 'apply' : 'dry-run',
          fullRatio: FULL_RATIO,
          batteriesConverted: Number(countRes.rows[0]?.batteries || 0),
          affectedUsers: Number(countRes.rows[0]?.users || 0),
          byItem: byItemRes.rows
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[convert_full_stored_batteries_to_stock] failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
