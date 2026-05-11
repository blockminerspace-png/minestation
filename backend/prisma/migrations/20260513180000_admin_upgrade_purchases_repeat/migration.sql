-- Permite múltiplas compras do mesmo pacote pelo mesmo utilizador.
-- Antes: PRIMARY KEY (user_id, upgrade_id) — uma linha por par.
ALTER TABLE "admin_upgrade_purchases" DROP CONSTRAINT IF EXISTS "admin_upgrade_purchases_pkey";

ALTER TABLE "admin_upgrade_purchases" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE "admin_upgrade_purchases" ADD CONSTRAINT "admin_upgrade_purchases_pkey" PRIMARY KEY ("id");

CREATE INDEX IF NOT EXISTS "admin_upgrade_purchases_user_id_upgrade_id_idx" ON "admin_upgrade_purchases"("user_id", "upgrade_id");
