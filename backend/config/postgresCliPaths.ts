import fs from 'node:fs';
import path from 'node:path';

/** Caminho absoluto seguro (sem .. nem caracteres de shell). */
function isSafeAbsUnixPath(p: string): boolean {
  if (!p || p.length > 512 || !p.startsWith('/') || p.includes('..')) return false;
  // Escapar a barra inicial dentro da classe para não terminar o literal /regex/
  return /^[\/a-zA-Z0-9._+\-]+$/.test(p);
}

/**
 * Resolve pg_dump / psql / pg_restore em Linux ou macOS:
 * - PG_DUMP_PATH, PSQL_PATH, PG_RESTORE_PATH (ficheiro absoluto existente)
 * - POSTGRES_CLIENT_BIN (directório que contém os três binários)
 * - /usr/bin, /usr/local/bin, /usr/lib/postgresql (subpastas por versão) /bin
 */
export function resolveUnixPostgresCli(tool: 'pg_dump' | 'psql' | 'pg_restore'): string | null {
  const envFile = tool === 'pg_dump' ? 'PG_DUMP_PATH' : tool === 'psql' ? 'PSQL_PATH' : 'PG_RESTORE_PATH';
  const rawFile = process.env[envFile];
  if (typeof rawFile === 'string' && rawFile.trim()) {
    const t = rawFile.trim();
    if (isSafeAbsUnixPath(t) && fs.existsSync(t) && path.basename(t) === tool) return t;
  }
  const rawDir = process.env.POSTGRES_CLIENT_BIN?.trim();
  if (rawDir && isSafeAbsUnixPath(rawDir)) {
    const joined = path.join(rawDir, tool);
    if (fs.existsSync(joined)) return joined;
  }
  for (const dir of ['/usr/bin', '/usr/local/bin']) {
    const joined = path.join(dir, tool);
    if (fs.existsSync(joined)) return joined;
  }
  try {
    const pgRoot = '/usr/lib/postgresql';
    const vers = fs.readdirSync(pgRoot).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
    for (const v of vers) {
      const joined = path.join(pgRoot, v, 'bin', tool);
      if (fs.existsSync(joined)) return joined;
    }
  }
  catch {
    /* ignorar */
  }
  return null;
}
