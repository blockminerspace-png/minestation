/**
 * Auditoria só de leitura: baterias / rigs para um email (diagnóstico).
 * Uso: AUDIT_EMAIL=x@y.com npm run db:audit-batteries-email
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const email = String(process.env.AUDIT_EMAIL || '').trim().toLowerCase();
if (!email) {
  console.error('Defina AUDIT_EMAIL=contacto@exemplo.com');
  process.exit(1);
}

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return { connectionString, max: 2, connectionTimeoutMillis: 20000 };
  }
  return {
    user: String(process.env.PGUSER || 'postgres'),
    host: String(process.env.PGHOST || 'localhost'),
    database: String(process.env.PGDATABASE || 'minestation'),
    password: String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres'),
    port: parseInt(process.env.PGPORT || '5432', 10) || 5432,
    max: 2,
    connectionTimeoutMillis: 20000
  };
}

const UUID_RE =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

const pool = new pg.Pool(buildPoolConfig());
const c = await pool.connect();
try {
  const u = await c.query('SELECT id, email FROM users WHERE lower(trim(email::text)) = $1 LIMIT 1', [email]);
  if (!u.rows[0]) {
    console.log('Utilizador não encontrado:', email);
    process.exit(2);
  }
  const uid = Number(u.rows[0].id);
  console.log('user_id=', uid, 'email=', u.rows[0].email);

  const sb = await c.query(
    `SELECT id, item_id, current_charge FROM stored_batteries WHERE user_id = $1 ORDER BY id`,
    [uid]
  );
  console.log('\n[stored_batteries]', sb.rows.length, 'linhas');
  for (const r of sb.rows) {
    console.log(' ', r.id, '| item_id=', r.item_id, '| charge=', r.current_charge);
  }

  const badSb = await c.query(
    `
    SELECT sb.id, sb.item_id
      FROM stored_batteries sb
      LEFT JOIN upgrades u ON u.id = btrim(COALESCE(sb.item_id, ''))
     WHERE sb.user_id = $1
       AND (
             btrim(COALESCE(sb.item_id, '')) = ''
          OR u.id IS NULL
          OR (
               lower(COALESCE(u.type, '')) <> 'battery'
           AND lower(COALESCE(u.category, '')) <> 'battery'
             )
           )
    `,
    [uid]
  );
  console.log('\n[stored_batteries inválidas]', badSb.rows.length);
  badSb.rows.forEach((r) => console.log(' ', r));

  const racks = await c.query(
    `
    SELECT pr.id, pr.slot_index, pr.battery_id, pr.current_charge, pr.is_on
      FROM placed_racks pr
     WHERE pr.user_id = $1
     ORDER BY COALESCE(pr.room_id, ''), pr.slot_index
    `,
    [uid]
  );
  console.log('\n[placed_racks]', racks.rows.length, 'rigs');
  for (const r of racks.rows) {
    console.log(' ', 'rack', r.id, 'slot', r.slot_index, 'battery_id=', r.battery_id, 'charge=', r.current_charge, 'on=', r.is_on);
  }

  const orphan = await c.query(
    `
    SELECT pr.id, pr.battery_id
      FROM placed_racks pr
     WHERE pr.user_id = $1
       AND pr.battery_id IS NOT NULL
       AND btrim(pr.battery_id::text) <> ''
       AND pr.battery_id::text ~* $2
       AND NOT EXISTS (SELECT 1 FROM stored_batteries sb WHERE sb.id = pr.battery_id AND sb.user_id = pr.user_id)
    `,
    [uid, UUID_RE]
  );
  console.log('\n[racks battery_id UUID órfão]', orphan.rows.length);
  orphan.rows.forEach((r) => console.log(' ', r));

  const dup = await c.query(
    `
    SELECT pr.battery_id, COUNT(*)::int AS n
      FROM placed_racks pr
     WHERE pr.user_id = $1
       AND pr.battery_id IS NOT NULL
       AND btrim(pr.battery_id::text) <> ''
       AND pr.battery_id::text ~* $2
     GROUP BY pr.battery_id
    HAVING COUNT(*) > 1
    `,
    [uid, UUID_RE]
  );
  console.log('\n[racks mesmo UUID em >1 rig]', dup.rows.length);
  dup.rows.forEach((r) => console.log(' ', r));

  const badCat = await c.query(
    `
    SELECT pr.id, pr.battery_id
      FROM placed_racks pr
     WHERE pr.user_id = $1
       AND pr.battery_id IS NOT NULL
       AND btrim(pr.battery_id::text) <> ''
       AND NOT (pr.battery_id::text ~* $2)
       AND NOT EXISTS (
             SELECT 1 FROM upgrades u
              WHERE u.id = btrim(pr.battery_id::text)
                AND (
                     lower(COALESCE(u.type, '')) = 'battery'
                  OR lower(COALESCE(u.category, '')) = 'battery'
                    )
           )
    `,
    [uid, UUID_RE]
  );
  console.log('\n[racks battery_id não-bateria]', badCat.rows.length);
  badCat.rows.forEach((r) => console.log(' ', r));

  const infBad = await c.query(
    `
    SELECT pr.id, pr.battery_id, pr.current_charge, u.power_capacity, u.id AS cat
      FROM placed_racks pr
      LEFT JOIN stored_batteries sb ON sb.user_id = pr.user_id AND btrim(sb.id::text) = btrim(pr.battery_id::text)
      LEFT JOIN upgrades u ON u.id = COALESCE(btrim(sb.item_id::text), btrim(pr.battery_id::text))
     WHERE pr.user_id = $1
       AND pr.battery_id IS NOT NULL
       AND btrim(pr.battery_id::text) <> ''
       AND COALESCE(u.power_capacity, 0) = -1
       AND pr.current_charge IS DISTINCT FROM -1
    `,
    [uid]
  );
  console.log('\n[racks bateria infinita com carga != -1]', infBad.rows.length);
  infBad.rows.forEach((r) => console.log(' ', r));
} finally {
  c.release();
  await pool.end();
}
