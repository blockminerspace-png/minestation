-- Wallet module: idempotency + append-only ledger for desk / future wallet ops

CREATE TABLE IF NOT EXISTS "wallet_idempotency" (
    "user_id" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "response_json" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "wallet_idempotency_pkey" PRIMARY KEY ("user_id", "scope", "idempotency_key")
);

CREATE TABLE IF NOT EXISTS "wallet_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "entry_type" TEXT NOT NULL,
    "coin_id" TEXT,
    "sold_crypto" DECIMAL(38, 18) NOT NULL,
    "gross_usdc" DECIMAL(38, 18) NOT NULL,
    "fee_usdc" DECIMAL(38, 18) NOT NULL,
    "net_usdc" DECIMAL(38, 18) NOT NULL,
    "idempotency_key" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_user_created_idx"
  ON "wallet_ledger_entries" ("user_id", "created_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_ledger_entries_user_idem_unique"
  ON "wallet_ledger_entries" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
