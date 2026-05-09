-- Pacotes admin (loja Upgrades): metadados, stock, janela, versão e idempotência de compra

ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'PROMO_PACK';
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "original_price_usdc" DECIMAL(18, 6);
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "stock_remaining" INTEGER;
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "max_per_user" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "starts_at" BIGINT;
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "ends_at" BIGINT;
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admin_upgrades" ADD COLUMN IF NOT EXISTS "image_url" TEXT;

CREATE TABLE IF NOT EXISTS "upgrade_purchase_idempotency" (
    "user_id" INTEGER NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'upgrade_purchase',
    "idempotency_key" TEXT NOT NULL,
    "response_json" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "upgrade_purchase_idempotency_pkey" PRIMARY KEY ("user_id", "scope", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "upgrade_purchase_idempotency_created_idx"
  ON "upgrade_purchase_idempotency" ("created_at" DESC);
