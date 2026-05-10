import type { PoolClient } from 'pg';

/**
 * Apaga apenas linhas de armazém (`workshop_slot_index IS NULL`) que não estão na lista `keepIds`
 * e que **não** continuam montadas numa rig (`placed_racks.battery_id`) na BD neste momento.
 * Ordem: deve correr antes de persistir o novo `placed_racks` para o mesmo pedido.
 */
export async function deleteWarehouseStoredBatteriesExceptKeepIds(
  client: PoolClient,
  userId: number,
  keepIds: string[]
): Promise<void> {
  if (keepIds.length > 0) {
    await client.query(
      `DELETE FROM stored_batteries sb
        WHERE sb.user_id = $1
          AND sb.workshop_slot_index IS NULL
          AND NOT (sb.id = ANY($2::text[]))
          AND NOT EXISTS (
            SELECT 1 FROM placed_racks pr
             WHERE pr.user_id = $1
               AND pr.battery_id IS NOT NULL
               AND btrim(pr.battery_id::text) <> ''
               AND btrim(pr.battery_id::text) = btrim(sb.id::text)
          )`,
      [userId, keepIds]
    );
  } else {
    await client.query(
      `DELETE FROM stored_batteries sb
        WHERE sb.user_id = $1
          AND sb.workshop_slot_index IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM placed_racks pr
             WHERE pr.user_id = $1
               AND pr.battery_id IS NOT NULL
               AND btrim(pr.battery_id::text) <> ''
               AND btrim(pr.battery_id::text) = btrim(sb.id::text)
          )`,
      [userId]
    );
  }
}
