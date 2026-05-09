-- Movimentos de inventário (auditoria); sem FK a users para alinhar ao estilo legado do schema.
CREATE TABLE IF NOT EXISTS "inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "catalog_item_id" VARCHAR(200),
    "instance_id" VARCHAR(200),
    "quantity_before" INTEGER,
    "quantity_after" INTEGER,
    "meta" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_movements_user_id_idx" ON "inventory_movements" ("user_id");
