import type { Pool } from 'pg';

/** Padrão POSIX para instância UUID em `battery_id` / `stored_batteries.id` (case-insensitive com ~*). */
const PG_INSTANCE_UUID =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/**
 * Curadoria de dados: `stored_batteries.item_id` deve ser id de catálogo (upgrades) tipo bateria;
 * a mesma instância (UUID) não pode estar equipada em mais do que um rack.
 * Idempotente — corre só no worker BACKGROUND (ver `server.ts`).
 */
export async function ensureStoredBatteriesIntegrity(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let fixedItem = 0;
  let clearedOrphan = 0;
  let clearedDupRack = 0;
  try {
    await client.query('BEGIN');

    const fbRes = await client.query(`
      SELECT id
        FROM upgrades
       WHERE COALESCE(is_active, 1) <> 0
         AND (lower(COALESCE(type, '')) = 'battery' OR lower(COALESCE(category, '')) = 'battery')
         AND id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
       ORDER BY CASE WHEN id = 'small_battery' THEN 0 ELSE 1 END,
                base_cost ASC NULLS LAST,
                id ASC
       LIMIT 1
    `);
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

    await client.query('COMMIT');
    if (fixedItem + clearedOrphan + clearedDupRack > 0) {
      console.log(
        `[Migration] stored_batteries/racks: item_id corrigido=${fixedItem}, racks UUID órfão=${clearedOrphan}, racks UUID duplicado=${clearedDupRack}`
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
    client.release();
  }
}
