-- Lucky boxes: audit trail, idempotency cache, optional shop stock limits.

ALTER TABLE loot_boxes
  ADD COLUMN IF NOT EXISTS stock INTEGER NULL,
  ADD COLUMN IF NOT EXISTS max_per_order INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS max_per_user INTEGER NULL;

CREATE TABLE IF NOT EXISTS lucky_box_openings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  box_id TEXT NOT NULL,
  rewards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  gained_usdc DECIMAL(24, 8) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  idempotency_key VARCHAR(128) NULL
);

CREATE INDEX IF NOT EXISTS idx_lucky_box_openings_user_created
  ON lucky_box_openings (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lucky_box_openings_box
  ON lucky_box_openings (box_id);

CREATE TABLE IF NOT EXISTS lucky_box_idempotency (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  http_status INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_lucky_box_idem_created
  ON lucky_box_idempotency (created_at DESC);
