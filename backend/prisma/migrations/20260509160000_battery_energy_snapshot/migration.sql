-- Snapshot de energia (Wh) e metadados na instância + cópia na rig montada.
-- Compatível com Postgres existente; colunas IF NOT EXISTS.

ALTER TABLE stored_batteries ADD COLUMN IF NOT EXISTS power_capacity_wh double precision NULL;
ALTER TABLE stored_batteries ADD COLUMN IF NOT EXISTS display_name text NULL;
ALTER TABLE stored_batteries ADD COLUMN IF NOT EXISTS image_url varchar(2048) NULL;

UPDATE stored_batteries sb
SET
  power_capacity_wh = COALESCE(sb.power_capacity_wh, u.power_capacity),
  display_name = COALESCE(NULLIF(BTRIM(COALESCE(sb.display_name, '')), ''), u.name),
  image_url = COALESCE(NULLIF(BTRIM(COALESCE(sb.image_url, '')), ''), NULLIF(BTRIM(COALESCE(u.image, '')), ''))
FROM upgrades u
WHERE sb.item_id = u.id
  AND (lower(COALESCE(u.type::text, '')) = 'battery' OR lower(COALESCE(u.category::text, '')) = 'battery');

ALTER TABLE placed_racks ADD COLUMN IF NOT EXISTS battery_catalog_item_id text NULL;
ALTER TABLE placed_racks ADD COLUMN IF NOT EXISTS battery_power_capacity_wh double precision NULL;
ALTER TABLE placed_racks ADD COLUMN IF NOT EXISTS battery_display_name text NULL;
ALTER TABLE placed_racks ADD COLUMN IF NOT EXISTS battery_image_url varchar(2048) NULL;

UPDATE placed_racks pr
SET
  battery_catalog_item_id = COALESCE(pr.battery_catalog_item_id, sb.item_id),
  battery_power_capacity_wh = COALESCE(pr.battery_power_capacity_wh, sb.power_capacity_wh, u.power_capacity),
  battery_display_name = COALESCE(NULLIF(BTRIM(COALESCE(pr.battery_display_name, '')), ''), NULLIF(BTRIM(COALESCE(sb.display_name, '')), ''), u.name),
  battery_image_url = COALESCE(
    NULLIF(BTRIM(COALESCE(pr.battery_image_url, '')), ''),
    NULLIF(BTRIM(COALESCE(sb.image_url, '')), ''),
    NULLIF(BTRIM(COALESCE(u.image, '')), '')
  )
FROM stored_batteries sb
JOIN upgrades u ON u.id = sb.item_id
WHERE pr.battery_id IS NOT NULL
  AND pr.battery_id = sb.id
  AND pr.user_id = sb.user_id
  AND (lower(COALESCE(u.type::text, '')) = 'battery' OR lower(COALESCE(u.category::text, '')) = 'battery');

UPDATE placed_racks pr
SET
  battery_catalog_item_id = COALESCE(pr.battery_catalog_item_id, pr.battery_id),
  battery_power_capacity_wh = COALESCE(pr.battery_power_capacity_wh, u.power_capacity),
  battery_display_name = COALESCE(NULLIF(BTRIM(COALESCE(pr.battery_display_name, '')), ''), u.name),
  battery_image_url = COALESCE(
    NULLIF(BTRIM(COALESCE(pr.battery_image_url, '')), ''),
    NULLIF(BTRIM(COALESCE(u.image, '')), '')
  )
FROM upgrades u
WHERE pr.battery_id IS NOT NULL
  AND pr.battery_id = u.id
  AND (lower(COALESCE(u.type::text, '')) = 'battery' OR lower(COALESCE(u.category::text, '')) = 'battery')
  AND pr.battery_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
