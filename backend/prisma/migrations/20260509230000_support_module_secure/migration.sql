-- Idempotência na criação de tickets de suporte (evita duplicar em double-submit / retry)

CREATE TABLE IF NOT EXISTS "support_submission_idempotency" (
    "user_id" INTEGER NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'support_submit_ticket',
    "idempotency_key" TEXT NOT NULL,
    "response_json" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "support_submission_idempotency_pkey" PRIMARY KEY ("user_id", "scope", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "support_submission_idempotency_created_idx"
  ON "support_submission_idempotency" ("created_at" DESC);
