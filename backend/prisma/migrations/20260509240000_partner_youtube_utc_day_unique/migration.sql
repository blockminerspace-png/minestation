-- Limite 1 envio por dia UTC: coluna derivada + índice único (concorrência segura)

ALTER TABLE "partner_youtube_submissions" ADD COLUMN IF NOT EXISTS "submit_utc_day" INTEGER;

UPDATE "partner_youtube_submissions"
SET "submit_utc_day" = CAST(
  TO_CHAR((TIMESTAMP 'epoch' + ("created_at"::BIGINT / 1000) * INTERVAL '1 second') AT TIME ZONE 'UTC', 'YYYYMMDD') AS INTEGER
)
WHERE "submit_utc_day" IS NULL;

ALTER TABLE "partner_youtube_submissions" ALTER COLUMN "submit_utc_day" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "partner_youtube_submissions_user_utcday_uidx"
  ON "partner_youtube_submissions" ("user_id", "submit_utc_day");

CREATE INDEX IF NOT EXISTS "partner_youtube_submissions_video_id_status_idx"
  ON "partner_youtube_submissions" ("youtube_video_id", "status");
