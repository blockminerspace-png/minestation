-- Depois de `lucky_boxes_module` (tabela `lucky_box_idempotency`) e `upgrade_shop_secure`.
ALTER TABLE "lucky_box_idempotency" ADD COLUMN IF NOT EXISTS "request_fingerprint" VARCHAR(64);
ALTER TABLE "upgrade_purchase_idempotency" ADD COLUMN IF NOT EXISTS "request_fingerprint" VARCHAR(64);
