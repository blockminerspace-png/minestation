-- =====================================================================
-- Migration: 20260516240000_battery_only_cleanup_two_estelar_per_user
--
-- Correctiva — substitui o efeito incorrecto de
-- `20260516230000_reset_all_stock_two_battery_estelar` e
-- `20260516234000_wipe_all_battery_instances_keep_only_stock_two_estelar`,
-- que apagaram TODO o `stock` (incluindo máquinas, racks, multiplicadores
-- e cabeamentos). Não restauramos o que se perdeu nas duas migrações
-- anteriores: aqui só garantimos o estado canónico desejado **APENAS para
-- baterias**, mantendo intactas todas as outras categorias.
--
-- Estado final garantido:
--   * `stock`: NENHUMA bateria além de `battery_estelar` qty=2 por user.
--     (Máquinas, racks, fiações, multiplicadores, AI chips e geradores
--     ficam tal como estão.)
--   * `stored_batteries`: vazia (qualquer instância UUID que tenha
--     reaparecido é removida).
--   * `placed_racks`: nenhuma rig com bateria equipada nem metadados
--     residuais; `is_on=0`.
--
-- Bloco DO $$ no fim aborta a migração se algum invariante falhar.
-- =====================================================================

-- (1) Remover do stock APENAS itens de catálogo do tipo 'battery' (case-insensitive)
DELETE FROM stock
 WHERE item_id IN (SELECT id FROM upgrades WHERE LOWER(type) = 'battery');

-- (1b) Limpa também legacy ids conhecidos (caso o catálogo já não os tenha)
DELETE FROM stock
 WHERE item_id IN ('small_battery', 'battery_protostar', 'battery_stellar');

-- (2) Garantir stored_batteries vazia
DELETE FROM stored_batteries;

-- (3) Desequipar baterias / desligar rigs (defensivo, idempotente)
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

-- (4) Inserir/repor 2 battery_estelar por user (idempotente)
INSERT INTO stock (user_id, item_id, qty)
SELECT u.id, 'battery_estelar', 2
  FROM users u
    ON CONFLICT (user_id, item_id) DO UPDATE SET qty = 2;

-- (5) Verificação estrita
DO $$
DECLARE
  v_other_batteries  bigint;
  v_estelar_users    bigint;
  v_users            bigint;
  v_bad_qty          bigint;
  v_stored           bigint;
  v_orphan_battery   bigint;
  v_rigs_meta        bigint;
  v_rigs_on          bigint;
BEGIN
  SELECT COUNT(*)
    INTO v_other_batteries
    FROM stock s
    JOIN upgrades u ON u.id = s.item_id
   WHERE LOWER(u.type) = 'battery'
     AND s.item_id <> 'battery_estelar';
  IF v_other_batteries > 0 THEN
    RAISE EXCEPTION '[battery cleanup] ainda existem % linha(s) de stock para baterias != battery_estelar', v_other_batteries;
  END IF;

  SELECT COUNT(*) INTO v_estelar_users FROM stock WHERE item_id = 'battery_estelar';
  SELECT COUNT(*) INTO v_users FROM users;
  IF v_estelar_users <> v_users THEN
    RAISE EXCEPTION '[battery cleanup] battery_estelar em % user(s) ≠ COUNT(users)= %', v_estelar_users, v_users;
  END IF;

  SELECT COUNT(*) INTO v_bad_qty FROM stock WHERE item_id = 'battery_estelar' AND qty <> 2;
  IF v_bad_qty > 0 THEN
    RAISE EXCEPTION '[battery cleanup] % linha(s) de battery_estelar com qty <> 2', v_bad_qty;
  END IF;

  SELECT COUNT(*) INTO v_stored FROM stored_batteries;
  IF v_stored > 0 THEN
    RAISE EXCEPTION '[battery cleanup] stored_batteries ainda tem % linha(s)', v_stored;
  END IF;

  SELECT COUNT(*) INTO v_orphan_battery FROM placed_racks
   WHERE battery_id IS NOT NULL AND btrim(battery_id::text) <> '';
  IF v_orphan_battery > 0 THEN
    RAISE EXCEPTION '[battery cleanup] % rig(s) ainda com battery_id', v_orphan_battery;
  END IF;

  SELECT COUNT(*) INTO v_rigs_meta FROM placed_racks
   WHERE battery_catalog_item_id IS NOT NULL
      OR battery_display_name IS NOT NULL
      OR battery_image_url IS NOT NULL;
  IF v_rigs_meta > 0 THEN
    RAISE EXCEPTION '[battery cleanup] % rig(s) ainda com metadados de bateria', v_rigs_meta;
  END IF;

  SELECT COUNT(*) INTO v_rigs_on FROM placed_racks WHERE is_on <> 0;
  IF v_rigs_on > 0 THEN
    RAISE EXCEPTION '[battery cleanup] % rig(s) com is_on != 0', v_rigs_on;
  END IF;
END $$;
