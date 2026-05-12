-- Colapsa instâncias de bateria em armazém (`stored_batteries` com status
-- INVENTORY/WAREHOUSE) em stock de catálogo (`stock.battery_estelar`).
--
-- Resultado para o jogador: a InventoryView mostra "Estelar × N" como item
-- de catálogo na "Depósito de peças" em vez de N cards individuais.
--
-- Idempotente: correr 2x não duplica (a 2ª passagem não encontra instâncias
-- INVENTORY para colapsar). Não toca em baterias EQUIPPED/CHARGING/LOCKED/etc.
-- (apenas para defesa — pós migrações anteriores tudo deveria estar INVENTORY).

-- 1. Conta as instâncias de armazém por utilizador (apenas as "soltas").
WITH agg AS (
  SELECT sb.user_id, COUNT(*)::int AS qty
    FROM stored_batteries sb
   WHERE UPPER(COALESCE(sb.status, 'INVENTORY')) IN ('INVENTORY', '')
     AND UPPER(COALESCE(sb.location, 'WAREHOUSE')) IN ('WAREHOUSE', 'INVENTORY', '')
     AND sb.workshop_slot_index IS NULL
     AND BTRIM(COALESCE(sb.workshop_component_slot_id, '')) = ''
     AND BTRIM(COALESCE(sb.rack_id, '')) = ''
     AND NOT EXISTS (
           SELECT 1 FROM placed_racks pr
            WHERE pr.user_id = sb.user_id
              AND pr.battery_id IS NOT NULL
              AND BTRIM(pr.battery_id::text) <> ''
              AND BTRIM(pr.battery_id::text) = BTRIM(sb.id::text)
         )
   GROUP BY sb.user_id
)
INSERT INTO stock (user_id, item_id, qty)
SELECT a.user_id, 'battery_estelar', a.qty FROM agg a
ON CONFLICT (user_id, item_id) DO UPDATE
  SET qty = stock.qty + EXCLUDED.qty;

-- 2. Remove as instâncias que foram colapsadas (mesmo critério do passo 1).
DELETE FROM stored_batteries sb
 WHERE UPPER(COALESCE(sb.status, 'INVENTORY')) IN ('INVENTORY', '')
   AND UPPER(COALESCE(sb.location, 'WAREHOUSE')) IN ('WAREHOUSE', 'INVENTORY', '')
   AND sb.workshop_slot_index IS NULL
   AND BTRIM(COALESCE(sb.workshop_component_slot_id, '')) = ''
   AND BTRIM(COALESCE(sb.rack_id, '')) = ''
   AND NOT EXISTS (
         SELECT 1 FROM placed_racks pr
          WHERE pr.user_id = sb.user_id
            AND pr.battery_id IS NOT NULL
            AND BTRIM(pr.battery_id::text) <> ''
            AND BTRIM(pr.battery_id::text) = BTRIM(sb.id::text)
       );
