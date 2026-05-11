-- Limpa inventário/stock de baterias finitas exatamente 1000 Wh (catálogo `upgrades`),
-- excluindo família infinita (protostar/estelar/stellar/small_battery e ids semelhantes).
-- Remove também rigs duplicadas com o mesmo UUID de instância (causa típica de "procriação" no cliente).

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
     AND pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
UPDATE placed_racks pr
   SET battery_id = NULL,
       current_charge = 0,
       is_on = 0,
       battery_catalog_item_id = NULL,
       battery_power_capacity_wh = NULL,
       battery_display_name = NULL,
       battery_image_url = NULL
  FROM ranked r
 WHERE pr.id = r.id
   AND r.rn > 1;

CREATE TEMP TABLE finite_1000wh_battery_catalog AS
SELECT u.id::text AS id
  FROM upgrades u
 WHERE (lower(COALESCE(u.type, '')) = 'battery' OR lower(COALESCE(u.category, '')) = 'battery')
   AND COALESCE(u.power_capacity, 0) = 1000
   AND u.id NOT IN ('battery_protostar', 'battery_estelar', 'battery_stellar', 'small_battery')
   AND lower(u.id) NOT LIKE '%protostar%'
   AND lower(u.id) NOT LIKE '%estelar%'
   AND lower(u.id) NOT LIKE '%stellar%';

UPDATE placed_racks pr
   SET battery_id = NULL,
       current_charge = 0,
       is_on = 0,
       battery_catalog_item_id = NULL,
       battery_power_capacity_wh = NULL,
       battery_display_name = NULL,
       battery_image_url = NULL
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f
          WHERE f.id = btrim(COALESCE(pr.battery_catalog_item_id, ''))
       )
    OR EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f
          JOIN stored_batteries sb ON sb.user_id = pr.user_id AND sb.id = pr.battery_id
         WHERE f.id = btrim(COALESCE(sb.item_id, ''))
       )
    OR EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f
         WHERE f.id = btrim(COALESCE(pr.battery_id, ''))
           AND NOT (
             pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
       );

DELETE FROM charging_history ch
 WHERE EXISTS (SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(ch.battery_item_id, '')))
    OR EXISTS (
         SELECT 1 FROM stored_batteries sb
         JOIN finite_1000wh_battery_catalog f ON f.id = btrim(COALESCE(sb.item_id, ''))
         WHERE btrim(COALESCE(ch.battery_instance_id, '')) <> ''
           AND btrim(COALESCE(ch.battery_instance_id, '')) = btrim(sb.id::text)
       );

DELETE FROM inventory_movements im
 WHERE EXISTS (SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(im.catalog_item_id, '')))
    OR EXISTS (
         SELECT 1 FROM stored_batteries sb
         JOIN finite_1000wh_battery_catalog f ON f.id = btrim(COALESCE(sb.item_id, ''))
         WHERE btrim(COALESCE(im.instance_id, '')) <> ''
           AND btrim(COALESCE(im.instance_id, '')) = btrim(sb.id::text)
       );

UPDATE stored_batteries sb
   SET workshop_slot_index = NULL,
       workshop_component_slot_id = NULL
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(sb.item_id, ''))
       );

DELETE FROM stored_batteries sb
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(sb.item_id, ''))
       );

DELETE FROM stock s
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(s.item_id, ''))
       );

DELETE FROM shop_cart_lines scl
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(scl.product_id, ''))
       );

DELETE FROM player_listings pl
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(pl.item_id, ''))
       );

DELETE FROM loot_box_items lbi
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(lbi.item_id, ''))
       );

DELETE FROM season_pass_rewards spr
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(spr.item_id, ''))
       );

DELETE FROM admin_upgrade_items aui
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(aui.item_id, ''))
       );

UPDATE wheel_prizes wp
   SET item_id = NULL
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(wp.item_id, ''))
       );

DELETE FROM wheel_spins ws
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(ws.won_item_id, ''))
       );

DELETE FROM wheel_paid_pending wpp
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(wpp.won_item_id, ''))
       );

UPDATE promo_code_redemptions pcr
   SET won_item_id = NULL
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(pcr.won_item_id, ''))
       );

UPDATE workshop_slots wks
   SET item_id = NULL
 WHERE EXISTS (
         SELECT 1 FROM finite_1000wh_battery_catalog f WHERE f.id = btrim(COALESCE(wks.item_id, ''))
       );
