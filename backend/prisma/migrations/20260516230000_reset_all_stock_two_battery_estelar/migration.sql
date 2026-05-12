-- =====================================================================
-- Migration: 20260516230000_reset_all_stock_two_battery_estelar
--
-- Limpa **toda** a tabela `stock` e repõe, para **cada** utilizador em
-- `users`, exactamente uma linha: `battery_estelar` com `qty = 2`.
--
-- Não altera `stored_batteries`, `placed_racks`, `coin_balances`, etc.
-- (baterias UUID no armazém / rigs mantêm-se — só o stock catálogo muda.)
--
-- Verificação no fim: aborta a migração se existir item que não seja
-- `battery_estelar` com quantidade 2, ou se o número de linhas em `stock`
-- não coincidir com o número de linhas em `users`.
-- =====================================================================

DELETE FROM stock;

INSERT INTO stock (user_id, item_id, qty)
SELECT u.id, 'battery_estelar', 2
  FROM users u;

-- Verificação estrita (falha = rollback da migração inteira)
DO $$
DECLARE
  bad_items   integer;
  bad_qty     integer;
  n_stock     bigint;
  n_users     bigint;
BEGIN
  SELECT COUNT(*) INTO bad_items FROM stock WHERE item_id <> 'battery_estelar';
  IF bad_items > 0 THEN
    RAISE EXCEPTION '[stock reset] % linha(s) com item_id diferente de battery_estelar', bad_items;
  END IF;

  SELECT COUNT(*) INTO bad_qty FROM stock WHERE qty <> 2;
  IF bad_qty > 0 THEN
    RAISE EXCEPTION '[stock reset] % linha(s) com qty diferente de 2', bad_qty;
  END IF;

  SELECT COUNT(*) INTO n_stock FROM stock;
  SELECT COUNT(*) INTO n_users FROM users;
  IF n_stock <> n_users THEN
    RAISE EXCEPTION '[stock reset] COUNT(stock)= % ≠ COUNT(users)= %', n_stock, n_users;
  END IF;
END $$;
