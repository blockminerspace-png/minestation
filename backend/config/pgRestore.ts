import fs from 'node:fs';
import { resolveUnixPostgresCli } from './postgresCliPaths.js';

/**
 * Caminhos fixos (allowlist) para `pg_restore` no Windows; em Unix tenta PATH + locais típicos + env.
 */
const KNOWN_WINDOWS_PATHS = [
  'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe',
  'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_restore.exe',
  'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe',
  'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_restore.exe',
  'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_restore.exe',
  'C:\\Program Files\\PostgreSQL\\13\\bin\\pg_restore.exe',
  'C:\\Program Files\\PostgreSQL\\12\\bin\\pg_restore.exe',
  'C:\\Program Files (x86)\\PostgreSQL\\18\\bin\\pg_restore.exe',
  'C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\pg_restore.exe'
] as const;

export function getPgRestorePath(): string {
  if (process.platform === 'win32') {
    for (const p of KNOWN_WINDOWS_PATHS) {
      if (fs.existsSync(p)) return p;
    }
    return 'pg_restore';
  }
  const unix = resolveUnixPostgresCli('pg_restore');
  return unix ?? 'pg_restore';
}
