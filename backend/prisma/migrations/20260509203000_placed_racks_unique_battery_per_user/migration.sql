-- Uma instância de bateria (UUID) não pode estar em duas rigs; ids de catálogo legados (ex. battery_diesel)
-- podem repetir-se entre rigs — por isso o índice aplica-se só quando battery_id é UUID v4.
CREATE UNIQUE INDEX IF NOT EXISTS "placed_racks_user_battery_uidx"
ON "placed_racks" ("user_id", "battery_id")
WHERE "battery_id" IS NOT NULL
  AND btrim("battery_id"::text) <> ''
  AND btrim("battery_id"::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
