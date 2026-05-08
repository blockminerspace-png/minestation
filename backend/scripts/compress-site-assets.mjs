import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

const TARGET_DIRS = [
  path.join(backendRoot, 'img'),
  path.join(repoRoot, 'uploads'),
  path.join(repoRoot, 'frontend', 'public'),
];

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4']);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(abs);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield abs;
    }
  }
}

const mod = await import(pathToFileURL(path.join(backendRoot, 'dist', 'lib', 'compressMediaAsset.js')).href);
const { compressMediaFileInPlace } = mod;

const files = TARGET_DIRS.flatMap((dir) => [...walk(dir)]);
let before = 0;
let after = 0;
let changed = 0;

for (const abs of files) {
  const prev = fs.statSync(abs).size;
  before += prev;
  await compressMediaFileInPlace(abs);
  const next = fs.statSync(abs).size;
  after += next;
  if (next < prev) changed += 1;
}

const saved = before - after;
console.log(
  JSON.stringify({
    scanned: files.length,
    changed,
    beforeBytes: before,
    afterBytes: after,
    savedBytes: saved,
    savedMb: Number((saved / (1024 * 1024)).toFixed(2)),
  })
);
