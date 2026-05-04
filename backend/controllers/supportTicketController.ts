import crypto from 'node:crypto';
import path from 'node:path';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import multer from 'multer';
import type {
  AdminReplyBatchRow,
  PlayerReplyBatchRow,
  SupportTicketReplyDbRow,
  SupportTicketPlayerReplyDbRow
} from '../models/supportTicketModel.js';
import {
  getSupportTicketById,
  getTicketForAdminReply,
  getTicketForPlayerAction,
  insertSupportAdminReply,
  insertSupportPlayerReply,
  insertSupportTicket,
  listAdminRepliesForTicket,
  listAdminRepliesForTicketIds,
  listMySupportTicketSummaries,
  listPlayerRepliesForTicket,
  listPlayerRepliesForTicketIds,
  listTicketsForAdmin,
  updateSupportTicketStatus
} from '../models/supportTicketModel.js';
import { sendInternalErrorSafeMessage } from '../utils/apiErrorResponse.js';

const SUPPORT_UPLOAD_MAX = 12 * 1024 * 1024;
export const SUPPORT_ALLOWED_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.webm',
  '.mov'
]);

export type AppendGameActivityLog = (
  pool: Pool,
  userId: number,
  action: string,
  meta: Record<string, unknown>
) => Promise<void>;

export type SupportTicketDeps = {
  pool: Pool;
  authenticateToken: RequestHandler;
  isAdmin: RequestHandler;
  uploadSupport: ReturnType<typeof multer>;
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

function buildAttachmentsFromFiles(
  files: Express.Multer.File[] | undefined
): { list: { url: string; originalName: string; mime: string }[] } {
  const list: { url: string; originalName: string; mime: string }[] = [];
  const arr = Array.isArray(files) ? files : [];
  for (const f of arr) {
    if (!f?.filename) continue;
    const ext = path.extname(f.filename).toLowerCase();
    if (!SUPPORT_ALLOWED_EXT.has(ext)) continue;
    list.push({
      url: `/img/${f.filename}`,
      originalName: String(f.originalname || f.filename).slice(0, 200),
      mime: String(f.mimetype || '').slice(0, 120)
    });
  }
  return { list };
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
    limits: { fileSize: SUPPORT_UPLOAD_MAX, files: 5 },
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
    limits: { fileSize: SUPPORT_UPLOAD_MAX, files: 5 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (SUPPORT_ALLOWED_EXT.has(ext)) return cb(null, true);
      cb(new Error('Tipo de ficheiro não permitido (imagens ou vídeo mp4/webm/mov).'));
    }
  });
  return { uploadSupport, uploadSupportReply };
}

export function registerSupportTicketRoutes(app: Express, deps: SupportTicketDeps): void {
  const { pool, authenticateToken, isAdmin, uploadSupport, uploadSupportReply, appendGameActivityLog } = deps;

  app.post(
    '/api/support/submit',
    authenticateToken,
    (req, res, next) => {
      uploadSupport.array('files', 5)(req, res, (err: unknown) => {
        if (err) {
          const msg = err instanceof Error ? err.message : 'Erro no upload';
          return res.status(400).json({ error: msg || 'Erro no upload' });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado' });
        return;
      }
      const subjectRaw = req.body?.subject != null ? String(req.body.subject) : '';
      const messageRaw = req.body?.message != null ? String(req.body.message) : '';
      const subject = subjectRaw.trim().slice(0, 180);
      const message = messageRaw.trim().slice(0, 8000);
      if (subject.length < 3) {
        res.status(400).json({ error: 'Assunto demasiado curto (mín. 3 caracteres).' });
        return;
      }
      if (message.length < 10) {
        res.status(400).json({ error: 'Mensagem demasiado curta (mín. 10 caracteres).' });
        return;
      }
      const { list: attachments } = buildAttachmentsFromFiles(req.files as Express.Multer.File[] | undefined);
      const id = crypto.randomUUID();
      const now = Date.now();
      try {
        await insertSupportTicket(pool, {
          id,
          userId: uid,
          subject,
          message,
          attachmentsJson: JSON.stringify(attachments),
          createdAt: now
        });
        await appendGameActivityLog(pool, uid, 'support_ticket_submit', {
          ticketId: id,
          attachmentCount: attachments.length
        });
        res.json({ ok: true, id });
      } catch (e) {
        console.error('[POST /api/support/submit]', e);
        res.status(500).json({ error: 'Erro ao registar o pedido.' });
      }
    }
  );

  app.get('/api/support/my-tickets', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    try {
      const rowsRes = await listMySupportTicketSummaries(pool, uid);
      const tickets = rowsRes.rows.map((r) => {
        const createdAt = Number(r.created_at) || 0;
        const lastAdmin = Number(r.last_admin_at) || 0;
        const lastPlayer = Number(r.last_player_at) || 0;
        const lastActivityAt = Math.max(createdAt, lastAdmin, lastPlayer);
        return {
          id: r.id,
          subject: r.subject,
          status: r.status,
          createdAt,
          adminReplyCount: r.admin_reply_count ?? 0,
          lastActivityAt
        };
      });
      res.json({ tickets });
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
      const tRes = await getSupportTicketById(pool, ticketId);
      const t = tRes.rows[0];
      if (!t || Number(t.user_id) !== uid) {
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }
      const adminRes = await listAdminRepliesForTicket(pool, ticketId);
      const playerRes = await listPlayerRepliesForTicket(pool, ticketId);
      res.json({
        ticket: {
          id: t.id,
          subject: t.subject,
          message: t.message,
          attachments: asJsonArray(t.attachments),
          status: t.status,
          createdAt: Number(t.created_at) || 0
        },
        adminReplies: adminRes.rows.map((r: SupportTicketReplyDbRow) => ({
          id: r.id,
          adminUsername: r.admin_username,
          message: r.message,
          attachments: asJsonArray(r.attachments),
          createdAt: Number(r.created_at) || 0
        })),
        playerReplies: playerRes.rows.map((r: SupportTicketPlayerReplyDbRow) => ({
          id: r.id,
          message: r.message,
          attachments: asJsonArray(r.attachments),
          createdAt: Number(r.created_at) || 0
        }))
      });
    } catch (e) {
      console.error('[GET /api/support/tickets/:ticketId]', e);
      res.status(500).json({ error: 'Erro ao carregar o pedido.' });
    }
  });

  app.post(
    '/api/support/tickets/:ticketId/reply',
    authenticateToken,
    (req, res, next) => {
      uploadSupport.array('files', 5)(req, res, (err: unknown) => {
        if (err) {
          const msg = err instanceof Error ? err.message : 'Erro no upload';
          return res.status(400).json({ error: msg || 'Erro no upload' });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
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
      const messageRaw = req.body?.message != null ? String(req.body.message) : '';
      const message = messageRaw.trim().slice(0, 8000);
      const files = req.files as Express.Multer.File[] | undefined;
      const arr = Array.isArray(files) ? files : [];
      if (message.length < 3 && arr.length === 0) {
        res.status(400).json({
          error: 'Escreve uma mensagem (mín. 3 caracteres) ou anexa ficheiros.'
        });
        return;
      }
      const { list: attachments } = buildAttachmentsFromFiles(files);
      try {
        const tRes = await getTicketForPlayerAction(pool, ticketId);
        const t = tRes.rows[0];
        if (!t || Number(t.user_id) !== uid) {
          res.status(404).json({ error: 'Pedido não encontrado.' });
          return;
        }
        if (String(t.status) !== 'open') {
          res.status(403).json({
            error:
              'Este pedido está arquivado. Só podes ver a conversa. Abre um novo pedido para falar connosco de novo.'
          });
          return;
        }
        const replyId = crypto.randomUUID();
        const now = Date.now();
        await insertSupportPlayerReply(pool, {
          replyId,
          ticketId,
          userId: uid,
          message,
          attachmentsJson: JSON.stringify(attachments),
          createdAt: now
        });
        await appendGameActivityLog(pool, uid, 'support_ticket_player_reply', {
          ticketId,
          replyId,
          attachmentCount: attachments.length
        });
        res.json({ ok: true, id: replyId });
      } catch (e) {
        console.error('[POST /api/support/tickets/:ticketId/reply]', e);
        res.status(500).json({ error: 'Erro ao enviar a mensagem.' });
      }
    }
  );

  app.get('/api/admin/support-tickets', isAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(
        300,
        Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100)
      );
      const rowsRes = await listTicketsForAdmin(pool, limit);
      const ids = rowsRes.rows.map((r) => r.id);
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
        const repRes = await listAdminRepliesForTicketIds(pool, ids);
        for (const row of repRes.rows as AdminReplyBatchRow[]) {
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
        const prRes = await listPlayerRepliesForTicketIds(pool, ids);
        for (const row of prRes.rows as PlayerReplyBatchRow[]) {
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
      const rows = rowsRes.rows.map((r) => ({
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
      sendInternalErrorSafeMessage(res, 'GET /api/admin/support-tickets', e, 'Erro ao listar tickets.');
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
      const r = await updateSupportTicketStatus(pool, st, id);
      if (!r.rows[0]) {
        res.status(404).json({ error: 'Ticket não encontrado.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      sendInternalErrorSafeMessage(res, 'POST /api/admin/support-tickets/status', e, 'Erro ao atualizar estado.');
    }
  });

  app.post(
    '/api/admin/support-tickets/reply',
    isAdmin,
    (req, res, next) => {
      uploadSupportReply.array('files', 5)(req, res, (err: unknown) => {
        if (err) {
          const msg = err instanceof Error ? err.message : 'Erro no upload';
          return res.status(400).json({ error: msg || 'Erro no upload' });
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
      const { list: attachments } = buildAttachmentsFromFiles(files);
      try {
        const tRes = await getTicketForAdminReply(pool, ticketId);
        const t = tRes.rows[0];
        if (!t) {
          res.status(404).json({ error: 'Ticket não encontrado.' });
          return;
        }
        const replyId = crypto.randomUUID();
        const now = Date.now();
        await insertSupportAdminReply(pool, {
          replyId,
          ticketId,
          adminUserId: adminId,
          message,
          attachmentsJson: JSON.stringify(attachments),
          createdAt: now
        });
        await appendGameActivityLog(pool, t.user_id, 'support_ticket_admin_reply', {
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
