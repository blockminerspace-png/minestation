-- Purga global: baterias 1000 kWh / Protostar / legado small_battery e variantes id/nome com "1000kwh".
-- Remove de contas (stock, instâncias, rigs, carrinho, P2P activo, oficina, prémios que referenciem o id).
-- Desactiva o item no catálogo (is_active=0) em vez de apagar a linha em upgrades (evita quebras em código legado).

CREATE TEMP TABLE purge_battery_cat (id TEXT PRIMARY KEY);

INSERT INTO purge_battery_cat (id) VALUES ('battery_protostar'), ('small_battery')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purge_battery_cat (id)
SELECT u.id
  FROM upgrades u
 WHERE lower(COALESCE(u.type::text, '')) = 'battery'
   AND (
         lower(u.id) LIKE '%1000kwh%'
      OR lower(COALESCE(u.name::text, '')) LIKE '%1000kwh%'
       )
ON CONFLICT (id) DO NOTHING;

-- Inventário / auditoria
DELETE FROM inventory_movements im
 WHERE im.catalog_item_id IN (SELECT id FROM purge_battery_cat)
    OR im.instance_id IN (
         SELECT sb.id FROM stored_batteries sb
          WHERE sb.item_id IN (SELECT id FROM purge_battery_cat)
       );

DELETE FROM charging_history ch
 WHERE ch.battery_item_id IN (SELECT id FROM purge_battery_cat)
    OR ch.battery_instance_id IN (
         SELECT sb.id FROM stored_batteries sb
          WHERE sb.item_id IN (SELECT id FROM purge_battery_cat)
       );

DELETE FROM shop_cart_lines scl
 WHERE scl.product_id IN (SELECT id FROM purge_battery_cat);

-- Rigs: desmontar antes de apagar instâncias
UPDATE placed_racks pr
   SET battery_id = NULL,
       current_charge = 0,
       battery_catalog_item_id = NULL,
       battery_power_capacity_wh = NULL,
       battery_display_name = NULL,
       battery_image_url = NULL
 WHERE pr.battery_catalog_item_id IN (SELECT id FROM purge_battery_cat)
    OR pr.battery_id IN (SELECT id FROM purge_battery_cat)
    OR pr.battery_id IN (
         SELECT sb.id FROM stored_batteries sb
          WHERE sb.item_id IN (SELECT id FROM purge_battery_cat)
       );

DELETE FROM stored_batteries sb
 WHERE sb.item_id IN (SELECT id FROM purge_battery_cat);

DELETE FROM stock s
 WHERE s.item_id IN (SELECT id FROM purge_battery_cat);

DELETE FROM player_listings pl
 WHERE pl.item_id IN (SELECT id FROM purge_battery_cat);

UPDATE workshop_slots ws
   SET item_id = NULL
 WHERE ws.item_id IN (SELECT id FROM purge_battery_cat);

-- Caixas / passes / roleta (definições e pendentes que só fazem sentido com o item)
DELETE FROM loot_box_items lbi
 WHERE lbi.item_id IN (SELECT id FROM purge_battery_cat);

DELETE FROM season_pass_rewards spr
 WHERE spr.item_id IN (SELECT id FROM purge_battery_cat);

UPDATE wheel_prizes wp
   SET item_id = NULL
 WHERE wp.item_id IN (SELECT id FROM purge_battery_cat);

DELETE FROM wheel_spins wspin
 WHERE wspin.won_item_id IN (SELECT id FROM purge_battery_cat);

DELETE FROM wheel_paid_pending wpp
 WHERE wpp.won_item_id IN (SELECT id FROM purge_battery_cat);

DELETE FROM promo_code_redemptions pcr
 WHERE pcr.won_item_id IN (SELECT id FROM purge_battery_cat);

DELETE FROM admin_upgrade_items aui
 WHERE aui.item_id IN (SELECT id FROM purge_battery_cat);

DELETE FROM upgrade_compat_racks ucr
 WHERE ucr.upgrade_id IN (SELECT id FROM purge_battery_cat);

-- Catálogo: retirar da venda e do jogo activo (mantém id para referências históricas / código)
UPDATE upgrades u
   SET is_active = 0,
       sell_in_hardware_market = 0,
       sell_in_black_market = 0
 WHERE u.id IN (SELECT id FROM purge_battery_cat);
