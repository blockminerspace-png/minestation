-- Instâncias de bateria: colunas semânticas (sem remover colunas legadas).
ALTER TABLE "stored_batteries" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "stored_batteries" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "stored_batteries" ADD COLUMN IF NOT EXISTS "rack_id" TEXT;
ALTER TABLE "stored_batteries" ADD COLUMN IF NOT EXISTS "slot_id" INTEGER;
ALTER TABLE "stored_batteries" ADD COLUMN IF NOT EXISTS "room_id" TEXT;
ALTER TABLE "stored_batteries" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stored_batteries" ADD COLUMN IF NOT EXISTS "last_moved_at" TIMESTAMPTZ;
ALTER TABLE "stored_batteries" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ DEFAULT now();

-- 1) Equipada em rig (fonte: placed_racks)
UPDATE "stored_batteries" sb
SET
  "status" = 'EQUIPPED',
  "location" = 'RACK',
  "rack_id" = pr."id",
  "slot_id" = COALESCE(pr."slot_index", 0),
  "room_id" = COALESCE(NULLIF(btrim(pr."room_id"::text), ''), 'room_initial'),
  "version" = GREATEST(COALESCE(sb."version", 0), 1),
  "last_moved_at" = COALESCE(sb."last_moved_at", now()),
  "updated_at" = now()
FROM "placed_racks" pr
WHERE pr."battery_id" IS NOT NULL
  AND btrim(pr."battery_id"::text) <> ''
  AND btrim(pr."battery_id"::text) = btrim(sb."id"::text)
  AND pr."user_id" = sb."user_id";

-- 2) Em oficina / carregador (sem montagem simultânea em rig)
UPDATE "stored_batteries" sb
SET
  "status" = 'CHARGING',
  "location" = 'WORKSHOP_CHARGER',
  "version" = GREATEST(COALESCE(sb."version", 0), 1),
  "last_moved_at" = COALESCE(sb."last_moved_at", now()),
  "updated_at" = now()
WHERE sb."workshop_slot_index" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "placed_racks" pr
    WHERE pr."user_id" = sb."user_id"
      AND pr."battery_id" IS NOT NULL
      AND btrim(pr."battery_id"::text) = btrim(sb."id"::text)
  );

-- 3) Armazém (restante sem status)
UPDATE "stored_batteries" sb
SET
  "status" = 'INVENTORY',
  "location" = 'WAREHOUSE',
  "version" = GREATEST(COALESCE(sb."version", 0), 1),
  "updated_at" = now()
WHERE sb."status" IS NULL OR btrim(sb."status") = '';

COMMENT ON COLUMN "stored_batteries"."status" IS 'Semântico: INVENTORY|EQUIPPED|CHARGING|BROKEN|CONSUMED|LOCKED (migração Fase 3).';
COMMENT ON COLUMN "stored_batteries"."location" IS 'Local semântico alinhado a status (ex.: WAREHOUSE, RACK, WORKSHOP_CHARGER).';
