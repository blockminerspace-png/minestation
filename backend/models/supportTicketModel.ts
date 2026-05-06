import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export type SupportTicketRow = {
  id: string;
  user_id: number;
  subject: string;
  message: string;
  attachments: unknown;
  status: string;
  created_at: unknown;
};

export type SupportTicketSummaryRow = {
  id: string;
  subject: string;
  status: string;
  created_at: unknown;
  admin_reply_count: number;
  last_admin_at: unknown;
  last_player_at: unknown;
};

export type SupportTicketReplyDbRow = {
  id: string;
  message: string;
  attachments: unknown;
  created_at: unknown;
  admin_username?: string;
};

export type SupportTicketPlayerReplyDbRow = {
  id: string;
  message: string;
  attachments: unknown;
  created_at: unknown;
};

export type AdminTicketListRow = SupportTicketRow & {
  username: string;
  email: string;
};

export type AdminReplyBatchRow = {
  id: string;
  ticket_id: string;
  admin_user_id: number;
  message: string;
  attachments: unknown;
  created_at: unknown;
  admin_username: string;
};

export type PlayerReplyBatchRow = {
  id: string;
  ticket_id: string;
  message: string;
  attachments: unknown;
  created_at: unknown;
};

export async function insertSupportTicket(params: {
  id: string;
  userId: number;
  subject: string;
  message: string;
  attachmentsJson: string;
  createdAt: number;
}): Promise<void> {
  let attachments: Prisma.InputJsonValue;
  try {
    attachments = JSON.parse(params.attachmentsJson) as Prisma.InputJsonValue;
  } catch {
    attachments = [];
  }
  await prisma.support_tickets.create({
    data: {
      id: params.id,
      user_id: params.userId,
      subject: params.subject,
      message: params.message,
      attachments,
      status: 'open',
      created_at: BigInt(params.createdAt)
    }
  });
}

export async function listMySupportTicketSummaries(userId: number): Promise<SupportTicketSummaryRow[]> {
  return prisma.$queryRaw<SupportTicketSummaryRow[]>`
    SELECT t.id, t.subject, t.status, t.created_at,
      (SELECT COUNT(*)::int FROM support_ticket_replies r WHERE r.ticket_id = t.id) AS admin_reply_count,
      COALESCE((SELECT MAX(r.created_at) FROM support_ticket_replies r WHERE r.ticket_id = t.id), 0) AS last_admin_at,
      COALESCE((SELECT MAX(p.created_at) FROM support_ticket_player_replies p WHERE p.ticket_id = t.id), 0) AS last_player_at
    FROM support_tickets t
    WHERE t.user_id = ${userId}
    ORDER BY t.created_at DESC
    LIMIT 100
  `;
}

export async function getSupportTicketById(ticketId: string): Promise<SupportTicketRow | null> {
  const row = await prisma.support_tickets.findUnique({ where: { id: ticketId } });
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    subject: row.subject,
    message: row.message,
    attachments: row.attachments,
    status: row.status,
    created_at: row.created_at
  };
}

export async function listAdminRepliesForTicket(ticketId: string): Promise<SupportTicketReplyDbRow[]> {
  return prisma.$queryRaw<SupportTicketReplyDbRow[]>`
    SELECT r.id, r.message, r.attachments, r.created_at, u.username AS admin_username
    FROM support_ticket_replies r
    JOIN users u ON u.id = r.admin_user_id
    WHERE r.ticket_id = ${ticketId}
    ORDER BY r.created_at ASC
  `;
}

export async function listPlayerRepliesForTicket(ticketId: string): Promise<SupportTicketPlayerReplyDbRow[]> {
  const rows = await prisma.support_ticket_player_replies.findMany({
    where: { ticket_id: ticketId },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      message: true,
      attachments: true,
      created_at: true
    }
  });
  return rows;
}

export async function getTicketForPlayerAction(
  ticketId: string
): Promise<{ id: string; user_id: number; status: string } | null> {
  return prisma.support_tickets.findUnique({
    where: { id: ticketId },
    select: { id: true, user_id: true, status: true }
  });
}

export async function insertSupportPlayerReply(params: {
  replyId: string;
  ticketId: string;
  userId: number;
  message: string;
  attachmentsJson: string;
  createdAt: number;
}): Promise<void> {
  let attachments: Prisma.InputJsonValue;
  try {
    attachments = JSON.parse(params.attachmentsJson) as Prisma.InputJsonValue;
  } catch {
    attachments = [];
  }
  await prisma.support_ticket_player_replies.create({
    data: {
      id: params.replyId,
      ticket_id: params.ticketId,
      user_id: params.userId,
      message: params.message,
      attachments,
      created_at: BigInt(params.createdAt)
    }
  });
}

export async function listTicketsForAdmin(limit: number): Promise<AdminTicketListRow[]> {
  return prisma.$queryRaw<AdminTicketListRow[]>`
    SELECT t.id, t.user_id, t.subject, t.message, t.attachments, t.status, t.created_at,
           u.username, u.email
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
    LIMIT ${limit}
  `;
}

export async function listAdminRepliesForTicketIds(ticketIds: string[]): Promise<AdminReplyBatchRow[]> {
  if (ticketIds.length === 0) return [];
  return prisma.$queryRaw<AdminReplyBatchRow[]>`
    SELECT r.id, r.ticket_id, r.admin_user_id, r.message, r.attachments, r.created_at,
           au.username AS admin_username
    FROM support_ticket_replies r
    JOIN users au ON au.id = r.admin_user_id
    WHERE r.ticket_id IN (${Prisma.join(ticketIds)})
    ORDER BY r.created_at ASC
  `;
}

export async function listPlayerRepliesForTicketIds(ticketIds: string[]): Promise<PlayerReplyBatchRow[]> {
  if (ticketIds.length === 0) return [];
  return prisma.$queryRaw<PlayerReplyBatchRow[]>`
    SELECT id, ticket_id, message, attachments, created_at
    FROM support_ticket_player_replies
    WHERE ticket_id IN (${Prisma.join(ticketIds)})
    ORDER BY created_at ASC
  `;
}

/** Número de linhas atualizadas (0 se o ticket não existir). */
export async function updateSupportTicketStatus(status: string, id: string): Promise<number> {
  const r = await prisma.support_tickets.updateMany({
    where: { id },
    data: { status }
  });
  return r.count;
}

export async function getTicketForAdminReply(
  ticketId: string
): Promise<{ id: string; user_id: number } | null> {
  return prisma.support_tickets.findUnique({
    where: { id: ticketId },
    select: { id: true, user_id: true }
  });
}

export async function insertSupportAdminReply(params: {
  replyId: string;
  ticketId: string;
  adminUserId: number;
  message: string;
  attachmentsJson: string;
  createdAt: number;
}): Promise<void> {
  let attachments: Prisma.InputJsonValue;
  try {
    attachments = JSON.parse(params.attachmentsJson) as Prisma.InputJsonValue;
  } catch {
    attachments = [];
  }
  await prisma.support_ticket_replies.create({
    data: {
      id: params.replyId,
      ticket_id: params.ticketId,
      admin_user_id: params.adminUserId,
      message: params.message,
      attachments,
      created_at: BigInt(params.createdAt)
    }
  });
}
