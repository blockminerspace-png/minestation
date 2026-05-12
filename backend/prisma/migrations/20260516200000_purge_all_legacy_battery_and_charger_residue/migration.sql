-- =====================================================================
-- Migration: 20260516200000_purge_all_legacy_battery_and_charger_residue
--
-- Erradica do banco TODAS as referências aos itens descontinuados:
--   * Baterias legadas: battery_aa, battery_car, battery_diesel,
--     battery_fusion, battery_nebula, battery_protostar, battery_ups,
--     battery_wall, nebula, small_battery, supernova
--     (canónica única `battery_estelar` permanece intocada)
--   * Carregadores: charger_a1, charger_a2 (sistema removido em
--     20260516180000_battery_uuids_and_purge_charging — mas o stock
--     dos jogadores e configs admin não tinham sido limpos).
--
-- Também:
--   * Sincroniza status/location de instâncias EQUIPPED (alinha com
--     placed_racks.battery_id) — corrige incoerência observada após
--     o explode UUID.
--   * Re-aplica is_active=1 em battery_estelar para garantir que o
--     único catálogo válido continua exposto na loja.
--
-- Idempotente: correr 2x não causa diferença (apenas no-ops).
-- Tabelas de histórico (inventory_movements, p2p_market_trade_history)
-- são PRESERVADAS para auditoria.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- (0) Lista canónica de IDs lixo a expurgar.
-- ---------------------------------------------------------------------

CREATE TEMP TABLE _purge_ids (id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_ids (id) VALUES
  ('charger_a1'),
  ('charger_a2'),
  ('battery_aa'),
  ('battery_car'),
  ('battery_diesel'),
  ('battery_fusion'),
  ('battery_nebula'),
  ('battery_protostar'),
  ('battery_ups'),
  ('battery_wall'),
  ('nebula'),
  ('small_battery'),
  ('supernova')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- (1) Estoque dos jogadores: apaga linhas de IDs lixo (sem refund —
--     sistema de carregamento foi descontinuado e baterias legadas
--     já foram convertidas em battery_estelar pela migration
--     20260516120000).
-- ---------------------------------------------------------------------

DELETE FROM stock
 WHERE item_id IN (SELECT id FROM _purge_ids);

-- Por garantia: linhas com qty <= 0 que estejam suspensas no Estoque
-- canónico não devem permanecer (semântica: "não tens stock").
DELETE FROM stock WHERE qty <= 0;

-- ---------------------------------------------------------------------
-- (2) Mercado P2P: cancela listings ativos de itens lixo.
--     Não há refund — sistema legado, listings perdem validade.
-- ---------------------------------------------------------------------

DELETE FROM player_listings
 WHERE item_id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (3) Carrinhos de checkout: remove linhas com produtos lixo.
-- ---------------------------------------------------------------------

DELETE FROM shop_cart_lines
 WHERE product_id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (4) Loot boxes: remove prêmios apontando para itens lixo.
-- ---------------------------------------------------------------------

DELETE FROM loot_box_items
 WHERE item_id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (5) Season pass: remove rewards apontando para itens lixo.
-- ---------------------------------------------------------------------

DELETE FROM season_pass_rewards
 WHERE item_id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (6) Wheel: limpa configs e spins pendentes.
-- ---------------------------------------------------------------------

UPDATE wheel_prizes
   SET item_id = NULL
 WHERE item_id IN (SELECT id FROM _purge_ids);

DELETE FROM wheel_spins
 WHERE won_item_id IN (SELECT id FROM _purge_ids);

DELETE FROM wheel_paid_pending
 WHERE won_item_id IN (SELECT id FROM _purge_ids);

UPDATE promo_code_redemptions
   SET won_item_id = NULL
 WHERE won_item_id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (7) Admin upgrade configs: remove referências a itens lixo.
--     admin_upgrade_items (item_id), admin_upgrade_boxes/coins/
--     passes/purchases/visibility (upgrade_id).
-- ---------------------------------------------------------------------

DELETE FROM admin_upgrade_items
 WHERE item_id IN (SELECT id FROM _purge_ids)
    OR upgrade_id IN (SELECT id FROM _purge_ids);

DELETE FROM admin_upgrade_boxes
 WHERE upgrade_id IN (SELECT id FROM _purge_ids);

DELETE FROM admin_upgrade_coins
 WHERE upgrade_id IN (SELECT id FROM _purge_ids);

DELETE FROM admin_upgrade_passes
 WHERE upgrade_id IN (SELECT id FROM _purge_ids);

DELETE FROM admin_upgrade_purchases
 WHERE upgrade_id IN (SELECT id FROM _purge_ids);

DELETE FROM admin_upgrade_visibility
 WHERE upgrade_id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (8) Promo codes: anula referência a upgrade lixo (mantém o código
--     ativo se for de outro tipo).
-- ---------------------------------------------------------------------

UPDATE promo_codes
   SET upgrade_id = NULL
 WHERE upgrade_id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (9) FK formal: upgrade_compat_racks → upgrades (cascade manual).
-- ---------------------------------------------------------------------

DELETE FROM upgrade_compat_racks
 WHERE upgrade_id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (10) Catálogo: deleta os 13 IDs lixo de upgrades.
--      A esta altura todas as FKs/refs foram limpas.
-- ---------------------------------------------------------------------

DELETE FROM upgrades
 WHERE id IN (SELECT id FROM _purge_ids);

-- ---------------------------------------------------------------------
-- (11) Garante que battery_estelar continua canónico e ativo.
--      (Defensivo: se alguma migration anterior tiver desativado,
--      re-ativa.)
-- ---------------------------------------------------------------------

UPDATE upgrades
   SET is_active = 1,
       sell_in_hardware_market = 1,
       sell_in_black_market = 1,
       type = 'battery',
       power_capacity = -1
 WHERE id = 'battery_estelar';

-- ---------------------------------------------------------------------
-- (12) Limpa placed_racks com battery_id apontando para UUIDs órfãos.
--      Bug observado pós-explode UUID: 92 rigs ainda têm battery_id =
--      UUID antigo (do cache do cliente) que NÃO existe mais em
--      stored_batteries. Com ORPHAN_RACK_BATTERY_AUTO_RECOVER=0 essas
--      rigs ficam com snapshot fantasma. Ação: anular battery_id e
--      snapshot, deixando is_on=0 (jogador re-equipa do inventário).
-- ---------------------------------------------------------------------

UPDATE placed_racks pr
   SET battery_id = NULL,
       battery_catalog_item_id = NULL,
       battery_display_name = NULL,
       battery_image_url = NULL,
       is_on = 0
 WHERE pr.battery_id IS NOT NULL
   AND BTRIM(pr.battery_id::text) <> ''
   AND NOT EXISTS (
         SELECT 1 FROM stored_batteries sb
          WHERE sb.id = pr.battery_id::text
            AND sb.user_id = pr.user_id
       );

-- ---------------------------------------------------------------------
-- (13) Sincroniza status das instâncias EQUIPPED com placed_racks.
--      Para racks que (pós-passo 12) ainda têm bateria existente,
--      garante que stored_batteries.status='EQUIPPED' e rack_id=pr.id.
-- ---------------------------------------------------------------------

UPDATE stored_batteries sb
   SET status = 'EQUIPPED',
       location = 'RACK',
       rack_id = pr.id,
       slot_id = NULL,
       room_id = COALESCE(NULLIF(BTRIM(pr.room_id::text), ''), 'room_initial'),
       updated_at = NOW()
  FROM placed_racks pr
 WHERE pr.user_id = sb.user_id
   AND pr.battery_id IS NOT NULL
   AND BTRIM(pr.battery_id::text) <> ''
   AND BTRIM(pr.battery_id::text) = BTRIM(sb.id::text)
   AND pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   AND COALESCE(sb.status, '') <> 'EQUIPPED';

-- ---------------------------------------------------------------------
-- (14) Sanity: stored_batteries que se dizem EQUIPPED mas não têm
--      placed_racks correspondente → voltam a INVENTORY/WAREHOUSE.
-- ---------------------------------------------------------------------

UPDATE stored_batteries sb
   SET status = 'INVENTORY',
       location = 'WAREHOUSE',
       rack_id = NULL,
       slot_id = NULL,
       room_id = NULL,
       updated_at = NOW()
 WHERE COALESCE(sb.status, '') = 'EQUIPPED'
   AND NOT EXISTS (
         SELECT 1 FROM placed_racks pr
          WHERE pr.user_id = sb.user_id
            AND pr.battery_id IS NOT NULL
            AND BTRIM(pr.battery_id::text) = BTRIM(sb.id::text)
       );

COMMIT;
