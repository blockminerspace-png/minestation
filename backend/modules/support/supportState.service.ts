import { prisma } from '../../config/prisma.js';
import { SUPPORT_UPLOAD_MAX_BYTES, SUPPORT_UPLOAD_MAX_FILES } from '../../lib/supportUploadLimits.js';
import { SUPPORT_ALLOWED_EXT } from '../../lib/supportTicketAttachments.js';
import { listMySupportTicketSummaries, type SupportTicketSummaryRow } from '../../models/supportTicketModel.js';

const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;

export type SupportPlayerTicketListItem = {
  publicId: string;
  subject: string;
  status: string;
  statusLabel: string;
  createdAt: number;
  adminReplyCount: number;
  lastActivityAt: number;
  unreadStaffReply: boolean;
};

export function mapSupportSummariesToPlayerTickets(
  summaries: SupportTicketSummaryRow[],
  pageLimit: number
): { tickets: SupportPlayerTicketListItem[]; pagination: { limit: number; nextCursor: string | null } } {
  const tickets: SupportPlayerTicketListItem[] = summaries.map((r) => {
    const createdAt = Number(r.created_at) || 0;
    const lastAdmin = Number(r.last_admin_at) || 0;
    const lastPlayer = Number(r.last_player_at) || 0;
    const lastActivityAt = Math.max(createdAt, lastAdmin, lastPlayer);
    const adminCount = r.admin_reply_count ?? 0;
    const unreadStaff =
      adminCount > 0 && lastAdmin > 0 && (lastPlayer === 0 ? lastAdmin > createdAt : lastAdmin > lastPlayer);
    return {
      publicId: r.id,
      subject: r.subject,
      status: r.status,
      statusLabel: r.status === 'archived' ? 'Arquivado' : r.status === 'open' ? 'Aberto' : String(r.status),
      createdAt,
      adminReplyCount: adminCount,
      lastActivityAt,
      unreadStaffReply: unreadStaff
    };
  });
  const nextCursor =
    summaries.length === pageLimit
      ? String(Number(summaries[summaries.length - 1].created_at) || 0)
      : null;
  return { tickets, pagination: { limit: pageLimit, nextCursor } };
}

export async function listSupportTicketsPageForPlayer(
  userId: number,
  query: { limit?: string; cursor?: string }
): Promise<{ tickets: SupportPlayerTicketListItem[]; pagination: { limit: number; nextCursor: string | null } }> {
  const lim = Math.min(
    MAX_PAGE,
    Math.max(1, parseInt(String(query.limit || String(DEFAULT_PAGE)), 10) || DEFAULT_PAGE)
  );
  const cursorRaw = String(query.cursor || '').trim();
  const cursorBi = cursorRaw && /^\d+$/.test(cursorRaw) ? BigInt(cursorRaw) : null;
  const summaries = await listMySupportTicketSummaries(userId, { limit: lim, cursorCreatedAt: cursorBi });
  return mapSupportSummariesToPlayerTickets(summaries, lim);
}

export async function buildSupportStatePayload(
  userId: number,
  query: { limit?: string; cursor?: string }
): Promise<Record<string, unknown>> {
  const lim = Math.min(
    MAX_PAGE,
    Math.max(1, parseInt(String(query.limit || String(DEFAULT_PAGE)), 10) || DEFAULT_PAGE)
  );
  const cursorRaw = String(query.cursor || '').trim();
  const cursorBi = cursorRaw && /^\d+$/.test(cursorRaw) ? BigInt(cursorRaw) : null;

  const [userRow, summaries] = await Promise.all([
    prisma.users.findUnique({
      where: { id: userId },
      select: { email: true, username: true }
    }),
    listMySupportTicketSummaries(userId, { limit: lim, cursorCreatedAt: cursorBi })
  ]);

  const { tickets, pagination } = mapSupportSummariesToPlayerTickets(summaries, lim);
  const unreadStaffReplyCount = tickets.filter((t) => t.unreadStaffReply).length;

  return {
    ok: true,
    account: {
      emailHint: userRow?.email ? maskEmailHint(userRow.email) : null,
      username: userRow?.username ?? null
    },
    limits: {
      maxAttachmentBytes: SUPPORT_UPLOAD_MAX_BYTES,
      maxAttachmentCount: SUPPORT_UPLOAD_MAX_FILES,
      maxSubjectLength: 180,
      maxMessageLength: 8000
    },
    allowedExtensions: Array.from(SUPPORT_ALLOWED_EXT).sort(),
    tickets,
    pagination,
    unreadStaffReplyCount,
    notice:
      'Anexos: imagens e vídeo (png, jpeg, webp, gif, mp4, webm, mov). Validação final no servidor. Use idempotencyKey ao criar pedidos.'
  };
}

function maskEmailHint(email: string): string {
  const e = String(email).trim();
  const at = e.indexOf('@');
  if (at <= 1) return e.slice(0, 3) + '…';
  return `${e[0]}…${e.slice(at - 1)}`;
}
