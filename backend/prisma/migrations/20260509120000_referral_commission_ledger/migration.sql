-- Ledger idempotente para comissão de referral sobre depósitos USDC (5% ao indicador).
CREATE TABLE IF NOT EXISTS referral_commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(240) NOT NULL,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id),
  referred_user_id INTEGER NOT NULL REFERENCES users(id),
  source_type VARCHAR(32) NOT NULL DEFAULT 'deposit',
  base_amount_usdc DOUBLE PRECISION NOT NULL,
  commission_percent DOUBLE PRECISION NOT NULL,
  commission_usdc DOUBLE PRECISION NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT referral_commission_ledger_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_referral_commission_ledger_referrer
  ON referral_commission_ledger(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_commission_ledger_referred
  ON referral_commission_ledger(referred_user_id);
