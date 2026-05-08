/**
 * Join da bateria polimórfica em `placed_racks` para agregações SQL (dashboard admin, leaderboard público).
 * Substitui `LEFT JOIN upgrades b ON r.battery_id = b.id` quando `battery_id` é UUID de instância.
 */
export const ADMIN_RACK_BATTERY_JOIN_FRAGMENT = `
LEFT JOIN stored_batteries sb_bat ON sb_bat.user_id = r.user_id AND sb_bat.id::text = r.battery_id::text
LEFT JOIN LATERAL (
  SELECT ch.battery_item_id::text AS item_id
  FROM charging_history ch
  INNER JOIN users u_ch ON lower(trim(u_ch.email::text)) = lower(trim(ch.user_email::text))
  WHERE u_ch.id = r.user_id
    AND ch.battery_instance_id::text = r.battery_id::text
    AND ch.battery_item_id IS NOT NULL
    AND BTRIM(ch.battery_item_id::text) <> ''
  ORDER BY ch.timestamp DESC
  LIMIT 1
) bat_hist ON true
LEFT JOIN upgrades b ON b.id = COALESCE(
  NULLIF(TRIM(sb_bat.item_id), ''),
  NULLIF(TRIM(bat_hist.item_id), ''),
  NULLIF(TRIM(r.battery_id), '')
)`;

/** Mesma lógica de energia operacional que antes, mas com `b` possivelmente NULL (instância sem catálogo). */
export const ADMIN_RACK_BATTERY_POWER_PREDICATE = `
AND (COALESCE(b.power_capacity, 0) = -1 OR r.current_charge > 0)
`;
