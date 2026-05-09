-- One-off: apaga linhas em stored_batteries cujo id aparece como valor em algum
-- workshop_slots.internal_state (JSON object → slot → instance UUID).
-- Corrige fantasmas do bug do carregador (mesma instância no armazém e na oficina).
--
-- Pré-visualização:
-- SELECT sb.user_id, sb.id, sb.item_id
--   FROM stored_batteries sb
--  WHERE EXISTS (
--    SELECT 1 FROM workshop_slots w,
--    LATERAL jsonb_each_text(
--      CASE WHEN NULLIF(BTRIM(w.internal_state::text), '') IS NULL
--           THEN '{}'::jsonb ELSE w.internal_state::jsonb END
--    ) AS kv(k, v)
--   WHERE w.user_id = sb.user_id AND v = sb.id::text
--  ) LIMIT 200;

BEGIN;

DELETE FROM stored_batteries sb
WHERE EXISTS (
  SELECT 1
    FROM workshop_slots w,
  LATERAL jsonb_each_text(
    CASE
      WHEN NULLIF(BTRIM(w.internal_state::text), '') IS NULL THEN '{}'::jsonb
      ELSE w.internal_state::jsonb
    END
  ) AS kv(k, v)
   WHERE w.user_id = sb.user_id
     AND v = sb.id::text
);

COMMIT;
