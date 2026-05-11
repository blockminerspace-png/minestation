#!/usr/bin/env node
/**
 * Limpeza global de itens bugados/órfãos/duplicados dos jogadores.
 *
 * Por defeito roda em dry-run (ROLLBACK). Use --apply para gravar.
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
const APPLY = process.argv.includes('--apply');
const UUID_INST = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SQL = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return { connectionString, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 };
  }
  return {
    user: String(process.env.PGUSER || 'postgres'),
    host: String(process.env.PGHOST || 'localhost'),
    database: String(process.env.PGDATABASE || 'minestation'),
    password: String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres'),
    port: parseInt(process.env.PGPORT || '5432', 10) || 5432,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  };
}

function asInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function safeJsonObject(raw) {
  if (raw == null || raw === '') return {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function stringifyJsonObject(value) {
  return JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
}

function addUsers(set, rows) {
  for (const row of rows) {
    const uid = asInt(row.user_id);
    if (uid && uid > 0) set.add(uid);
  }
}

async function runReturning(client, summary, touchedUsers, key, sql, params = []) {
  const res = await client.query(sql, params);
  summary[key] = res.rowCount || 0;
  addUsers(touchedUsers, res.rows || []);
  return res.rows || [];
}

async function main() {
  const pool = new Pool(buildPoolConfig());
  const client = await pool.connect();
  const summary = {};
  const touchedUsers = new Set();

  const validOwnedCatalogSql = `
    SELECT id
      FROM upgrades
     WHERE id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
       AND COALESCE(category, '') <> 'legacy-temp'
       AND COALESCE(type, '') <> 'legacy-temp'
  `;

  const invalidCatalogPredicate = (field) => `
    NOT EXISTS (
      SELECT 1
        FROM upgrades u
       WHERE u.id = ${field}
         AND u.id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
         AND COALESCE(u.category, '') <> 'legacy-temp'
         AND COALESCE(u.type, '') <> 'legacy-temp'
    )
  `;

  try {
    await client.query('BEGIN');

    const validOwnedCatalogRes = await client.query(validOwnedCatalogSql);
    const validOwnedCatalogIds = new Set(validOwnedCatalogRes.rows.map((r) => String(r.id)));

    await runReturning(
      client,
      summary,
      touchedUsers,
      'orphanRackSlotsDeleted',
      `
      DELETE FROM rack_slots rs
       WHERE NOT EXISTS (SELECT 1 FROM placed_racks pr WHERE pr.id = rs.rack_id)
       RETURNING NULL::int AS user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'orphanRackMultiplierSlotsDeleted',
      `
      DELETE FROM rack_multiplier_slots rms
       WHERE NOT EXISTS (SELECT 1 FROM placed_racks pr WHERE pr.id = rms.rack_id)
       RETURNING NULL::int AS user_id
      `
    );

    const invalidStoredRows = await client.query(`
      SELECT id::text, user_id
        FROM stored_batteries sb
       WHERE ${invalidCatalogPredicate('sb.item_id')}
          OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = sb.user_id)
    `);
    const invalidBatteryIds = invalidStoredRows.rows.map((r) => String(r.id));
    addUsers(touchedUsers, invalidStoredRows.rows);
    summary.invalidStoredBatteriesFound = invalidStoredRows.rowCount || 0;

    await runReturning(
      client,
      summary,
      touchedUsers,
      'rackInvalidBatteryRefsCleared',
      `
      UPDATE placed_racks pr
         SET battery_id = NULL,
             current_charge = 0,
             battery_catalog_item_id = NULL,
             battery_power_capacity_wh = NULL,
             battery_display_name = NULL,
             battery_image_url = NULL
       WHERE pr.battery_id IS NOT NULL
         AND btrim(pr.battery_id::text) <> ''
         AND (
           pr.battery_id = ANY($1::text[])
           OR (
             pr.battery_id::text ~* $2
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
           )
           OR (
             pr.battery_id::text !~* $2
             AND ${invalidCatalogPredicate('pr.battery_id')}
           )
         )
       RETURNING pr.user_id
      `,
      [invalidBatteryIds, UUID_SQL]
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'invalidStoredBatteriesDeleted',
      `
      DELETE FROM stored_batteries sb
       WHERE sb.id = ANY($1::text[])
       RETURNING sb.user_id
      `,
      [invalidBatteryIds]
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'invalidRacksDeleted',
      `
      WITH bad AS (
        SELECT pr.id, pr.user_id
          FROM placed_racks pr
         WHERE ${invalidCatalogPredicate('pr.item_id')}
            OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = pr.user_id)
      ),
      del_slots AS (
        DELETE FROM rack_slots rs USING bad WHERE rs.rack_id = bad.id
      ),
      del_mults AS (
        DELETE FROM rack_multiplier_slots rms USING bad WHERE rms.rack_id = bad.id
      )
      DELETE FROM placed_racks pr USING bad
       WHERE pr.id = bad.id
       RETURNING bad.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'invalidStockDeleted',
      `
      DELETE FROM stock s
       WHERE s.qty IS NULL
          OR s.qty <= 0
          OR ${invalidCatalogPredicate('s.item_id')}
          OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)
       RETURNING s.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'invalidListingsDeleted',
      `
      DELETE FROM player_listings pl
       WHERE COALESCE(pl.qty, 1) <= 0
          OR pl.price IS NULL
          OR pl.price < 0
          OR ${invalidCatalogPredicate('pl.item_id')}
          OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = pl.user_id)
       RETURNING pl.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'invalidRackMachineSlotsCleared',
      `
      UPDATE rack_slots rs
         SET machine_item_id = NULL
        FROM placed_racks pr
       WHERE pr.id = rs.rack_id
         AND rs.machine_item_id IS NOT NULL
         AND btrim(rs.machine_item_id::text) <> ''
         AND ${invalidCatalogPredicate('rs.machine_item_id')}
       RETURNING pr.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'invalidRackMultiplierSlotsCleared',
      `
      UPDATE rack_multiplier_slots rms
         SET multiplier_item_id = NULL
        FROM placed_racks pr
       WHERE pr.id = rms.rack_id
         AND rms.multiplier_item_id IS NOT NULL
         AND btrim(rms.multiplier_item_id::text) <> ''
         AND ${invalidCatalogPredicate('rms.multiplier_item_id')}
       RETURNING pr.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'invalidRackWiringsCleared',
      `
      UPDATE placed_racks pr
         SET wiring_id = NULL
       WHERE pr.wiring_id IS NOT NULL
         AND btrim(pr.wiring_id::text) <> ''
         AND ${invalidCatalogPredicate('pr.wiring_id')}
       RETURNING pr.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'invalidRackBatteryCatalogCleared',
      `
      UPDATE placed_racks pr
         SET battery_catalog_item_id = NULL,
             battery_power_capacity_wh = NULL,
             battery_display_name = NULL,
             battery_image_url = NULL
       WHERE pr.battery_catalog_item_id IS NOT NULL
         AND btrim(pr.battery_catalog_item_id::text) <> ''
         AND ${invalidCatalogPredicate('pr.battery_catalog_item_id')}
       RETURNING pr.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'badRackChargesFixed',
      `
      UPDATE placed_racks pr
         SET current_charge = 0
       WHERE pr.current_charge IS NULL
          OR pr.current_charge::text = 'NaN'
          OR (pr.current_charge < 0 AND pr.current_charge <> -1)
       RETURNING pr.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'badStoredBatteryChargesFixed',
      `
      UPDATE stored_batteries sb
         SET current_charge = CASE WHEN COALESCE(sb.power_capacity_wh, 0) = -1 THEN -1 ELSE 0 END
       WHERE sb.current_charge IS NULL
          OR sb.current_charge::text = 'NaN'
          OR (sb.current_charge < 0 AND sb.current_charge <> -1)
       RETURNING sb.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'duplicateRacksSameRoomSlotDeleted',
      `
      WITH ranked AS (
        SELECT
          pr.id,
          pr.user_id,
          ROW_NUMBER() OVER (
            PARTITION BY
              pr.user_id,
              COALESCE(NULLIF(btrim(pr.room_id::text), ''), 'room_initial'),
              COALESCE(pr.slot_index, 0)
            ORDER BY
              (
                CASE WHEN pr.item_id IS NOT NULL AND btrim(pr.item_id::text) <> '' THEN 1 ELSE 0 END +
                CASE WHEN pr.wiring_id IS NOT NULL AND btrim(pr.wiring_id::text) <> '' THEN 1 ELSE 0 END +
                CASE WHEN pr.battery_id IS NOT NULL AND btrim(pr.battery_id::text) <> '' THEN 1 ELSE 0 END +
                CASE WHEN pr.selected_coin_id IS NOT NULL AND btrim(pr.selected_coin_id::text) <> '' THEN 1 ELSE 0 END +
                COALESCE(slot_counts.machine_count, 0) +
                COALESCE(mult_counts.multiplier_count, 0)
              ) DESC,
              pr.is_on DESC,
              pr.id DESC
          ) AS rn
        FROM placed_racks pr
        LEFT JOIN (
          SELECT rack_id, COUNT(*)::int AS machine_count
            FROM rack_slots
           WHERE machine_item_id IS NOT NULL AND btrim(machine_item_id::text) <> ''
           GROUP BY rack_id
        ) slot_counts ON slot_counts.rack_id = pr.id
        LEFT JOIN (
          SELECT rack_id, COUNT(*)::int AS multiplier_count
            FROM rack_multiplier_slots
           WHERE multiplier_item_id IS NOT NULL AND btrim(multiplier_item_id::text) <> ''
           GROUP BY rack_id
        ) mult_counts ON mult_counts.rack_id = pr.id
      ),
      bad AS (
        SELECT id, user_id FROM ranked WHERE rn > 1
      ),
      del_slots AS (
        DELETE FROM rack_slots rs USING bad WHERE rs.rack_id = bad.id
      ),
      del_mults AS (
        DELETE FROM rack_multiplier_slots rms USING bad WHERE rms.rack_id = bad.id
      )
      DELETE FROM placed_racks pr USING bad
       WHERE pr.id = bad.id
       RETURNING bad.user_id
      `
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'duplicateRackBatteryRefsCleared',
      `
      WITH ranked AS (
        SELECT id, user_id, battery_id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id, btrim(battery_id::text)
                 ORDER BY COALESCE(room_id, ''), COALESCE(slot_index, 0), id
               ) AS rn
          FROM placed_racks
         WHERE battery_id IS NOT NULL
           AND btrim(battery_id::text) <> ''
           AND battery_id::text ~* $1
      )
      UPDATE placed_racks pr
         SET battery_id = NULL,
             current_charge = 0,
             battery_catalog_item_id = NULL,
             battery_power_capacity_wh = NULL,
             battery_display_name = NULL,
             battery_image_url = NULL
        FROM ranked r
       WHERE pr.id = r.id
         AND r.rn > 1
       RETURNING pr.user_id
      `,
      [UUID_SQL]
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'storedBatteryRackWorkshopConflictFixed',
      `
      UPDATE stored_batteries sb
         SET workshop_slot_index = NULL,
             workshop_component_slot_id = NULL,
             status = 'EQUIPPED',
             location = 'RACK',
             rack_id = pr.id,
             updated_at = now()
        FROM placed_racks pr
       WHERE pr.user_id = sb.user_id
         AND btrim(pr.battery_id::text) = btrim(sb.id::text)
         AND pr.battery_id::text ~* $1
         AND (sb.workshop_slot_index IS NOT NULL OR sb.status IS DISTINCT FROM 'EQUIPPED' OR sb.location IS DISTINCT FROM 'RACK')
       RETURNING sb.user_id
      `,
      [UUID_SQL]
    );

    await runReturning(
      client,
      summary,
      touchedUsers,
      'equippedWithoutRackReturnedToInventory',
      `
      UPDATE stored_batteries sb
         SET status = 'INVENTORY',
             location = 'INVENTORY',
             rack_id = NULL,
             slot_id = NULL,
             room_id = NULL,
             updated_at = now()
       WHERE sb.status = 'EQUIPPED'
         AND NOT EXISTS (
           SELECT 1 FROM placed_racks pr
            WHERE pr.user_id = sb.user_id
              AND btrim(pr.battery_id::text) = btrim(sb.id::text)
         )
       RETURNING sb.user_id
      `
    );

    const validBatteryRes = await client.query(`
      SELECT sb.id::text, sb.user_id
        FROM stored_batteries sb
       WHERE NOT (${invalidCatalogPredicate('sb.item_id')})
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = sb.user_id)
    `);
    const validBatteryById = new Map();
    for (const row of validBatteryRes.rows) validBatteryById.set(String(row.id), Number(row.user_id));

    const rackBatteryRefsRes = await client.query(`
      SELECT pr.user_id, pr.id AS rack_id, pr.battery_id::text AS battery_id
        FROM placed_racks pr
       WHERE pr.battery_id IS NOT NULL
         AND btrim(pr.battery_id::text) <> ''
         AND pr.battery_id::text ~* $1
    `, [UUID_SQL]);
    const rackBatteryRefKeys = new Set(
      rackBatteryRefsRes.rows.map((r) => `${Number(r.user_id)}:${String(r.battery_id)}`)
    );

    const workshopRows = await client.query(`
      SELECT user_id, slot_index, item_id, internal_state, slot_charges, slot_item_ids
        FROM workshop_slots
       ORDER BY user_id, slot_index
       FOR UPDATE
    `);

    const firstWorkshopBatteryOwner = new Map();
    let workshopSlotsDeleted = 0;
    let workshopSlotsUpdated = 0;
    let workshopBatteryDuplicatesCleared = 0;
    let workshopInvalidRefsCleared = 0;

    for (const row of workshopRows.rows) {
      const uid = Number(row.user_id);
      const slotIndex = Number(row.slot_index);
      const itemId = String(row.item_id || '').trim();
      let deleteRow = false;
      let changed = false;

      const internalState = safeJsonObject(row.internal_state);
      const slotCharges = safeJsonObject(row.slot_charges);
      const slotItemIds = safeJsonObject(row.slot_item_ids);

      if (!Number.isInteger(uid) || uid <= 0 || !itemId || !validOwnedCatalogIds.has(itemId)) {
        deleteRow = true;
        changed = true;
      }

      if (!deleteRow) {
        for (const [slotKey, rawValue] of Object.entries(internalState)) {
          const value = rawValue == null ? '' : String(rawValue).trim();
          if (!value) continue;

          const catalogInSlot = slotItemIds[slotKey] == null ? '' : String(slotItemIds[slotKey]).trim();
          const isBatteryInstance = UUID_INST.test(value);
          const isValidCatalogValue = !isBatteryInstance && validOwnedCatalogIds.has(value);
          const isValidSlotCatalog = !catalogInSlot || validOwnedCatalogIds.has(catalogInSlot);

          if (isBatteryInstance) {
            const owner = validBatteryById.get(value);
            const refKey = `${uid}:${value}`;
            const duplicateKey = `${uid}:${value}`;
            const firstOwner = firstWorkshopBatteryOwner.get(duplicateKey);
            if (owner !== uid || rackBatteryRefKeys.has(refKey) || firstOwner) {
              internalState[slotKey] = null;
              delete slotCharges[slotKey];
              delete slotItemIds[slotKey];
              changed = true;
              if (firstOwner) workshopBatteryDuplicatesCleared++;
              else workshopInvalidRefsCleared++;
              continue;
            }
            firstWorkshopBatteryOwner.set(duplicateKey, `${uid}:${slotIndex}:${slotKey}`);
            continue;
          }

          if (!isValidCatalogValue || !isValidSlotCatalog) {
            internalState[slotKey] = null;
            delete slotCharges[slotKey];
            delete slotItemIds[slotKey];
            workshopInvalidRefsCleared++;
            changed = true;
          }
        }

        for (const [slotKey, rawValue] of Object.entries(slotItemIds)) {
          const value = rawValue == null ? '' : String(rawValue).trim();
          if (!value || activeCatalogIds.has(value)) continue;
          delete slotItemIds[slotKey];
          delete slotCharges[slotKey];
          if (internalState[slotKey] !== undefined) internalState[slotKey] = null;
          workshopInvalidRefsCleared++;
          changed = true;
        }
      }

      if (!changed) continue;
      if (Number.isInteger(uid) && uid > 0) touchedUsers.add(uid);

      if (deleteRow) {
        const del = await client.query('DELETE FROM workshop_slots WHERE user_id = $1 AND slot_index = $2', [uid, slotIndex]);
        workshopSlotsDeleted += del.rowCount || 0;
      } else {
        const upd = await client.query(
          `
          UPDATE workshop_slots
             SET internal_state = $3,
                 slot_charges = $4,
                 slot_item_ids = $5
           WHERE user_id = $1 AND slot_index = $2
          `,
          [uid, slotIndex, stringifyJsonObject(internalState), stringifyJsonObject(slotCharges), stringifyJsonObject(slotItemIds)]
        );
        workshopSlotsUpdated += upd.rowCount || 0;
      }
    }

    summary.workshopSlotsDeleted = workshopSlotsDeleted;
    summary.workshopSlotsUpdated = workshopSlotsUpdated;
    summary.workshopBatteryDuplicatesCleared = workshopBatteryDuplicatesCleared;
    summary.workshopInvalidRefsCleared = workshopInvalidRefsCleared;

    await runReturning(
      client,
      summary,
      touchedUsers,
      'chargingWithoutWorkshopReturnedToInventory',
      `
      UPDATE stored_batteries sb
         SET status = 'INVENTORY',
             location = 'INVENTORY',
             workshop_slot_index = NULL,
             workshop_component_slot_id = NULL,
             updated_at = now()
       WHERE sb.status = 'CHARGING'
         AND NOT EXISTS (
           SELECT 1
             FROM workshop_slots ws
            WHERE ws.user_id = sb.user_id
              AND ws.slot_index = sb.workshop_slot_index
              AND ws.internal_state LIKE '%' || sb.id || '%'
         )
       RETURNING sb.user_id
      `
    );

    const touchedUserIds = [...touchedUsers].filter((uid) => Number.isInteger(uid) && uid > 0).sort((a, b) => a - b);
    if (touchedUserIds.length > 0) {
      const now = String(Date.now());
      const gs = await client.query(
        `
        UPDATE game_states
           SET server_updated_at = $1,
               last_updated_at = $1
         WHERE user_id = ANY($2::int[])
        RETURNING user_id
        `,
        [now, touchedUserIds]
      );
      summary.gameStatesTouched = gs.rowCount || 0;
    } else {
      summary.gameStatesTouched = 0;
    }

    if (APPLY) await client.query('COMMIT');
    else await client.query('ROLLBACK');

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: APPLY ? 'apply' : 'dry-run',
          activeCatalogItems: activeCatalogIds.size,
          affectedUsers: touchedUserIds.length,
          summary
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[cleanup_corrupted_player_items] failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
