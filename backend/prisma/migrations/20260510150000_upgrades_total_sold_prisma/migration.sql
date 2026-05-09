-- Coluna já pode existir (runtime ensure em server/initDb); alinha Prisma com a BD.
ALTER TABLE upgrades ADD COLUMN IF NOT EXISTS total_sold INTEGER DEFAULT 0;
