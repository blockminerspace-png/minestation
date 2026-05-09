import type { Express, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { PartnerYoutubeSubmitError, runPartnerYoutubeSubmitVideo } from './partnersSubmit.service.js';
import { buildPartnersStatePayload, getApprovedPartnerVideoByPublicId } from './partnersState.service.js';

const partnersSubmitLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envios. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

function uidOptional(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function uidRequired(req: Request): number | null {
  return uidOptional(req);
}

export type PartnersPlayerControllerDeps = {
  authenticateToken: RequestHandler;
  appendGameActivityLog: (
    _q: unknown,
    userId: number,
    action: string,
    meta: Record<string, unknown>
  ) => Promise<void>;
};

export function registerPartnersPlayerRoutes(app: Express, deps: PartnersPlayerControllerDeps): void {
  const { authenticateToken, appendGameActivityLog } = deps;

  app.get('/api/partners/state', async (req: Request, res: Response) => {
    try {
      const payload = await buildPartnersStatePayload({
        optionalUserId: uidOptional(req),
        query: {
          limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined
        }
      });
      res.json(payload);
    } catch (e) {
      console.error('[GET /api/partners/state]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao carregar parceiros.');
    }
  });

  app.get('/api/partners/videos', async (req: Request, res: Response) => {
    try {
      const st = await buildPartnersStatePayload({
        optionalUserId: null,
        query: {
          limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined
        }
      });
      const showcase = st.showcase as Record<string, unknown> | undefined;
      res.json({
        ok: true,
        videos: showcase?.videos ?? [],
        pagination: showcase?.pagination ?? { nextCursor: null, limit: 24 }
      });
    } catch (e) {
      console.error('[GET /api/partners/videos]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao listar vídeos.');
    }
  });

  app.get('/api/partners/videos/:publicId', async (req: Request, res: Response) => {
    const publicId = String(req.params.publicId || '').trim().slice(0, 120);
    if (!publicId) {
      res.status(400).json({ error: 'ID inválido.', code: 'VALIDATION' });
      return;
    }
    try {
      const v = await getApprovedPartnerVideoByPublicId(publicId);
      if (!v) {
        res.status(404).json({ error: 'Vídeo não encontrado.', code: 'NOT_FOUND' });
        return;
      }
      res.json({ ok: true, video: v });
    } catch (e) {
      console.error('[GET /api/partners/videos/:publicId]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao carregar vídeo.');
    }
  });

  app.get('/api/partners/my-submissions', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const st = await buildPartnersStatePayload({
        optionalUserId: uid,
        query: {}
      });
      res.json({
        ok: true,
        mySubmissions: st.mySubmissions ?? [],
        auth: st.auth
      });
    } catch (e) {
      console.error('[GET /api/partners/my-submissions]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao carregar envios.');
    }
  });

  app.post(
    '/api/partners/videos/submit',
    partnersSubmitLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      const uid = uidRequired(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      try {
        const { id } = await runPartnerYoutubeSubmitVideo({
          userId: uid,
          titleRaw: body.title,
          youtubeUrlRaw: body.youtubeUrl,
          descriptionRaw: body.description
        });
        try {
          await appendGameActivityLog(null, uid, 'partner_youtube_submit', { submissionId: id });
        } catch {
          /* ignore */
        }
        res.status(201).json({ ok: true, publicId: id, id, status: 'pending' });
      } catch (e) {
        if (e instanceof PartnerYoutubeSubmitError) {
          const code = e.code;
          const payload: Record<string, unknown> = { error: e.message };
          if (code) payload.code = code;
          res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
          return;
        }
        console.error('[POST /api/partners/videos/submit]', e);
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao guardar envio.');
      }
    }
  );
}
