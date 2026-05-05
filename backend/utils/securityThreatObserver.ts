/**
 * Observador de ameaças leve (sem Redis): agrega sinais por IP na BD,
 * auto-insere em ip_blacklist ao ultrapassar limiar e opcionalmente corre
 * um pg_dump de emergência (mesmo advisory lock do backup diário).
 *
 * Variáveis de ambiente (opcional):
 * - SECURITY_OBSERVER_ENABLED — `0` / `false` desliga tudo.
 * - SECURITY_OBSERVER_BAN_THRESHOLD — pontos para banir (10–500, default 52).
 * - SECURITY_OBSERVER_WINDOW_MINUTES — janela deslizante (2–180 min, default 15).
 * - SECURITY_OBSERVER_IP_ALLOWLIST — IPs nunca pontuados, separados por vírgula
 *   (ex.: `203.0.113.10,198.51.100.0` ou prefixo com `*` `10.0.0.*`).
 * - SECURITY_OBSERVER_ADMIN_PROBE_MIN / SECURITY_OBSERVER_ADMIN_PROBE_SCORE — scan de admin_access_logs.
 * - SECURITY_OBSERVER_BACKUP_ON_BAN — `0` desliga dump de emergência ao banir.
 * - SECURITY_OBSERVER_MAX_SCORE_PER_REQUEST — teto por pedido (default 72).
 * - SECURITY_OBSERVER_AUTO_IP_BAN — `1` / `true` insere em `ip_blacklist` ao atingir limiar (default **desligado**).
 *   Com `0` só grava pontuação em `security_threat_scores` (evita banir IPs errados / CGNAT / proxy mal configurado).
 */
import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { BackupModelApi } from '../controllers/backupController.js';
import { createScheduledSqlBackupOnce } from '../controllers/backupController.js';

const AUTO_SQL_BACKUP_LOCK_K1 = 0x4d53;
const AUTO_SQL_BACKUP_LOCK_K2 = 0x6270;

export function isSecurityObserverEnabled(): boolean {
  const v = process.env.SECURITY_OBSERVER_ENABLED;
  if (v === undefined || v === '') return true;
  return v !== '0' && String(v).toLowerCase() !== 'false';
}

/** Inserção automática em `ip_blacklist` (default: desligada — ban manual no admin). */
export function isSecurityObserverAutoIpBanEnabled(): boolean {
  const v = process.env.SECURITY_OBSERVER_AUTO_IP_BAN;
  if (v === undefined || v === '') return false;
  return v === '1' || String(v).toLowerCase() === 'true';
}

function banThreshold(): number {
  const n = parseInt(process.env.SECURITY_OBSERVER_BAN_THRESHOLD || '90', 10);
  return Number.isFinite(n) && n >= 10 ? Math.min(500, n) : 90;
}

function windowMs(): number {
  const n = parseInt(process.env.SECURITY_OBSERVER_WINDOW_MINUTES || '15', 10);
  return (Number.isFinite(n) && n >= 2 ? Math.min(180, n) : 15) * 60 * 1000;
}

function maxScorePerRequest(): number {
  const n = parseInt(process.env.SECURITY_OBSERVER_MAX_SCORE_PER_REQUEST || '72', 10);
  return Number.isFinite(n) && n >= 24 ? Math.min(200, n) : 72;
}

/** IPs ou prefixos (`10.1.2.*`) que nunca acumulam pontuação (monitorização, VPN fixa do staff). */
function isIpAllowlisted(ip: string): boolean {
  const raw = process.env.SECURITY_OBSERVER_IP_ALLOWLIST;
  if (!raw || !String(raw).trim()) return false;
  const n = String(ip || '').trim().toLowerCase();
  if (!n) return false;
  for (const part of String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)) {
    if (part === n) return true;
    if (part.endsWith('*') && n.startsWith(part.slice(0, -1))) return true;
  }
  return false;
}

/** Fragmentos típicos de varredura / exploit genérico (não rotas reais do app). */
const PROBE_PATH_FRAGMENTS = [
  '/wp-admin',
  '/wp-login',
  '/wp-content',
  '/wp-includes',
  'phpmyadmin',
  '/.env',
  '/.git',
  '/xmlrpc',
  '/vendor/phpunit',
  '/cgi-bin',
  '/.aws/',
  'etc/passwd',
  'SELECT%20',
  '../etc/',
  '/actuator',
  '/server-status',
  '/swagger',
  '/api-docs',
  '/graphql',
  '/.svn',
  '/.hg',
  '/console',
  '/invoker',
  '/boaform',
  '/setup.cgi',
  '/shell',
  '/.ds_store',
  '.jsp?',
  '.jsp/',
  '/backup.sql',
  '/dump.sql',
  'UNION%20SELECT',
  'UNION+SELECT',
  '%00',
  '/.kube/',
  '/config.json',
  '/telescope',
  '/_profiler',
  '/solr/',
  '/jenkins',
  '/.vscode/',
  'allow_url_include',
  'auto_prepend_file'
];

/** User-agents típicos de ferramentas de ataque (evitar marcar só "curl"). */
const MALICIOUS_UA = /\b(sqlmap|nikto|nuclei|acunetix|nessus|openvas|dirbuster|gobuster|wfuzz|masscan|zgrab|wpscan|hydra|havij|qualys|appscan|arachni|w3af|metasploit)\b/i;

function isLocalIp(ip: string): boolean {
  return (
    !ip ||
    ip === 'unknown' ||
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip === '::ffff:127.0.0.1'
  );
}

export function scoreProbePath(path: string): number {
  const p = String(path || '').toLowerCase();
  if (p.includes('/.well-known/acme-challenge')) return 0;
  if (p.includes('/.well-known/pki-validation')) return 0;
  for (const f of PROBE_PATH_FRAGMENTS) {
    if (p.includes(f.toLowerCase())) return 24;
  }
  return 0;
}

function scoreMaliciousUserAgent(ua: string | undefined): number {
  const s = typeof ua === 'string' ? ua.trim() : '';
  if (s.length < 6) return 0;
  return MALICIOUS_UA.test(s) ? 20 : 0;
}

export function scoreForHttpResponse(statusCode: number, path: string, userAgent?: string): number {
  let s = scoreProbePath(path);
  const p = String(path || '').toLowerCase();
  if (s > 0 && (statusCode === 404 || statusCode === 410 || statusCode === 405)) {
    s += 8;
  }
  /* Não pontuar falhas de login: stuffing gera muitos 401 por IP; CGNAT / IP errado no proxy bania gente inocente. */
  if (statusCode === 429) s += 14;
  s += scoreMaliciousUserAgent(userAgent);
  const cap = maxScorePerRequest();
  return Math.min(cap, s);
}

export type SecurityThreatObserverDeps = {
  pool: Pool;
  backupModel: BackupModelApi;
  getClientIp: (req: Request) => string;
};

async function applyScoreAndMaybeBan(
  pool: Pool,
  backupModel: BackupModelApi | null,
  ip: string,
  points: number
): Promise<void> {
  if (isLocalIp(ip) || isIpAllowlisted(ip) || points <= 0) return;
  const now = Date.now();
  const win = windowMs();
  const thresh = banThreshold();

  const client = await pool.connect();
  try {
    const sel = await client.query(
      `SELECT score, window_start FROM security_threat_scores WHERE ip = $1`,
      [ip]
    );
    let newScore = points;
    let windowStart = now;
    const row = sel.rows[0] as { score?: unknown; window_start?: unknown } | undefined;
    if (row) {
      const ws = Number(row.window_start);
      const sc = Number(row.score);
      if (Number.isFinite(ws) && now - ws > win) {
        newScore = points;
        windowStart = now;
      } else {
        newScore = (Number.isFinite(sc) ? sc : 0) + points;
        windowStart = Number.isFinite(ws) ? ws : now;
      }
    }
    await client.query(
      `INSERT INTO security_threat_scores (ip, score, window_start, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ip) DO UPDATE SET score = $2, window_start = $3, updated_at = $4`,
      [ip, newScore, windowStart, now]
    );

    if (newScore >= thresh) {
      if (isSecurityObserverAutoIpBanEnabled()) {
        await client.query(
          `INSERT INTO ip_blacklist (ip, reason, added_at) VALUES ($1, $2, $3)
         ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, added_at = EXCLUDED.added_at`,
          [
            ip,
            `[Observador automático] Pontuação ${newScore} (janela ~${Math.round(win / 60000)} min).`,
            now
          ]
        );
        console.warn(`[SecurityObserver] IP bloqueado automaticamente: ${ip} (score=${newScore})`);

        const doBackup =
          process.env.SECURITY_OBSERVER_BACKUP_ON_BAN !== '0' &&
          String(process.env.SECURITY_OBSERVER_BACKUP_ON_BAN).toLowerCase() !== 'false';
        if (doBackup && backupModel) {
          const lockRes = await client.query(`SELECT pg_try_advisory_lock($1::integer, $2::integer) AS ok`, [
            AUTO_SQL_BACKUP_LOCK_K1,
            AUTO_SQL_BACKUP_LOCK_K2
          ]);
          if (lockRes.rows[0]?.ok === true) {
            try {
              const r = await createScheduledSqlBackupOnce(backupModel);
              console.warn(
                `[SecurityObserver] Backup de emergência após bloqueio: ${r.filename} (${r.bytes} bytes)`
              );
            } catch (e) {
              console.error('[SecurityObserver] Backup de emergência falhou:', e);
            } finally {
              try {
                await client.query(`SELECT pg_advisory_unlock($1::integer, $2::integer)`, [
                  AUTO_SQL_BACKUP_LOCK_K1,
                  AUTO_SQL_BACKUP_LOCK_K2
                ]);
              } catch (unlockErr) {
                console.error('[SecurityObserver] advisory unlock:', unlockErr);
              }
            }
          } else {
            console.log('[SecurityObserver] Backup de emergência ignorado (lock de dump já detido).');
          }
        }
      } else {
        console.warn(
          `[SecurityObserver] Limiar ${thresh} (score ${newScore}) para ${ip} — sem ban automático (defina SECURITY_OBSERVER_AUTO_IP_BAN=1 para ativar).`
        );
      }

      await client.query(`UPDATE security_threat_scores SET score = 0, window_start = $2 WHERE ip = $1`, [
        ip,
        now
      ]);
    }
  } finally {
    client.release();
  }
}

export function recordThreatFromHttpResponse(
  pool: Pool,
  backupModel: BackupModelApi | null,
  ip: string,
  path: string,
  statusCode: number,
  userAgent?: string
): void {
  if (!isSecurityObserverEnabled()) return;
  const pts = scoreForHttpResponse(statusCode, path, userAgent);
  if (pts <= 0) return;
  void applyScoreAndMaybeBan(pool, backupModel, ip, pts).catch((e) => {
    console.warn('[SecurityObserver] recordThreat:', e instanceof Error ? e.message : e);
  });
}

/** Middleware: no `finish` da resposta, pontua por IP (não bloqueia o request). */
export function attachSecurityThreatResponseObserver(app: Express, deps: SecurityThreatObserverDeps): void {
  const { pool, backupModel, getClientIp } = deps;
  app.use((req: Request, res: Response, next) => {
    if (!isSecurityObserverEnabled()) return next();
    const ip = getClientIp(req);
    const pathOnly = String(req.originalUrl || req.url || '');
    res.on('finish', () => {
      const ua = req.headers['user-agent'];
      recordThreatFromHttpResponse(pool, backupModel, ip, pathOnly, res.statusCode, typeof ua === 'string' ? ua : undefined);
    });
    next();
  });
}

/** Varre admin_access_logs (só worker de fundo): muitas tentativas falhadas no painel. */
export async function runSecurityObserverAdminLogScan(pool: Pool, backupModel: BackupModelApi | null): Promise<void> {
  if (!isSecurityObserverEnabled()) return;
  const since = Date.now() - 12 * 60 * 1000;
  const minHits = Math.max(8, parseInt(process.env.SECURITY_OBSERVER_ADMIN_PROBE_MIN || '18', 10) || 18);
  const bonus = Math.max(10, parseInt(process.env.SECURITY_OBSERVER_ADMIN_PROBE_SCORE || '22', 10) || 22);

  const r = await pool.query(
    `SELECT ip, COUNT(*)::int AS c
       FROM admin_access_logs
      WHERE created_at > $1
        AND (
          details LIKE '%No session cookie provided%'
          OR details LIKE '%Invalid session ID:%'
          OR details LIKE '%Expired session:%'
          OR details LIKE '%attempted admin access without admin flag%'
          OR details LIKE '%Permissão admin negada:%'
        )
      GROUP BY ip
     HAVING COUNT(*) >= $2`,
    [since, minHits]
  );
  for (const row of r.rows as Array<{ ip?: string; c?: number }>) {
    const ip = String(row.ip || '');
    if (isLocalIp(ip) || isIpAllowlisted(ip)) continue;
    await applyScoreAndMaybeBan(pool, backupModel, ip, bonus);
  }
}

export function startSecurityThreatObserverBackgroundScan(
  pool: Pool,
  backupModel: BackupModelApi,
  opts?: { intervalMs?: number }
): void {
  if (!isSecurityObserverEnabled()) {
    console.log('[SecurityObserver] Desativado (SECURITY_OBSERVER_ENABLED=0).');
    return;
  }
  const intervalMs = opts?.intervalMs ?? 120_000;
  const tick = (): void => {
    void runSecurityObserverAdminLogScan(pool, backupModel).catch((e) => {
      console.warn('[SecurityObserver] scan:', e instanceof Error ? e.message : e);
    });
  };
  setInterval(tick, intervalMs);
  setTimeout(tick, 45_000);
  const allowHint = process.env.SECURITY_OBSERVER_IP_ALLOWLIST?.trim()
    ? ' allowlist=sim'
    : '';
  const autoBan = isSecurityObserverAutoIpBanEnabled() ? ' ban automático em ip_blacklist=sim' : ' ban automático=off (só pontuação)';
  console.log(
    `[SecurityObserver] Activo: janela ${windowMs() / 60000} min, limiar ${banThreshold()} pts, máx ${maxScorePerRequest()} pts/pedido, scan admin logs a cada ${Math.round(intervalMs / 1000)}s.${allowHint}${autoBan}`
  );
}
