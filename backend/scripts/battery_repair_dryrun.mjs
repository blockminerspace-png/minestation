#!/usr/bin/env node
/**
 * Reparo de consistência de baterias (delega a ensureStoredBatteriesIntegrity).
 *
 * Por defeito: dry-run (não escreve na BD). Use --apply após revisão.
 * BATTERY_RECONCILIATION_DRY_RUN: informativo em logs; escrita só com --apply.
 *
 * Auditoria opcional em inventory_movements:
 *   node scripts/battery_repair_dryrun.mjs --apply --audit-user-id=123
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

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  let auditUserId = null;
  for (const a of argv) {
    if (a.startsWith('--audit-user-id=')) {
      const n = parseInt(a.slice('--audit-user-id='.length), 10);
      if (Number.isFinite(n) && n > 0) auditUserId = n;
    }
  }
  return { apply, auditUserId };
}

async function main() {
  const { apply, auditUserId } = parseArgs(process.argv.slice(2));
  if (
    apply &&
    ['1', 'true', 'yes'].includes(String(process.env.BATTERY_RECONCILIATION_DRY_RUN ?? '').trim().toLowerCase())
  ) {
    console.error(
      '[battery_repair] BATTERY_RECONCILIATION_DRY_RUN=1 bloqueia --apply. Desative a variável ou use só dry-run / npm run battery:repair:dry.'
    );
    process.exit(2);
  }
  if (!apply) {
    console.log(
      '[battery_repair] DRY-RUN: nenhuma escrita na BD. Relatório de leitura (reportBatteryIntegrityReadonly).\n' +
        'Correr antes: `npm run battery:diagnostic`. Para aplicar mutações de integridade:\n' +
        '  npm run build:ts && node scripts/battery_repair_dryrun.mjs --apply [--audit-user-id=UID]\n' +
        `BATTERY_RECONCILIATION_DRY_RUN=${process.env.BATTERY_RECONCILIATION_DRY_RUN ?? '(unset)'} — diagnóstico seguro; --apply obrigatório para escrever.`
    );
    const { reportBatteryIntegrityReadonly } = await import('../dist/modules/batteries/batteries.integrity.js');
    const pool = new Pool(buildPoolConfig());
    const c = await pool.connect();
    try {
      const rep = await reportBatteryIntegrityReadonly(c);
      console.log(JSON.stringify(rep, null, 2));
    } catch (e) {
      console.error('[battery_repair] Falha no relatório read-only:', e);
      process.exit(1);
    } finally {
      c.release();
      await pool.end();
    }
    process.exit(0);
  }

  const { ensureStoredBatteriesIntegrity, buildBatteryIntegrityRepairPlan } = await import(
    '../dist/modules/batteries/batteries.integrity.js'
  );
  const pool = new Pool(buildPoolConfig());
  try {
    const pc = await pool.connect();
    let plan;
    try {
      plan = await buildBatteryIntegrityRepairPlan(pc);
    } finally {
      pc.release();
    }
    console.log('[battery_repair] PLANO DE AÇÕES (--apply) — revisão antes de mutações:');
    for (const a of plan.actions) {
      console.log(`  • [${a.id}] ${a.description}`);
      console.log(`      ~${a.estimatedRows} linha(s) afetadas (estimativa SELECT-only)`);
    }
    console.log('[battery_repair] Resumo diagnóstico:', JSON.stringify(plan.summary));
    console.warn(
      JSON.stringify({
        event: 'battery_repair_apply_start',
        at: new Date().toISOString(),
        actions: plan.actions.map((x) => ({ id: x.id, estimatedRows: x.estimatedRows }))
      })
    );
    await ensureStoredBatteriesIntegrity(pool);
    const pc2 = await pool.connect();
    let repAfter;
    try {
      const { reportBatteryIntegrityReadonly } = await import('../dist/modules/batteries/batteries.integrity.js');
      repAfter = await reportBatteryIntegrityReadonly(pc2);
    } finally {
      pc2.release();
    }
    console.warn(
      JSON.stringify({
        event: 'battery_repair_apply_audit',
        at: new Date().toISOString(),
        summaryBefore: plan.summary,
        summaryAfter: repAfter
      })
    );
    if (auditUserId != null) {
      const meta = JSON.stringify({
        reason: 'battery_semantic_migration_repair',
        script: 'battery_repair_dryrun.mjs',
        at: new Date().toISOString()
      }).slice(0, 4000);
      await pool.query(
        `INSERT INTO inventory_movements (user_id, action, catalog_item_id, instance_id, quantity_before, quantity_after, meta, created_at)
         VALUES ($1, $2, NULL, NULL, NULL, NULL, $3, $4::bigint)`,
        [auditUserId, 'battery_semantic_migration_repair', meta, String(Date.now())]
      );
      console.log('[battery_repair] inventory_movements gravado para user_id=%s', auditUserId);
    } else {
      console.log('[battery_repair] Sem --audit-user-id: não foi gravado inventory_movements (opcional).');
    }
    console.log('[battery_repair] Concluído.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[battery_repair]', e);
  process.exit(1);
});
