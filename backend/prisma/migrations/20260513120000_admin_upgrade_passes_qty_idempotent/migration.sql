-- Garante a coluna `qty` na tabela `admin_upgrade_passes` em bases antigas.
-- Sem esta coluna, qualquer `prisma.admin_upgrade_passes.findMany()` (SELECT *)
-- falha com "column does not exist" e a compra de pacote em /upgrades
-- devolve 500 ("Erro ao processar o pedido.").
ALTER TABLE "admin_upgrade_passes" ADD COLUMN IF NOT EXISTS "qty" INTEGER NOT NULL DEFAULT 1;
