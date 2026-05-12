/**
 * Quando `placed_racks.battery_id` é UUID de instância mas a linha em `stored_batteries`
 * desapareceu (dessincronização), **não** anular a bateria na rig: recria-se o armazém
 * com o mesmo `id`, inferindo `item_id` nesta ordem:
 * 1) `battery_catalog_item_id` / `batteryCatalogItemId` na rig (payload ou BD),
 * 2) tipo mais comum noutras linhas `stored_batteries` do jogador,
 * 3) fallback barato no catálogo (canónico entre opções válidas).
 * `small_battery` legado normaliza para o canónico.
 *
 * Sistema de carregamento descontinuado em
 * `20260516180000_battery_uuids_and_purge_charging`: já não há `current_charge`/
 * `power_capacity_wh` em `stored_batteries`.
 */
import type { PoolClient } from 'pg';
import { isRackBatteryInstanceUuid } from './batteries.repository.js';
import { CANONICAL_1000WH_BATTERY_ID, normalizeKnown1000WhBatteryCatalogId } from './batteries.catalog.js';

type PgLike = Pick<PoolClient, 'query'>;

export type RecoveredStoredBatteryRow = {
  id: string;
  item_id: string;
};

function rackBatteryCatalogHint(r: Record<string, unknown>): string {
  const raw = r.batteryCatalogItemId ?? r.battery_catalog_item_id;
  if (raw == null) return '';
  return normalizeKnown1000WhBatteryCatalogId(String(raw).trim());
}

export async function recoverOrphanRackBatteryStorageRows(
  client: PgLike,
  userId: number,
  racks: Array<Record<string, unknown>>
): Promise<RecoveredStoredBatteryRow[]> {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0 || !Array.isArray(racks) || racks.length === 0) return [];

  const cand: Array<{ bid: string; catalog_hint: string | null }> = [];
  const seen = new Set<string>();
  for (const r of racks) {
    if (!r || typeof r !== 'object') continue;
    const ro = r as Record<string, unknown>;
    const raw = ro.batteryId;
    if (raw == null) continue;
    const bid = String(raw).trim();
    if (!bid || !isRackBatteryInstanceUuid(bid) || seen.has(bid)) continue;
    seen.add(bid);
    const hintRaw = rackBatteryCatalogHint(ro);
    cand.push({ bid, catalog_hint: hintRaw || null });
  }
  if (cand.length === 0) return [];

  const needDbHint = cand.some((c) => !c.catalog_hint);
  if (needDbHint) {
    try {
      const pr = await client.query<{ bid: string; cat: string }>(
        `SELECT battery_id::text AS bid, battery_catalog_item_id::text AS cat
           FROM placed_racks
          WHERE user_id = $1::int
            AND battery_id IS NOT NULL
            AND battery_catalog_item_id IS NOT NULL`,
        [uid]
      );
      const dbHint = new Map<string, string>();
      for (const row of pr.rows || []) {
        const b = String(row.bid ?? '').trim();
        const cat = normalizeKnown1000WhBatteryCatalogId(String(row.cat ?? '').trim());
        if (b && cat && isRackBatteryInstanceUuid(b)) dbHint.set(b, cat);
      }
      for (const c of cand) {
        if (!c.catalog_hint) {
          const h = dbHint.get(c.bid);
          if (h) c.catalog_hint = h;
        }
      }
    } catch {
      /* continua só com hints do payload */
    }
  }

  const payload = JSON.stringify(
    cand.map((c) => ({ bid: c.bid, catalog_hint: c.catalog_hint || null }))
  );

  const res = await client.query<RecoveredStoredBatteryRow>(
    `WITH fb AS (
       SELECT id::text AS fid
         FROM upgrades
        WHERE COALESCE(is_active, 1) <> 0
          AND (lower(COALESCE(type, '')) = 'battery' OR lower(COALESCE(category, '')) = 'battery')
          AND id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
        ORDER BY CASE WHEN id = $3::text THEN 0 ELSE 1 END,
                 base_cost ASC NULLS LAST,
                 id ASC
        LIMIT 1
     ),
     cand AS (
       SELECT * FROM json_to_recordset($2::json) AS x(bid text, catalog_hint text)
     ),
     ins AS (
       INSERT INTO stored_batteries (id, user_id, item_id, display_name, image_url)
       SELECT c.bid,
              $1::int,
              COALESCE(rack_hint.hid, dom.item_id, fb.fid),
              u.name,
              NULLIF(BTRIM(COALESCE(u.image::text, '')), '')
         FROM cand c
         CROSS JOIN fb
         LEFT JOIN LATERAL (
           SELECT uhint.id::text AS hid
             FROM upgrades uhint
            WHERE NULLIF(BTRIM(c.catalog_hint), '') IS NOT NULL
              AND uhint.id = NULLIF(BTRIM(c.catalog_hint), '')
              AND COALESCE(uhint.is_active, 1) <> 0
              AND (lower(COALESCE(uhint.type, '')) = 'battery' OR lower(COALESCE(uhint.category, '')) = 'battery')
              AND uhint.id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
            LIMIT 1
         ) rack_hint ON true
         LEFT JOIN LATERAL (
           SELECT CASE
                    WHEN btrim(sb2.item_id::text) = 'small_battery' THEN $3::text
                    ELSE btrim(sb2.item_id::text)
                  END AS item_id
             FROM stored_batteries sb2
             JOIN upgrades u2 ON u2.id = btrim(COALESCE(sb2.item_id, ''))
            WHERE sb2.user_id = $1
              AND (lower(COALESCE(u2.type, '')) = 'battery' OR lower(COALESCE(u2.category, '')) = 'battery')
              AND u2.id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
            GROUP BY CASE
                       WHEN btrim(sb2.item_id::text) = 'small_battery' THEN $3::text
                       ELSE btrim(sb2.item_id::text)
                     END
            ORDER BY COUNT(*) DESC,
                     length(
                       CASE
                         WHEN btrim(sb2.item_id::text) = 'small_battery' THEN $3::text
                         ELSE btrim(sb2.item_id::text)
                       END
                     ) ASC
            LIMIT 1
         ) dom ON true
         LEFT JOIN upgrades u ON u.id = COALESCE(rack_hint.hid, dom.item_id, fb.fid)
          AND (lower(COALESCE(u.type, '')) = 'battery' OR lower(COALESCE(u.category, '')) = 'battery')
        WHERE (SELECT fid FROM fb) IS NOT NULL
          AND c.bid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND NOT EXISTS (
                SELECT 1 FROM stored_batteries sb
                 WHERE sb.id = c.bid AND sb.user_id = $1
              )
        ON CONFLICT (id) DO NOTHING
        RETURNING id, item_id
     )
     SELECT id, item_id FROM ins`,
    [uid, payload, CANONICAL_1000WH_BATTERY_ID]
  );

  return (res.rows || []).map((row) => ({
    id: String(row.id),
    item_id: String(row.item_id)
  }));
}
