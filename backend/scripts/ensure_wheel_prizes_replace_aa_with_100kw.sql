-- Idempotente: tira "Pack de Pilhas AA" (battery_aa) da roleta e ativa "100 kW"
-- (battery_diesel) no lugar, preservando o peso, a cor e o tier do prémio original.
-- Caixas antigas (loot_boxes.trigger='roleta_reward' description='reward_for_battery_aa')
-- não são apagadas: utilizadores que já ganharam essa caixa continuam a poder abri-la.
-- Apenas garantimos que a *roleta* nunca mais sorteia battery_aa.
--
-- Executar: docker exec -i postgres_app psql -U postgres -d minestation -v ON_ERROR_STOP=1 -f - < ensure_wheel_prizes_replace_aa_with_100kw.sql

BEGIN;

-- Pré-requisito: o item 100 kW (id=battery_diesel) tem de existir no catálogo.
-- Se faltar, abortamos (nada feito) para o admin investigar — não criamos catálogo aqui.
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM upgrades WHERE id = 'battery_diesel';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Catálogo sem upgrade id=battery_diesel (100 kW). Adicione no admin antes de aplicar.';
  END IF;
END $$;

-- 1) Existe prémio 100 kW activo a apontar para battery_diesel? Se sim, é alvo final.
-- 2) Caso contrário, transformamos o prémio actual de "Pack de Pilhas AA" no novo (sem
--    criar linha duplicada, preservando o id) — assim mantemos peso/cor/tier originais.
-- 3) Em qualquer caso, desactivamos todos os prémios que ainda apontem para battery_aa.

WITH existing_100 AS (
  SELECT id FROM wheel_prizes
   WHERE item_id = 'battery_diesel'
     AND COALESCE(is_active, 1) = 1
   LIMIT 1
),
aa_prize AS (
  SELECT id, weight, color, tier
    FROM wheel_prizes
   WHERE item_id = 'battery_aa'
   ORDER BY COALESCE(is_active, 1) DESC, id ASC
   LIMIT 1
),
upd_existing AS (
  -- Se já existe prémio activo "100 kW", herda peso do AA se faltar (defensivo).
  UPDATE wheel_prizes wp
     SET label = '100 kW',
         is_active = 1,
         tier = COALESCE(wp.tier, 'BASIC'),
         weight = GREATEST(wp.weight, COALESCE((SELECT weight FROM aa_prize), 1))
   WHERE wp.id IN (SELECT id FROM existing_100)
  RETURNING wp.id
),
upd_aa AS (
  -- Se NÃO existe prémio 100 kW: converter o AA -> 100 kW no mesmo registo
  UPDATE wheel_prizes wp
     SET item_id = 'battery_diesel',
         label = '100 kW',
         is_active = 1,
         tier = COALESCE(wp.tier, 'BASIC')
   WHERE wp.id IN (SELECT id FROM aa_prize)
     AND NOT EXISTS (SELECT 1 FROM existing_100)
  RETURNING wp.id
)
SELECT 'ok' AS status;

-- Desactiva qualquer prémio remanescente que ainda aponte para battery_aa
-- (evita aparecer no sorteio elegível e na UI pública).
UPDATE wheel_prizes
   SET is_active = 0,
       tier = 'LEGACY'
 WHERE item_id = 'battery_aa'
   AND COALESCE(is_active, 1) = 1;

-- Repara caixas de recompensa antigas para battery_diesel (idempotente):
-- garante uma linha válida em `loot_box_items` apontando para o upgrade — replica
-- a função `ensureRoletaRewardBoxItem` do roletaModel para os utilizadores que
-- ganhem a primeira vez 100 kW sem precisar de outro giro.
-- (loot_box_items.id é SERIAL: deixamos o default a actuar via DEFAULT explícito.)
WITH box AS (
  SELECT id FROM loot_boxes
   WHERE trigger = 'roleta_reward'
     AND description = 'reward_for_battery_diesel'
   LIMIT 1
)
INSERT INTO loot_box_items (box_id, item_type, item_id, min_qty, max_qty, probability)
SELECT box.id, 'item', 'battery_diesel', 1, 1, 100
  FROM box
 WHERE NOT EXISTS (
   SELECT 1 FROM loot_box_items lbi
    WHERE lbi.box_id = box.id
      AND lbi.item_id = 'battery_diesel'
      AND lbi.item_type = 'item'
 );

COMMIT;

-- Inspecção pós-aplicação
SELECT id, label, weight, is_active, tier, item_id
  FROM wheel_prizes
 ORDER BY is_active DESC, id ASC;
