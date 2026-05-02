import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import db from '../db.js';
import { getPgRestoreSpawnOptions } from '../config/database.js';
import { getPgRestorePath } from '../config/pgRestore.js';
import {
  getBackupDir,
  resolveSafeBackupPath,
  RESTORE_ALLOWED_TABLES,
  isSafeSqlIdentifier,
  BACKUP_TABLE_NAMES,
  runPgDumpToFile,
  runPsqlRestoreFile,
  pruneAutoSqlBackups,
  isLikelyPlainSqlDumpFile,
  AUTO_SQL_BACKUP_PREFIX,
  ensureBackupDir
} from '../models/backupModel.js';

const require = createRequire(import.meta.url);
let BetterSqliteDatabase = null;
try {
  BetterSqliteDatabase = require('better-sqlite3');
} catch {
  BetterSqliteDatabase = null;
}

const priorityOrder = () => [...BACKUP_TABLE_NAMES];

function isBackupFilename(name) {
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

/**
 * Um ciclo de backup automático: `pg_dump` SQL + rotação de ficheiros antigos.
 */
export async function createScheduledSqlBackupOnce() {
  ensureBackupDir();
  const fn = `${AUTO_SQL_BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
  const dest = resolveSafeBackupPath(fn);
  if (!dest) throw new Error('Caminho de backup inválido');
  await runPgDumpToFile(dest);
  const keep = parseInt(process.env.BACKUP_SQL_KEEP || '14', 10) || 14;
  pruneAutoSqlBackups(getBackupDir(), keep);
  const st = fs.statSync(dest);
  return { filename: fn, path: dest, bytes: st.size };
}

/**
 * Agenda backup SQL completo a cada 24h (worker BACKGROUND / ALL).
 * `BACKUP_DISABLE_AUTO=1` desativa. `BACKUP_AUTO_FIRST_DELAY_MS` atraso da 1ª execução (ms).
 */
export function startScheduledSqlBackups() {
  if (process.env.BACKUP_DISABLE_AUTO === '1' || String(process.env.BACKUP_DISABLE_AUTO).toLowerCase() === 'true') {
    console.log('[Backup] Backups automáticos SQL desativados (BACKUP_DISABLE_AUTO).');
    return;
  }
  const intervalMs = 24 * 60 * 60 * 1000;
  const firstDelay = Math.max(60_000, parseInt(process.env.BACKUP_AUTO_FIRST_DELAY_MS || '300000', 10) || 300000);
  const tick = async () => {
    try {
      const r = await createScheduledSqlBackupOnce();
      console.log(`[Backup] Dump SQL automático: ${r.filename} (${r.bytes} bytes)`);
    } catch (e) {
      console.error('[Backup] Falha no dump SQL automático:', e.message);
    }
  };
  setTimeout(tick, firstDelay);
  setInterval(tick, intervalMs);
  console.log(`[Backup] Agendado pg_dump SQL a cada 24h (primeira execução em ${Math.round(firstDelay / 1000)}s).`);
}

function spawnPgRestoreAwait(args, env) {
  return new Promise((resolve, reject) => {
    const pgRestoreExe = getPgRestorePath();
    const restore = spawn(pgRestoreExe, args, { env });
    restore.stdout.on('data', (data) => {
      console.log(`[pg_restore] ${data}`);
    });
    restore.stderr.on('data', (data) => {
      console.error(`[pg_restore err] ${data}`);
    });
    restore.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_restore falhou (código ${code})`));
    });
    restore.on('error', reject);
  });
}

/**
 * Rotas admin: listar / criar (pg_dump SQL) / apagar / upload / download / restaurar.
 * @param {import('express').Express} app
 * @param {{ isAdmin: import('express').RequestHandler }} deps
 */
export function registerBackupRoutes(app, { isAdmin }) {
  app.get('/api/admin/backups', isAdmin, async (req, res) => {
    try {
      const BACKUP_DIR = getBackupDir();
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const list = [];
      for (const ent of fs.readdirSync(BACKUP_DIR, { withFileTypes: true })) {
        if (!ent.isFile() || !isBackupFilename(ent.name)) continue;
        try {
          const stats = fs.statSync(path.join(BACKUP_DIR, ent.name));
          list.push({ filename: ent.name, size: stats.size, createdAt: stats.mtimeMs });
        } catch (statErr) {
          console.warn('[Backups] Ignorando ficheiro ao listar:', ent.name, statErr.message);
        }
      }
      res.json(list.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) {
      console.error('[Backups] Listagem:', e);
      res.status(500).json({ error: 'Falha ao listar backups' });
    }
  });

  app.post('/api/admin/backup', isAdmin, async (req, res) => {
    const { name } = req.body || {};
    const safeBase = path.basename(String(name || 'backup')).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'backup';
    const filename = `${safeBase}_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    const dest = resolveSafeBackupPath(filename);
    if (!dest) return res.status(400).json({ error: 'Nome de backup inválido' });
    try {
      await runPgDumpToFile(dest);
      const st = fs.statSync(dest);
      res.json({ ok: true, filename, bytes: st.size, format: 'sql' });
    } catch (e) {
      try {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      console.error('[Backups] pg_dump:', e);
      res.status(500).json({
        error:
          'Falha ao criar backup SQL (pg_dump). Instale as ferramentas cliente PostgreSQL e garanta pg_dump no PATH. ' +
          e.message
      });
    }
  });

  app.delete('/api/admin/backups/:filename', isAdmin, async (req, res) => {
    const fullPath = resolveSafeBackupPath(req.params.filename);
    if (!fullPath) return res.status(400).json({ error: 'Nome de arquivo inválido' });
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        res.json({ ok: true });
      } else res.status(404).json({ error: 'Arquivo não encontrado' });
    } catch (e) {
      res.status(500).json({ error: 'Falha ao deletar backup' });
    }
  });

  const MAX_BACKUP_UPLOAD_BYTES = 150 * 1024 * 1024;

  app.post('/api/admin/backups/upload', isAdmin, async (req, res) => {
    const { filename, content } = req.body;
    if (!filename || !content) {
      console.error('[BackupUpload] Missing filename or content');
      return res.status(400).json({ error: 'Dados ausentes' });
    }
    try {
      console.log(`[BackupUpload] Receiving file: ${filename}, size: ${content.length}`);
      const dest = resolveSafeBackupPath(filename);
      if (!dest) return res.status(400).json({ error: 'Nome de arquivo inválido' });
      const base64Data = content.includes('base64,') ? content.split('base64,')[1] : content;
      if (typeof base64Data !== 'string' || base64Data.length > Math.ceil(MAX_BACKUP_UPLOAD_BYTES * 1.37)) {
        return res.status(413).json({ error: 'Conteúdo demasiado grande' });
      }
      const buffer = Buffer.from(base64Data.replace(/\s/g, ''), 'base64');
      if (buffer.length > MAX_BACKUP_UPLOAD_BYTES) {
        return res.status(413).json({ error: `Backup excede o máximo de ${MAX_BACKUP_UPLOAD_BYTES / (1024 * 1024)} MiB` });
      }
      fs.writeFileSync(dest, buffer);
      console.log(`[BackupUpload] Saved to: ${dest}`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[BackupUpload] Error:', e);
      res.status(500).json({ error: 'Erro no upload: ' + e.message });
    }
  });

  app.get('/api/admin/backups/download/:filename', isAdmin, (req, res) => {
    const fullPath = resolveSafeBackupPath(req.params.filename);
    if (!fullPath) return res.status(400).json({ error: 'Nome de arquivo inválido' });
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const base = path.basename(fullPath);
    if (base.toLowerCase().endsWith('.sql')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.download(fullPath, base);
  });

  app.post('/api/admin/restore', isAdmin, async (req, res) => {
    const { filename } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'Nome do arquivo ausente' });
    const bkpPath = resolveSafeBackupPath(filename);
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
      console.warn('[Restore] Erro ao ler cabeçalho do arquivo:', e);
    }

    if (isPgCustomDump) {
      console.log('[Restore] Arquivo PGDMP detectado. Usando pg_restore...');
      const pgOpts = getPgRestoreSpawnOptions();
      const args = ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--verbose'];
      const env = { ...process.env, ...pgOpts.extraEnv };
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
        return res.status(500).json({ error: e.message });
      }
    }

    if (isLikelyPlainSqlDumpFile(bkpPath)) {
      console.log('[Restore] Ficheiro SQL (pg_dump plain). Usando psql...');
      try {
        await runPsqlRestoreFile(bkpPath);
        return res.json({ ok: true, message: 'Restore a partir de SQL (psql) concluído.' });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    const client = await db.connect();
    const priority = priorityOrder();
    try {
      await client.query('BEGIN');

      if (filename.endsWith('.db') || filename.endsWith('.sqlite')) {
        if (!BetterSqliteDatabase) {
          await client.query('ROLLBACK');
          return res.status(501).json({
            error: 'Restauro SQLite requer o pacote opcional better-sqlite3 (`npm install better-sqlite3`).'
          });
        }
        const bkpDb = new BetterSqliteDatabase(bkpPath, { readonly: true });
        const foundTables = bkpDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all()
          .map((t) => t.name);

        const sortedTables = foundTables.sort((a, b) => {
          let idxA = priority.indexOf(a);
          let idxB = priority.indexOf(b);
          if (idxA === -1) idxA = 999;
          if (idxB === -1) idxB = 999;
          return idxA - idxB;
        });

        for (const tableName of sortedTables) {
          if (!RESTORE_ALLOWED_TABLES.has(tableName) || !isSafeSqlIdentifier(tableName)) {
            console.warn(`[Restore] Tabela ignorada (não permitida): ${tableName}`);
            continue;
          }
          const existsRes = await client.query('SELECT 1 FROM information_schema.tables WHERE table_name = $1', [tableName]);
          if (existsRes.rowCount === 0) continue;
          const backupRows = bkpDb.prepare(`SELECT * FROM ${tableName}`).all();
          if (backupRows.length === 0) continue;
          const cols = Object.keys(backupRows[0]);
          if (!cols.every(isSafeSqlIdentifier)) {
            console.warn(`[Restore] Colunas inválidas na tabela ${tableName}, ignorando.`);
            continue;
          }
          const colList = cols.join(', ');
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
          for (const row of backupRows) {
            const values = cols.map((c) => row[c]);
            try {
              await client.query('SAVEPOINT restore_row');
              await client.query(`INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
              await client.query('RELEASE SAVEPOINT restore_row');
            } catch (e) {
              await client.query('ROLLBACK TO SAVEPOINT restore_row');
              console.warn(`[Restore] Saltando registro em ${tableName}: ${e.message}`);
            }
          }
        }
        bkpDb.close();
      } else {
        const backupData = JSON.parse(fs.readFileSync(bkpPath, 'utf8'));
        const sortedKeys = Object.keys(backupData).sort((a, b) => {
          let idxA = priority.indexOf(a);
          let idxB = priority.indexOf(b);
          if (idxA === -1) idxA = 999;
          if (idxB === -1) idxB = 999;
          return idxA - idxB;
        });

        for (const table of sortedKeys) {
          if (!RESTORE_ALLOWED_TABLES.has(table) || !isSafeSqlIdentifier(table)) {
            console.warn(`[Restore] Tabela ignorada (não permitida): ${table}`);
            continue;
          }
          const rows = backupData[table];
          if (!Array.isArray(rows) || rows.length === 0) continue;
          const cols = Object.keys(rows[0]);
          if (!cols.every(isSafeSqlIdentifier)) {
            console.warn(`[Restore] Colunas inválidas na tabela ${table}, ignorando.`);
            continue;
          }
          const colList = cols.join(', ');
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
          for (const row of rows) {
            const values = cols.map((c) => row[c]);
            try {
              await client.query('SAVEPOINT restore_row');
              await client.query(`INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
              await client.query('RELEASE SAVEPOINT restore_row');
            } catch (e) {
              await client.query('ROLLBACK TO SAVEPOINT restore_row');
              console.warn(`[Restore] Saltando registro em ${table}: ${e.message}`);
            }
          }
        }
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Erro no restore: ' + e.message });
    } finally {
      client.release();
    }
  });
}
