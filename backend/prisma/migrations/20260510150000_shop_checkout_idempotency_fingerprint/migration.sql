-- Fingerprint do carrinho no momento da compra (deteção de reuse malicioso da mesma chave).
ALTER TABLE "shop_checkout_idempotency" ADD COLUMN IF NOT EXISTS "request_fingerprint" VARCHAR(64);
