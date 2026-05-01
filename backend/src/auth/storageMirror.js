import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, '../../storage');

export function ensureStorageDir() {
  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
  } catch {
    /* ignore */
  }
}

/**
 * Espelho não sensível em disco (pasta storage) para auditoria / cópia de trabalho.
 * Nunca grava o refresh em claro — apenas metadados agregados.
 */
export async function writeJwtRefreshSnapshot(db) {
  ensureStorageDir();
  try {
    const res = await db.query(
      `SELECT COUNT(*)::int AS active FROM jwt_refresh_tokens WHERE revoked_at IS NULL AND expires_at > $1`,
      [Date.now()]
    );
    const snap = {
      updatedAt: Date.now(),
      activeRefreshTokens: res.rows[0]?.active ?? 0
    };
    const target = path.join(STORAGE_DIR, 'jwt_refresh_index.json');
    fs.writeFileSync(target, JSON.stringify(snap, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.warn('[JWT] Falha ao escrever espelho em storage:', e.message);
  }
}
