-- Idempotência para mutações de intenção na área Servidores (equipar/desequipar aux na rig, etc.).
CREATE TABLE IF NOT EXISTS "game_servers_intent_idempotency" (
  "user_id" INTEGER NOT NULL,
  "scope" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "http_status" INTEGER NOT NULL,
  "response_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "game_servers_intent_idempotency_pkey" PRIMARY KEY ("user_id", "scope", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "game_servers_intent_idempotency_created_at_idx"
  ON "game_servers_intent_idempotency" ("created_at" DESC);
