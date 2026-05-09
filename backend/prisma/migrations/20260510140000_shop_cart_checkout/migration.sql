CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "shop_carts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "shop_carts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shop_carts_user_id_key" UNIQUE ("user_id")
);

CREATE TABLE IF NOT EXISTS "shop_cart_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "product_id" VARCHAR(200) NOT NULL,
    "qty" INTEGER NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "shop_cart_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shop_cart_lines_cart_id_product_id_key" UNIQUE ("cart_id", "product_id"),
    CONSTRAINT "shop_cart_lines_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "shop_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shop_cart_lines_qty_check" CHECK ("qty" >= 0)
);

CREATE INDEX IF NOT EXISTS "shop_cart_lines_cart_id_idx" ON "shop_cart_lines" ("cart_id");

CREATE TABLE IF NOT EXISTS "shop_checkout_idempotency" (
    "user_id" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "new_usdc" DOUBLE PRECISION NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "lines_json" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "shop_checkout_idempotency_pkey" PRIMARY KEY ("user_id", "idempotency_key")
);
