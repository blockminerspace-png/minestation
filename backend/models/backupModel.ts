import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getBackendRootFromModelsFile } from '../lib/backendRoot.js';
import type { PgCliSpawnOptions } from '../config/database.js';

type DatabaseConfigModule = { getPostgresCliSpawnOptions: () => PgCliSpawnOptions };
type PgDumpModule = { getPgDumpPath: () => string };
type PsqlModule = { getPsqlPath: () => string };

let depsPromise: Promise<{
  getPostgresCliSpawnOptions: () => PgCliSpawnOptions;
  getPgDumpPath: () => string;
  getPsqlPath: () => string;
}> | null = null;

function loadBackupToolingModules(): Promise<{
  getPostgresCliSpawnOptions: () => PgCliSpawnOptions;
  getPgDumpPath: () => string;
  getPsqlPath: () => string;
}> {
  if (!depsPromise) {
    const root = getBackendRootFromModelsFile(import.meta.url);
    const configDir = path.join(root, 'dist', 'config');
    depsPromise = Promise.all([
      import(pathToFileURL(path.join(configDir, 'database.js')).href) as Promise<DatabaseConfigModule>,
      import(pathToFileURL(path.join(configDir, 'pgDump.js')).href) as Promise<PgDumpModule>,
      import(pathToFileURL(path.join(configDir, 'psql.js')).href) as Promise<PsqlModule>
    ]).then(([dbCfg, pgDump, psql]) => ({
      getPostgresCliSpawnOptions: dbCfg.getPostgresCliSpawnOptions,
      getPgDumpPath: pgDump.getPgDumpPath,
      getPsqlPath: psql.getPsqlPath
    }));
  }
  return depsPromise;
}

const BACKEND_ROOT = getBackendRootFromModelsFile(import.meta.url);

/** Ficheiros gerados pelo job de 24h (para rotação por idade). */
export const AUTO_SQL_BACKUP_PREFIX = 'auto_pgdump_';

/** Diretório de backups: `BACKUP_DIR` absoluto ou `../backups` relativo ao backend. */
export function ensureBackupDir(): string {
  const raw = process.env.BACKUP_DIR && String(process.env.BACKUP_DIR).trim();
  const dir = raw ? path.resolve(raw) : path.join(BACKEND_ROOT, '../backups');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

export function getBackupDir(): string {
  return ensureBackupDir();
}

/** Caminho absoluto dentro do diretório de backups (evita path traversal). */
export function resolveSafeBackupPath(filename: unknown, backupDir: string = getBackupDir()): string | null {
  const base = path.resolve(backupDir);
  const safeName = path.basename(String(filename ?? ''));
  if (!safeName || safeName === '.' || safeName === '..') return null;
  const resolved = path.resolve(base, safeName);
  const baseSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (resolved !== base && !resolved.startsWith(baseSep)) return null;
  return resolved;
}

/** Tabelas incluídas em backup JSON e permitidas em restore (whitelist). */
export const BACKUP_TABLE_NAMES = [
  'users',
  'referrals',
  'mining_coins',
  'access_levels',
  'upgrades',
  'upgrade_compat_racks',
  'loot_boxes',
  'loot_box_items',
  'system_news',
  'season_passes',
  'season_purchases',
  'game_states',
  'settings',
  'stock',
  'unopened_boxes',
  'stored_batteries',
  'placed_racks',
  'rack_slots',
  'rack_multiplier_slots',
  'player_listings',
  'nft_items',
  'sessions',
  'jwt_refresh_tokens',
  'coin_balances',
  'coin_withdrawals',
  'admin_upgrades',
  'admin_upgrade_items',
  'admin_upgrade_boxes',
  'admin_upgrade_passes',
  'admin_upgrade_coins',
  'admin_upgrade_purchases',
  'player_news_submissions',
  'rig_rooms',
  'user_rig_rooms',
  'player_claimed_boxes',
  'daily_actions',
  'promo_codes',
  'promo_code_redemptions',
  'economy_settings',
  'withdrawal_requests',
  'device_fingerprint_logs'
] as const;

export const RESTORE_ALLOWED_TABLES = new Set<string>(BACKUP_TABLE_NAMES);

export function isSafeSqlIdentifier(name: unknown): boolean {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Export fiel do Postgres (schema + dados + constraints) via `pg_dump` em SQL plain.
 */
export function runPgDumpToFile(outputAbsolutePath: string): Promise<void> {
  return loadBackupToolingModules().then(
    ({ getPostgresCliSpawnOptions, getPgDumpPath }) =>
      new Promise<void>((resolve, reject) => {
        const opts = getPostgresCliSpawnOptions();
        const exe = getPgDumpPath();
        const args = [
          '--format=plain',
          '--encoding=UTF8',
          '--no-owner',
          '--no-acl',
          '--clean',
          '--if-exists',
          '-f',
          outputAbsolutePath
        ];
        if (opts.useConnectionString) {
          args.push(opts.databaseUrl);
        } else {
          args.push('-h', opts.host, '-p', opts.port, '-U', opts.user, '-d', opts.database);
        }
        const child = spawn(exe, args, { env: { ...process.env, ...opts.extraEnv } });
        let stderr = '';
        child.stderr?.on('data', (d: Buffer) => {
          const s = d.toString();
          stderr += s;
          process.stderr.write(`[pg_dump] ${s}`);
        });
        child.stdout?.on('data', (d: Buffer) => {
          process.stdout.write(`[pg_dump] ${d}`);
        });
        child.on('error', (err: Error) => reject(err));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr.trim() || `pg_dump terminou com código ${code}`));
        });
      })
  );
}

/**
 * Aplica um ficheiro `.sql` gerado por `pg_dump` (plain) com `psql`.
 */
export function runPsqlRestoreFile(sqlAbsolutePath: string): Promise<void> {
  return loadBackupToolingModules().then(
    ({ getPostgresCliSpawnOptions, getPsqlPath }) =>
      new Promise<void>((resolve, reject) => {
        const opts = getPostgresCliSpawnOptions();
        const exe = getPsqlPath();
        let args: string[];
        if (opts.useConnectionString) {
          args = [opts.databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlAbsolutePath];
        } else {
          args = ['-h', opts.host, '-p', opts.port, '-U', opts.user, '-d', opts.database, '-v', 'ON_ERROR_STOP=1', '-f', sqlAbsolutePath];
        }
        const child = spawn(exe, args, { env: { ...process.env, ...opts.extraEnv } });
        let stderr = '';
        child.stderr?.on('data', (d: Buffer) => {
          const s = d.toString();
          stderr += s;
          process.stderr.write(`[psql] ${s}`);
        });
        child.stdout?.on('data', (d: Buffer) => {
          process.stdout.write(`[psql] ${d}`);
        });
        child.on('error', (err: Error) => reject(err));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr.trim() || `psql terminou com código ${code}`));
        });
      })
  );
}

/** Mantém os N backups automáticos mais recentes; apaga os mais antigos. */
export function pruneAutoSqlBackups(backupDir: string = getBackupDir(), keepCount: number = 14): void {
  const keep = Math.max(1, Math.min(500, Math.floor(Number(keepCount)) || 14));
  if (!fs.existsSync(backupDir)) return;
  const entries: Array<{ path: string; name: string; mtime: number }> = [];
  for (const ent of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const n = ent.name;
    if (!n.startsWith(AUTO_SQL_BACKUP_PREFIX) || !n.toLowerCase().endsWith('.sql')) continue;
    const full = path.join(backupDir, n);
    try {
      const st = fs.statSync(full);
      entries.push({ path: full, name: n, mtime: st.mtimeMs });
    } catch {
      /* ignore */
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  for (let i = keep; i < entries.length; i++) {
    try {
      fs.unlinkSync(entries[i].path);
      console.log('[Backup] Backup automático antigo removido:', entries[i].name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[Backup] Falha ao remover:', entries[i].name, msg);
    }
  }
}

export function isLikelyPlainSqlDumpFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (base.endsWith('.sql')) return true;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(400);
    const n = fs.readSync(fd, buf, 0, 400, 0);
    fs.closeSync(fd);
    const head = buf.subarray(0, n).toString('utf8').trimStart();
    return head.startsWith('--') || head.startsWith('SET ') || head.startsWith('SELECT pg_catalog');
  } catch {
    return false;
  }
}
