/**
 * Importa o dump JSON de produção no Postgres local (estrutura + dados).
 *
 * Uso:
 *   1) Subir o DB: docker compose -f docker-compose.local.yml up -d
 *   Dump SQL (pg_dump): npm run import:dump (usa ../backup02.sql)
 *   Dump JSON antigo: npm run import:json
 *   Ou: node import_production.js /caminho/arquivo.json
 *
 * Credenciais: DATABASE_URL ou postgres/postgrespassword (docker-compose.local.yml).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';
import { initDb } from './db.pg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultDumpPath = path.join(
  __dirname,
  '..',
  'atual2_2026-04-29T21-02-32-867Z.sql'
);

const dataFile = process.argv[2] || process.env.DUMP_JSON_PATH || defaultDumpPath;

if (!fs.existsSync(dataFile)) {
  console.error(`Arquivo não encontrado: ${dataFile}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

/** Ordem respeitando FKs (tabelas que referenciam outras vêm depois). */
const tableOrder = [
  'users',
  'referrals',
  'mining_coins',
  'access_levels',
  'upgrades',
  'upgrade_compat_racks',
  'loot_boxes',
  'loot_box_items',
  'system_news',
  'season_passes',
  'season_purchases',
  'game_states',
  'settings',
  'stock',
  'unopened_boxes',
  'stored_batteries',
  'placed_racks',
  'rack_slots',
  'rack_multiplier_slots',
  'player_listings',
  'nft_items',
  'sessions',
  'coin_balances',
  'coin_withdrawals',
  'admin_upgrades',
  'admin_upgrade_items',
  'admin_upgrade_boxes',
  'admin_upgrade_passes',
  'admin_upgrade_coins',
  'admin_upgrade_purchases',
  'player_news_submissions',
  'rig_rooms',
  'user_rig_rooms',
  'workshop_slots',
  'player_claimed_boxes',
  'daily_actions',
  'promo_codes',
  'promo_code_redemptions',
  'economy_settings',
  'withdrawal_requests',
  'device_fingerprint_logs',
];

async function ensureColumns(client, table, sampleRow) {
  const columns = Object.keys(sampleRow);
  for (const col of columns) {
    try {
      await client.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
      if (col.endsWith('_at') || col.endsWith('_time')) {
        await client.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${col}" TYPE BIGINT USING "${col}"::BIGINT`
        );
      }
    } catch {
      // coluna já existe com tipo fixo, etc.
    }
  }
}

async function importTable(table, rows) {
  if (!rows || rows.length === 0) {
    console.log(`- ${table}: vazio, pulando`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureColumns(client, table, rows[0]);

    await client.query('SET session_replication_role = replica;');
    await client.query(`TRUNCATE TABLE "${table}" CASCADE`);

    const columns = Object.keys(rows[0]);
    const batchSize = 200;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];

      batch.forEach((row, bIdx) => {
        const rowPlaceholders = [];
        columns.forEach((col, cIdx) => {
          const pIdx = bIdx * columns.length + cIdx + 1;
          rowPlaceholders.push(`$${pIdx}`);
          let val = row[col];
          if (val !== null && typeof val === 'object') val = JSON.stringify(val);
          values.push(val);
        });
        placeholders.push(`(${rowPlaceholders.join(',')})`);
      });

      const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES ${placeholders.join(',')}`;
      await client.query(sql, values);
    }

    await client.query('SET session_replication_role = DEFAULT;');
    await client.query('COMMIT');
    console.log(`OK ${table}: ${rows.length} linhas`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`ERRO ${table}: ${e.message}`);
    throw e;
  } finally {
    client.release();
  }
}

async function syncSequences() {
  const client = await pool.connect();
  try {
    const tablesWithSerialId = [
      'users',
      'referrals',
      'loot_box_items',
      'game_states',
      'mining_yield_history',
      'season_pass_rewards',
      'admin_access_logs',
      'referral_models',
    ];
    for (const t of tablesWithSerialId) {
      try {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1))`
        );
      } catch {
        // tabela ausente ou sem serial
      }
    }
  } finally {
    client.release();
  }
}

async function run() {
  console.log('Inicializando schema (initDb)...');
  await initDb();

  console.log(`Importando de: ${dataFile}`);
  try {
    for (const table of tableOrder) {
      await importTable(table, data[table]);
    }

    console.log('\nSincronizando sequences...');
    await syncSequences();

    console.log('Importação concluída.');
  } catch (e) {
    console.error('Importação abortada:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
