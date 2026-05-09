-- Perfil seguro: desafios de assinatura para carteira Polygon e auditoria de ações do perfil.

CREATE TABLE IF NOT EXISTS profile_wallet_connect_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE INDEX IF NOT EXISTS profile_wallet_challenges_user_idx
  ON profile_wallet_connect_challenges (user_id);

CREATE INDEX IF NOT EXISTS profile_wallet_challenges_expires_idx
  ON profile_wallet_connect_challenges (expires_at);

CREATE TABLE IF NOT EXISTS profile_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  route VARCHAR(200),
  request_id VARCHAR(64),
  meta TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS profile_audit_user_created_idx
  ON profile_audit_log (user_id, created_at DESC);
