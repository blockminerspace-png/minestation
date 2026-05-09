-- Wheel: config, idempotency, spin history, prize tiers (basic-only roll pool)

CREATE TABLE IF NOT EXISTS "wheel_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "spin_price_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0.10,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "is_enabled" INTEGER NOT NULL DEFAULT 1,
    "min_spin_price_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0.10,
    "max_spins_per_request" INTEGER NOT NULL DEFAULT 1,
    "daily_limit" INTEGER,
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 0,
    "starts_at" BIGINT,
    "ends_at" BIGINT,
    "updated_at" BIGINT NOT NULL,
    "metadata_json" TEXT,
    CONSTRAINT "wheel_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "wheel_config" (
    "id", "spin_price_usdc", "currency", "is_enabled", "min_spin_price_usdc",
    "max_spins_per_request", "daily_limit", "cooldown_seconds", "starts_at", "ends_at", "updated_at", "metadata_json"
)
VALUES (
    1, 0.10, 'USDC', 1, 0.10, 1, NULL, 0, NULL, NULL,
    (FLOOR(EXTRACT(EPOCH FROM NOW()) * 1000))::BIGINT,
    NULL
)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "wheel_prizes" ADD COLUMN IF NOT EXISTS "is_active" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "wheel_prizes" ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'BASIC';

CREATE TABLE IF NOT EXISTS "wheel_spins" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT,
    "won_item_id" TEXT NOT NULL,
    "box_id" TEXT,
    "charged_usdc" DECIMAL(18,6),
    "status" TEXT NOT NULL DEFAULT 'completed',
    "idempotency_key" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "wheel_spins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wheel_spins_user_created_idx" ON "wheel_spins" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "wheel_spins_user_idem_idx" ON "wheel_spins" ("user_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "wheel_spins_user_paid_idem_unique"
  ON "wheel_spins" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL AND "kind" = 'paid';

CREATE TABLE IF NOT EXISTS "wheel_idempotency" (
    "user_id" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "response_json" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "wheel_idempotency_pkey" PRIMARY KEY ("user_id", "scope", "idempotency_key")
);

-- Deactivate legacy / strong wheel segments; new BASIC rows use w2_* ids.
UPDATE "wheel_prizes" SET "is_active" = 0, "tier" = 'LEGACY' WHERE "id" NOT LIKE 'w2\_%' ESCAPE '\';

DELETE FROM "wheel_prizes" WHERE "id" LIKE 'w2\_%' ESCAPE '\';

INSERT INTO "wheel_prizes" ("id", "label", "weight", "color", "item_id", "is_active", "tier")
SELECT
    'w2_' || LPAD(row_number() OVER (ORDER BY u."base_cost" ASC NULLS LAST, u."id")::text, 3, '0'),
    LEFT(u."name", 120),
    (10 + (MOD(ABS(hashtext(u."id"::text)), 9)))::integer,
    '#64748b',
    u."id",
    1,
    'BASIC'
FROM (
    SELECT "id", "name", "base_cost"
    FROM "upgrades"
    WHERE COALESCE("is_active", 1) = 1
    ORDER BY COALESCE("base_cost", 1e12) ASC NULLS LAST, "id" ASC
    LIMIT 8
) AS u;
