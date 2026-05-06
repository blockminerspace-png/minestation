import fs from 'node:fs';
import path from 'path';
import { prisma } from '../../config/prisma.js';
import { getBackendRootFromSrcAuthFile } from '../../lib/backendRoot.js';

const STORAGE_DIR = path.join(getBackendRootFromSrcAuthFile(import.meta.url), 'storage');

export function ensureStorageDir(): void {
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
export async function writeJwtRefreshSnapshot(): Promise<void> {
  ensureStorageDir();
  try {
    const activeRefreshTokens = await prisma.jwt_refresh_tokens.count({
      where: {
        revoked_at: null,
        expires_at: { gt: BigInt(Date.now()) }
      }
    });
    const snap = {
      updatedAt: Date.now(),
      activeRefreshTokens
    };
    const target = path.join(STORAGE_DIR, 'jwt_refresh_index.json');
    fs.writeFileSync(target, JSON.stringify(snap, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[JWT] Falha ao escrever espelho em storage:', msg);
  }
}
