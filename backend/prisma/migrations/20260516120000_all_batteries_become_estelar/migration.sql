-- Sistema de baterias passa a ser infinito por design e tudo converge para um único
-- catálogo canónico: `battery_estelar` (power_capacity = -1).
--
-- Esta migração é idempotente:
--   * Garante que `battery_estelar` existe em `upgrades` com `power_capacity = -1`.
--   * Agrega o stock de qualquer outra bateria do catálogo em `battery_estelar`.
--   * Reescreve toda instância em `stored_batteries` para `battery_estelar` infinita.
--   * Reescreve a cópia em snapshot em `placed_racks` para `battery_estelar` infinita.
--   * Liberta baterias presas na oficina (workshop linkage limpo).
--   * Re-sincroniza status/location/rack_id de instâncias que continuam montadas em rigs.
--   * Limpa o estado interno dos `workshop_slots` (oficina foi removida da UI; cron é no-op).
--
-- A coluna `placed_racks.battery_id` NÃO é alterada (mantém o UUID da instância ou o id
-- de catálogo legado). O snapshot em `battery_catalog_item_id = 'battery_estelar'` faz com
-- que `resolvePlacedRackBatteryCatalogId` resolva sempre para Estelar.
--
-- A migração corre dentro da transacção implícita que o `prisma migrate deploy` cria;
-- por isso não há `BEGIN/COMMIT` explícito (tudo ou nada por design do Prisma).

-- 0. Garante a existência da bateria canónica no catálogo.
INSERT INTO upgrades (
  id, name, category, type, base_cost, base_production,
  power_consumption, power_capacity, multiplier,
  description, icon, status, is_nft,
  sell_in_hardware_market, sell_in_black_market, is_active
)
VALUES (
  'battery_estelar',
  'Estelar',
  'ENERGIA & CABEAMENTO',
  'battery',
  50,
  0,
  0,
  -1,
  0,
  'Bateria estelar — protoestrela aprisionada que fornece energia infinita à rig sem necessidade de recarga.',
  'battery',
  'available',
  0,
  1,
  1,
  1
)
ON CONFLICT (id) DO UPDATE
  -- Preserva campos curados (nome, imagem, descrição, custo, etc.) se já existir;
  -- só força os invariantes do sistema infinito.
  SET power_capacity = -1,
      type = 'battery',
      is_active = COALESCE(upgrades.is_active, 1);

-- 1. Lista de ids de bateria do catálogo que NÃO são a canónica (alvos de migração).
CREATE TEMP TABLE _legacy_battery_ids ON COMMIT DROP AS
SELECT u.id::text AS id
  FROM upgrades u
 WHERE (lower(COALESCE(u.type, '')) = 'battery' OR lower(COALESCE(u.category, '')) = 'battery')
   AND u.id <> 'battery_estelar';

-- 2. Stock por utilizador: agrega qty de baterias legacy em `battery_estelar` e remove as legacy.
WITH agg AS (
  SELECT s.user_id, COALESCE(SUM(s.qty), 0)::int AS total_qty
    FROM stock s
   WHERE s.item_id IN (SELECT id FROM _legacy_battery_ids)
   GROUP BY s.user_id
   HAVING COALESCE(SUM(s.qty), 0) > 0
)
INSERT INTO stock (user_id, item_id, qty)
SELECT a.user_id, 'battery_estelar', a.total_qty FROM agg a
ON CONFLICT (user_id, item_id) DO UPDATE
  SET qty = stock.qty + EXCLUDED.qty;

DELETE FROM stock
 WHERE item_id IN (SELECT id FROM _legacy_battery_ids);

-- 3. Limpa carrinho de checkout (linhas de produtos legacy podem violar invariantes).
DELETE FROM shop_cart_lines
 WHERE product_id IN (SELECT id FROM _legacy_battery_ids);

-- 4. Limpa listings P2P pendentes de baterias legacy (não há paridade de catálogo).
DELETE FROM player_listings
 WHERE item_id IN (SELECT id FROM _legacy_battery_ids);

-- 5. Tabelas auxiliares: nada a fazer em loot boxes / passes / wheel se nenhuma config
--    de admin ainda referencia ids legacy. As consultas abaixo só apagam quando aplicável.
DELETE FROM loot_box_items
 WHERE item_id IN (SELECT id FROM _legacy_battery_ids);

DELETE FROM season_pass_rewards
 WHERE item_id IN (SELECT id FROM _legacy_battery_ids);

DELETE FROM admin_upgrade_items
 WHERE item_id IN (SELECT id FROM _legacy_battery_ids);

UPDATE wheel_prizes
   SET item_id = NULL
 WHERE item_id IN (SELECT id FROM _legacy_battery_ids);

DELETE FROM wheel_spins
 WHERE won_item_id IN (SELECT id FROM _legacy_battery_ids);

DELETE FROM wheel_paid_pending
 WHERE won_item_id IN (SELECT id FROM _legacy_battery_ids);

UPDATE promo_code_redemptions
   SET won_item_id = NULL
 WHERE won_item_id IN (SELECT id FROM _legacy_battery_ids);

-- 6. Instâncias de bateria no armazém / equipadas: tudo vira Estelar infinita e fica
--    momentaneamente em INVENTORY/WAREHOUSE (re-sincronizamos rack EQUIPPED no passo 8).
UPDATE stored_batteries
   SET item_id = 'battery_estelar',
       current_charge = -1,
       power_capacity_wh = -1,
       display_name = 'Estelar',
       image_url = NULL,
       workshop_slot_index = NULL,
       workshop_component_slot_id = NULL,
       status = 'INVENTORY',
       location = 'WAREHOUSE',
       rack_id = NULL,
       slot_id = NULL,
       room_id = NULL,
       last_moved_at = NOW(),
       updated_at = NOW();

-- 7. placed_racks: força snapshot canónico para qualquer rig com bateria.
UPDATE placed_racks
   SET battery_catalog_item_id = 'battery_estelar',
       battery_power_capacity_wh = -1,
       battery_display_name = 'Estelar',
       battery_image_url = NULL,
       current_charge = -1
 WHERE battery_id IS NOT NULL
   AND btrim(battery_id::text) <> '';

-- 8. Re-sincroniza status/location/rack_id em stored_batteries para instâncias que continuam
--    montadas numa rig (`placed_racks.battery_id` é UUID e existe em stored_batteries).
UPDATE stored_batteries sb
   SET status = 'EQUIPPED',
       location = 'RACK',
       rack_id = pr.id,
       last_moved_at = NOW(),
       updated_at = NOW()
  FROM placed_racks pr
 WHERE pr.user_id = sb.user_id
   AND pr.battery_id IS NOT NULL
   AND btrim(pr.battery_id::text) <> ''
   AND btrim(pr.battery_id::text) = btrim(sb.id::text)
   AND pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- 9. workshop_slots: limpa estado interno (oficina foi removida da UI; cron é no-op).
--    Mantém `item_id` (carregador continua "instalado" no slot, sem efeito visível).
UPDATE workshop_slots
   SET internal_state = '{}',
       slot_item_ids = '{}',
       slot_charges = '{}',
       current_charge = 0;

-- 10. Limpa histórico de carregamento que referencie ids legacy (opcional; mantém auditoria coerente).
DELETE FROM charging_history
 WHERE battery_item_id IN (SELECT id FROM _legacy_battery_ids);

-- 11. Limpa movimentações de inventário de baterias legacy (mantém histórico só de Estelar).
DELETE FROM inventory_movements
 WHERE catalog_item_id IN (SELECT id FROM _legacy_battery_ids);

-- 12. Desativa baterias legacy no catálogo: não aparecem mais nas lojas / na admin UI
--     (o id é mantido para integridade referencial de logs históricos).
UPDATE upgrades
   SET is_active = 0,
       sell_in_hardware_market = 0,
       sell_in_black_market = 0
 WHERE id IN (SELECT id FROM _legacy_battery_ids);
