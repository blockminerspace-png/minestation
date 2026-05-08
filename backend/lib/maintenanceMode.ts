import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/db.js';
import { getSettingValue, upsertSettingsEntries } from './settingsPrisma.js';

const KEY_MODE = 'maintenance_mode';
const KEY_MESSAGE = 'maintenance_message';
const MAX_MESSAGE_LEN = 4000;

export type MaintenancePublicState = {
  active: boolean;
  message: string | null;
};

function flagFilePath(): string {
  const dir = (process.env.MAINTENANCE_FLAG_DIR || '/var/www/maintenance').trim() || '/var/www/maintenance';
  return path.join(dir, 'maintenance.flag');
}

function parseModeFromValue(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const s = String(raw).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** Lê estado na BD (tabela `settings`). */
export async function readMaintenanceState(): Promise<MaintenancePublicState> {
  const [modeRaw, msgRaw] = await Promise.all([getSettingValue(KEY_MODE), getSettingValue(KEY_MESSAGE)]);
  const active = parseModeFromValue(modeRaw);
  let message: string | null = msgRaw != null && String(msgRaw).trim() ? String(msgRaw).trim() : null;
  if (message && message.length > MAX_MESSAGE_LEN) {
    message = message.slice(0, MAX_MESSAGE_LEN);
  }
  return { active, message };
}

/** Cria/remove o ficheiro que o Nginx lê (volume partilhado com o container nginx). */
export function writeMaintenanceFlagFile(active: boolean): void {
  const file = flagFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (active) {
      fs.writeFileSync(file, `${Date.now()}\n`, { encoding: 'utf8' });
    } else {
      try {
        fs.unlinkSync(file);
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err?.code !== 'ENOENT') throw e;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[Maintenance] não foi possível sincronizar ficheiro-flag (%s): %s', file, msg);
  }
}

/** Alinha o ficheiro com a BD (útil no arranque após deploy/restart). */
export async function syncMaintenanceFlagFromDatabase(): Promise<void> {
  const { active } = await readMaintenanceState();
  writeMaintenanceFlagFile(active);
}

async function invalidateAllSessions(): Promise<{ sessions: number; jwtRefresh: number }> {
  const [s, j] = await Promise.all([
    prisma.sessions.deleteMany({}),
    prisma.jwt_refresh_tokens.deleteMany({})
  ]);
  return { sessions: s.count, jwtRefresh: j.count };
}

/**
 * Liga ou desliga manutenção: `settings` + ficheiro para Nginx.
 * Ao ligar: remove todas as sessões (`sid`) e refresh JWT (logout geral).
 */
export async function applyMaintenanceMode(opts: {
  active: boolean;
  message?: string | null;
}): Promise<{ active: boolean; message: string | null; invalidated?: { sessions: number; jwtRefresh: number } }> {
  const active = !!opts.active;
  let message: string | null =
    opts.message != null && String(opts.message).trim() ? String(opts.message).trim() : null;
  if (message && message.length > MAX_MESSAGE_LEN) {
    message = message.slice(0, MAX_MESSAGE_LEN);
  }
  if (!active) {
    message = null;
  }

  const entries: Array<{ key: string; value: string }> = [{ key: KEY_MODE, value: active ? '1' : '0' }];
  if (active && message) {
    entries.push({ key: KEY_MESSAGE, value: message });
  } else {
    entries.push({ key: KEY_MESSAGE, value: '' });
  }
  await upsertSettingsEntries(entries);

  writeMaintenanceFlagFile(active);

  let invalidated: { sessions: number; jwtRefresh: number } | undefined;
  if (active) {
    invalidated = await invalidateAllSessions();
  }

  const st = await readMaintenanceState();
  return { active: st.active, message: st.message, invalidated };
}
