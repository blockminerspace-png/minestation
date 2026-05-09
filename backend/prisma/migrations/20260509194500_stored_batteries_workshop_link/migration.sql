-- Ligação provisória armazém ↔ oficina: mantém linha em `stored_batteries` enquanto a bateria
-- está num carregador (evita apagar no save "servers-only" e desincronizar carga).

ALTER TABLE "stored_batteries"
  ADD COLUMN IF NOT EXISTS "workshop_slot_index" INTEGER NULL,
  ADD COLUMN IF NOT EXISTS "workshop_component_slot_id" TEXT NULL;

CREATE INDEX IF NOT EXISTS "idx_stored_batteries_user_workshop"
  ON "stored_batteries" ("user_id")
  WHERE "workshop_slot_index" IS NOT NULL;

COMMENT ON COLUMN "stored_batteries"."workshop_slot_index" IS 'Provisório: índice 0–5 da bancada workshop_slots; NULL = não está na oficina.';
COMMENT ON COLUMN "stored_batteries"."workshop_component_slot_id" IS 'Provisório: chave do slot no internal_state (ex. battery_0).';
