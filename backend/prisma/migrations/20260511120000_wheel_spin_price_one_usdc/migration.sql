-- Preço do giro pago da roleta: 1 USDC (antes 0.10 por defeito).
UPDATE wheel_config
SET
  spin_price_usdc = 1,
  min_spin_price_usdc = 1,
  updated_at = (FLOOR(EXTRACT(EPOCH FROM NOW()) * 1000))::BIGINT
WHERE id = 1;

ALTER TABLE wheel_config ALTER COLUMN spin_price_usdc SET DEFAULT 1;
ALTER TABLE wheel_config ALTER COLUMN min_spin_price_usdc SET DEFAULT 1;
