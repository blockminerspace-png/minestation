-- Idempotência de commits de `computeProgressForUser` (retry / corrida rara).
CREATE TABLE IF NOT EXISTS "mining_progress_commit_ledger" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "mining_progress_commit_ledger_user_key_uidx" UNIQUE ("user_id", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "mining_progress_commit_ledger_user_created_idx"
  ON "mining_progress_commit_ledger" ("user_id", "created_at" DESC);
