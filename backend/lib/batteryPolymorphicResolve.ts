import type { PoolClient } from 'pg';
import {
  batteryIdLooksLikePhysicalInstanceUuid,
  workshopDbRowInstanceToCatalog
} from './batteryInstanceResolve.js';

/**
 * `battery_id` em racks / instância em oficina: pode ser `upgrade.id` (catálogo) ou UUID de instância.
 * Ordem: `stored_batteries` → montagem em `placed_racks` → oficina (BD) → `charging_history` → hint → catálogo.
 * Nunca devolver UUID como id de catálogo.
 */
export async function resolveBatteryPolymorphicToCatalogItemId(
  client: PoolClient,
  userId: number,
  batteryId: string,
  slotCatalogHint?: string | null
): Promise<string | null> {
  const id = String(batteryId || '').trim();
  if (!id) return null;

  const sbRes = await client.query(
    `SELECT item_id::text AS item_id FROM stored_batteries WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id]
  );
  const sbRow = sbRes.rows[0] as { item_id?: unknown } | undefined;
  const fromStore = sbRow?.item_id != null ? String(sbRow.item_id).trim() : '';
  if (fromStore) return fromStore;

  let mountedOnRack = false;
  if (batteryIdLooksLikePhysicalInstanceUuid(id)) {
    const pr = await client.query(
      `SELECT 1 FROM placed_racks WHERE user_id = $1 AND battery_id = $2 LIMIT 1`,
      [userId, id]
    );
    mountedOnRack = (pr.rowCount ?? 0) > 0;

    const wsRes = await client.query(
      `SELECT internal_state, slot_item_ids FROM workshop_slots WHERE user_id = $1`,
      [userId]
    );
    for (const row of wsRes.rows || []) {
      const m = workshopDbRowInstanceToCatalog(
        (row as { internal_state?: unknown }).internal_state,
        (row as { slot_item_ids?: unknown }).slot_item_ids
      );
      const cat = m.get(id);
      if (cat) return cat;
    }

    const histRes = await client.query(
      `SELECT battery_item_id::text AS item_id
         FROM charging_history
        WHERE user_email = (SELECT email FROM users WHERE id = $1 LIMIT 1)
          AND battery_instance_id = $2
          AND battery_item_id IS NOT NULL
          AND BTRIM(battery_item_id::text) <> ''
        ORDER BY timestamp DESC
        LIMIT 1`,
      [userId, id]
    );
    const hRow = histRes.rows[0] as { item_id?: unknown } | undefined;
    const fromHist = hRow?.item_id != null ? String(hRow.item_id).trim() : '';
    if (fromHist) return fromHist;

    const hint = slotCatalogHint != null ? String(slotCatalogHint).trim() : '';
    if (hint) return hint;

    if (mountedOnRack) return null;
    return null;
  }

  return id;
}
