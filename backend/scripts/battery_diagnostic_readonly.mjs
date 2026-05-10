#!/usr/bin/env node
/**
 * Diagnóstico read-only de baterias / racks (Postgres).
 * Não altera dados. Usa DATABASE_URL ou PG* (ver ensure_stored_batteries_integrity.mjs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const { Pool } = pg;

const UUID_INST =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return { connectionString, max: 2, connectionTimeoutMillis: 15000 };
  }
  return {
    user: String(process.env.PGUSER || 'postgres'),
    host: String(process.env.PGHOST || 'localhost'),
    database: String(process.env.PGDATABASE || 'minestation'),
    password: String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres'),
    port: parseInt(process.env.PGPORT || '5432', 10) || 5432,
    max: 2,
    connectionTimeoutMillis: 15000
  };
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const pool = new Pool(buildPoolConfig());
  try {
    section('UUID duplicado em mais do que um rack (mesmo battery_id)');
    const dup = await pool.query(`
      SELECT pr.battery_id::text AS battery_id, COUNT(*)::int AS rack_count, array_agg(pr.id ORDER BY pr.id) AS rack_ids
        FROM placed_racks pr
       WHERE pr.battery_id IS NOT NULL
         AND btrim(pr.battery_id::text) <> ''
         AND pr.battery_id::text ~* $1
       GROUP BY pr.battery_id
      HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC
       LIMIT 50
    `, [UUID_INST]);
    console.log(dup.rows.length ? dup.rows : '(nenhum)');

    section('Rack com battery_id UUID sem linha stored_batteries correspondente (mesmo user)');
    const orphan = await pool.query(`
      SELECT pr.id AS rack_id, pr.user_id, pr.battery_id::text AS battery_id
        FROM placed_racks pr
       WHERE pr.battery_id IS NOT NULL
         AND btrim(pr.battery_id::text) <> ''
         AND pr.battery_id::text ~* $1
         AND NOT EXISTS (
               SELECT 1 FROM stored_batteries sb
                WHERE sb.id = pr.battery_id AND sb.user_id = pr.user_id
             )
       LIMIT 100
    `, [UUID_INST]);
    console.log(orphan.rowCount ? orphan.rows : '(nenhum)');

    section('stored_batteries: carga negativa ou não finita');
    const badCharge = await pool.query(`
      SELECT id, user_id, current_charge FROM stored_batteries
       WHERE current_charge IS NULL OR current_charge < 0 OR current_charge::text = 'NaN'
       LIMIT 100
    `);
    console.log(badCharge.rowCount ? badCharge.rows : '(nenhum)');

    section('placed_racks: carga negativa (exceto -1 infinito legítimo em alguns casos)');
    const badRack = await pool.query(`
      SELECT id, user_id, battery_id, current_charge FROM placed_racks
       WHERE current_charge IS NULL OR (current_charge < 0 AND current_charge <> -1)
       LIMIT 100
    `);
    console.log(badRack.rowCount ? badRack.rows : '(nenhum)');

    section('stored_batteries: UUID montado na rig E com workshop_slot_index (estado inválido)');
    const wsRig = await pool.query(
      `
      SELECT sb.id, sb.user_id, sb.workshop_slot_index, sb.workshop_component_slot_id
        FROM stored_batteries sb
       INNER JOIN placed_racks pr
          ON pr.user_id = sb.user_id
         AND btrim(pr.battery_id::text) = btrim(sb.id::text)
         AND pr.battery_id::text ~* $1
       WHERE sb.workshop_slot_index IS NOT NULL
       LIMIT 100
    `,
      [UUID_INST]
    );
    console.log(wsRig.rowCount ? wsRig.rows : '(nenhum)');

    section('Resumo contagens');
    const c = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM placed_racks WHERE battery_id IS NOT NULL AND btrim(battery_id::text) <> '')::int AS racks_com_bateria,
        (SELECT COUNT(*) FROM stored_batteries)::int AS linhas_stored_batteries
    `);
    console.log(c.rows[0]);

    console.log('\n[Fim] Apenas leitura — nada foi alterado.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[battery_diagnostic_readonly]', e);
  process.exit(1);
});
