CREATE TABLE IF NOT EXISTS "p2p_market_buy_idempotency" (
    "buyer_id" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "http_status" INTEGER NOT NULL,
    "body_json" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "p2p_market_buy_idempotency_pkey" PRIMARY KEY ("buyer_id","idempotency_key")
);

CREATE INDEX IF NOT EXISTS "p2p_market_buy_idempotency_created_at_idx" ON "p2p_market_buy_idempotency" ("created_at");
