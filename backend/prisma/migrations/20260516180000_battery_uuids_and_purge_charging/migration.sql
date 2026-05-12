-- =====================================================================
-- Migration: 20260516180000_battery_uuids_and_purge_charging
--
-- 1) Toda bateria passa a ter UUID próprio: explode `stock.battery_estelar`
--    (uma linha de catálogo por utilizador) em N linhas individuais em
--    `stored_batteries`, cada uma com `gen_random_uuid()`.
--
-- 2) Erradica todo o sistema de carregamento que existiu:
--    - tabelas:  workshop_slots, charging_history
--    - colunas:  stored_batteries.current_charge, .power_capacity_wh,
--                .workshop_slot_index, .workshop_component_slot_id
--                placed_racks.current_charge, .battery_power_capacity_wh
--    - daily_actions: chaves daily_boost_*, instant_recharge_*, reward_ad_*
--
-- Ordem é importante: criar instâncias ANTES de zerar o stock.
-- =====================================================================

-- pg_crypto (gen_random_uuid) — idempotente
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

-- ---------------------------------------------------------------------
-- (1) Explode `stock.battery_estelar` em N stored_batteries com UUID.
-- ---------------------------------------------------------------------

WITH expanded AS (
  SELECT s.user_id, gs.n
    FROM stock s
    CROSS JOIN LATERAL generate_series(1, GREATEST(s.qty, 0)) AS gs(n)
   WHERE s.item_id = 'battery_estelar'
     AND s.qty > 0
)
INSERT INTO stored_batteries (
  id, user_id, item_id,
  current_charge, power_capacity_wh,
  display_name, image_url,
  workshop_slot_index, workshop_component_slot_id,
  status, location, rack_id, slot_id, room_id,
  version, last_moved_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  e.user_id,
  'battery_estelar',
  -1, -1,
  'Estelar', NULL,
  NULL, NULL,
  'INVENTORY', 'WAREHOUSE', NULL, NULL, NULL,
  0, NOW(), NOW()
FROM expanded e;

-- Stock catálogo desta bateria fica a 0 (instâncias ficam todas em stored_batteries).
UPDATE stock SET qty = 0 WHERE item_id = 'battery_estelar';

-- Limpa quaisquer entradas residuais com qty <= 0 para o id desta bateria
DELETE FROM stock WHERE item_id = 'battery_estelar' AND qty <= 0;

-- ---------------------------------------------------------------------
-- (2) Limpa daily_actions do antigo sistema de carregamento.
-- ---------------------------------------------------------------------

DELETE FROM daily_actions
 WHERE action_key LIKE 'daily_boost_slot_%'
    OR action_key LIKE 'instant_recharge_slot_%'
    OR action_key LIKE 'reward_ad_slot_%';

-- ---------------------------------------------------------------------
-- (3) Drop tabelas de carregamento.
-- ---------------------------------------------------------------------

DROP TABLE IF EXISTS workshop_slots;
DROP TABLE IF EXISTS charging_history;

-- ---------------------------------------------------------------------
-- (4) Drop colunas que sustentavam o carregamento.
--     Antes de dropar `current_charge` em placed_racks: garantir que
--     não há rigs ainda a apontar para baterias (já tratado nas
--     migrations 20260516140000 / 20260516160000, mas reforçamos).
-- ---------------------------------------------------------------------

UPDATE placed_racks
   SET battery_id = NULL,
       battery_catalog_item_id = NULL,
       battery_power_capacity_wh = NULL,
       battery_display_name = NULL,
       battery_image_url = NULL,
       current_charge = 0
 WHERE battery_id IS NOT NULL;

ALTER TABLE stored_batteries
  DROP COLUMN IF EXISTS current_charge,
  DROP COLUMN IF EXISTS power_capacity_wh,
  DROP COLUMN IF EXISTS workshop_slot_index,
  DROP COLUMN IF EXISTS workshop_component_slot_id;

ALTER TABLE placed_racks
  DROP COLUMN IF EXISTS current_charge,
  DROP COLUMN IF EXISTS battery_power_capacity_wh;

COMMIT;
