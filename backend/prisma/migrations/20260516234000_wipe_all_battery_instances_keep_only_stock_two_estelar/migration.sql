-- =====================================================================
-- Migration: 20260516234000_wipe_all_battery_instances_keep_only_stock_two_estelar
--
-- Complementa `20260516230000_reset_all_stock_two_battery_estelar`:
-- aquela migração só limpou `stock`, mas as instâncias UUID em
-- `stored_batteries` e as baterias já equipadas em rigs
-- (`placed_racks.battery_id`) continuaram. Esta migração apaga tudo isso e
-- volta a afirmar o estado canónico final:
--
--   * `placed_racks`: nenhuma rig tem bateria equipada (`battery_id` NULL,
--     metadados de catálogo da bateria limpos, `is_on = 0`).
--   * `stored_batteries`: vazia (todas as instâncias UUID apagadas).
--   * `stock`: exactamente `battery_estelar` qty=2 para CADA `users.id`.
--
-- Não toca em coin_balances, listings, lootbox, etc. (fora de scope.)
-- Bloco DO $$ no fim faz rollback se qualquer invariante falhar.
-- =====================================================================

-- (1) Desequipar todas as baterias de todas as rigs
UPDATE placed_racks
   SET battery_id              = NULL,
       battery_catalog_item_id = NULL,
       battery_display_name    = NULL,
       battery_image_url       = NULL,
       is_on                   = 0
 WHERE battery_id IS NOT NULL
    OR battery_catalog_item_id IS NOT NULL
    OR battery_display_name IS NOT NULL
    OR battery_image_url IS NOT NULL
    OR is_on <> 0;

-- (2) Apagar TODAS as instâncias UUID de baterias
DELETE FROM stored_batteries;

-- (3) Re-afirmar o stock canónico (idempotente com migração anterior)
DELETE FROM stock;

INSERT INTO stock (user_id, item_id, qty)
SELECT u.id, 'battery_estelar', 2
  FROM users u;

-- (4) Verificação estrita
DO $$
DECLARE
  n_orphan_battery   bigint;
  n_stored           bigint;
  n_rigs_on          bigint;
  n_rigs_with_meta   bigint;
  bad_items          bigint;
  bad_qty            bigint;
  n_stock            bigint;
  n_users            bigint;
BEGIN
  SELECT COUNT(*) INTO n_orphan_battery
    FROM placed_racks
   WHERE battery_id IS NOT NULL AND btrim(battery_id::text) <> '';
  IF n_orphan_battery > 0 THEN
    RAISE EXCEPTION '[wipe batteries] % rig(s) ainda com battery_id não nulo', n_orphan_battery;
  END IF;

  SELECT COUNT(*) INTO n_rigs_with_meta
    FROM placed_racks
   WHERE battery_catalog_item_id IS NOT NULL
      OR battery_display_name IS NOT NULL
      OR battery_image_url IS NOT NULL;
  IF n_rigs_with_meta > 0 THEN
    RAISE EXCEPTION '[wipe batteries] % rig(s) ainda com metadados de bateria', n_rigs_with_meta;
  END IF;

  SELECT COUNT(*) INTO n_rigs_on FROM placed_racks WHERE is_on <> 0;
  IF n_rigs_on > 0 THEN
    RAISE EXCEPTION '[wipe batteries] % rig(s) com is_on != 0 (deveriam estar OFF)', n_rigs_on;
  END IF;

  SELECT COUNT(*) INTO n_stored FROM stored_batteries;
  IF n_stored > 0 THEN
    RAISE EXCEPTION '[wipe batteries] stored_batteries ainda tem % linha(s)', n_stored;
  END IF;

  SELECT COUNT(*) INTO bad_items FROM stock WHERE item_id <> 'battery_estelar';
  IF bad_items > 0 THEN
    RAISE EXCEPTION '[stock reset] % linha(s) com item_id diferente de battery_estelar', bad_items;
  END IF;

  SELECT COUNT(*) INTO bad_qty FROM stock WHERE qty <> 2;
  IF bad_qty > 0 THEN
    RAISE EXCEPTION '[stock reset] % linha(s) com qty diferente de 2', bad_qty;
  END IF;

  SELECT COUNT(*) INTO n_stock FROM stock;
  SELECT COUNT(*) INTO n_users FROM users;
  IF n_stock <> n_users THEN
    RAISE EXCEPTION '[stock reset] COUNT(stock)= % ≠ COUNT(users)= %', n_stock, n_users;
  END IF;
END $$;
