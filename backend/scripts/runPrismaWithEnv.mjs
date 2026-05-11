/**
 * Carrega .env típicos do deploy (VPS / Docker-compose no repo) e corre o CLI Prisma.
 * Uso: node scripts/runPrismaWithEnv.mjs migrate deploy
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

const envFiles = [
  path.join(backendRoot, '..', 'app_production', '.env'),
  path.join(backendRoot, '..', '.env'),
  path.join(backendRoot, '.env')
];

const hadUrl = String(process.env.DATABASE_URL || '').trim() !== '';

// Contentor Docker já traz DATABASE_URL no ambiente — não sobrescrever com .env do host.
if (!hadUrl) {
  dotenv.config({ path: envFiles[0] });
  dotenv.config({ path: envFiles[1], override: true });
  dotenv.config({ path: envFiles[2], override: true });
}

if (!process.env.DATABASE_URL || String(process.env.DATABASE_URL).trim() === '') {
  console.error(
    '[prisma] DATABASE_URL não definida após carregar (por ordem de prioridade):\n' +
      envFiles.map((p) => `  - ${p}`).join('\n') +
      '\n\nColoca DATABASE_URL num destes ficheiros ou exporta na shell antes de migrar.'
  );
  process.exit(1);
}

const prismaArgs = process.argv.slice(2);
if (prismaArgs.length === 0) {
  console.error('[prisma] Uso: node scripts/runPrismaWithEnv.mjs migrate deploy');
  process.exit(1);
}

const r = spawnSync('npx', ['prisma', ...prismaArgs], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: process.env,
  shell: false
});

process.exit(r.status === null ? 1 : r.status);
