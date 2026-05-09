import { prisma } from '../../config/prisma.js';

const META_MAX = 4000;

export type ProfileAuditMeta = Record<string, string | number | boolean | null | undefined>;

export async function appendProfileAuditLog(input: {
  userId: number | null;
  action: string;
  route?: string;
  requestId?: string | null;
  meta?: ProfileAuditMeta;
}): Promise<void> {
  const now = BigInt(Date.now());
  let metaStr: string | null = null;
  if (input.meta && typeof input.meta === 'object') {
    try {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.meta)) {
        if (typeof v === 'string') safe[k] = v.slice(0, 500);
        else if (typeof v === 'number' || typeof v === 'boolean' || v === null) safe[k] = v;
      }
      metaStr = JSON.stringify(safe).slice(0, META_MAX);
    } catch {
      metaStr = null;
    }
  }
  try {
    await prisma.profile_audit_log.create({
      data: {
        user_id: input.userId ?? null,
        action: String(input.action || 'unknown').slice(0, 120),
        route: input.route != null ? String(input.route).slice(0, 200) : null,
        request_id: input.requestId != null ? String(input.requestId).slice(0, 64) : null,
        meta: metaStr,
        created_at: now
      }
    });
  } catch (e) {
    console.error('[profile_audit]', e instanceof Error ? e.message : e);
  }
}

export async function listProfileSecurityEvents(userId: number, limit = 50): Promise<
  Array<{
    id: string;
    action: string;
    route: string | null;
    requestId: string | null;
    createdAt: number;
    meta: Record<string, unknown> | null;
  }>
> {
  const rows = await prisma.profile_audit_log.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      action: true,
      route: true,
      request_id: true,
      created_at: true,
      meta: true
    }
  });
  return rows.map((r) => {
    let meta: Record<string, unknown> | null = null;
    if (r.meta) {
      try {
        meta = JSON.parse(r.meta) as Record<string, unknown>;
      } catch {
        meta = null;
      }
    }
    return {
      id: r.id,
      action: r.action,
      route: r.route,
      requestId: r.request_id,
      createdAt: Number(r.created_at),
      meta
    };
  });
}
