import type { Express, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import {
  SupportMutationError,
  runSupportPlayerReplyMutation,
  runSupportSubmitTicketMutation
} from '../models/supportMutationModel.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';
import { compressUploadedMulterFiles } from '../lib/compressMediaAsset.js';
import { buildAttachmentsFromFiles, sendSupportMulterError } from '../lib/supportTicketAttachments.js';
import { SUPPORT_UPLOAD_MAX_FILES } from '../lib/supportUploadLimits.js';

const supportMutateLimiter = rateLimit({
  windowMs: 60_000,
  max: 24,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envios de suporte. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

function uidNum(req: Request): number | null {
  const v = req.userId;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseSupportMutateAction(body: unknown): 'submit_ticket' | 'player_reply' | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const a = String((body as Record<string, unknown>).action ?? '').trim();
  if (a === 'submit_ticket' || a === 'player_reply') return a;
  return null;
}

export type SupportMutationControllerDeps = {
  authenticateToken: RequestHandler;
  uploadSupport: ReturnType<typeof multer>;
  appendGameActivityLog: (
    _q: unknown,
    userId: number,
    action: string,
    meta: Record<string, unknown>
  ) => Promise<void>;
};

export function registerSupportMutationRoutes(app: Express, deps: SupportMutationControllerDeps): void {
  const { authenticateToken, uploadSupport, appendGameActivityLog } = deps;

  app.post(
    '/api/support/mutate',
    supportMutateLimiter,
    authenticateToken,
    (req: Request, res: Response, next: () => void) => {
      uploadSupport.array('files', SUPPORT_UPLOAD_MAX_FILES)(req, res, (err: unknown) => {
        if (err) {
          sendSupportMulterError(res, err);
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const action = parseSupportMutateAction(req.body);
      if (!action) {
        res.status(400).json({ error: 'Ação inválida ou em falta.', code: 'INVALID_ACTION' });
        return;
      }
      const files = req.files as Express.Multer.File[] | undefined;
      await compressUploadedMulterFiles(files);
      const { list: attachments } = buildAttachmentsFromFiles(files);
      try {
        if (action === 'submit_ticket') {
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
          res.json({ ok: true, id, action: 'submit_ticket', idempotentReplay: !!idempotentReplay });
          return;
        }
        const { replyId, idempotentReplay } = await runSupportPlayerReplyMutation({
          userId: uid,
          ticketIdRaw: req.body?.ticketId,
          messageRaw: req.body?.message,
          attachments,
          idempotencyKeyRaw: req.body?.idempotencyKey
        });
        const ticketId = String(req.body?.ticketId ?? '')
          .trim()
          .slice(0, 80);
        await appendGameActivityLog(null, uid, 'support_ticket_player_reply', {
          ticketId,
          replyId,
          attachmentCount: attachments.length
        });
        res.json({ ok: true, id: replyId, action: 'player_reply', idempotentReplay: !!idempotentReplay });
      } catch (e) {
        if (e instanceof SupportMutationError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.code) payload.code = e.code;
          res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
          return;
        }
        console.error('[POST /api/support/mutate]', e);
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao processar o pedido.');
      }
    }
  );
}
