import crypto from 'node:crypto';
import path from 'node:path';
import type { Express, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import type { SupportTicketReplyDbRow, SupportTicketPlayerReplyDbRow } from '../models/supportTicketModel.js';
import {
  getSupportTicketById,
  getTicketForAdminReply,
  insertSupportAdminReply,
  listAdminRepliesForTicket,
  listAdminRepliesForTicketIds,
  listMySupportTicketSummaries,
  listPlayerRepliesForTicket,
  listPlayerRepliesForTicketIds,
  listTicketsForAdmin,
  updateSupportTicketStatus
} from '../models/supportTicketModel.js';
import { SUPPORT_UPLOAD_MAX_BYTES, SUPPORT_UPLOAD_MAX_FILES } from '../lib/supportUploadLimits.js';
import {
  SUPPORT_ALLOWED_EXT,
  buildAttachmentsFromFiles,
  sendSupportMulterError
} from '../lib/supportTicketAttachments.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';
import { compressUploadedMulterFiles } from '../lib/compressMediaAsset.js';
import { rewriteSupportAttachmentsForPlayerDownload } from '../modules/support/supportAttachmentsProxy.js';
import type { SupportAttachmentItem } from '../models/supportMutationModel.js';
import { mapSupportSummariesToPlayerTickets } from '../modules/support/supportState.service.js';

/** @deprecated import from `../lib/supportTicketAttachments.js` */
export { SUPPORT_ALLOWED_EXT };

export type AppendGameActivityLog = (
  _q: unknown,
  userId: number,
  action: string,
  meta: Record<string, unknown>
) => Promise<void>;

export type SupportTicketDeps = {
  authenticateToken: RequestHandler;
  isAdmin: RequestHandler;
  uploadSupportReply: ReturnType<typeof multer>;
  appendGameActivityLog: AppendGameActivityLog;
};

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asJsonArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asAttachmentItemsPlayer(uid: number, ticketId: string, raw: unknown): SupportAttachmentItem[] {
  const arr = asJsonArray(raw);
  const list: SupportAttachmentItem[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    list.push({
      url: String(o.url ?? ''),
      originalName: String(o.originalName ?? '').slice(0, 200),
      mime: String(o.mime ?? '').slice(0, 120)
    });
  }
  return rewriteSupportAttachmentsForPlayerDownload(uid, ticketId, list);
}

/**
 * Multer para anexos de suporte (jogador e admin); ficheiros em `uploadsDir`.
 */
export function createSupportTicketUploadMiddlewares(uploadsDir: string): {
  uploadSupport: ReturnType<typeof multer>;
  uploadSupportReply: ReturnType<typeof multer>;
} {
  const supportStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uid = req.userId != null ? String(req.userId) : '0';
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `support-${uid}-${uniqueSuffix}${ext}`);
    }
  });
  const uploadSupport = multer({
    storage: supportStorage,
    limits: { fileSize: SUPPORT_UPLOAD_MAX_BYTES, files: SUPPORT_UPLOAD_MAX_FILES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (SUPPORT_ALLOWED_EXT.has(ext)) return cb(null, true);
      cb(new Error('Tipo de ficheiro não permitido (imagens ou vídeo mp4/webm/mov).'));
    }
  });
  const supportReplyStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uid = req.userId != null ? String(req.userId) : '0';
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `support-reply-${uid}-${uniqueSuffix}${ext}`);
    }
  });
  const uploadSupportReply = multer({
    storage: supportReplyStorage,
    limits: { fileSize: SUPPORT_UPLOAD_MAX_BYTES, files: SUPPORT_UPLOAD_MAX_FILES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (SUPPORT_ALLOWED_EXT.has(ext)) return cb(null, true);
      cb(new Error('Tipo de ficheiro não permitido (imagens ou vídeo mp4/webm/mov).'));
    }
  });
  return { uploadSupport, uploadSupportReply };
}

export function registerSupportTicketRoutes(app: Express, deps: SupportTicketDeps): void {
  const { authenticateToken, isAdmin, uploadSupportReply, appendGameActivityLog } = deps;

  app.get('/api/support/my-tickets', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    try {
      const lim = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
      const cursorRaw = String(req.query.cursor || '').trim();
      const cursorBi = cursorRaw && /^\d+$/.test(cursorRaw) ? BigInt(cursorRaw) : null;
      const summaryRows = await listMySupportTicketSummaries(uid, { limit: lim, cursorCreatedAt: cursorBi });
      const { tickets: mapped, pagination } = mapSupportSummariesToPlayerTickets(summaryRows, lim);
      const tickets = mapped.map((t) => ({
        id: t.publicId,
        subject: t.subject,
        status: t.status,
        createdAt: t.createdAt,
        adminReplyCount: t.adminReplyCount,
        lastActivityAt: t.lastActivityAt,
        unreadStaffReply: t.unreadStaffReply
      }));
      res.json({ tickets, pagination });
    } catch (e) {
      console.error('[GET /api/support/my-tickets]', e);
      res.status(500).json({ error: 'Erro ao listar pedidos.' });
    }
  });

  app.get('/api/support/tickets/:ticketId', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const ticketId = String(req.params.ticketId || '').trim().slice(0, 80);
    if (!ticketId) {
      res.status(400).json({ error: 'Pedido inválido.' });
      return;
    }
    try {
      const t = await getSupportTicketById(ticketId);
      if (!t || Number(t.user_id) !== uid) {
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }
      const adminReplies = await listAdminRepliesForTicket(ticketId);
      const playerReplies = await listPlayerRepliesForTicket(ticketId);
      res.json({
        ticket: {
          id: t.id,
          subject: t.subject,
          message: t.message,
          attachments: asAttachmentItemsPlayer(uid, ticketId, t.attachments),
          status: t.status,
          createdAt: Number(t.created_at) || 0
        },
        adminReplies: adminReplies.map((r: SupportTicketReplyDbRow) => ({
          id: r.id,
          adminUsername: r.admin_username,
          message: r.message,
          attachments: asAttachmentItemsPlayer(uid, ticketId, r.attachments),
          createdAt: Number(r.created_at) || 0
        })),
        playerReplies: playerReplies.map((r: SupportTicketPlayerReplyDbRow) => ({
          id: r.id,
          message: r.message,
          attachments: asAttachmentItemsPlayer(uid, ticketId, r.attachments),
          createdAt: Number(r.created_at) || 0
        }))
      });
    } catch (e) {
      console.error('[GET /api/support/tickets/:ticketId]', e);
      res.status(500).json({ error: 'Erro ao carregar o pedido.' });
    }
  });

  app.get('/api/admin/support-tickets', isAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(
        300,
        Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100)
      );
      const adminTicketRows = await listTicketsForAdmin(limit);
      const ids = adminTicketRows.map((r) => r.id);
      const repliesByTicket: Record<
        string,
        {
          id: string;
          adminUserId: number;
          adminUsername: string;
          message: string;
          attachments: unknown[];
          createdAt: number;
        }[]
      > = {};
      const playerRepliesByTicket: Record<
        string,
        { id: string; message: string; attachments: unknown[]; createdAt: number }[]
      > = {};
      if (ids.length > 0) {
        const repRows = await listAdminRepliesForTicketIds(ids);
        for (const row of repRows) {
          const tid = row.ticket_id;
          if (!repliesByTicket[tid]) repliesByTicket[tid] = [];
          repliesByTicket[tid].push({
            id: row.id,
            adminUserId: row.admin_user_id,
            adminUsername: row.admin_username,
            message: row.message,
            attachments: asJsonArray(row.attachments),
            createdAt: Number(row.created_at) || 0
          });
        }
        const prRows = await listPlayerRepliesForTicketIds(ids);
        for (const row of prRows) {
          const tid = row.ticket_id;
          if (!playerRepliesByTicket[tid]) playerRepliesByTicket[tid] = [];
          playerRepliesByTicket[tid].push({
            id: row.id,
            message: row.message,
            attachments: asJsonArray(row.attachments),
            createdAt: Number(row.created_at) || 0
          });
        }
      }
      const rows = adminTicketRows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        username: r.username,
        email: r.email,
        subject: r.subject,
        message: r.message,
        attachments: asJsonArray(r.attachments),
        status: r.status,
        createdAt: Number(r.created_at) || 0,
        replies: repliesByTicket[r.id] || [],
        playerReplies: playerRepliesByTicket[r.id] || []
      }));
      res.json({ tickets: rows });
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/admin/support-tickets', e, 'Erro ao listar tickets.');
    }
  });

  app.post('/api/admin/support-tickets/status', isAdmin, async (req: Request, res: Response) => {
    const body = req.body as { id?: unknown; status?: unknown } | undefined;
    const { id, status } = body || {};
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'id obrigatório.' });
      return;
    }
    const st = status === 'archived' ? 'archived' : 'open';
    try {
      const updated = await updateSupportTicketStatus(st, id);
      if (updated === 0) {
        res.status(404).json({ error: 'Ticket não encontrado.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/admin/support-tickets/status', e, 'Erro ao atualizar estado.');
    }
  });

  app.post(
    '/api/admin/support-tickets/reply',
    isAdmin,
    (req, res, next) => {
      uploadSupportReply.array('files', SUPPORT_UPLOAD_MAX_FILES)(req, res, (err: unknown) => {
        if (err) {
          sendSupportMulterError(res, err);
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const adminId = uidNum(req);
      if (!adminId) {
        res.status(401).json({ error: 'Não autenticado' });
        return;
      }
      const ticketIdRaw = req.body?.ticketId != null ? String(req.body.ticketId) : '';
      const ticketId = ticketIdRaw.trim().slice(0, 80);
      if (!ticketId) {
        res.status(400).json({ error: 'ticketId obrigatório.' });
        return;
      }
      const messageRaw = req.body?.message != null ? String(req.body.message) : '';
      const message = messageRaw.trim().slice(0, 8000);
      const files = req.files as Express.Multer.File[] | undefined;
      const arr = Array.isArray(files) ? files : [];
      if (message.length < 3 && arr.length === 0) {
        res.status(400).json({
          error: 'Escreva uma mensagem (mín. 3 caracteres) ou anexe ficheiros.'
        });
        return;
      }
      await compressUploadedMulterFiles(files);
      const { list: attachments } = buildAttachmentsFromFiles(files);
      try {
        const t = await getTicketForAdminReply(ticketId);
        if (!t) {
          res.status(404).json({ error: 'Ticket não encontrado.' });
          return;
        }
        const replyId = crypto.randomUUID();
        const now = Date.now();
        await insertSupportAdminReply({
          replyId,
          ticketId,
          adminUserId: adminId,
          message,
          attachmentsJson: JSON.stringify(attachments),
          createdAt: now
        });
        await appendGameActivityLog(null, t.user_id, 'support_ticket_admin_reply', {
          ticketId,
          replyId,
          adminUserId: adminId,
          attachmentCount: attachments.length
        });
        res.json({ ok: true, id: replyId });
      } catch (e) {
        console.error('[POST /api/admin/support-tickets/reply]', e);
        res.status(500).json({ error: 'Erro ao registar a resposta.' });
      }
    }
  );
}
