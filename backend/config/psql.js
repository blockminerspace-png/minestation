import fs from 'fs';

/** Localização do binário `psql` (Windows vs PATH). */
export function getPsqlPath() {
  const knownPaths = [
    'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\12\\bin\\psql.exe',
    'C:\\Program Files (x86)\\PostgreSQL\\18\\bin\\psql.exe',
    'C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\psql.exe'
  ];

  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'psql';
}
