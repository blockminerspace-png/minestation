-- Fingerprint do pedido para detectar mesma idempotencyKey com payload diferente (câmbio / carteira).
ALTER TABLE "wallet_idempotency" ADD COLUMN IF NOT EXISTS "request_fingerprint" VARCHAR(64);
