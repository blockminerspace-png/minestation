import crypto from 'node:crypto';
import type { Pool } from 'pg';

const MAX_PAYLOAD_CHARS = 12_000;

const ALLOW_COMPONENT_KEYS = new Set([
  'userAgent',
  'language',
  'languages',
  'platform',
  'hardwareConcurrency',
  'deviceMemory',
  'timezone',
  'timezoneOffset',
  'screenResolution',
  'colorDepth',
  'pixelRatio',
  'touchSupport',
  'cookiesEnabled',
  'pdfViewerEnabled',
  'localStorage',
  'sessionStorage',
  'vendor',
  'maxTouchPoints',
  'webglVendor',
  'webglRenderer'
]);

export type DeviceFingerprintEvent = 'login' | 'register';

export type SanitizedDeviceFingerprint = {
  fingerprintHash: string;
  payloadJson: string;
};

/**
 * Normaliza o payload enviado pelo browser (apenas chaves permitidas, tamanhos limitados)
 * e devolve JSON + hash SHA-256 para deduplicação / auditoria.
 */
export function sanitizeDeviceFingerprint(raw: unknown): SanitizedDeviceFingerprint | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const safe: Record<string, unknown> = {};

  if (typeof o.visitorId === 'string' && /^[a-f0-9]{32,128}$/i.test(o.visitorId)) {
    safe.visitorId = o.visitorId.slice(0, 128);
  }

  const components = o.components;
  if (components != null && typeof components === 'object' && !Array.isArray(components)) {
    const c = components as Record<string, unknown>;
    for (const key of ALLOW_COMPONENT_KEYS) {
      if (!(key in c)) continue;
      const v = c[key];
      if (typeof v === 'string') {
        if (v.length <= 600) safe[key] = v;
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        safe[key] = v;
      } else if (typeof v === 'boolean') {
        safe[key] = v;
      }
    }
  }

  if (Object.keys(safe).length === 0) return null;

  const payloadJson = JSON.stringify(safe);
  if (payloadJson.length > MAX_PAYLOAD_CHARS) return null;

  const fingerprintHash = crypto.createHash('sha256').update(payloadJson).digest('hex');
  return { fingerprintHash, payloadJson };
}

export async function insertDeviceFingerprintLog(
  pool: Pool,
  opts: {
    userId: number;
    eventType: DeviceFingerprintEvent;
    fingerprintHash: string;
    payloadJson: string;
    ip: string;
    userAgent: string;
  }
): Promise<void> {
  if (opts.eventType !== 'login' && opts.eventType !== 'register') return;
  if (!Number.isFinite(opts.userId) || opts.userId < 1) return;
  await pool.query(
    `INSERT INTO device_fingerprint_logs (user_id, event_type, fingerprint_hash, payload_json, ip, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      opts.userId,
      opts.eventType,
      opts.fingerprintHash,
      opts.payloadJson,
      opts.ip.slice(0, 128),
      opts.userAgent.slice(0, 512),
      Date.now()
    ]
  );
}

export type AdminDeviceFingerprintLog = {
  id: string;
  userId: number;
  email: string | null;
  username: string | null;
  eventType: string;
  fingerprintHash: string;
  payloadJson: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
};

/** Lista auditoria de fingerprints (admin), com utilizador associado. */
export async function listDeviceFingerprintLogs(
  pool: Pool,
  opts: {
    limit: number;
    offset: number;
    eventType?: 'login' | 'register' | null;
    userId?: number | null;
    q?: string | null;
  }
): Promise<{ rows: AdminDeviceFingerprintLog[]; total: number }> {
  const params: unknown[] = [];
  const clauses: string[] = ['1=1'];
  let i = 1;

  if (opts.eventType === 'login' || opts.eventType === 'register') {
    clauses.push(`l.event_type = $${i++}`);
    params.push(opts.eventType);
  }
  if (opts.userId != null && Number.isFinite(opts.userId) && opts.userId > 0) {
    clauses.push(`l.user_id = $${i++}`);
    params.push(Math.floor(opts.userId));
  }
  const qRaw = (opts.q ?? '').trim().replace(/%/g, '').replace(/_/g, '').slice(0, 100);
  if (qRaw.length > 0) {
    const pat = `%${qRaw}%`;
    clauses.push(
      `(u.email ILIKE $${i} OR u.username ILIKE $${i} OR l.fingerprint_hash::text ILIKE $${i} OR COALESCE(l.ip, '') ILIKE $${i})`
    );
    params.push(pat);
    i++;
  }

  const whereSql = clauses.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM device_fingerprint_logs l INNER JOIN users u ON u.id = l.user_id WHERE ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.c ?? 0);

  const lim = Math.min(200, Math.max(1, opts.limit));
  const off = Math.max(0, opts.offset);
  const listSql = `
    SELECT l.id::text AS id, l.user_id, l.event_type, l.fingerprint_hash, l.payload_json, l.ip, l.user_agent, l.created_at,
           u.email, u.username
    FROM device_fingerprint_logs l
    INNER JOIN users u ON u.id = l.user_id
    WHERE ${whereSql}
    ORDER BY l.created_at DESC
    LIMIT $${i} OFFSET $${i + 1}
  `;
  const dataRes = await pool.query(listSql, [...params, lim, off]);

  const rows: AdminDeviceFingerprintLog[] = dataRes.rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    userId: Number(r.user_id),
    email: r.email != null ? String(r.email) : null,
    username: r.username != null ? String(r.username) : null,
    eventType: String(r.event_type),
    fingerprintHash: String(r.fingerprint_hash),
    payloadJson: r.payload_json != null ? String(r.payload_json) : null,
    ip: r.ip != null ? String(r.ip) : null,
    userAgent: r.user_agent != null ? String(r.user_agent) : null,
    createdAt: Number(r.created_at)
  }));

  return { rows, total };
}
