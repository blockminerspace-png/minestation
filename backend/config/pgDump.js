import fs from 'fs';

/** Localização do binário `pg_dump` (Windows vs PATH). */
export function getPgDumpPath() {
  const knownPaths = [
    'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\13\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\12\\bin\\pg_dump.exe',
    'C:\\Program Files (x86)\\PostgreSQL\\18\\bin\\pg_dump.exe',
    'C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\pg_dump.exe'
  ];

  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'pg_dump';
}
