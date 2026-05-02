import fs from 'fs';

/** Localização do binário `pg_restore` (Windows vs PATH). */
export function getPgRestorePath() {
  const knownPaths = [
    'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_restore.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe',
    'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_restore.exe',
    'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_restore.exe',
    'C:\\Program Files\\PostgreSQL\\13\\bin\\pg_restore.exe',
    'C:\\Program Files\\PostgreSQL\\12\\bin\\pg_restore.exe',
    'C:\\Program Files (x86)\\PostgreSQL\\18\\bin\\pg_restore.exe',
    'C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\pg_restore.exe'
  ];

  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'pg_restore';
}
