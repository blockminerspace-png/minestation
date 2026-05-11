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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function stringifyObject(value) {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return JSON.stringify(obj);
}

function cleanWorkshopSlot(row, activeCatalogIds, liveBatteryIds) {
  const itemId = String(row.item_id || '').trim();
  if (!itemId || !activeCatalogIds.has(itemId)) {
    return { deleteRow: true, changed: true };
  }

  const internalState = safeJsonObject(row.internal_state);
  const slotCharges = safeJsonObject(row.slot_charges);
  const slotItemIds = safeJsonObject(row.slot_item_ids);
  let changed = false;

  for (const [slotId, rawValue] of Object.entries(internalState)) {
    const value = rawValue == null ? '' : String(rawValue).trim();
    if (!value) continue;

    const keepAsBatteryInstance = UUID_RE.test(value) && liveBatteryIds.has(value);
    const keepAsCatalogItem = !UUID_RE.test(value) && activeCatalogIds.has(value);
    if (keepAsBatteryInstance || keepAsCatalogItem) continue;

    internalState[slotId] = null;
    delete slotCharges[slotId];
    delete slotItemIds[slotId];
    changed = true;
  }

  for (const [slotId, rawValue] of Object.entries(slotItemIds)) {
    const value = rawValue == null ? '' : String(rawValue).trim();
    if (!value || activeCatalogIds.has(value)) continue;
    delete slotItemIds[slotId];
    delete slotCharges[slotId];
    if (internalState[slotId] !== undefined) internalState[slotId] = null;
    changed = true;
  }

  if (!changed) return { deleteRow: false, changed: false };
  return {
    deleteRow: false,
    changed: true,
    internalState: stringifyObject(internalState),
    slotCharges: stringifyObject(slotCharges),
    slotItemIds: stringifyObject(slotItemIds)
  };
}

async function queryAffectedUsers(client, sql, params = []) {
  const res = await client.query(sql, params);
  return res.rows.map((r) => Number(r.user_id)).filter((n) => Number.isInteger(n) && n > 0);
}

async function main() {
  const pool = new Pool(buildPoolConfig());
  const client = await pool.connect();
  const touchedUsers = new Set();
  const summary = {};

  const activeCatalogSql = `
    SELECT id
      FROM upgrades
     WHERE COALESCE(is_active, 1) <> 0
       AND id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
       AND COALESCE(category, '') <> 'legacy-temp'
       AND COALESCE(type, '') <> 'legacy-temp'
  `;

  const invalidCatalogPredicate = `
    NOT EXISTS (
      SELECT 1
        FROM upgrades u
       WHERE u.id = %FIELD%
         AND COALESCE(u.is_active, 1) <> 0
         AND u.id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
         AND COALESCE(u.category, '') <> 'legacy-temp'
         AND COALESCE(u.type, '') <> 'legacy-temp'
    )
  `;

  try {
    await client.query('BEGIN');

    const activeRes = await client.query(activeCatalogSql);
    const activeCatalogIds = new Set(activeRes.rows.map((r) => String(r.id)));

    const invalidStoredRes = await client.query(`
      SELECT id, user_id
        FROM stored_batteries sb
       WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 'sb.item_id')}
    `);
    const invalidBatteryIds = invalidStoredRes.rows.map((r) => String(r.id));
    for (const row of invalidStoredRes.rows) touchedUsers.add(Number(row.user_id));
    summary.storedBatteriesDeleted = invalidStoredRes.rowCount || 0;

    const invalidRackUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT user_id
          FROM placed_racks pr
         WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pr.item_id')}
      `
    );
    invalidRackUsers.forEach((uid) => touchedUsers.add(uid));

    const invalidRackIdsRes = await client.query(`
      SELECT id
        FROM placed_racks pr
       WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pr.item_id')}
    `);
    const invalidRackIds = invalidRackIdsRes.rows.map((r) => String(r.id));

    if (invalidRackIds.length > 0) {
      const rackSlotsDel = await client.query('DELETE FROM rack_slots WHERE rack_id = ANY($1::text[])', [invalidRackIds]);
      const rackMultsDel = await client.query('DELETE FROM rack_multiplier_slots WHERE rack_id = ANY($1::text[])', [
        invalidRackIds
      ]);
      const racksDel = await client.query('DELETE FROM placed_racks WHERE id = ANY($1::text[])', [invalidRackIds]);
      summary.invalidRackSlotsDeleted = rackSlotsDel.rowCount || 0;
      summary.invalidRackMultiplierSlotsDeleted = rackMultsDel.rowCount || 0;
      summary.invalidRacksDeleted = racksDel.rowCount || 0;
    } else {
      summary.invalidRackSlotsDeleted = 0;
      summary.invalidRackMultiplierSlotsDeleted = 0;
      summary.invalidRacksDeleted = 0;
    }

    const stockUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT user_id
          FROM stock s
         WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 's.item_id')}
      `
    );
    stockUsers.forEach((uid) => touchedUsers.add(uid));
    const stockDel = await client.query(`
      DELETE FROM stock s
       WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 's.item_id')}
    `);
    summary.stockDeleted = stockDel.rowCount || 0;

    const listingUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT user_id
          FROM player_listings pl
         WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pl.item_id')}
      `
    );
    listingUsers.forEach((uid) => touchedUsers.add(uid));
    const listingsDel = await client.query(`
      DELETE FROM player_listings pl
       WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pl.item_id')}
    `);
    summary.playerListingsDeleted = listingsDel.rowCount || 0;

    const rackSlotUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT pr.user_id
          FROM rack_slots rs
          JOIN placed_racks pr ON pr.id = rs.rack_id
         WHERE rs.machine_item_id IS NOT NULL
           AND BTRIM(rs.machine_item_id::text) <> ''
           AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'rs.machine_item_id')}
      `
    );
    rackSlotUsers.forEach((uid) => touchedUsers.add(uid));
    const rackSlotsUpd = await client.query(`
      UPDATE rack_slots rs
         SET machine_item_id = NULL
        FROM placed_racks pr
       WHERE pr.id = rs.rack_id
         AND rs.machine_item_id IS NOT NULL
         AND BTRIM(rs.machine_item_id::text) <> ''
         AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'rs.machine_item_id')}
    `);
    summary.rackMachineSlotsCleared = rackSlotsUpd.rowCount || 0;

    const rackMultUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT pr.user_id
          FROM rack_multiplier_slots rms
          JOIN placed_racks pr ON pr.id = rms.rack_id
         WHERE rms.multiplier_item_id IS NOT NULL
           AND BTRIM(rms.multiplier_item_id::text) <> ''
           AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'rms.multiplier_item_id')}
      `
    );
    rackMultUsers.forEach((uid) => touchedUsers.add(uid));
    const rackMultsUpd = await client.query(`
      UPDATE rack_multiplier_slots rms
         SET multiplier_item_id = NULL
        FROM placed_racks pr
       WHERE pr.id = rms.rack_id
         AND rms.multiplier_item_id IS NOT NULL
         AND BTRIM(rms.multiplier_item_id::text) <> ''
         AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'rms.multiplier_item_id')}
    `);
    summary.rackMultiplierSlotsCleared = rackMultsUpd.rowCount || 0;

    const wiringUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT user_id
          FROM placed_racks pr
         WHERE pr.wiring_id IS NOT NULL
           AND BTRIM(pr.wiring_id::text) <> ''
           AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pr.wiring_id')}
      `
    );
    wiringUsers.forEach((uid) => touchedUsers.add(uid));
    const wiringUpd = await client.query(`
      UPDATE placed_racks pr
         SET wiring_id = NULL
       WHERE pr.wiring_id IS NOT NULL
         AND BTRIM(pr.wiring_id::text) <> ''
         AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pr.wiring_id')}
    `);
    summary.rackWiringsCleared = wiringUpd.rowCount || 0;

    const batteryCatalogUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT user_id
          FROM placed_racks pr
         WHERE pr.battery_catalog_item_id IS NOT NULL
           AND BTRIM(pr.battery_catalog_item_id::text) <> ''
           AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pr.battery_catalog_item_id')}
      `
    );
    batteryCatalogUsers.forEach((uid) => touchedUsers.add(uid));
    const batteryCatalogUpd = await client.query(`
      UPDATE placed_racks pr
         SET battery_catalog_item_id = NULL,
             battery_power_capacity_wh = NULL,
             battery_display_name = NULL,
             battery_image_url = NULL
       WHERE pr.battery_catalog_item_id IS NOT NULL
         AND BTRIM(pr.battery_catalog_item_id::text) <> ''
         AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pr.battery_catalog_item_id')}
    `);
    summary.rackBatteryCatalogRefsCleared = batteryCatalogUpd.rowCount || 0;

    const liveBatteryRes = await client.query(`
      SELECT sb.id
        FROM stored_batteries sb
       WHERE NOT (${invalidCatalogPredicate.replaceAll('%FIELD%', 'sb.item_id')})
    `);
    const liveBatteryIds = new Set(liveBatteryRes.rows.map((r) => String(r.id)));

    const rackBatteryUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT pr.user_id
          FROM placed_racks pr
         WHERE pr.battery_id IS NOT NULL
           AND BTRIM(pr.battery_id::text) <> ''
           AND (
             pr.battery_id = ANY($1::text[])
             OR (
               NOT EXISTS (SELECT 1 FROM stored_batteries sb WHERE sb.user_id = pr.user_id AND sb.id = pr.battery_id)
               AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pr.battery_id')}
             )
           )
      `,
      [invalidBatteryIds]
    );
    rackBatteryUsers.forEach((uid) => touchedUsers.add(uid));
    const rackBatteryUpd = await client.query(
      `
        UPDATE placed_racks pr
           SET battery_id = NULL,
               current_charge = 0,
               battery_catalog_item_id = NULL,
               battery_power_capacity_wh = NULL,
               battery_display_name = NULL,
               battery_image_url = NULL
         WHERE pr.battery_id IS NOT NULL
           AND BTRIM(pr.battery_id::text) <> ''
           AND (
             pr.battery_id = ANY($1::text[])
             OR (
               NOT EXISTS (SELECT 1 FROM stored_batteries sb WHERE sb.user_id = pr.user_id AND sb.id = pr.battery_id)
               AND ${invalidCatalogPredicate.replaceAll('%FIELD%', 'pr.battery_id')}
             )
           )
      `,
      [invalidBatteryIds]
    );
    summary.rackBatteriesCleared = rackBatteryUpd.rowCount || 0;

    if (invalidBatteryIds.length > 0) {
      const storedDel = await client.query('DELETE FROM stored_batteries WHERE id = ANY($1::text[])', [invalidBatteryIds]);
      summary.storedBatteriesDeleted = storedDel.rowCount || 0;
    }

    const pendingUsers = await queryAffectedUsers(
      client,
      `
        SELECT DISTINCT user_id
          FROM wheel_paid_pending wpp
         WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 'wpp.won_item_id')}
      `
    );
    pendingUsers.forEach((uid) => touchedUsers.add(uid));
    const pendingDel = await client.query(`
      DELETE FROM wheel_paid_pending wpp
       WHERE ${invalidCatalogPredicate.replaceAll('%FIELD%', 'wpp.won_item_id')}
    `);
    summary.wheelPaidPendingDeleted = pendingDel.rowCount || 0;

    const workshopRows = await client.query(`
      SELECT user_id, slot_index, item_id, internal_state, slot_charges, slot_item_ids
        FROM workshop_slots
       ORDER BY user_id, slot_index
       FOR UPDATE
    `);

    let workshopDeleted = 0;
    let workshopUpdated = 0;
    for (const row of workshopRows.rows) {
      const cleaned = cleanWorkshopSlot(row, activeCatalogIds, liveBatteryIds);
      if (!cleaned.changed) continue;
      const uid = Number(row.user_id);
      if (Number.isInteger(uid) && uid > 0) touchedUsers.add(uid);
      if (cleaned.deleteRow) {
        const del = await client.query('DELETE FROM workshop_slots WHERE user_id = $1 AND slot_index = $2', [
          row.user_id,
          row.slot_index
        ]);
        workshopDeleted += del.rowCount || 0;
        continue;
      }
      const upd = await client.query(
        `
          UPDATE workshop_slots
             SET internal_state = $3,
                 slot_charges = $4,
                 slot_item_ids = $5
           WHERE user_id = $1 AND slot_index = $2
        `,
        [row.user_id, row.slot_index, cleaned.internalState, cleaned.slotCharges, cleaned.slotItemIds]
      );
      workshopUpdated += upd.rowCount || 0;
    }
    summary.workshopSlotsDeleted = workshopDeleted;
    summary.workshopSlotsUpdated = workshopUpdated;

    const now = Date.now();
    const touchedUserIds = [...touchedUsers].sort((a, b) => a - b);
    if (touchedUserIds.length > 0) {
      const gsUpd = await client.query(
        `
          UPDATE game_states
             SET server_updated_at = $1,
                 last_updated_at = $1
           WHERE user_id = ANY($2::int[])
        `,
        [String(now), touchedUserIds]
      );
      summary.gameStatesTouched = gsUpd.rowCount || 0;
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
    console.error('[remove_legacy_catalog_items] failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
