/**
 * Normaliza caminhos de imagens na BD: URLs absolutas do próprio site → `/img/...`;
 * depois aplica a mesma lógica que `normalizePublicAssetUrl` (miner/foo.png → /img/miner/foo.png).
 *
 * Uso na VM: `docker compose exec -T app sh -c 'cd /app/backend && node scripts/normalize-db-public-asset-urls.mjs'`
 * Local: `npm run build:ts && node scripts/normalize-db-public-asset-urls.mjs`
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { normalizePublicAssetUrl } from '../dist/lib/publicAssetUrl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

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

function collectKnownHosts() {
  const set = new Set(['genesisdao.tech', 'localhost', '127.0.0.1']);
  for (const key of ['FRONTEND_URL', 'PUBLIC_URL', 'SITE_URL', 'VITE_API_URL']) {
    const raw = process.env[key];
    if (!raw || typeof raw !== 'string') continue;
    for (const part of raw.split(',')) {
      try {
        const u = new URL(part.trim());
        if (u.hostname) set.add(u.hostname.replace(/^www\./i, '').toLowerCase());
      } catch {
        /* ignore */
      }
    }
  }
  return set;
}

const KNOWN_HOSTS = collectKnownHosts();

/** `https://domínio/img/x` → `/img/x` (+ query). Mantém URLs externas. */
function stripSameSiteAbsoluteToPath(raw) {
  const s = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const u = new URL(s);
    const low = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (!KNOWN_HOSTS.has(low)) return s;
    if (u.pathname.toLowerCase().startsWith('/img/')) {
      return `${u.pathname}${u.search || ''}`;
    }
  } catch {
    /* ignore */
  }
  return s;
}

function canon(raw) {
  const step1 = stripSameSiteAbsoluteToPath(raw);
  return normalizePublicAssetUrl(step1);
}

async function rewriteColumn(client, table, idColumn, valueColumn) {
  const rows = await client.query(
    `SELECT ${idColumn} AS id, ${valueColumn} AS value
       FROM ${table}
      WHERE ${valueColumn} IS NOT NULL AND btrim(${valueColumn}::text) <> ''`
  );
  let updated = 0;
  for (const row of rows.rows) {
    const cur = String(row.value);
    const next = canon(cur);
    if (next != null && next !== cur) {
      await client.query(`UPDATE ${table} SET ${valueColumn} = $1 WHERE ${idColumn} = $2`, [next, row.id]);
      updated += 1;
    }
  }
  console.log(`[normalize-db-public-assets] ${table}.${valueColumn}: ${updated} linha(s)`);
  return updated;
}

async function columnExists(client, table, col) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, col]
  );
  return (r.rowCount ?? 0) > 0;
}

const client = new pg.Client(buildPoolConfig());
await client.connect();
try {
  let total = 0;
  total += await rewriteColumn(client, 'upgrades', 'id', 'icon');
  total += await rewriteColumn(client, 'upgrades', 'id', 'image');
  total += await rewriteColumn(client, 'loot_boxes', 'id', 'icon');
  if (await columnExists(client, 'season_passes', 'emblem_url')) {
    total += await rewriteColumn(client, 'season_passes', 'id', 'emblem_url');
  }
  if (await columnExists(client, 'system_news', 'image_url')) {
    total += await rewriteColumn(client, 'system_news', 'id', 'image_url');
  }
  console.log(`[normalize-db-public-assets] total updates: ${total}`);
} finally {
  await client.end();
}
