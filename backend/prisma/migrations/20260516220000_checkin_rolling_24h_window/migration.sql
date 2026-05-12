-- =====================================================================
-- Migration: 20260516220000_checkin_rolling_24h_window
--
-- Substitui a janela "dia civil BRT" por uma janela rolante de 24 horas
-- baseada em `last_checkin_at_ms` (timestamp em ms epoch da última
-- check-in). A coluna `last_checkin_day` é preservada por compatibilidade
-- (e ainda é actualizada pelo serviço, para diagnóstico), mas a regra de
-- congelamento e contagem de streak passa a depender exclusivamente do
-- novo timestamp.
--
-- Regras (servidor):
--  - `frozen` quando `now() - last_checkin_at_ms >= 24h` (ou NULL).
--  - Tentativa de check-in dentro da janela (24h) → idempotente.
--  - Check-in entre 24h e 48h após o anterior → `streak += 1`.
--  - Check-in 48h+ depois (ou primeiro de sempre) → `streak = 1`.
--  - A cada `streak` múltiplo de 7 → grant de 1 `battery_estelar`.
--
-- Back-fill (compatibilidade com utilizadores que já checaram pelo regime
-- antigo "dia BRT"):
--  - Quem checou hoje BRT → `last_checkin_at_ms = NOW()` (mantém 24h
--    completas a partir do deploy; conservador, evita penalizar quem
--    acabou de fazer check-in).
--  - Quem checou em dias anteriores → `last_checkin_at_ms = 23:59:59 BRT`
--    desse dia (já expirado, semantica equivalente ao regime antigo).
-- =====================================================================

ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS last_checkin_at_ms BIGINT;

UPDATE game_states
   SET last_checkin_at_ms = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
 WHERE last_checkin_at_ms IS NULL
   AND last_checkin_day IS NOT NULL
   AND last_checkin_day = to_char((NOW() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD');

UPDATE game_states
   SET last_checkin_at_ms = (
         EXTRACT(
           EPOCH FROM ((last_checkin_day::date + INTERVAL '23 hours 59 minutes 59 seconds')
                       AT TIME ZONE 'America/Sao_Paulo')
         ) * 1000
       )::BIGINT
 WHERE last_checkin_at_ms IS NULL
   AND last_checkin_day IS NOT NULL
   AND last_checkin_day ~ '^\d{4}-\d{2}-\d{2}$';

CREATE INDEX IF NOT EXISTS game_states_last_checkin_at_ms_idx
  ON game_states (last_checkin_at_ms);
