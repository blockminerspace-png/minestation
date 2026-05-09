import path from 'node:path';
import type { Express, Request, RequestHandler, Response } from 'express';
import type multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../../config/prisma.js';
import { compressUploadedMulterFiles } from '../../lib/compressMediaAsset.js';
import { buildAttachmentsFromFiles, sendSupportMulterError } from '../../lib/supportTicketAttachments.js';
import { SUPPORT_UPLOAD_MAX_FILES } from '../../lib/supportUploadLimits.js';
import {
  SupportMutationError,
  runSupportPlayerReplyMutation,
  runSupportSubmitTicketMutation
} from '../../models/supportMutationModel.js';
import { supportStoredNameReferencedOnTicket, updateSupportTicketStatusForUser } from '../../models/supportTicketModel.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import {
  isSafeSupportStoredFilename,
  isSupportReplyStoredName,
  supportStoredFileOwnedByUser
} from './supportAttachmentsProxy.js';
import { buildSupportStatePayload, listSupportTicketsPageForPlayer } from './supportState.service.js';

const supportMutateLimiter = rateLimit({
  windowMs: 60_000,
  max: 24,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envios de suporte. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

const supportDownloadLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados downloads. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type SupportPlayerControllerDeps = {
  authenticateToken: RequestHandler;
  uploadSupport: ReturnType<typeof multer>;
  appendGameActivityLog: (
    _q: unknown,
    userId: number,
    action: string,
    meta: Record<string, unknown>
  ) => Promise<void>;
  uploadsDir: string;
};

export function registerSupportPlayerRoutes(app: Express, deps: SupportPlayerControllerDeps): void {
  const { authenticateToken, uploadSupport, appendGameActivityLog, uploadsDir } = deps;
  const uploadsRoot = path.resolve(uploadsDir);

  app.get('/api/support/state', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const payload = await buildSupportStatePayload(uid, {
        limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined
      });
      res.json(payload);
    } catch (e) {
      console.error('[GET /api/support/state]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao carregar suporte.');
    }
  });

  app.get('/api/support/tickets', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const page = await listSupportTicketsPageForPlayer(uid, {
        limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined
      });
      res.json({ ok: true, ...page });
    } catch (e) {
      console.error('[GET /api/support/tickets]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao listar pedidos.');
    }
  });

  const uploadChain =
    (maxFiles: number) => (req: Request, res: Response, next: () => void) => {
      uploadSupport.array('files', maxFiles)(req, res, (err: unknown) => {
        if (err) {
          sendSupportMulterError(res, err);
          return;
        }
        next();
      });
    };

  app.post(
    '/api/support/tickets',
    supportMutateLimiter,
    authenticateToken,
    uploadChain(SUPPORT_UPLOAD_MAX_FILES),
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const files = req.files as Express.Multer.File[] | undefined;
      await compressUploadedMulterFiles(files);
      const { list: attachments } = buildAttachmentsFromFiles(files);
      try {
        const { id, idempotentReplay } = await runSupportSubmitTicketMutation({
          userId: uid,
          subjectRaw: req.body?.subject,
          messageRaw: req.body?.message,
          attachments,
          idempotencyKeyRaw: req.body?.idempotencyKey
        });
        await appendGameActivityLog(null, uid, 'support_ticket_submit', {
          ticketId: id,
          attachmentCount: attachments.length,
          idempotentReplay: !!idempotentReplay
        });
        res.status(idempotentReplay ? 200 : 201).json({
          ok: true,
          publicId: id,
          id,
          idempotentReplay: !!idempotentReplay
        });
      } catch (e) {
        if (e instanceof SupportMutationError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.code) payload.code = e.code;
          res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
          return;
        }
        console.error('[POST /api/support/tickets]', e);
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao criar o pedido.');
      }
    }
  );

  app.post(
    '/api/support/tickets/:ticketId/messages',
    supportMutateLimiter,
    authenticateToken,
    uploadChain(SUPPORT_UPLOAD_MAX_FILES),
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const ticketId = String(req.params.ticketId || '').trim().slice(0, 80);
      const files = req.files as Express.Multer.File[] | undefined;
      await compressUploadedMulterFiles(files);
      const { list: attachments } = buildAttachmentsFromFiles(files);
      try {
        const { replyId, idempotentReplay } = await runSupportPlayerReplyMutation({
          userId: uid,
          ticketIdRaw: ticketId,
          messageRaw: req.body?.message,
          attachments,
          idempotencyKeyRaw: req.body?.idempotencyKey
        });
        await appendGameActivityLog(null, uid, 'support_ticket_player_reply', {
          ticketId,
          replyId,
          attachmentCount: attachments.length,
          idempotentReplay: !!idempotentReplay
        });
        res.status(idempotentReplay ? 200 : 201).json({
          ok: true,
          messageId: replyId,
          id: replyId,
          idempotentReplay: !!idempotentReplay
        });
      } catch (e) {
        if (e instanceof SupportMutationError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.code) payload.code = e.code;
          res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
          return;
        }
        console.error('[POST /api/support/tickets/:ticketId/messages]', e);
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao enviar a mensagem.');
      }
    }
  );

  app.post(
    '/api/support/tickets/:ticketId/archive',
    supportMutateLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const ticketId = String(req.params.ticketId || '').trim().slice(0, 80);
      if (!ticketId) {
        res.status(400).json({ error: 'Pedido inválido.', code: 'VALIDATION' });
        return;
      }
      try {
        const n = await updateSupportTicketStatusForUser(ticketId, uid, 'archived', 'open');
        if (n === 0) {
          res.status(409).json({
            error: 'Não foi possível arquivar (já arquivado ou pedido inexistente).',
            code: 'CONFLICT'
          });
          return;
        }
        await appendGameActivityLog(null, uid, 'support_ticket_archive_user', { ticketId });
        res.json({ ok: true });
      } catch (e) {
        console.error('[POST /api/support/tickets/:ticketId/archive]', e);
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao arquivar.');
      }
    }
  );

  app.post(
    '/api/support/tickets/:ticketId/reopen',
    supportMutateLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const ticketId = String(req.params.ticketId || '').trim().slice(0, 80);
      if (!ticketId) {
        res.status(400).json({ error: 'Pedido inválido.', code: 'VALIDATION' });
        return;
      }
      try {
        const n = await updateSupportTicketStatusForUser(ticketId, uid, 'open', 'archived');
        if (n === 0) {
          res.status(409).json({
            error: 'Não foi possível reabrir (já aberto ou pedido inexistente).',
            code: 'CONFLICT'
          });
          return;
        }
        await appendGameActivityLog(null, uid, 'support_ticket_reopen_user', { ticketId });
        res.json({ ok: true });
      } catch (e) {
        console.error('[POST /api/support/tickets/:ticketId/reopen]', e);
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao reabrir.');
      }
    }
  );

  app.get(
    '/api/support/attachments/download',
    supportDownloadLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const file = String(req.query.file || '').trim();
      const ticketId = String(req.query.ticket || '').trim().slice(0, 80);
      if (!isSafeSupportStoredFilename(file)) {
        res.status(400).json({ error: 'Ficheiro inválido.', code: 'INVALID_FILE' });
        return;
      }

      let allowed = false;
      if (supportStoredFileOwnedByUser(file, uid)) {
        allowed = true;
      } else if (isSupportReplyStoredName(file)) {
        if (!ticketId) {
          res.status(400).json({ error: 'Parâmetro ticket em falta.', code: 'TICKET_REQUIRED' });
          return;
        }
        const row = await prisma.support_tickets.findUnique({
          where: { id: ticketId },
          select: { user_id: true }
        });
        if (!row || Number(row.user_id) !== uid) {
          res.status(404).json({ error: 'Não encontrado.', code: 'NOT_FOUND' });
          return;
        }
        allowed = await supportStoredNameReferencedOnTicket(ticketId, file);
      }

      if (!allowed) {
        res.status(404).json({ error: 'Não encontrado.', code: 'NOT_FOUND' });
        return;
      }

      const resolved = path.resolve(uploadsRoot, path.basename(file));
      if (!resolved.startsWith(uploadsRoot + path.sep) && resolved !== uploadsRoot) {
        res.status(400).json({ error: 'Caminho inválido.', code: 'INVALID_PATH' });
        return;
      }

      res.sendFile(path.basename(file), { root: uploadsRoot, dotfiles: 'deny' }, (err) => {
        if (err) {
          if (!res.headersSent) {
            res.status(404).json({ error: 'Ficheiro não encontrado.', code: 'NOT_FOUND' });
          }
          return;
        }
        void appendGameActivityLog(null, uid, 'support_attachment_download', {
          file: path.basename(file),
          ticketId: ticketId || null
        });
      });
    }
  );
}
