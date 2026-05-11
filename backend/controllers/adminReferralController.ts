/**
 * Endpoints admin do programa de referral.
 *
 * Reusa as tabelas já existentes:
 *   - `users`                       (indicador/indicado)
 *   - `referrals`                   (vínculo por username)
 *   - `referral_commission_ledger`  (histórico de comissões, idempotente)
 *
 * Apenas operações de **leitura**: não permite ajustar comissões via API admin
 * (uma decisão consciente — se preciso, criar fluxo dedicado e auditado).
 * Todos os endpoints exigem o middleware `isAdmin`.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';
import { REFERRAL_DEPOSIT_COMMISSION_PERCENT } from '../models/referralCommissionModel.js';

export type AdminReferralDeps = {
  isAdmin: RequestHandler;
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function parseDateMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function asNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toMs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function registerAdminReferralRoutes(app: Express, deps: AdminReferralDeps): void {
  const { isAdmin } = deps;

  /**
   * GET /api/admin/referrals/summary
   *
   * Indicadores activos, vínculos totais, totais financeiros, top indicadores,
   * taxa actual da comissão.
   */
  app.get('/api/admin/referrals/summary', isAdmin, async (req: Request, res: Response) => {
    try {
      const [overall, distinct, topReferrers] = await Promise.all([
        prisma.$queryRawUnsafe<
          Array<{
            commission_count: bigint | number | string | null;
            base_total: number | string | null;
            commission_total: number | string | null;
          }>
        >(
          `SELECT
              COUNT(*)                                     AS commission_count,
              COALESCE(SUM(base_amount_usdc), 0)::float8   AS base_total,
              COALESCE(SUM(commission_usdc), 0)::float8    AS commission_total
            FROM referral_commission_ledger`
        ),
        prisma.$queryRawUnsafe<
          Array<{
            unique_referrers: bigint | number | string | null;
            total_links: bigint | number | string | null;
            referred_distinct: bigint | number | string | null;
          }>
        >(
          `SELECT
              COUNT(DISTINCT user_id)                       AS unique_referrers,
              COUNT(*)                                      AS total_links,
              COUNT(DISTINCT referred_username)             AS referred_distinct
            FROM referrals`
        ),
        prisma.$queryRawUnsafe<
          Array<{
            referrer_user_id: number;
            username: string | null;
            email: string | null;
            invited_count: bigint | number | string | null;
            commission_total: number | string | null;
          }>
        >(
          `SELECT
              u.id                                            AS referrer_user_id,
              u.username                                      AS username,
              u.email                                         AS email,
              COUNT(DISTINCT r.referred_username)             AS invited_count,
              COALESCE(SUM(l.commission_usdc), 0)::float8     AS commission_total
            FROM users u
            LEFT JOIN referrals r ON r.user_id = u.id
            LEFT JOIN referral_commission_ledger l ON l.referrer_user_id = u.id
            GROUP BY u.id, u.username, u.email
            HAVING COUNT(DISTINCT r.referred_username) > 0
            ORDER BY commission_total DESC NULLS LAST, invited_count DESC NULLS LAST
            LIMIT 10`
        )
      ]);

      const o = overall[0] || ({} as Record<string, unknown>);
      const d = distinct[0] || ({} as Record<string, unknown>);

      res.json({
        ok: true,
        commissionPercent: REFERRAL_DEPOSIT_COMMISSION_PERCENT,
        commissionRate: REFERRAL_DEPOSIT_COMMISSION_PERCENT / 100,
        stats: {
          uniqueReferrers: asNum(d.unique_referrers),
          totalLinks: asNum(d.total_links),
          referredDistinct: asNum(d.referred_distinct),
          commissionsCount: asNum(o.commission_count),
          totalReferredDepositsUsdc: asNum(o.base_total),
          totalCommissionPaidUsdc: asNum(o.commission_total),
          pendingCommissionUsdc: 0
        },
        topReferrers: topReferrers.map((row) => ({
          id: Number(row.referrer_user_id),
          username: row.username ?? null,
          email: row.email ?? null,
          invitedCount: asNum(row.invited_count),
          commissionTotalUsdc: asNum(row.commission_total)
        }))
      });
    } catch (e) {
      console.error('[AdminReferralReport] summary', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        '[GET /api/admin/referrals/summary]',
        e,
        'Erro ao carregar resumo de referral.'
      );
    }
  });

  /**
   * GET /api/admin/referrals/commissions
   *
   * Histórico paginado de comissões com filtros: período, indicador, indicado,
   * mínimo/máximo de comissão, status.
   *
   * Hoje todas as linhas do ledger estão pagas (créditos ocorrem na mesma
   * transação do depósito). Mantemos o campo `status` na resposta para
   * compatibilidade futura.
   */
  app.get('/api/admin/referrals/commissions', isAdmin, async (req: Request, res: Response) => {
    try {
      const page = clamp(parseInt(String(req.query.page ?? '1'), 10), 1, 99999);
      const limit = clamp(parseInt(String(req.query.limit ?? '50'), 10), 1, 500);
      const offset = (page - 1) * limit;

      const startMs = parseDateMs(req.query.startDate);
      const endMs = parseDateMs(req.query.endDate);
      const referrer = typeof req.query.referrer === 'string' ? req.query.referrer.trim() : '';
      const referred = typeof req.query.referred === 'string' ? req.query.referred.trim() : '';
      const minComm = parseFloat(String(req.query.minCommission ?? ''));
      const maxComm = parseFloat(String(req.query.maxCommission ?? ''));
      const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      const where: string[] = [];
      const params: unknown[] = [];
      if (Number.isFinite(startMs)) {
        params.push(startMs);
        where.push(`l.created_at >= $${params.length}`);
      }
      if (Number.isFinite(endMs)) {
        params.push(endMs);
        where.push(`l.created_at <= $${params.length}`);
      }
      if (referrer) {
        params.push(referrer.toLowerCase());
        where.push(
          `(LOWER(ur.username) = $${params.length} OR LOWER(ur.email) = $${params.length} OR (CASE WHEN ur.id::text = $${params.length} THEN TRUE ELSE FALSE END))`
        );
      }
      if (referred) {
        params.push(referred.toLowerCase());
        where.push(
          `(LOWER(ud.username) = $${params.length} OR LOWER(ud.email) = $${params.length} OR (CASE WHEN ud.id::text = $${params.length} THEN TRUE ELSE FALSE END))`
        );
      }
      if (Number.isFinite(minComm)) {
        params.push(minComm);
        where.push(`l.commission_usdc >= $${params.length}`);
      }
      if (Number.isFinite(maxComm)) {
        params.push(maxComm);
        where.push(`l.commission_usdc <= $${params.length}`);
      }
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where.push(
          `(LOWER(COALESCE(ur.username,'')) LIKE $${params.length} OR LOWER(COALESCE(ur.email,'')) LIKE $${params.length} OR LOWER(COALESCE(ud.username,'')) LIKE $${params.length} OR LOWER(COALESCE(ud.email,'')) LIKE $${params.length} OR LOWER(COALESCE(l.idempotency_key,'')) LIKE $${params.length})`
        );
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const totalRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number | string | null }>>(
        `SELECT COUNT(*)::bigint AS total
           FROM referral_commission_ledger l
           LEFT JOIN users ur ON ur.id = l.referrer_user_id
           LEFT JOIN users ud ON ud.id = l.referred_user_id
           ${whereSql}`,
        ...params
      );
      const total = asNum(totalRows[0]?.total);

      const paramsList = [...params, limit, offset];
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          created_at: number | string | bigint | null;
          idempotency_key: string;
          source_type: string | null;
          base_amount_usdc: number | string | null;
          commission_percent: number | string | null;
          commission_usdc: number | string | null;
          referrer_user_id: number;
          referrer_username: string | null;
          referrer_email: string | null;
          referred_user_id: number;
          referred_username: string | null;
          referred_email: string | null;
        }>
      >(
        `SELECT
            l.id::text                 AS id,
            l.created_at               AS created_at,
            l.idempotency_key          AS idempotency_key,
            l.source_type              AS source_type,
            l.base_amount_usdc         AS base_amount_usdc,
            l.commission_percent       AS commission_percent,
            l.commission_usdc          AS commission_usdc,
            l.referrer_user_id         AS referrer_user_id,
            ur.username                AS referrer_username,
            ur.email                   AS referrer_email,
            l.referred_user_id         AS referred_user_id,
            ud.username                AS referred_username,
            ud.email                   AS referred_email
          FROM referral_commission_ledger l
          LEFT JOIN users ur ON ur.id = l.referrer_user_id
          LEFT JOIN users ud ON ud.id = l.referred_user_id
          ${whereSql}
          ORDER BY l.created_at DESC
          LIMIT $${paramsList.length - 1} OFFSET $${paramsList.length}`,
        ...paramsList
      );

      res.json({
        ok: true,
        page,
        limit,
        total,
        rows: rows.map((r) => ({
          id: r.id,
          createdAt: toMs(r.created_at),
          sourceType: String(r.source_type ?? 'deposit'),
          sourceTransactionId: String(r.idempotency_key ?? ''),
          depositAmountUsdc: asNum(r.base_amount_usdc),
          commissionPercent: asNum(r.commission_percent),
          commissionRate: asNum(r.commission_percent) / 100,
          commissionAmountUsdc: asNum(r.commission_usdc),
          referrer: {
            id: Number(r.referrer_user_id),
            username: r.referrer_username ?? null,
            email: r.referrer_email ?? null
          },
          referred: {
            id: Number(r.referred_user_id),
            username: r.referred_username ?? null,
            email: r.referred_email ?? null
          },
          status: 'paid' as const
        }))
      });
    } catch (e) {
      console.error('[AdminReferralReport] commissions', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        '[GET /api/admin/referrals/commissions]',
        e,
        'Erro ao listar comissões.'
      );
    }
  });

  /**
   * GET /api/admin/referrals/links
   *
   * Vínculos indicador↔indicado, com totais agregados (depósito, comissão).
   */
  app.get('/api/admin/referrals/links', isAdmin, async (req: Request, res: Response) => {
    try {
      const page = clamp(parseInt(String(req.query.page ?? '1'), 10), 1, 99999);
      const limit = clamp(parseInt(String(req.query.limit ?? '50'), 10), 1, 500);
      const offset = (page - 1) * limit;
      const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      const params: unknown[] = [];
      const where: string[] = [];
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where.push(
          `(LOWER(COALESCE(ur.username,'')) LIKE $${params.length} OR LOWER(COALESCE(ur.email,'')) LIKE $${params.length} OR LOWER(COALESCE(ud.username,'')) LIKE $${params.length} OR LOWER(COALESCE(ud.email,'')) LIKE $${params.length})`
        );
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const totalRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number | string | null }>>(
        `SELECT COUNT(*)::bigint AS total
           FROM referrals r
           JOIN users ur ON ur.id = r.user_id
           LEFT JOIN users ud ON ud.username = r.referred_username
           ${whereSql}`,
        ...params
      );
      const total = asNum(totalRows[0]?.total);

      const paramsList = [...params, limit, offset];
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          link_id: number;
          referrer_user_id: number;
          referrer_username: string | null;
          referrer_email: string | null;
          referred_username_raw: string | null;
          referred_user_id: number | null;
          referred_email: string | null;
          first_commission_at: number | string | bigint | null;
          total_deposit_usdc: number | string | null;
          total_commission_usdc: number | string | null;
        }>
      >(
        `SELECT
            r.id                                            AS link_id,
            r.user_id                                       AS referrer_user_id,
            ur.username                                     AS referrer_username,
            ur.email                                        AS referrer_email,
            r.referred_username                             AS referred_username_raw,
            ud.id                                           AS referred_user_id,
            ud.email                                        AS referred_email,
            MIN(l.created_at)                               AS first_commission_at,
            COALESCE(SUM(l.base_amount_usdc), 0)::float8    AS total_deposit_usdc,
            COALESCE(SUM(l.commission_usdc), 0)::float8     AS total_commission_usdc
          FROM referrals r
          JOIN users ur ON ur.id = r.user_id
          LEFT JOIN users ud ON ud.username = r.referred_username
          LEFT JOIN referral_commission_ledger l
            ON l.referrer_user_id = r.user_id AND l.referred_user_id = ud.id
          ${whereSql}
          GROUP BY r.id, r.user_id, ur.username, ur.email, r.referred_username, ud.id, ud.email
          ORDER BY r.id DESC
          LIMIT $${paramsList.length - 1} OFFSET $${paramsList.length}`,
        ...paramsList
      );

      res.json({
        ok: true,
        page,
        limit,
        total,
        rows: rows.map((r) => ({
          linkId: Number(r.link_id),
          referrer: {
            id: Number(r.referrer_user_id),
            username: r.referrer_username ?? null,
            email: r.referrer_email ?? null
          },
          referred: {
            id: r.referred_user_id != null ? Number(r.referred_user_id) : null,
            username: r.referred_username_raw ?? null,
            email: r.referred_email ?? null
          },
          firstCommissionAt: toMs(r.first_commission_at),
          totalDepositedUsdc: asNum(r.total_deposit_usdc),
          totalCommissionUsdc: asNum(r.total_commission_usdc)
        }))
      });
    } catch (e) {
      console.error('[AdminReferralReport] links', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        '[GET /api/admin/referrals/links]',
        e,
        'Erro ao listar vínculos.'
      );
    }
  });

  /**
   * GET /api/admin/referrals/export.csv
   *
   * Exporta o histórico de comissões (com os filtros aplicados) para CSV.
   * Limite duro de 50 000 linhas por chamada — proteger memória.
   */
  app.get('/api/admin/referrals/export.csv', isAdmin, async (req: Request, res: Response) => {
    try {
      const startMs = parseDateMs(req.query.startDate);
      const endMs = parseDateMs(req.query.endDate);
      const referrer = typeof req.query.referrer === 'string' ? req.query.referrer.trim() : '';
      const referred = typeof req.query.referred === 'string' ? req.query.referred.trim() : '';
      const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      const params: unknown[] = [];
      const where: string[] = [];
      if (Number.isFinite(startMs)) {
        params.push(startMs);
        where.push(`l.created_at >= $${params.length}`);
      }
      if (Number.isFinite(endMs)) {
        params.push(endMs);
        where.push(`l.created_at <= $${params.length}`);
      }
      if (referrer) {
        params.push(referrer.toLowerCase());
        where.push(
          `(LOWER(ur.username) = $${params.length} OR LOWER(ur.email) = $${params.length})`
        );
      }
      if (referred) {
        params.push(referred.toLowerCase());
        where.push(
          `(LOWER(ud.username) = $${params.length} OR LOWER(ud.email) = $${params.length})`
        );
      }
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where.push(
          `(LOWER(COALESCE(ur.username,'')) LIKE $${params.length} OR LOWER(COALESCE(ud.username,'')) LIKE $${params.length} OR LOWER(COALESCE(l.idempotency_key,'')) LIKE $${params.length})`
        );
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          created_at: number | string | bigint | null;
          idempotency_key: string;
          source_type: string | null;
          base_amount_usdc: number | string | null;
          commission_percent: number | string | null;
          commission_usdc: number | string | null;
          referrer_username: string | null;
          referrer_email: string | null;
          referred_username: string | null;
          referred_email: string | null;
        }>
      >(
        `SELECT
            l.id::text                 AS id,
            l.created_at               AS created_at,
            l.idempotency_key          AS idempotency_key,
            l.source_type              AS source_type,
            l.base_amount_usdc         AS base_amount_usdc,
            l.commission_percent       AS commission_percent,
            l.commission_usdc          AS commission_usdc,
            ur.username                AS referrer_username,
            ur.email                   AS referrer_email,
            ud.username                AS referred_username,
            ud.email                   AS referred_email
          FROM referral_commission_ledger l
          LEFT JOIN users ur ON ur.id = l.referrer_user_id
          LEFT JOIN users ud ON ud.id = l.referred_user_id
          ${whereSql}
          ORDER BY l.created_at DESC
          LIMIT 50000`,
        ...params
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="referral-commissions-${Date.now()}.csv"`);

      const header = [
        'id',
        'created_at_iso',
        'created_at_ms',
        'source_type',
        'source_transaction_id',
        'referrer_username',
        'referrer_email',
        'referred_username',
        'referred_email',
        'deposit_usdc',
        'commission_percent',
        'commission_usdc',
        'status'
      ];
      const lines: string[] = [header.join(',')];
      for (const r of rows) {
        const ms = toMs(r.created_at);
        lines.push(
          [
            csvCell(r.id),
            csvCell(ms ? new Date(ms).toISOString() : ''),
            csvCell(ms),
            csvCell(r.source_type ?? 'deposit'),
            csvCell(r.idempotency_key ?? ''),
            csvCell(r.referrer_username ?? ''),
            csvCell(r.referrer_email ?? ''),
            csvCell(r.referred_username ?? ''),
            csvCell(r.referred_email ?? ''),
            csvCell(asNum(r.base_amount_usdc).toFixed(8)),
            csvCell(asNum(r.commission_percent).toFixed(4)),
            csvCell(asNum(r.commission_usdc).toFixed(8)),
            csvCell('paid')
          ].join(',')
        );
      }
      res.send(lines.join('\n'));
    } catch (e) {
      console.error('[AdminReferralReport] export.csv', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        '[GET /api/admin/referrals/export.csv]',
        e,
        'Erro ao exportar comissões.'
      );
    }
  });
}
