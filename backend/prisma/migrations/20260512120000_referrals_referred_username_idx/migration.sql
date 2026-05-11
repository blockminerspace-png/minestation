-- Acelera a sonda de referrer na compra P2P (subquery por username do comprador).
CREATE INDEX IF NOT EXISTS "referrals_referred_username_idx" ON "referrals" ("referred_username");
