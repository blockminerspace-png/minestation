/**
 * Quando `placed_racks.battery_id` é UUID de instância mas a linha em `stored_batteries`
 * desapareceu (dessincronização), **não** anular a bateria na rig: recria-se o armazém
 * com o mesmo `id`, preservando `current_charge` e inferindo `item_id` (modo idêntico
 * a `ensure_stored_batteries_integrity.sql`: bateria mais comum do jogador ou fallback
 * de catálogo ativo).
 */
import type { PoolClient } from 'pg';
import { isRackBatteryInstanceUuid } from './batteries.repository.js';

type PgLike = Pick<PoolClient, 'query'>;

export type RecoveredStoredBatteryRow = {
  id: string;
  item_id: string;
  current_charge: number;
};

/**
 * Insere linhas em `stored_batteries` para cada UUID órfão nas rigs do payload.
 * @returns linhas inseridas (para fundir no JSON de `storedBatteries` no GET).
 */
export async function recoverOrphanRackBatteryStorageRows(
  client: PgLike,
  userId: number,
  racks: Array<{ batteryId?: unknown; currentCharge?: unknown }>
): Promise<RecoveredStoredBatteryRow[]> {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0 || !Array.isArray(racks) || racks.length === 0) return [];

  const cand: Array<{ bid: string; charge: number }> = [];
  const seen = new Set<string>();
  for (const r of racks) {
    const raw = r?.batteryId;
    if (raw == null) continue;
    const bid = String(raw).trim();
    if (!bid || !isRackBatteryInstanceUuid(bid) || seen.has(bid)) continue;
    seen.add(bid);
    const ch = typeof r.currentCharge === 'number' && Number.isFinite(r.currentCharge) ? r.currentCharge : 0;
    cand.push({ bid, charge: Math.max(0, ch) });
  }
  if (cand.length === 0) return [];

  const payload = JSON.stringify(cand.map((c) => ({ bid: c.bid, charge: c.charge })));

  const res = await client.query<RecoveredStoredBatteryRow>(
    `WITH fb AS (
       SELECT id::text AS fid
         FROM upgrades
        WHERE COALESCE(is_active, 1) <> 0
          AND (lower(COALESCE(type, '')) = 'battery' OR lower(COALESCE(category, '')) = 'battery')
          AND id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
        ORDER BY CASE WHEN id = 'small_battery' THEN 0 ELSE 1 END,
                 base_cost ASC NULLS LAST,
                 id ASC
        LIMIT 1
     ),
     cand AS (
       SELECT * FROM json_to_recordset($2::json) AS x(bid text, charge double precision)
     ),
     ins AS (
       INSERT INTO stored_batteries (id, user_id, item_id, current_charge, power_capacity_wh, display_name, image_url, workshop_slot_index, workshop_component_slot_id)
       SELECT c.bid,
              $1::int,
              COALESCE(dom.item_id, fb.fid),
              GREATEST(0::double precision, COALESCE(c.charge, 0)::double precision),
              u.power_capacity,
              u.name,
              NULLIF(BTRIM(COALESCE(u.image::text, '')), ''),
              NULL::integer,
              NULL::text
         FROM cand c
         CROSS JOIN fb
         LEFT JOIN LATERAL (
           SELECT btrim(sb2.item_id::text) AS item_id
             FROM stored_batteries sb2
             JOIN upgrades u2 ON u2.id = btrim(COALESCE(sb2.item_id, ''))
            WHERE sb2.user_id = $1
              AND (lower(COALESCE(u2.type, '')) = 'battery' OR lower(COALESCE(u2.category, '')) = 'battery')
              AND u2.id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
            GROUP BY btrim(sb2.item_id::text)
            ORDER BY COUNT(*) DESC, length(btrim(sb2.item_id::text)) ASC
            LIMIT 1
         ) dom ON true
         LEFT JOIN upgrades u ON u.id = COALESCE(dom.item_id, fb.fid)
          AND (lower(COALESCE(u.type, '')) = 'battery' OR lower(COALESCE(u.category, '')) = 'battery')
        WHERE (SELECT fid FROM fb) IS NOT NULL
          AND c.bid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND NOT EXISTS (
                SELECT 1 FROM stored_batteries sb
                 WHERE sb.id = c.bid AND sb.user_id = $1
              )
        ON CONFLICT (id) DO NOTHING
        RETURNING id, item_id, current_charge
     )
     SELECT id, item_id, current_charge FROM ins`,
    [uid, payload]
  );

  return (res.rows || []).map((row) => ({
    id: String(row.id),
    item_id: String(row.item_id),
    current_charge: Number(row.current_charge) || 0
  }));
}
