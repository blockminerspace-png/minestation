import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pasta `backend/` (onde estão `db.js`, `config/`, etc.), quer o ficheiro actual
 * esteja em `backend/models/*.ts` ou em `backend/dist/models/*.js` após `tsc`.
 */
export function getBackendRootFromModelsFile(importMetaUrl: string): string {
  const selfDir = path.dirname(fileURLToPath(importMetaUrl));
  const parentName = path.basename(path.dirname(selfDir));
  if (parentName === 'dist') {
    return path.resolve(selfDir, '..', '..');
  }
  return path.resolve(selfDir, '..');
}

/** `backend/src/auth` ou `backend/dist/src/auth` → pasta `backend/`. */
export function getBackendRootFromSrcAuthFile(importMetaUrl: string): string {
  const selfDir = path.dirname(fileURLToPath(importMetaUrl));
  const base = path.basename(selfDir);
  const parent = path.basename(path.dirname(selfDir));
  const grand = path.basename(path.dirname(path.dirname(selfDir)));
  if (base === 'auth' && parent === 'src' && grand === 'dist') {
    return path.resolve(selfDir, '..', '..', '..');
  }
  if (base === 'auth' && parent === 'src') {
    return path.resolve(selfDir, '..', '..');
  }
  return path.resolve(selfDir, '..', '..');
}
