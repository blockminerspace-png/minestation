import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

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

export async function insertDeviceFingerprintLog(opts: {
  userId: number;
  eventType: DeviceFingerprintEvent;
  fingerprintHash: string;
  payloadJson: string;
  ip: string;
  userAgent: string;
}): Promise<void> {
  if (opts.eventType !== 'login' && opts.eventType !== 'register') return;
  if (!Number.isFinite(opts.userId) || opts.userId < 1) return;
  await prisma.device_fingerprint_logs.create({
    data: {
      user_id: opts.userId,
      event_type: opts.eventType,
      fingerprint_hash: opts.fingerprintHash,
      payload_json: opts.payloadJson,
      ip: opts.ip.slice(0, 128),
      user_agent: opts.userAgent.slice(0, 512),
      created_at: BigInt(Date.now())
    }
  });
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
export async function listDeviceFingerprintLogs(opts: {
  limit: number;
  offset: number;
  eventType?: 'login' | 'register' | null;
  userId?: number | null;
  q?: string | null;
}): Promise<{ rows: AdminDeviceFingerprintLog[]; total: number }> {
  const lim = Math.min(200, Math.max(1, opts.limit));
  const off = Math.max(0, opts.offset);

  const and: Prisma.device_fingerprint_logsWhereInput[] = [];

  if (opts.eventType === 'login' || opts.eventType === 'register') {
    and.push({ event_type: opts.eventType });
  }
  if (opts.userId != null && Number.isFinite(opts.userId) && opts.userId > 0) {
    and.push({ user_id: Math.floor(opts.userId) });
  }

  const qRaw = (opts.q ?? '').trim().replace(/%/g, '').replace(/_/g, '').slice(0, 100);
  if (qRaw.length > 0) {
    const matchingUsers = await prisma.users.findMany({
      where: {
        OR: [
          { email: { contains: qRaw, mode: 'insensitive' } },
          { username: { contains: qRaw, mode: 'insensitive' } }
        ]
      },
      select: { id: true }
    });
    const ids = matchingUsers.map((u) => u.id);
    and.push({
      OR: [
        { fingerprint_hash: { contains: qRaw, mode: 'insensitive' } },
        { ip: { contains: qRaw, mode: 'insensitive' } },
        ...(ids.length > 0 ? [{ user_id: { in: ids } }] : [])
      ]
    });
  }

  const where: Prisma.device_fingerprint_logsWhereInput =
    and.length > 0 ? { AND: and } : {};

  const total = await prisma.device_fingerprint_logs.count({ where });

  const logs = await prisma.device_fingerprint_logs.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: lim,
    skip: off
  });

  const userIds = [...new Set(logs.map((l) => l.user_id))];
  const users =
    userIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, username: true }
        })
      : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const rows: AdminDeviceFingerprintLog[] = logs.map((l) => {
    const u = byId.get(l.user_id);
    return {
      id: String(l.id),
      userId: l.user_id,
      email: u?.email ?? null,
      username: u?.username ?? null,
      eventType: l.event_type,
      fingerprintHash: l.fingerprint_hash,
      payloadJson: l.payload_json,
      ip: l.ip,
      userAgent: l.user_agent,
      createdAt: Number(l.created_at)
    };
  });

  return { rows, total };
}
