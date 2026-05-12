import type { PoolClient } from 'pg';

/**
 * Apaga apenas linhas de armazém que não estão na lista `keepIds` e que **não** continuam
 * montadas numa rig (`placed_racks.battery_id`) na BD neste momento.
 * Ordem: deve correr antes de persistir o novo `placed_racks` para o mesmo pedido.
 *
 * Sistema de carregamento descontinuado em
 * `20260516180000_battery_uuids_and_purge_charging`: já não há `workshop_slot_index`
 * em `stored_batteries`; só restam INVENTORY (armazém) e EQUIPPED (em rig).
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
