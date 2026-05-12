-- Desmonta TODAS as baterias atualmente em rigs (`placed_racks.battery_id IS NOT NULL`)
-- e devolve cada uma como instância em `stored_batteries` com semântica
-- `status='INVENTORY' / location='WAREHOUSE'`. As rigs ficam sem bateria
-- (`battery_id = NULL`, snapshot zerado, `is_on = 0`).
--
-- Depois desta migração, a InventoryView mostra cada bateria devolvida como
-- uma instância "Estelar" infinita no armazém do utilizador.
--
-- 3 casos cobertos (idempotente; correr 2x não duplica):
--   (1) `battery_id` é UUID e existe em `stored_batteries` (caso comum pós-`20260516120000`).
--   (2) `battery_id` é UUID mas NÃO existe em `stored_batteries` (rig com snapshot legado órfão).
--   (3) `battery_id` é id de catálogo legacy (não-UUID) — gera nova UUID.

-- Passo 1: atualiza instâncias existentes para INVENTORY/WAREHOUSE (Estelar infinita).
UPDATE stored_batteries sb
   SET status = 'INVENTORY',
       location = 'WAREHOUSE',
       rack_id = NULL,
       slot_id = NULL,
       room_id = NULL,
       workshop_slot_index = NULL,
       workshop_component_slot_id = NULL,
       item_id = 'battery_estelar',
       current_charge = -1,
       power_capacity_wh = -1,
       display_name = 'Estelar',
       image_url = NULL,
       version = COALESCE(sb.version, 0) + 1,
       last_moved_at = NOW(),
       updated_at = NOW()
  FROM placed_racks pr
 WHERE pr.battery_id IS NOT NULL
   AND BTRIM(pr.battery_id::text) <> ''
   AND pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   AND BTRIM(pr.battery_id::text) = BTRIM(sb.id::text)
   AND pr.user_id = sb.user_id;

-- Passo 2: cria instância no armazém para UUIDs órfãos (em rig mas sem stored_batteries).
INSERT INTO stored_batteries (
  id, user_id, item_id, current_charge, power_capacity_wh,
  display_name, image_url,
  workshop_slot_index, workshop_component_slot_id,
  status, location, rack_id, slot_id, room_id,
  version, last_moved_at, updated_at
)
SELECT
  pr.battery_id::text,
  pr.user_id,
  'battery_estelar',
  -1,
  -1,
  'Estelar',
  NULL,
  NULL, NULL,
  'INVENTORY', 'WAREHOUSE', NULL, NULL, NULL,
  0, NOW(), NOW()
  FROM placed_racks pr
 WHERE pr.battery_id IS NOT NULL
   AND BTRIM(pr.battery_id::text) <> ''
   AND pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   AND NOT EXISTS (
         SELECT 1 FROM stored_batteries sb
          WHERE BTRIM(sb.id::text) = BTRIM(pr.battery_id::text)
            AND sb.user_id = pr.user_id
       )
ON CONFLICT (id) DO NOTHING;

-- Passo 3: para `battery_id` legacy (id de catálogo, não-UUID), cria nova UUID em
-- `stored_batteries` por linha de placed_racks.
INSERT INTO stored_batteries (
  id, user_id, item_id, current_charge, power_capacity_wh,
  display_name, image_url,
  workshop_slot_index, workshop_component_slot_id,
  status, location, rack_id, slot_id, room_id,
  version, last_moved_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  pr.user_id,
  'battery_estelar',
  -1,
  -1,
  'Estelar',
  NULL,
  NULL, NULL,
  'INVENTORY', 'WAREHOUSE', NULL, NULL, NULL,
  0, NOW(), NOW()
  FROM placed_racks pr
 WHERE pr.battery_id IS NOT NULL
   AND BTRIM(pr.battery_id::text) <> ''
   AND NOT (
     pr.battery_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   );

-- Passo 4: limpa snapshot em placed_racks (rig fica sem bateria).
UPDATE placed_racks
   SET battery_id = NULL,
       current_charge = 0,
       is_on = 0,
       battery_catalog_item_id = NULL,
       battery_power_capacity_wh = NULL,
       battery_display_name = NULL,
       battery_image_url = NULL
 WHERE battery_id IS NOT NULL;
