-- Idempotente, **todas as contas**: alinha stored_batteries.item_id ao catálogo de bateria;
-- recupera placed_racks com UUID de instância sem linha em stored_batteries (recria armazém, preserva carga);
-- limpa placed_racks (UUID duplicado entre rigs, battery_id que não é bateria válida);
-- normaliza carga -1 em baterias infinitas nas rigs (UI “CARGA 00”).
-- Executar: docker exec -i app-postgres psql -U postgres -d minestation -v ON_ERROR_STOP=1 -f - < backend/scripts/ensure_stored_batteries_integrity.sql

BEGIN;

WITH fb AS (
  SELECT id::text AS fid
    FROM upgrades
   WHERE COALESCE(is_active, 1) <> 0
     AND (lower(COALESCE(type, '')) = 'battery' OR lower(COALESCE(category, '')) = 'battery')
     AND id NOT LIKE 'temp_legacy\_%' ESCAPE '\'
   ORDER BY CASE WHEN id = 'small_battery' THEN 0 ELSE 1 END,
            base_cost ASC NULLS LAST,
            id ASC
   LIMIT 1
),
bad_rows AS (
  SELECT sb.id,
         COALESCE(dom.item_id, fb.fid) AS new_item_id
    FROM stored_batteries sb
    CROSS JOIN fb
    LEFT JOIN upgrades u ON u.id = btrim(COALESCE(sb.item_id, ''))
    LEFT JOIN LATERAL (
      SELECT btrim(sb2.item_id::text) AS item_id
        FROM stored_batteries sb2
        JOIN upgrades u2 ON u2.id = btrim(COALESCE(sb2.item_id, ''))
       WHERE sb2.user_id = sb.user_id
         AND sb2.id <> sb.id
         AND (lower(COALESCE(u2.type, '')) = 'battery' OR lower(COALESCE(u2.category, '')) = 'battery')
         AND u2.id NOT LIKE 'temp_legacy\_%' ESCAPE '\'
       GROUP BY btrim(sb2.item_id::text)
       ORDER BY COUNT(*) DESC, length(btrim(sb2.item_id::text)) ASC
       LIMIT 1
    ) dom ON TRUE
   WHERE (SELECT fid FROM fb) IS NOT NULL
     AND (
           btrim(COALESCE(sb.item_id, '')) = ''
        OR u.id IS NULL
        OR (
             lower(COALESCE(u.type, '')) <> 'battery'
         AND lower(COALESCE(u.category, '')) <> 'battery'
           )
         )
),
fix_sb AS (
  UPDATE stored_batteries sb
     SET item_id = br.new_item_id
    FROM bad_rows br
   WHERE sb.id = br.id
   RETURNING sb.id
),
recover_orphan AS (
  INSERT INTO stored_batteries (id, user_id, item_id, current_charge)
  SELECT pr.battery_id,
         pr.user_id,
         COALESCE(dom.item_id, fb.fid),
         GREATEST(0::double precision, COALESCE(pr.current_charge, 0)::double precision)
    FROM placed_racks pr
    CROSS JOIN fb
    LEFT JOIN LATERAL (
      SELECT btrim(sb2.item_id::text) AS item_id
        FROM stored_batteries sb2
        JOIN upgrades u2 ON u2.id = btrim(COALESCE(sb2.item_id, ''))
       WHERE sb2.user_id = pr.user_id
         AND (lower(COALESCE(u2.type, '')) = 'battery' OR lower(COALESCE(u2.category, '')) = 'battery')
         AND u2.id NOT LIKE 'temp_legacy\_%' ESCAPE '\'
       GROUP BY btrim(sb2.item_id::text)
       ORDER BY COUNT(*) DESC, length(btrim(sb2.item_id::text)) ASC
       LIMIT 1
    ) dom ON true
   WHERE (SELECT fid FROM fb) IS NOT NULL
     AND pr.battery_id IS NOT NULL
     AND btrim(pr.battery_id::text) <> ''
     AND pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     AND NOT EXISTS (
           SELECT 1 FROM stored_batteries sb
            WHERE sb.id = pr.battery_id AND sb.user_id = pr.user_id
         )
  ON CONFLICT (id) DO NOTHING
  RETURNING id
),
dup AS (
  UPDATE placed_racks pr
     SET battery_id = NULL,
         current_charge = 0,
         is_on = 0
    FROM (
      SELECT pr2.id,
             ROW_NUMBER() OVER (
               PARTITION BY pr2.user_id, pr2.battery_id
               ORDER BY COALESCE(pr2.slot_index, 0) ASC, pr2.id ASC
             ) AS rn
        FROM placed_racks pr2
       INNER JOIN stored_batteries sb ON sb.id = pr2.battery_id AND sb.user_id = pr2.user_id
       WHERE pr2.battery_id IS NOT NULL
         AND btrim(pr2.battery_id::text) <> ''
         AND pr2.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) r
   WHERE pr.id = r.id
     AND r.rn > 1
   RETURNING pr.id
),
bad_catalog AS (
  UPDATE placed_racks pr
     SET battery_id = NULL,
         current_charge = 0,
         is_on = 0
   WHERE pr.battery_id IS NOT NULL
     AND btrim(pr.battery_id::text) <> ''
     AND NOT (pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     AND NOT EXISTS (
           SELECT 1 FROM upgrades u
            WHERE u.id = btrim(pr.battery_id::text)
              AND (
                   lower(COALESCE(u.type, '')) = 'battery'
                OR lower(COALESCE(u.category, '')) = 'battery'
                  )
         )
   RETURNING pr.id
),
inf_inst AS (
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
),
inf_cat AS (
  UPDATE placed_racks pr
     SET current_charge = -1
    FROM upgrades u
   WHERE pr.battery_id IS NOT NULL
     AND btrim(pr.battery_id::text) <> ''
     AND btrim(pr.battery_id::text) = u.id
     AND NOT (pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     AND COALESCE(u.power_capacity, 0) = -1
     AND (
           lower(COALESCE(u.type, '')) = 'battery'
        OR lower(COALESCE(u.category, '')) = 'battery'
          )
     AND pr.current_charge IS DISTINCT FROM -1
   RETURNING pr.id
)
SELECT
  (SELECT COUNT(*)::int FROM fix_sb) AS item_id_corrigido,
  (SELECT COUNT(*)::int FROM recover_orphan) AS racks_uuid_recuperadas,
  (SELECT COUNT(*)::int FROM dup) AS racks_uuid_duplicado,
  (SELECT COUNT(*)::int FROM bad_catalog) AS racks_batt_id_invalido,
  (SELECT COUNT(*)::int FROM inf_inst) AS racks_inf_carga_inst,
  (SELECT COUNT(*)::int FROM inf_cat) AS racks_inf_carga_cat;

COMMIT;
