import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Express, RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { sanitizeApiMessage, sanitizeForLog } from '../lib/safeText.js';
import type { PgCliSpawnOptions } from '../config/database.js';

const betterSqliteRequire = createRequire(import.meta.url);

/** better-sqlite3 é opcional; só tipagem mínima para o fluxo de restore SQLite. */
interface SqliteStatement {
  all: () => Array<Record<string, unknown>>;
}
interface SqliteDatabase {
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
}
type SqliteDatabaseCtor = new (filePath: string, opts?: { readonly?: boolean }) => SqliteDatabase;

let BetterSqliteDatabase: SqliteDatabaseCtor | null = null;
try {
  BetterSqliteDatabase = betterSqliteRequire('better-sqlite3') as SqliteDatabaseCtor;
} catch {
  BetterSqliteDatabase = null;
}

/** API do `models/backupModel` (compilado em `dist/models/`) injectada pelo `server.js`. */
export type BackupModelApi = {
  getBackupDir: () => string;
  resolveSafeBackupPath: (filename: string) => string | null;
  RESTORE_ALLOWED_TABLES: Set<string>;
  isSafeSqlIdentifier: (name: unknown) => boolean;
  BACKUP_TABLE_NAMES: readonly string[];
  runPgDumpToFile: (outputAbsolutePath: string) => Promise<void>;
  runPsqlRestoreFile: (sqlAbsolutePath: string) => Promise<void>;
  pruneAutoSqlBackups: (backupDir?: string, keepCount?: number) => void;
  isLikelyPlainSqlDumpFile: (filePath: string) => boolean;
  AUTO_SQL_BACKUP_PREFIX: string;
  ensureBackupDir: () => string;
};

export type PgRestoreSpawnOptions = PgCliSpawnOptions;

export type BackupControllerDeps = {
  isAdmin: RequestHandler;
  backupModel: BackupModelApi;
  getPgRestoreSpawnOptions: () => PgRestoreSpawnOptions;
  getPgRestorePath: () => string;
};

function priorityOrder(m: BackupModelApi): string[] {
  return [...m.BACKUP_TABLE_NAMES];
}

function isBackupFilename(name: string): boolean {
  const lower = String(name).toLowerCase();
  return (
    lower.endsWith('.db') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.back') ||
    lower.endsWith('.sql') ||
    lower.endsWith('.json') ||
    lower.endsWith('.json.gz') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.dump')
  );
}

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Um ciclo de backup automático: `pg_dump` SQL + rotação de ficheiros antigos.
 */
export async function createScheduledSqlBackupOnce(m: BackupModelApi): Promise<{ filename: string; path: string; bytes: number }> {
  m.ensureBackupDir();
  const fn = `${m.AUTO_SQL_BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
  const dest = m.resolveSafeBackupPath(fn);
  if (!dest) throw new Error('Caminho de backup inválido');
  await m.runPgDumpToFile(dest);
  const keep = parseInt(process.env.BACKUP_SQL_KEEP || '14', 10) || 14;
  m.pruneAutoSqlBackups(m.getBackupDir(), keep);
  const st = fs.statSync(dest);
  return { filename: fn, path: dest, bytes: st.size };
}

/** Chaves fixas para `pg_try_advisory_lock` — evita dump duplicado com várias réplicas / processos. */
const AUTO_SQL_BACKUP_LOCK_K1 = 0x4d53;
const AUTO_SQL_BACKUP_LOCK_K2 = 0x6270;

function parseAutoBackupLocalClock(): { hour: number; minute: number } {
  const hour = Math.min(23, Math.max(0, parseInt(process.env.BACKUP_AUTO_LOCAL_HOUR || '0', 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(process.env.BACKUP_AUTO_LOCAL_MINUTE || '0', 10) || 0));
  return { hour, minute };
}

/** Tempo até a próxima ocorrência de `hour:minute` no relógio local do processo (TZ do servidor). */
export function msUntilNextLocalClockRun(nowMs: number = Date.now()): number {
  const now = new Date(nowMs);
  const { hour, minute } = parseAutoBackupLocalClock();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return Math.max(1000, target.getTime() - now.getTime());
}

/**
 * Agenda um único `pg_dump` automático por dia, à hora local do servidor (default 00:00).
 * Usa advisory lock na BD via Prisma para uma só instância entre réplicas.
 */
export function startScheduledSqlBackups(backupModel: BackupModelApi): void {
  if (process.env.BACKUP_DISABLE_AUTO === '1' || String(process.env.BACKUP_DISABLE_AUTO).toLowerCase() === 'true') {
    console.log('[Backup] Backups automáticos SQL desativados (BACKUP_DISABLE_AUTO).');
    return;
  }
  const k1 = AUTO_SQL_BACKUP_LOCK_K1;
  const k2 = AUTO_SQL_BACKUP_LOCK_K2;
  const { hour, minute } = parseAutoBackupLocalClock();

  const tick = async (): Promise<void> => {
    try {
      await prisma.$transaction(
        async (tx) => {
          const lockRes = await tx.$queryRaw<[{ ok: boolean }]>`
            SELECT pg_try_advisory_lock(${k1}::integer, ${k2}::integer) AS ok
          `;
          const got = lockRes[0]?.ok === true;
          if (!got) {
            console.log('[Backup] Dump SQL automático ignorado (outro processo detém o lock).');
            return;
          }
          try {
            const r = await createScheduledSqlBackupOnce(backupModel);
            console.log(`[Backup] Dump SQL automático: ${sanitizeForLog(r.filename)} (${r.bytes} bytes)`);
          } catch (e) {
            console.error('[Backup] Falha no dump SQL automático:', sanitizeForLog(toErrorMessage(e), 200));
          } finally {
            try {
              await tx.$queryRaw`
                SELECT pg_advisory_unlock(${k1}::integer, ${k2}::integer)
              `;
            } catch (unlockErr) {
              console.error('[Backup] Falha ao libertar advisory lock:', sanitizeForLog(toErrorMessage(unlockErr), 200));
            }
          }
        },
        { timeout: 1_200_000, maxWait: 30_000 }
      );
    } catch (e) {
      console.error('[Backup] Falha ao adquirir lock / transação para dump automático:', sanitizeForLog(toErrorMessage(e), 200));
    }
  };

  const scheduleLoop = (): void => {
    const delay = msUntilNextLocalClockRun();
    const nextAt = new Date(Date.now() + delay);
    const nextLocal = nextAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
    console.log(
      `[Backup] Dump SQL automático: diariamente às ${String(hour).padStart(2, '0')}:${String(
        minute
      ).padStart(2, '0')} (relógio local do processo / TZ do servidor). Próxima: ${nextLocal} (daqui ~${Math.round(delay / 60000)} min).`
    );
    setTimeout(() => {
      void (async () => {
        await tick();
        scheduleLoop();
      })();
    }, delay);
  };

  scheduleLoop();
}

/**
 * Rotas admin: listar / criar (pg_dump SQL) / apagar / upload / download / restaurar.
 */
export function registerBackupRoutes(app: Express, deps: BackupControllerDeps): void {
  const { isAdmin, backupModel: m, getPgRestoreSpawnOptions, getPgRestorePath } = deps;

  function spawnPgRestoreAwait(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
      const pgRestoreExe = getPgRestorePath();
      const restore = spawn(pgRestoreExe, args, { env });
      restore.stdout.on('data', (data: Buffer) => {
        console.log(`[pg_restore] ${sanitizeForLog(data.toString('utf8'), 4000)}`);
      });
      restore.stderr.on('data', (data: Buffer) => {
        console.error(`[pg_restore err] ${sanitizeForLog(data.toString('utf8'), 4000)}`);
      });
      restore.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_restore falhou (código ${code})`));
      });
      restore.on('error', reject);
    });
  }

  app.get('/api/admin/backups', isAdmin, async (_req, res) => {
    try {
      const BACKUP_DIR = m.getBackupDir();
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const list: Array<{ filename: string; size: number; createdAt: number }> = [];
      for (const ent of fs.readdirSync(BACKUP_DIR, { withFileTypes: true })) {
        if (!ent.isFile() || !isBackupFilename(ent.name)) continue;
        try {
          const stats = fs.statSync(path.join(BACKUP_DIR, ent.name));
          list.push({ filename: ent.name, size: stats.size, createdAt: stats.mtimeMs });
        } catch (statErr) {
          console.warn('[Backups] Ignorando ficheiro ao listar:', sanitizeForLog(ent.name), sanitizeForLog(toErrorMessage(statErr), 120));
        }
      }
      res.json(list.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) {
      console.error('[Backups] Listagem:', sanitizeForLog(toErrorMessage(e), 200));
      res.status(500).json({ error: 'Falha ao listar backups' });
    }
  });

  app.post('/api/admin/backup', isAdmin, async (req, res) => {
    const body = req.body as { name?: unknown } | undefined;
    const safeBase =
      path.basename(String(body?.name ?? 'backup')).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'backup';
    const filename = `${safeBase}_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    const dest = m.resolveSafeBackupPath(filename);
    if (!dest) return res.status(400).json({ error: 'Nome de backup inválido' });
    try {
      await m.runPgDumpToFile(dest);
      const st = fs.statSync(dest);
      console.log(`[Backups] Manual pg_dump OK: ${sanitizeForLog(filename)} (${st.size} bytes)`);
      res.json({ ok: true, filename, bytes: st.size, format: 'sql' });
    } catch (e) {
      try {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      console.error('[Backups] pg_dump:', sanitizeForLog(toErrorMessage(e), 200));
      const detail = sanitizeApiMessage(toErrorMessage(e), 180);
      const hint = String(detail).includes('ENOENT')
        ? ' Em Docker: reconstrua a imagem (Dockerfile inclui postgresql-client) ou defina PG_DUMP_PATH. '
        : ' ';
      res.status(500).json({
        error:
          'Falha ao criar backup SQL (pg_dump). Instale o cliente PostgreSQL (pacote que fornece pg_dump no PATH). ' +
          hint +
          detail
      });
    }
  });

  app.delete('/api/admin/backups/:filename', isAdmin, async (req, res) => {
    const fullPath = m.resolveSafeBackupPath(req.params.filename);
    if (!fullPath) return res.status(400).json({ error: 'Nome de arquivo inválido' });
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        res.json({ ok: true });
      } else res.status(404).json({ error: 'Arquivo não encontrado' });
    } catch {
      res.status(500).json({ error: 'Falha ao deletar backup' });
    }
  });

  const MAX_BACKUP_UPLOAD_BYTES = 150 * 1024 * 1024;

  app.post('/api/admin/backups/upload', isAdmin, async (req, res) => {
    const body = req.body as { filename?: unknown; content?: unknown } | undefined;
    const filename = body?.filename;
    const content = body?.content;
    if (filename == null || content == null) {
      console.error('[BackupUpload] Missing filename or content');
      return res.status(400).json({ error: 'Dados ausentes' });
    }
    try {
      const fnStr = String(filename);
      console.log(`[BackupUpload] Receiving file: ${sanitizeForLog(fnStr)}, size: ${String(content).length}`);
      const dest = m.resolveSafeBackupPath(fnStr);
      if (!dest) return res.status(400).json({ error: 'Nome de arquivo inválido' });
      const contentStr = String(content);
      const base64Data = contentStr.includes('base64,') ? contentStr.split('base64,')[1] ?? '' : contentStr;
      if (typeof base64Data !== 'string' || base64Data.length > Math.ceil(MAX_BACKUP_UPLOAD_BYTES * 1.37)) {
        return res.status(413).json({ error: 'Conteúdo demasiado grande' });
      }
      const buffer = Buffer.from(base64Data.replace(/\s/g, ''), 'base64');
      if (buffer.length > MAX_BACKUP_UPLOAD_BYTES) {
        return res.status(413).json({ error: `Backup excede o máximo de ${MAX_BACKUP_UPLOAD_BYTES / (1024 * 1024)} MiB` });
      }
      fs.writeFileSync(dest, buffer);
      console.log(`[BackupUpload] Saved to: ${sanitizeForLog(dest, 200)}`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[BackupUpload] Error:', sanitizeForLog(toErrorMessage(e), 200));
      res.status(500).json({ error: 'Erro no upload: ' + sanitizeApiMessage(toErrorMessage(e), 160) });
    }
  });

  app.get('/api/admin/backups/download/:filename', isAdmin, (req, res) => {
    const fullPath = m.resolveSafeBackupPath(req.params.filename);
    if (!fullPath) return res.status(400).json({ error: 'Nome de arquivo inválido' });
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const base = path.basename(fullPath);
    if (base.toLowerCase().endsWith('.sql')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.download(fullPath, base);
  });

  app.post('/api/admin/restore', isAdmin, async (req, res) => {
    const body = req.body as { filename?: unknown } | undefined;
    const filename = body?.filename != null ? String(body.filename) : '';
    if (!filename) return res.status(400).json({ error: 'Nome do arquivo ausente' });
    const bkpPath = m.resolveSafeBackupPath(filename);
    if (!bkpPath) return res.status(400).json({ error: 'Nome de arquivo inválido' });
    if (!fs.existsSync(bkpPath)) return res.status(404).json({ error: 'Backup não encontrado' });

    let isPgCustomDump = false;
    try {
      const fd = fs.openSync(bkpPath, 'r');
      const buffer = Buffer.alloc(5);
      fs.readSync(fd, buffer, 0, 5, 0);
      fs.closeSync(fd);
      isPgCustomDump = buffer.toString('ascii') === 'PGDMP';
    } catch (e) {
      console.warn('[Restore] Erro ao ler cabeçalho do arquivo:', sanitizeForLog(toErrorMessage(e), 120));
    }

    if (isPgCustomDump) {
      console.log('[Restore] Arquivo PGDMP detectado. Usando pg_restore...');
      const pgOpts = getPgRestoreSpawnOptions();
      const args: string[] = ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--verbose'];
      const env: NodeJS.ProcessEnv = { ...process.env, ...pgOpts.extraEnv };
      if (pgOpts.useConnectionString) {
        args.push('-d', pgOpts.databaseUrl);
      } else {
        args.push('-h', pgOpts.host, '-p', pgOpts.port, '-U', pgOpts.user, '-d', pgOpts.database);
      }
      args.push(bkpPath);
      try {
        await spawnPgRestoreAwait(args, env);
        return res.json({ ok: true, message: 'Restore binário concluído.' });
      } catch (e) {
        return res.status(500).json({ error: sanitizeApiMessage(toErrorMessage(e), 240) });
      }
    }

    if (m.isLikelyPlainSqlDumpFile(bkpPath)) {
      console.log('[Restore] Ficheiro SQL (pg_dump plain). Usando psql...');
      try {
        await m.runPsqlRestoreFile(bkpPath);
        return res.json({ ok: true, message: 'Restore a partir de SQL (psql) concluído.' });
      } catch (e) {
        return res.status(500).json({ error: sanitizeApiMessage(toErrorMessage(e), 240) });
      }
    }

    const priority = priorityOrder(m);
    try {
      await prisma.$transaction(
        async (tx) => {
        if (filename.endsWith('.db') || filename.endsWith('.sqlite')) {
          if (!BetterSqliteDatabase) {
            throw new Error('SQLITE501');
          }
          const bkpDb = new BetterSqliteDatabase(bkpPath, { readonly: true });
          const foundTables = bkpDb
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all()
            .map((t) => String((t as { name?: unknown }).name ?? ''));

          const sortedTables = foundTables.sort((a, b) => {
            let idxA = priority.indexOf(a);
            let idxB = priority.indexOf(b);
            if (idxA === -1) idxA = 999;
            if (idxB === -1) idxB = 999;
            return idxA - idxB;
          });

          for (const tableName of sortedTables) {
            if (!m.RESTORE_ALLOWED_TABLES.has(tableName) || !m.isSafeSqlIdentifier(tableName)) {
              console.warn(`[Restore] Tabela ignorada (não permitida): ${sanitizeForLog(tableName, 80)}`);
              continue;
            }
            const existsRows = await tx.$queryRawUnsafe(
              `SELECT 1 AS x FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
              tableName
            );
            if (!Array.isArray(existsRows) || existsRows.length === 0) continue;
            const backupRows = bkpDb.prepare(`SELECT * FROM ${tableName}`).all();
            if (backupRows.length === 0) continue;
            const cols = Object.keys(backupRows[0] as Record<string, unknown>);
            if (!cols.every(m.isSafeSqlIdentifier)) {
              console.warn(`[Restore] Colunas inválidas na tabela ${sanitizeForLog(tableName, 80)}, ignorando.`);
              continue;
            }
            const colList = cols.join(', ');
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            for (const row of backupRows) {
              const values = cols.map((c) => (row as Record<string, unknown>)[c]);
              try {
                await tx.$executeRawUnsafe('SAVEPOINT restore_row');
                await tx.$executeRawUnsafe(
                  `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
                  ...values
                );
                await tx.$executeRawUnsafe('RELEASE SAVEPOINT restore_row');
              } catch (e) {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT restore_row');
                console.warn(
                  `[Restore] Saltando registro em ${sanitizeForLog(tableName, 80)}: ${sanitizeForLog(toErrorMessage(e), 120)}`
                );
              }
            }
          }
          bkpDb.close();
        } else {
          const rawJson = fs.readFileSync(bkpPath, 'utf8');
          const backupData = JSON.parse(rawJson) as Record<string, unknown>;
          const sortedKeys = Object.keys(backupData).sort((a, b) => {
            let idxA = priority.indexOf(a);
            let idxB = priority.indexOf(b);
            if (idxA === -1) idxA = 999;
            if (idxB === -1) idxB = 999;
            return idxA - idxB;
          });

          for (const table of sortedKeys) {
            if (!m.RESTORE_ALLOWED_TABLES.has(table) || !m.isSafeSqlIdentifier(table)) {
              console.warn(`[Restore] Tabela ignorada (não permitida): ${sanitizeForLog(table, 80)}`);
              continue;
            }
            const rowsRaw = backupData[table];
            if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) continue;
            const rows = rowsRaw as Array<Record<string, unknown>>;
            const cols = Object.keys(rows[0]);
            if (!cols.every(m.isSafeSqlIdentifier)) {
              console.warn(`[Restore] Colunas inválidas na tabela ${sanitizeForLog(table, 80)}, ignorando.`);
              continue;
            }
            const colList = cols.join(', ');
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            for (const row of rows) {
              const values = cols.map((c) => row[c]);
              try {
                await tx.$executeRawUnsafe('SAVEPOINT restore_row');
                await tx.$executeRawUnsafe(
                  `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
                  ...values
                );
                await tx.$executeRawUnsafe('RELEASE SAVEPOINT restore_row');
              } catch (e) {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT restore_row');
                console.warn(
                  `[Restore] Saltando registro em ${sanitizeForLog(table, 80)}: ${sanitizeForLog(toErrorMessage(e), 120)}`
                );
              }
            }
          }
        }
      },
        { timeout: 1_800_000, maxWait: 60_000 }
      );
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof Error && e.message === 'SQLITE501') {
        return res.status(501).json({
          error: 'Restauro SQLite requer o pacote opcional better-sqlite3 (`npm install better-sqlite3`).'
        });
      }
      res.status(500).json({ error: 'Erro no restore: ' + sanitizeApiMessage(toErrorMessage(e), 200) });
    }
  });
}
