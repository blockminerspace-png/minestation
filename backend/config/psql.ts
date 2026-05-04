import fs from 'node:fs';
import { resolveUnixPostgresCli } from './postgresCliPaths.js';

/**
 * Caminhos fixos (allowlist) para `psql` no Windows; em Unix tenta PATH + locais típicos + env.
 */
const KNOWN_WINDOWS_PATHS = [
  'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\12\\bin\\psql.exe',
  'C:\\Program Files (x86)\\PostgreSQL\\18\\bin\\psql.exe',
  'C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\psql.exe'
] as const;

export function getPsqlPath(): string {
  if (process.platform === 'win32') {
    for (const p of KNOWN_WINDOWS_PATHS) {
      if (fs.existsSync(p)) return p;
    }
    return 'psql';
  }
  const unix = resolveUnixPostgresCli('psql');
  return unix ?? 'psql';
}
