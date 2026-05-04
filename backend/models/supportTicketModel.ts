import type { Pool, QueryResult } from 'pg';

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

export async function insertSupportTicket(
  pool: Pool,
  params: {
    id: string;
    userId: number;
    subject: string;
    message: string;
    attachmentsJson: string;
    createdAt: number;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO support_tickets (id, user_id, subject, message, attachments, status, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'open', $6)`,
    [params.id, params.userId, params.subject, params.message, params.attachmentsJson, params.createdAt]
  );
}

export async function listMySupportTicketSummaries(
  pool: Pool,
  userId: number
): Promise<QueryResult<SupportTicketSummaryRow>> {
  return pool.query(
    `SELECT t.id, t.subject, t.status, t.created_at,
            (SELECT COUNT(*)::int FROM support_ticket_replies r WHERE r.ticket_id = t.id) AS admin_reply_count,
            COALESCE((SELECT MAX(r.created_at) FROM support_ticket_replies r WHERE r.ticket_id = t.id), 0) AS last_admin_at,
            COALESCE((SELECT MAX(p.created_at) FROM support_ticket_player_replies p WHERE p.ticket_id = t.id), 0) AS last_player_at
     FROM support_tickets t
     WHERE t.user_id = $1
     ORDER BY t.created_at DESC
     LIMIT 100`,
    [userId]
  );
}

export async function getSupportTicketById(
  pool: Pool,
  ticketId: string
): Promise<QueryResult<SupportTicketRow>> {
  return pool.query(
    `SELECT id, user_id, subject, message, attachments, status, created_at FROM support_tickets WHERE id = $1`,
    [ticketId]
  );
}

export async function listAdminRepliesForTicket(
  pool: Pool,
  ticketId: string
): Promise<QueryResult<SupportTicketReplyDbRow>> {
  return pool.query(
    `SELECT r.id, r.message, r.attachments, r.created_at, u.username AS admin_username
     FROM support_ticket_replies r
     JOIN users u ON u.id = r.admin_user_id
     WHERE r.ticket_id = $1
     ORDER BY r.created_at ASC`,
    [ticketId]
  );
}

export async function listPlayerRepliesForTicket(
  pool: Pool,
  ticketId: string
): Promise<QueryResult<SupportTicketPlayerReplyDbRow>> {
  return pool.query(
    `SELECT id, message, attachments, created_at FROM support_ticket_player_replies WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId]
  );
}

export async function getTicketForPlayerAction(
  pool: Pool,
  ticketId: string
): Promise<QueryResult<{ id: string; user_id: number; status: string }>> {
  return pool.query(`SELECT id, user_id, status FROM support_tickets WHERE id = $1`, [ticketId]);
}

export async function insertSupportPlayerReply(
  pool: Pool,
  params: {
    replyId: string;
    ticketId: string;
    userId: number;
    message: string;
    attachmentsJson: string;
    createdAt: number;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO support_ticket_player_replies (id, ticket_id, user_id, message, attachments, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      params.replyId,
      params.ticketId,
      params.userId,
      params.message,
      params.attachmentsJson,
      params.createdAt
    ]
  );
}

export async function listTicketsForAdmin(
  pool: Pool,
  limit: number
): Promise<QueryResult<AdminTicketListRow>> {
  return pool.query(
    `SELECT t.id, t.user_id, t.subject, t.message, t.attachments, t.status, t.created_at,
            u.username, u.email
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     ORDER BY t.created_at DESC
     LIMIT $1`,
    [limit]
  );
}

export async function listAdminRepliesForTicketIds(
  pool: Pool,
  ticketIds: string[]
): Promise<QueryResult<AdminReplyBatchRow>> {
  return pool.query(
    `SELECT r.id, r.ticket_id, r.admin_user_id, r.message, r.attachments, r.created_at,
            au.username AS admin_username
     FROM support_ticket_replies r
     JOIN users au ON au.id = r.admin_user_id
     WHERE r.ticket_id = ANY($1::text[])
     ORDER BY r.created_at ASC`,
    [ticketIds]
  );
}

export async function listPlayerRepliesForTicketIds(
  pool: Pool,
  ticketIds: string[]
): Promise<QueryResult<PlayerReplyBatchRow>> {
  return pool.query(
    `SELECT id, ticket_id, message, attachments, created_at
     FROM support_ticket_player_replies
     WHERE ticket_id = ANY($1::text[])
     ORDER BY created_at ASC`,
    [ticketIds]
  );
}

export async function updateSupportTicketStatus(
  pool: Pool,
  status: string,
  id: string
): Promise<QueryResult<{ id: string }>> {
  return pool.query('UPDATE support_tickets SET status = $1 WHERE id = $2 RETURNING id', [status, id]);
}

export async function getTicketForAdminReply(
  pool: Pool,
  ticketId: string
): Promise<QueryResult<{ id: string; user_id: number }>> {
  return pool.query('SELECT id, user_id FROM support_tickets WHERE id = $1', [ticketId]);
}

export async function insertSupportAdminReply(
  pool: Pool,
  params: {
    replyId: string;
    ticketId: string;
    adminUserId: number;
    message: string;
    attachmentsJson: string;
    createdAt: number;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO support_ticket_replies (id, ticket_id, admin_user_id, message, attachments, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      params.replyId,
      params.ticketId,
      params.adminUserId,
      params.message,
      params.attachmentsJson,
      params.createdAt
    ]
  );
}
