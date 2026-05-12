-- =====================================================================
-- Migration: 20260512200000_daily_checkin_system
--
-- Sistema de check-in diário (substitui carregamento de baterias):
--
--  * `game_states.last_checkin_day` (TEXT 'YYYY-MM-DD' em America/Sao_Paulo).
--    Última data em que o jogador fez check-in.
--
--  * `game_states.checkin_streak` (INTEGER, default 0). Sequência consecutiva
--    de dias com check-in. A cada 7 dias consecutivos o jogador ganha 1
--    bateria Estelar (instância UUID em `stored_batteries`).
--
-- Regras (servidor):
--  - Janela diária: dia local America/Sao_Paulo (00:00–23:59).
--  - Check-in no dia X conta uma vez por X (idempotente).
--  - Se o último check-in foi no dia X-1, `streak` incrementa em 1.
--  - Se foi anterior a X-1 (ou nunca), `streak` reinicia em 1.
--  - Quando `streak` atinge múltiplo de 7, granta 1 `battery_estelar`.
--  - Se `last_checkin_day` ≠ dia BRT actual, mineração fica congelada
--    (cron `miningProgressComputer` não credita produção).
-- =====================================================================

ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS last_checkin_day VARCHAR(10),
  ADD COLUMN IF NOT EXISTS checkin_streak INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS game_states_last_checkin_day_idx
  ON game_states (last_checkin_day);
