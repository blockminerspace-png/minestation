/**
 * Após mover ficheiros para img/{miner,moedas,...}, atualiza URLs na BD
 * (ex.: /img/foo.png → /img/miner/foo.png) com base no disco.
 *
 * Uso: DATABASE_URL=... node backend/scripts/rewrite-img-paths-after-reorg.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG = path.resolve(__dirname, '../img');
const SUBS = ['miner', 'moedas', 'carregadores', 'baterias', 'favicon', 'uploads'];

function buildBasenameToUrl() {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const sub of SUBS) {
    const dir = path.join(IMG, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (!fs.statSync(p).isFile()) continue;
      const publicUrl = sub === 'uploads' ? `/img/${name}` : `/img/${sub}/${name}`;
      m.set(name, publicUrl);
    }
  }
  return m;
}

function basenameFromDbUrl(u) {
  const s = String(u || '').trim();
  if (!s.startsWith('/img/')) return null;
  const noq = s.split('?')[0];
  const parts = noq.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 1];
}

async function rewriteColumn(client, table, idColumn, valueColumn, map) {
  const rows = await client.query(
    `SELECT ${idColumn} AS id, ${valueColumn} AS value
       FROM ${table}
      WHERE ${valueColumn} IS NOT NULL
        AND ${valueColumn} != ''
        AND ${valueColumn} LIKE '/img/%'`
  );

  let updated = 0;
  for (const row of rows.rows) {
    const cur = String(row.value);
    const base = basenameFromDbUrl(cur);
    if (!base) continue;
    const next = map.get(base);
    if (next && next !== cur) {
      await client.query(
        `UPDATE ${table} SET ${valueColumn} = $1 WHERE ${idColumn} = $2`,
        [next, row.id]
      );
      updated += 1;
    }
  }

  console.log(`[rewrite-img-paths] ${table}.${valueColumn} atualizados: ${updated}`);
  return updated;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL');
  process.exit(1);
}

const map = buildBasenameToUrl();
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const total =
    (await rewriteColumn(client, 'upgrades', 'id', 'image', map)) +
    (await rewriteColumn(client, 'upgrades', 'id', 'icon', map)) +
    (await rewriteColumn(client, 'loot_boxes', 'id', 'icon', map)) +
    (await rewriteColumn(client, 'system_news', 'id', 'image_url', map));
  console.log(`[rewrite-img-paths] total atualizado: ${total}`);
} finally {
  await client.end();
}
