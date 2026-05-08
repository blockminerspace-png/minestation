#!/usr/bin/env node
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const STOCK_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sem-id';
}

function makeTempId(userId, seq, original) {
  return `temp_legacy_${userId}_${seq}_${slugify(original)}`.slice(0, 200);
}

async function main() {
  const pool = new Pool(buildPoolConfig());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const brokenRes = await client.query(`
      WITH broken AS (
        SELECT s.ctid
        FROM stock s
        LEFT JOIN upgrades g ON g.id = s.item_id
        WHERE s.item_id IS NULL
           OR s.item_id = ''
           OR s.item_id !~ '^[a-zA-Z0-9_.-]{1,200}$'
           OR g.id IS NULL
      )
      SELECT
        s.ctid::text AS row_ctid,
        s.user_id,
        COALESCE(u.email, '') AS email,
        s.item_id,
        s.qty
      FROM stock s
      JOIN broken b ON b.ctid = s.ctid
      LEFT JOIN users u ON u.id = s.user_id
      ORDER BY s.user_id, s.item_id NULLS FIRST
      FOR UPDATE OF s
    `);

    let seq = 0;
    let fixed = 0;
    const byUser = new Map();

    for (const row of brokenRes.rows) {
      seq += 1;
      const original = String(row.item_id ?? '').trim() || 'sem-id';
      if (STOCK_ID_RE.test(original)) continue;

      const tempId = makeTempId(row.user_id, seq, original);
      const name = `Item temporario recuperado #${row.user_id}-${seq}`;
      const description = `Placeholder criado automaticamente para preservar inventario legado. original=${original} email=${String(row.email || '').slice(0, 120)}`.slice(0, 500);

      await client.query(
        `
          INSERT INTO upgrades (
            id, name, category, type, base_cost, base_production, power_consumption, power_capacity,
            multiplier, slots_capacity, ai_slots_capacity, description, icon, status, is_nft, nft_contract,
            nft_token_id, max_global_stock, image, reward_wh, layout, sell_in_hardware_market,
            sell_in_black_market, is_active, total_sold
          ) VALUES (
            $1, $2, 'legacy-temp', 'legacy-temp', 0, 0, 0, 0,
            0, 0, 0, $3, '', 'temporary', 0, NULL,
            NULL, 0, '', 0, NULL, 0,
            0, 1, 0
          )
          ON CONFLICT (id) DO NOTHING
        `,
        [tempId, name, description]
      );

      await client.query('UPDATE stock SET item_id = $1 WHERE ctid::text = $2', [tempId, row.row_ctid]);
      fixed += 1;
      byUser.set(row.user_id, (byUser.get(row.user_id) || 0) + 1);
    }

    await client.query('COMMIT');

    const remainingRes = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM stock s
      LEFT JOIN upgrades g ON g.id = s.item_id
      WHERE s.item_id IS NULL
         OR s.item_id = ''
         OR s.item_id !~ '^[a-zA-Z0-9_.-]{1,200}$'
         OR g.id IS NULL
    `);

    const summary = [...byUser.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([userId, count]) => ({ userId, count }));

    console.log(JSON.stringify({
      ok: true,
      fixed,
      affectedUsers: byUser.size,
      remaining: Number(remainingRes.rows[0]?.count || 0),
      topUsers: summary
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[sanitize_legacy_stock_items] failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
