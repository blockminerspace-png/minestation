import type { Pool, PoolClient } from 'pg';
import { CANONICAL_1000WH_BATTERY_ID } from './batteries.catalog.js';

/** Padrão POSIX para instância UUID em `battery_id` / `stored_batteries.id` (case-insensitive com ~*). */
const PG_INSTANCE_UUID =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

const ADV_LOCK_K1 = 90210;
const ADV_LOCK_K2 = 41;

export type BatteryIntegrityReadonlyReport = {
  event: 'battery_integrity_readonly_report';
  badCatalogRows: number;
  orphanRackUuid: number;
  duplicateRackUuid: number;
  invalidRackBatteryId: number;
};

/**
 * SELECT-only: contagens de problemas que `ensureStoredBatteriesIntegrity` corrigia com mutações.
 */
export async function reportBatteryIntegrityReadonly(client: PoolClient): Promise<BatteryIntegrityReadonlyReport> {
  const badRes = await client.query<{ c: string }>(
    `
      SELECT COUNT(*)::text AS c
        FROM stored_batteries sb
        LEFT JOIN upgrades u ON u.id = btrim(COALESCE(sb.item_id, ''))
       WHERE btrim(COALESCE(sb.item_id, '')) = ''
          OR u.id IS NULL
          OR (
               lower(COALESCE(u.type, '')) <> 'battery'
           AND lower(COALESCE(u.category, '')) <> 'battery'
             )
    `
  );
  const orphanRes = await client.query<{ c: string }>(
    `
      SELECT COUNT(*)::text AS c
        FROM placed_racks pr
       WHERE pr.battery_id IS NOT NULL
         AND btrim(pr.battery_id::text) <> ''
         AND pr.battery_id::text ~* $1
         AND NOT EXISTS (
               SELECT 1 FROM stored_batteries sb
                WHERE sb.id = pr.battery_id AND sb.user_id = pr.user_id
             )
         AND NOT EXISTS (
               SELECT 1 FROM upgrades u
                WHERE u.id = btrim(COALESCE(pr.battery_catalog_item_id, ''))
                  AND (
                       lower(COALESCE(u.type, '')) = 'battery'
                    OR lower(COALESCE(u.category, '')) = 'battery'
                      )
             )
    `,
    [PG_INSTANCE_UUID]
  );
  const dupRes = await client.query<{ c: string }>(
    `
      SELECT COUNT(*)::text AS c
        FROM (
          SELECT pr.user_id, pr.battery_id
            FROM placed_racks pr
           INNER JOIN stored_batteries sb ON sb.id = pr.battery_id AND sb.user_id = pr.user_id
           WHERE pr.battery_id IS NOT NULL
             AND btrim(pr.battery_id::text) <> ''
             AND pr.battery_id::text ~* $1
           GROUP BY pr.user_id, pr.battery_id
          HAVING COUNT(*) > 1
        ) x
    `,
    [PG_INSTANCE_UUID]
  );
  const badCat = await client.query<{ c: string }>(
    `
      SELECT COUNT(*)::text AS c
        FROM placed_racks pr
       WHERE pr.battery_id IS NOT NULL
         AND btrim(pr.battery_id::text) <> ''
         AND NOT (pr.battery_id::text ~* $1)
         AND NOT EXISTS (
               SELECT 1 FROM upgrades u
                WHERE u.id = btrim(pr.battery_id::text)
                  AND (
                       lower(COALESCE(u.type, '')) = 'battery'
                    OR lower(COALESCE(u.category, '')) = 'battery'
                      )
             )
    `,
    [PG_INSTANCE_UUID]
  );
  return {
    event: 'battery_integrity_readonly_report',
    badCatalogRows: parseInt(badRes.rows[0]?.c || '0', 10) || 0,
    orphanRackUuid: parseInt(orphanRes.rows[0]?.c || '0', 10) || 0,
    duplicateRackUuid: parseInt(dupRes.rows[0]?.c || '0', 10) || 0,
    invalidRackBatteryId: parseInt(badCat.rows[0]?.c || '0', 10) || 0
  };
}

export type BatteryIntegrityRepairPlanAction = {
  id: string;
  description: string;
  estimatedRows: number;
};

/**
 * Plano explícito (somente leitura) alinhado às mutações de `ensureStoredBatteriesIntegrity`.
 * Usado pelo script `battery_repair_dryrun.mjs` antes de `--apply`.
 */
export async function buildBatteryIntegrityRepairPlan(client: PoolClient): Promise<{
  summary: BatteryIntegrityReadonlyReport;
  actions: BatteryIntegrityRepairPlanAction[];
}> {
  const summary = await reportBatteryIntegrityReadonly(client);

  const infInstRes = await client.query<{ c: string }>(
    `
      SELECT COUNT(*)::text AS c
        FROM placed_racks pr
        JOIN stored_batteries sb ON pr.user_id = sb.user_id
         AND btrim(pr.battery_id::text) <> ''
         AND btrim(pr.battery_id::text) = btrim(sb.id::text)
        JOIN upgrades u ON u.id = btrim(sb.item_id::text)
       WHERE pr.battery_id IS NOT NULL
         AND COALESCE(u.power_capacity, 0) = -1
         AND pr.current_charge IS DISTINCT FROM -1
    `
  );
  const infCatRes = await client.query<{ c: string }>(
    `
      SELECT COUNT(*)::text AS c
        FROM placed_racks pr
        JOIN upgrades u ON btrim(pr.battery_id::text) = u.id
       WHERE pr.battery_id IS NOT NULL
         AND btrim(pr.battery_id::text) <> ''
         AND NOT (pr.battery_id::text ~* $1)
         AND COALESCE(u.power_capacity, 0) = -1
         AND (
               lower(COALESCE(u.type, '')) = 'battery'
            OR lower(COALESCE(u.category, '')) = 'battery'
             )
         AND pr.current_charge IS DISTINCT FROM -1
    `,
    [PG_INSTANCE_UUID]
  );

  const infInst = parseInt(infInstRes.rows[0]?.c || '0', 10) || 0;
  const infCat = parseInt(infCatRes.rows[0]?.c || '0', 10) || 0;

  const actions: BatteryIntegrityRepairPlanAction[] = [
    {
      id: 'fix_stored_battery_catalog',
      description:
        'Atualizar `stored_batteries.item_id` quando vazio, catálogo inválido ou não é tipo bateria (inferência + fallback de catálogo).',
      estimatedRows: summary.badCatalogRows
    },
    {
      id: 'clear_orphan_rack_battery_uuid',
      description:
        'Em `placed_racks`, anular `battery_id` UUID sem linha em `stored_batteries` apenas quando não há snapshot válido em `battery_catalog_item_id`.',
      estimatedRows: summary.orphanRackUuid
    },
    {
      id: 'clear_duplicate_rack_battery_uuid',
      description:
        'Em `placed_racks`, manter só uma rig por par (user_id, battery_id UUID); duplicados extra perdem `battery_id`.',
      estimatedRows: summary.duplicateRackUuid
    },
    {
      id: 'clear_invalid_rack_battery_catalog_ref',
      description:
        'Em `placed_racks`, anular `battery_id` que não é UUID de instância nem id de catálogo de bateria válido.',
      estimatedRows: summary.invalidRackBatteryId
    },
    {
      id: 'sync_infinite_charge_from_instance',
      description:
        'Definir `placed_racks.current_charge = -1` quando a bateria (instância) tem `power_capacity` infinito no catálogo.',
      estimatedRows: infInst
    },
    {
      id: 'sync_infinite_charge_from_catalog_id',
      description:
        'Definir `placed_racks.current_charge = -1` quando `battery_id` é id de catálogo com capacidade infinita.',
      estimatedRows: infCat
    }
  ];

  return { summary, actions };
}

/**
 * Curadoria de dados: `stored_batteries.item_id` deve ser id de catálogo (upgrades) tipo bateria;
 * a mesma instância (UUID) não pode estar equipada em mais do que um rack.
 * Idempotente — corre só no worker BACKGROUND (ver `server.ts`).
 *
 * Com `BATTERY_INTEGRITY_MUTATIONS_ENABLED=0`: apenas relatório estruturado (sem UPDATE/DELETE).
 */
export async function ensureStoredBatteriesIntegrity(pool: Pool): Promise<void> {
  if (String(process.env.BATTERY_WORKERS_ENABLED ?? '1').trim() === '0') {
    console.log('[Migration] ensureStoredBatteriesIntegrity ignorado (BATTERY_WORKERS_ENABLED=0)');
    return;
  }
  if (String(process.env.BATTERY_BACKGROUND_INTEGRITY_ENABLED ?? '1').trim() === '0') {
    console.log('[Migration] ensureStoredBatteriesIntegrity ignorado (BATTERY_BACKGROUND_INTEGRITY_ENABLED=0)');
    return;
  }

  const mutationsEnabled = !['0', 'false', 'no'].includes(String(process.env.BATTERY_INTEGRITY_MUTATIONS_ENABLED ?? '1').trim().toLowerCase());

  const client = await pool.connect();
  try {
    if (!mutationsEnabled) {
      const rep = await reportBatteryIntegrityReadonly(client);
      console.warn(JSON.stringify(rep));
      return;
    }

    const lk = await client.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS pg_try_advisory_lock',
      [ADV_LOCK_K1, ADV_LOCK_K2]
    );
    if (!lk.rows[0]?.pg_try_advisory_lock) {
      console.warn(
        JSON.stringify({
          event: 'battery_integrity_lock_busy',
          message: 'Outra execução detém o lock — skip.'
        })
      );
      return;
    }

    let fixedItem = 0;
    let clearedOrphan = 0;
    let clearedDupRack = 0;
    let clearedBadCatalogBatt = 0;
    let fixedInfiniteChargeInst = 0;
    let fixedInfiniteChargeCat = 0;
    try {
      await client.query('BEGIN');

      const fbRes = await client.query(
        `
      SELECT id
        FROM upgrades
       WHERE COALESCE(is_active, 1) <> 0
         AND (lower(COALESCE(type, '')) = 'battery' OR lower(COALESCE(category, '')) = 'battery')
         AND id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
       ORDER BY CASE WHEN id = $1::text THEN 0 ELSE 1 END,
                base_cost ASC NULLS LAST,
                id ASC
       LIMIT 1
    `,
        [CANONICAL_1000WH_BATTERY_ID]
      );
      const fallbackCatalog = fbRes.rows[0]?.id != null ? String(fbRes.rows[0].id).trim() : '';
      if (!fallbackCatalog) {
        await client.query('ROLLBACK');
        console.warn('[Migration] ensureStoredBatteriesIntegrity: sem upgrade de bateria na BD — ignorado.');
        return;
      }

      const badRes = await client.query<{ id: string; user_id: number }>(
        `
        SELECT sb.id, sb.user_id
          FROM stored_batteries sb
          LEFT JOIN upgrades u ON u.id = btrim(COALESCE(sb.item_id, ''))
         WHERE btrim(COALESCE(sb.item_id, '')) = ''
            OR u.id IS NULL
            OR (
                 lower(COALESCE(u.type, '')) <> 'battery'
             AND lower(COALESCE(u.category, '')) <> 'battery'
               )
      `
      );

      for (const row of badRes.rows) {
        const uid = Number(row.user_id);
        const sid = String(row.id || '').trim();
        if (!sid || !Number.isFinite(uid) || uid <= 0) continue;

        const dom = await client.query<{ item_id: string }>(
          `
          SELECT btrim(sb2.item_id::text) AS item_id
            FROM stored_batteries sb2
            JOIN upgrades u ON u.id = btrim(COALESCE(sb2.item_id, ''))
           WHERE sb2.user_id = $1
             AND sb2.id <> $2
             AND (lower(COALESCE(u.type, '')) = 'battery' OR lower(COALESCE(u.category, '')) = 'battery')
             AND u.id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
           GROUP BY btrim(sb2.item_id::text)
           ORDER BY COUNT(*) DESC, length(btrim(sb2.item_id::text)) ASC
           LIMIT 1
        `,
          [uid, sid]
        );
        const pick = dom.rows[0]?.item_id != null ? String(dom.rows[0].item_id).trim() : '';
        const newItemId = pick || fallbackCatalog;
        await client.query(`UPDATE stored_batteries SET item_id = $1 WHERE id = $2`, [newItemId, sid]);
        fixedItem += 1;
      }

      const orphanRacks = await client.query(`
        UPDATE placed_racks pr
           SET battery_id = NULL,
               current_charge = 0,
               is_on = 0
         WHERE pr.battery_id IS NOT NULL
           AND btrim(pr.battery_id::text) <> ''
           AND pr.battery_id::text ~* '${PG_INSTANCE_UUID}'
           AND NOT EXISTS (
                 SELECT 1 FROM stored_batteries sb
                  WHERE sb.id = pr.battery_id AND sb.user_id = pr.user_id
               )
           AND NOT EXISTS (
                 SELECT 1 FROM upgrades u
                  WHERE u.id = btrim(COALESCE(pr.battery_catalog_item_id, ''))
                    AND (
                         lower(COALESCE(u.type, '')) = 'battery'
                      OR lower(COALESCE(u.category, '')) = 'battery'
                        )
               )
         RETURNING pr.id
    `);
      clearedOrphan = orphanRacks.rowCount ?? 0;

      const dupRacks = await client.query(`
        WITH ranked AS (
          SELECT pr.id,
                 ROW_NUMBER() OVER (
                   PARTITION BY pr.user_id, pr.battery_id
                   ORDER BY COALESCE(pr.slot_index, 0) ASC, pr.id ASC
                 ) AS rn
            FROM placed_racks pr
           INNER JOIN stored_batteries sb ON sb.id = pr.battery_id AND sb.user_id = pr.user_id
           WHERE pr.battery_id IS NOT NULL
             AND btrim(pr.battery_id::text) <> ''
             AND pr.battery_id::text ~* '${PG_INSTANCE_UUID}'
        )
        UPDATE placed_racks pr
           SET battery_id = NULL,
               current_charge = 0,
               is_on = 0
          FROM ranked r
         WHERE pr.id = r.id
           AND r.rn > 1
         RETURNING pr.id
    `);
      clearedDupRack = dupRacks.rowCount ?? 0;

      const badCat = await client.query(`
        UPDATE placed_racks pr
           SET battery_id = NULL,
               current_charge = 0,
               is_on = 0
         WHERE pr.battery_id IS NOT NULL
           AND btrim(pr.battery_id::text) <> ''
           AND NOT (pr.battery_id::text ~* '${PG_INSTANCE_UUID}')
           AND NOT EXISTS (
                 SELECT 1 FROM upgrades u
                  WHERE u.id = btrim(pr.battery_id::text)
                    AND (
                         lower(COALESCE(u.type, '')) = 'battery'
                      OR lower(COALESCE(u.category, '')) = 'battery'
                        )
               )
         RETURNING pr.id
    `);
      clearedBadCatalogBatt = badCat.rowCount ?? 0;

      const infInst = await client.query(`
        UPDATE placed_racks pr
           SET current_charge = -1
          FROM stored_batteries sb
          JOIN upgrades u ON u.id = btrim(sb.item_id::text)
         WHERE pr.user_id = sb.user_id
           AND pr.battery_id IS NOT NULL
           AND btrim(pr.battery_id::text) <> ''
           AND btrim(pr.battery_id::text) = btrim(sb.id::text)
           AND COALESCE(u.power_capacity, 0) = -1
           AND pr.current_charge IS DISTINCT FROM -1
         RETURNING pr.id
    `);
      fixedInfiniteChargeInst = infInst.rowCount ?? 0;

      const infCat = await client.query(`
        UPDATE placed_racks pr
           SET current_charge = -1
          FROM upgrades u
         WHERE pr.battery_id IS NOT NULL
           AND btrim(pr.battery_id::text) <> ''
           AND btrim(pr.battery_id::text) = u.id
           AND NOT (pr.battery_id::text ~* '${PG_INSTANCE_UUID}')
           AND COALESCE(u.power_capacity, 0) = -1
           AND (
                 lower(COALESCE(u.type, '')) = 'battery'
             OR lower(COALESCE(u.category, '')) = 'battery'
               )
           AND pr.current_charge IS DISTINCT FROM -1
         RETURNING pr.id
    `);
      fixedInfiniteChargeCat = infCat.rowCount ?? 0;

      await client.query('COMMIT');
      const touched =
        fixedItem +
        clearedOrphan +
        clearedDupRack +
        clearedBadCatalogBatt +
        fixedInfiniteChargeInst +
        fixedInfiniteChargeCat;
      if (touched > 0) {
        console.log(
          JSON.stringify({
            event: 'battery_integrity_mutations_applied',
            item_id: fixedItem,
            rack_uuid_orfao: clearedOrphan,
            rack_uuid_dup: clearedDupRack,
            rack_batt_id_invalido: clearedBadCatalogBatt,
            rack_inf_carga_inst: fixedInfiniteChargeInst,
            rack_inf_carga_cat: fixedInfiniteChargeCat
          })
        );
      }
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.warn(
        '[Migration] ensureStoredBatteriesIntegrity:',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [ADV_LOCK_K1, ADV_LOCK_K2]);
    }
  } finally {
    client.release();
  }
}
