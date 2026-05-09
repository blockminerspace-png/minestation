-- Leituras por jogador em `stored_batteries` (inventário / game-state).
CREATE INDEX IF NOT EXISTS "stored_batteries_user_id_idx" ON "stored_batteries" ("user_id");
