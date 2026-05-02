import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getPostgresCliSpawnOptions } from '../config/database.js';
import { getPgDumpPath } from '../config/pgDump.js';
import { getPsqlPath } from '../config/psql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.join(__dirname, '..');

/** Ficheiros gerados pelo job de 24h (para rotação por idade). */
export const AUTO_SQL_BACKUP_PREFIX = 'auto_pgdump_';

/** Diretório de backups: `BACKUP_DIR` absoluto ou `../backups` relativo ao backend. */
export function ensureBackupDir() {
  const raw = process.env.BACKUP_DIR && String(process.env.BACKUP_DIR).trim();
  const dir = raw ? path.resolve(raw) : path.join(BACKEND_ROOT, '../backups');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

export function getBackupDir() {
  return ensureBackupDir();
}

/** Caminho absoluto dentro do diretório de backups (evita path traversal). */
export function resolveSafeBackupPath(filename, backupDir = getBackupDir()) {
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
  'users', 'referrals', 'mining_coins', 'access_levels', 'upgrades', 'upgrade_compat_racks',
  'loot_boxes', 'loot_box_items', 'system_news', 'season_passes', 'season_purchases',
  'game_states', 'settings', 'stock', 'unopened_boxes', 'stored_batteries', 'placed_racks',
  'rack_slots', 'rack_multiplier_slots', 'player_listings', 'nft_items', 'sessions',
  'coin_balances', 'coin_withdrawals', 'admin_upgrades', 'admin_upgrade_items',
  'admin_upgrade_boxes', 'admin_upgrade_passes', 'admin_upgrade_coins', 'admin_upgrade_purchases',
  'player_news_submissions', 'rig_rooms', 'user_rig_rooms', 'workshop_slots',
  'player_claimed_boxes', 'daily_actions', 'promo_codes', 'promo_code_redemptions',
  'economy_settings', 'withdrawal_requests', 'device_fingerprint_logs'
];

export const RESTORE_ALLOWED_TABLES = new Set(BACKUP_TABLE_NAMES);

export function isSafeSqlIdentifier(name) {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Export fiel do Postgres (schema + dados + constraints) via `pg_dump` em SQL plain.
 * Requer `pg_dump` no PATH (ou caminho Windows em `config/pgDump.js`).
 */
export function runPgDumpToFile(outputAbsolutePath) {
  return new Promise((resolve, reject) => {
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
    child.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(`[pg_dump] ${s}`);
    });
    child.stdout?.on('data', (d) => {
      process.stdout.write(`[pg_dump] ${d}`);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `pg_dump terminou com código ${code}`));
    });
  });
}

/**
 * Aplica um ficheiro `.sql` gerado por `pg_dump` (plain) com `psql`.
 * Operação destrutiva se o dump incluir DROP/CLEAN — apenas painel admin.
 */
export function runPsqlRestoreFile(sqlAbsolutePath) {
  return new Promise((resolve, reject) => {
    const opts = getPostgresCliSpawnOptions();
    const exe = getPsqlPath();
    let args;
    if (opts.useConnectionString) {
      args = [opts.databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlAbsolutePath];
    } else {
      args = [
        '-h', opts.host,
        '-p', opts.port,
        '-U', opts.user,
        '-d', opts.database,
        '-v', 'ON_ERROR_STOP=1',
        '-f', sqlAbsolutePath
      ];
    }
    const child = spawn(exe, args, { env: { ...process.env, ...opts.extraEnv } });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(`[psql] ${s}`);
    });
    child.stdout?.on('data', (d) => {
      process.stdout.write(`[psql] ${d}`);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `psql terminou com código ${code}`));
    });
  });
}

/** Mantém os N backups automáticos mais recentes; apaga os mais antigos. */
export function pruneAutoSqlBackups(backupDir = getBackupDir(), keepCount = 14) {
  const keep = Math.max(1, Math.min(500, Math.floor(Number(keepCount)) || 14));
  if (!fs.existsSync(backupDir)) return;
  const entries = [];
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
      console.warn('[Backup] Falha ao remover:', entries[i].name, e.message);
    }
  }
}

export function isLikelyPlainSqlDumpFile(filePath) {
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
