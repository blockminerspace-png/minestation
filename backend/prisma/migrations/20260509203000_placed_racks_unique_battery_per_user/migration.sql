-- Impede a mesma instância de bateria (`battery_id` UUID) de estar montada em mais de uma rig do mesmo utilizador.
-- Ajuda a evitar duplicidade mesmo com pedidos concorrentes (a regra completa continua nos serviços + validação de save).
CREATE UNIQUE INDEX IF NOT EXISTS "placed_racks_user_battery_uidx"
ON "placed_racks" ("user_id", "battery_id")
WHERE "battery_id" IS NOT NULL AND btrim("battery_id"::text) <> '';
