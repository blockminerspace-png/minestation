/**
 * Corrige `upgrades.image` para chassis rack_a61–rack_a634 quando a BD ainda
 * aponta para uploads antigos em `/img/<basename>.png` que não existem no
 * disco, mas os skins já estão em `img/miner/*rig-6x*`.
 *
 * Também preenche `rack_10u` e legados `temp_legacy_%rack%` vazios com o
 * rack padrão (ficheiro *RackPreto* / *bxt3up* em miner), se existir.
 *
 * Uso: DATABASE_URL=... node backend/scripts/repair-infra-rack-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MINER = path.resolve(__dirname, '../img/miner');

/** @param {(n: string) => boolean} pred */
function firstMinerFile(pred) {
  if (!fs.existsSync(MINER)) return null;
  const names = fs.readdirSync(MINER).filter((n) => fs.statSync(path.join(MINER, n)).isFile() && pred(n));
  if (!names.length) return null;
  names.sort((a, b) => a.length - b.length);
  return names[0];
}

function defaultRackPng() {
  const byPreto = firstMinerFile((n) => /rackpreto|rack.?preto/i.test(n));
  if (byPreto) return byPreto;
  const byBxt = firstMinerFile((n) => n.includes('bxt3up'));
  if (byBxt) return byBxt;
  return firstMinerFile((n) => /rack/i.test(n) && /\.png$/i.test(n));
}

/** @type {Array<[string, () => string | null]>} */
const RACK_RESOLVERS = [
  [
    'rack_a61',
    () =>
      firstMinerFile(
        (n) => /rig-61/i.test(n) && !/rig-612/i.test(n) && /\.png$/i.test(n)
      ),
  ],
  ['rack_a62', () => firstMinerFile((n) => /rig-62/i.test(n) && /\.png$/i.test(n))],
  ['rack_a63', () => firstMinerFile((n) => /rig-63/i.test(n) && /\.png$/i.test(n))],
  ['rack_a634', () => firstMinerFile((n) => /rig-64/i.test(n) && /\.png$/i.test(n))],
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
let n = 0;
try {
  for (const [id, resolve] of RACK_RESOLVERS) {
    const file = resolve();
    if (!file) {
      console.warn(`[repair-rack-images] sem ficheiro em img/miner para ${id}, ignorado`);
      continue;
    }
    const image = `/img/miner/${file}`;
    const r = await client.query(
      `UPDATE upgrades SET image = $1 WHERE id = $2 AND (image IS DISTINCT FROM $1)`,
      [image, id]
    );
    n += r.rowCount || 0;
    if (r.rowCount) console.log(`[repair-rack-images] ${id} -> ${image}`);
  }

  const def = defaultRackPng();
  if (def) {
    const image = `/img/miner/${def}`;
    const r10 = await client.query(
      `UPDATE upgrades SET image = $1
        WHERE id = 'rack_10u' AND (image IS NULL OR trim(image) = '')`,
      [image]
    );
    n += r10.rowCount || 0;
    if (r10.rowCount) console.log(`[repair-rack-images] rack_10u (vazio) -> ${image}`);

    const rL = await client.query(
      `UPDATE upgrades SET image = $1
        WHERE id LIKE 'temp_legacy_%rack%'
          AND (image IS NULL OR trim(image) = '')`,
      [image]
    );
    n += rL.rowCount || 0;
    if (rL.rowCount) console.log(`[repair-rack-images] temp_legacy rack vazios -> ${image} (${rL.rowCount})`);
  } else {
    console.warn('[repair-rack-images] sem imagem padrão de rack em img/miner');
  }

  console.log(`[repair-rack-images] linhas atualizadas (total): ${n}`);
} finally {
  await client.end();
}
