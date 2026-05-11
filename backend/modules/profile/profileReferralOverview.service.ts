/**
 * Visão completa do programa de indicações para o utilizador autenticado.
 *
 * Reusa as tabelas já existentes:
 *   - `users`                       (referral_code / referred_by)
 *   - `referrals`                   (vínculo indicador→indicado por username)
 *   - `referral_commission_ledger`  (histórico de comissões + idempotência)
 *
 * Não cria novas tabelas: as restrições de unicidade contra duplicação
 * (`idempotency_key` UNIQUE) já existem; aqui só agregamos para leitura.
 */
import { prisma } from '../../config/prisma.js';
import {
  REFERRAL_DEPOSIT_COMMISSION_PERCENT
} from '../../models/referralCommissionModel.js';

type CommissionRow = {
  id: string;
  created_at: string | number | bigint | null;
  referred_user_id: number;
  base_amount_usdc: number | string | null;
  commission_percent: number | string | null;
  commission_usdc: number | string | null;
  source_type: string | null;
  idempotency_key: string;
  referred_username: string | null;
  referred_email: string | null;
};

type ReferredRow = {
  referred_user_id: number;
  username: string | null;
  email: string | null;
  link_id: number | string | bigint | null;
  first_commission_at: number | string | bigint | null;
  total_deposit_usdc: number | string | null;
  total_commission_usdc: number | string | null;
  commissions_count: number | string | bigint | null;
};

function toNum(v: unknown): number {
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

function maskEmail(email: string | null | undefined): string | null {
  const t = String(email ?? '').trim().toLowerCase();
  if (!t || !t.includes('@')) return null;
  const [local, domain] = t.split('@');
  if (!local || !domain) return null;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

export type ReferralOverview = {
  ok: true;
  referralCode: string | null;
  inviteUrl: string | null;
  referredBy: string | null;
  stats: {
    invitedCount: number;
    totalReferredDepositsUsdc: number;
    totalCommissionUsdc: number;
    paidCommissionUsdc: number;
    pendingCommissionUsdc: number;
    commissionRate: number;
    commissionPercent: number;
    commissionsCount: number;
  };
  referredUsers: Array<{
    id: number;
    username: string | null;
    emailMasked: string | null;
    createdAt: number;
    linkId: number;
    totalDepositedUsdc: number;
    totalCommissionUsdc: number;
    commissionsCount: number;
  }>;
  commissions: Array<{
    id: string;
    createdAt: number;
    referredUser: { id: number; username: string | null; emailMasked: string | null };
    depositAmountUsdc: number;
    commissionRate: number;
    commissionAmountUsdc: number;
    sourceType: string;
    sourceTransactionId: string;
    status: 'paid';
  }>;
};

/**
 * Constrói o overview do programa de referral para um utilizador.
 *
 * Hoje toda comissão registada no ledger é creditada na mesma transação
 * que o depósito (ver `creditDepositReferralCommissionPg`), pelo que cada
 * linha do ledger conta como `paid`. Mantemos `pendingCommissionUsdc=0`
 * por contrato — se no futuro existir fluxo de hold, basta filtrar aqui.
 */
export async function buildReferralOverview(input: {
  userId: number;
  inviteBaseUrl: string;
  historyLimit?: number;
}): Promise<ReferralOverview> {
  const uid = Number(input.userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error('uid inválido em buildReferralOverview');
  }
  const limit = Math.min(200, Math.max(10, Number(input.historyLimit) || 50));

  const userRow = await prisma.users.findUnique({
    where: { id: uid },
    select: {
      id: true,
      username: true,
      referral_code: true,
      referred_by: true
    }
  });

  const referralCode = userRow?.referral_code ?? null;
  const base = String(input.inviteBaseUrl || '').replace(/\/+$/, '');
  const inviteUrl =
    referralCode && base ? `${base}?ref=${encodeURIComponent(referralCode)}` : referralCode ? `?ref=${encodeURIComponent(referralCode)}` : null;

  const [referredRows, commissionRows] = await Promise.all([
    prisma.$queryRawUnsafe<ReferredRow[]>(
      // Subqueries independentes para evitar duplicação se houver mais de uma linha
      // em `referrals` para o mesmo (user_id, referred_username) — caso contrário
      // o JOIN no MESMO SELECT multiplica SUM(commission_usdc) e SUM(base_amount_usdc).
      `
      SELECT
        u.id                                AS referred_user_id,
        u.username                          AS username,
        u.email                             AS email,
        rl.link_id                          AS link_id,
        cm.first_commission_at              AS first_commission_at,
        COALESCE(cm.total_deposit, 0)::float8    AS total_deposit_usdc,
        COALESCE(cm.total_commission, 0)::float8 AS total_commission_usdc,
        COALESCE(cm.commissions_count, 0)        AS commissions_count
      FROM users u
      JOIN (
        SELECT referred_username, MIN(id) AS link_id
        FROM referrals
        WHERE user_id = $1
        GROUP BY referred_username
      ) rl ON rl.referred_username = u.username
      LEFT JOIN (
        SELECT
          referred_user_id,
          MIN(created_at)                         AS first_commission_at,
          SUM(base_amount_usdc)                   AS total_deposit,
          SUM(commission_usdc)                    AS total_commission,
          COUNT(id)                               AS commissions_count
        FROM referral_commission_ledger
        WHERE referrer_user_id = $1
        GROUP BY referred_user_id
      ) cm ON cm.referred_user_id = u.id
      ORDER BY rl.link_id DESC
      `,
      uid
    ),
    prisma.$queryRawUnsafe<CommissionRow[]>(
      `
      SELECT
        l.id::text                AS id,
        l.created_at              AS created_at,
        l.referred_user_id        AS referred_user_id,
        l.base_amount_usdc        AS base_amount_usdc,
        l.commission_percent      AS commission_percent,
        l.commission_usdc         AS commission_usdc,
        l.source_type             AS source_type,
        l.idempotency_key         AS idempotency_key,
        u.username                AS referred_username,
        u.email                   AS referred_email
      FROM referral_commission_ledger l
      LEFT JOIN users u ON u.id = l.referred_user_id
      WHERE l.referrer_user_id = $1
      ORDER BY l.created_at DESC
      LIMIT $2
      `,
      uid,
      limit
    )
  ]);

  const referredUsers = referredRows.map((row) => ({
    id: Number(row.referred_user_id),
    username: row.username ?? null,
    emailMasked: maskEmail(row.email),
    createdAt: toMs(row.first_commission_at),
    linkId: Number(row.link_id ?? 0),
    totalDepositedUsdc: toNum(row.total_deposit_usdc),
    totalCommissionUsdc: toNum(row.total_commission_usdc),
    commissionsCount: toNum(row.commissions_count)
  }));

  const commissions = commissionRows.map((row) => ({
    id: row.id,
    createdAt: toMs(row.created_at),
    referredUser: {
      id: Number(row.referred_user_id),
      username: row.referred_username ?? null,
      emailMasked: maskEmail(row.referred_email)
    },
    depositAmountUsdc: toNum(row.base_amount_usdc),
    commissionRate: toNum(row.commission_percent) / 100,
    commissionAmountUsdc: toNum(row.commission_usdc),
    sourceType: String(row.source_type ?? 'deposit'),
    sourceTransactionId: String(row.idempotency_key ?? '').slice(0, 240),
    status: 'paid' as const
  }));

  const totalReferredDepositsUsdc = referredUsers.reduce((acc, u) => acc + u.totalDepositedUsdc, 0);
  const totalCommissionUsdc = referredUsers.reduce((acc, u) => acc + u.totalCommissionUsdc, 0);
  const commissionsCount = referredUsers.reduce((acc, u) => acc + u.commissionsCount, 0);

  return {
    ok: true,
    referralCode,
    inviteUrl,
    referredBy: userRow?.referred_by ?? null,
    stats: {
      invitedCount: referredUsers.length,
      totalReferredDepositsUsdc,
      totalCommissionUsdc,
      paidCommissionUsdc: totalCommissionUsdc,
      pendingCommissionUsdc: 0,
      commissionRate: REFERRAL_DEPOSIT_COMMISSION_PERCENT / 100,
      commissionPercent: REFERRAL_DEPOSIT_COMMISSION_PERCENT,
      commissionsCount
    },
    referredUsers,
    commissions
  };
}
