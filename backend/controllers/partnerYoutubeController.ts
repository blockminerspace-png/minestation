import type { Express, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  countPartnerSubmissionsForUserUtcDay,
  getPartnerAccessLevelIdsLower,
  listPartnerYoutubeApprovedPublic,
  listPartnerYoutubeApprovedPublicCursor,
  listPartnerYoutubeByUser,
  listPartnerYoutubeSubmissionsForAdmin,
  updatePartnerYoutubeApprove,
  updatePartnerYoutubeReject,
  deletePartnerYoutubeSubmission,
  getPartnerYoutubeCreatorProfile,
  upsertPartnerYoutubeCreatorProfile,
  listPartnerYoutubePartnersForAdmin,
  isPartnerYoutubeManualAllowlisted,
  addPartnerYoutubeManualAllowlist,
  removePartnerYoutubeManualAllowlist,
  findUserIdsByNormalizedEmail,
  findUserIdsByNormalizedUsername,
  userExistsById
} from '../models/partnerYoutubeModel.js';
import {
  partnerYoutubeUtcDayKeyYYYYMMDD,
  parsePartnerYoutubeVideoCursor,
  userAccessSetHasPartnerLevel,
  sanitizePartnerCreatorAvatarUrl,
  sanitizePartnerCreatorChannelUrl
} from '../utils/partnerYoutubeHelpers.js';
import { PartnerYoutubeSubmitError, runPartnerYoutubeSubmitVideo } from '../modules/partners/partnersSubmit.service.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

const partnerYoutubeSubmitLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envios. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

export type AppendGameActivityLog = (
  _q: unknown,
  userId: number,
  action: string,
  meta: Record<string, unknown>
) => Promise<void>;

export type PartnerYoutubeDeps = {
  authenticateToken: RequestHandler;
  isAdmin: RequestHandler;
  appendGameActivityLog: AppendGameActivityLog;
};

function uidNum(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function registerPartnerYoutubeRoutes(app: Express, deps: PartnerYoutubeDeps): void {
  const { authenticateToken, isAdmin, appendGameActivityLog } = deps;

  app.get('/api/partner-videos/public', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(48, Math.max(1, parseInt(String(req.query.limit ?? '24'), 10) || 24));
      const cursorRaw = req.query.cursor != null ? String(req.query.cursor).trim() : '';
      const cursorParsed = cursorRaw ? parsePartnerYoutubeVideoCursor(cursorRaw) : null;
      if (cursorRaw && !cursorParsed) {
        res.status(400).json({ error: 'Cursor inválido.', code: 'INVALID_CURSOR' });
        return;
      }
      const rows = cursorParsed
        ? await listPartnerYoutubeApprovedPublicCursor(limit, cursorParsed)
        : await listPartnerYoutubeApprovedPublic(
            limit,
            Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0)
          );
      res.json({
        videos: rows.map((row) => ({
          id: row.id,
          title: row.title,
          youtubeUrl: row.youtube_url,
          youtubeVideoId: row.youtube_video_id,
          description: row.description || '',
          createdAt: Number(row.created_at) || 0,
          approvedAt: row.reviewed_at != null ? Number(row.reviewed_at) : undefined,
          username: row.username,
          userId: Number(row.user_id) || 0,
          partnerChannelUrl: row.partner_channel_url || '',
          partnerAvatarUrl: row.partner_avatar_url || ''
        })),
        pagination: cursorParsed
          ? {
              nextCursor:
                rows.length === limit
                  ? `${Number(rows[rows.length - 1].reviewed_at ?? rows[rows.length - 1].created_at) || 0}_${rows[rows.length - 1].id}`
                  : null,
              limit
            }
          : undefined
      });
    } catch (e) {
      console.error('[GET /api/partner-videos/public]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/partner-videos/public', e, 'Erro ao listar vídeos.');
    }
  });

  app.get('/api/partner-videos/my', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const idSet = await getPartnerAccessLevelIdsLower(uid);
      const manualListed = await isPartnerYoutubeManualAllowlisted(uid);
      const isPartner = userAccessSetHasPartnerLevel(idSet) || manualListed;
      const dayKey = partnerYoutubeUtcDayKeyYYYYMMDD(Date.now());
      const usedToday = await countPartnerSubmissionsForUserUtcDay(uid, dayKey);
      const listRows = await listPartnerYoutubeByUser(uid);
      res.json({
        isPartner,
        canSubmitToday: isPartner && usedToday < 1,
        submissionsToday: usedToday,
        submissions: listRows.map((row) => ({
          id: row.id,
          title: row.title,
          youtubeUrl: row.youtube_url,
          youtubeVideoId: row.youtube_video_id,
          description: row.description || '',
          status: row.status,
          createdAt: Number(row.created_at) || 0,
          reviewedAt: row.reviewed_at != null ? Number(row.reviewed_at) : undefined,
          rejectReason: row.reject_reason || undefined
        }))
      });
    } catch (e) {
      console.error('[GET /api/partner-videos/my]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/partner-videos/my', e, 'Erro ao carregar envios.');
    }
  });

  app.post(
    '/api/partner-videos/submit',
    partnerYoutubeSubmitLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
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
        res.status(201).json({ ok: true, id, publicId: id, status: 'pending' });
      } catch (e) {
        if (e instanceof PartnerYoutubeSubmitError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.code) payload.code = e.code;
          res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
          return;
        }
        console.error('[POST /api/partner-videos/submit]', e);
        sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/partner-videos/submit', e, 'Erro ao guardar envio.');
      }
    }
  );

  app.post('/api/admin/partner-youtube-allowlist', isAdmin, async (req: Request, res: Response) => {
    const adminId = uidNum(req);
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const body = (req.body || {}) as { userId?: unknown; username?: unknown };
    let userId = parseInt(String(body.userId ?? '').trim(), 10);
    if (!Number.isFinite(userId) || userId < 1) {
      const raw = typeof body.username === 'string' ? body.username.trim() : '';
      if (!raw) {
        res.status(400).json({ error: 'Indica userId ou texto (nome ou email).' });
        return;
      }
      try {
        const ids = raw.includes('@')
          ? await findUserIdsByNormalizedEmail(raw)
          : await findUserIdsByNormalizedUsername(raw);
        if (ids.length === 0) {
          res.status(404).json({ error: 'Utilizador não encontrado.' });
          return;
        }
        if (ids.length > 1) {
          res.status(400).json({ error: 'Vários resultados; escolhe na lista pelo ID ou refina a pesquisa.' });
          return;
        }
        userId = ids[0];
      } catch (e) {
        console.error('[POST /api/admin/partner-youtube-allowlist] lookup', e);
        sendInternalErrorSafeMessageOrPrisma(
          res,
          'POST /api/admin/partner-youtube-allowlist lookup',
          e,
          'Erro ao procurar utilizador.'
        );
        return;
      }
    } else {
      const ok = await userExistsById(userId);
      if (!ok) {
        res.status(404).json({ error: 'Utilizador não encontrado.' });
        return;
      }
    }
    try {
      const inserted = await addPartnerYoutubeManualAllowlist(userId, adminId, Date.now());
      res.json({ ok: true, inserted, userId });
    } catch (e) {
      console.error('[POST /api/admin/partner-youtube-allowlist]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'POST /api/admin/partner-youtube-allowlist',
        e,
        'Erro ao adicionar à lista.'
      );
    }
  });

  app.delete('/api/admin/partner-youtube-allowlist/:userId', isAdmin, async (req: Request, res: Response) => {
    if (!uidNum(req)) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const targetId = parseInt(String(req.params.userId || '').trim(), 10);
    if (!Number.isFinite(targetId) || targetId < 1) {
      res.status(400).json({ error: 'ID de utilizador inválido.' });
      return;
    }
    try {
      const removed = await removePartnerYoutubeManualAllowlist(targetId);
      if (!removed) {
        res.status(404).json({ error: 'Este utilizador não está na lista manual.' });
        return;
      }
      res.json({ ok: true, userId: targetId });
    } catch (e) {
      console.error('[DELETE /api/admin/partner-youtube-allowlist/:userId]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'DELETE /api/admin/partner-youtube-allowlist/:userId',
        e,
        'Erro ao remover da lista.'
      );
    }
  });

  app.get('/api/admin/partner-youtube-partners', isAdmin, async (_req: Request, res: Response) => {
    try {
      const partnerRows = await listPartnerYoutubePartnersForAdmin();
      res.json({
        partners: partnerRows.map((row) => ({
          userId: row.user_id,
          username: row.username,
          email: row.email,
          approvedCount: Number(row.approved_count) || 0,
          channelUrl: row.partner_channel_url || '',
          avatarUrl: row.partner_avatar_url || '',
          allowlisted: Boolean(row.is_allowlisted)
        }))
      });
    } catch (e) {
      console.error('[GET /api/admin/partner-youtube-partners]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/admin/partner-youtube-partners',
        e,
        'Erro ao listar parceiros.'
      );
    }
  });

  app.get(['/api/admin/partner-videos', '/api/admin/partners/submissions'], isAdmin, async (req: Request, res: Response) => {
    const st = String(req.query.status || 'all').toLowerCase();
    const statusFilter =
      st === 'pending' || st === 'approved' || st === 'rejected' ? (st as 'pending' | 'approved' | 'rejected') : 'all';
    try {
      const subRows = await listPartnerYoutubeSubmissionsForAdmin(statusFilter);
      res.json({
        submissions: subRows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          username: row.username,
          email: row.email,
          title: row.title,
          youtubeUrl: row.youtube_url,
          youtubeVideoId: row.youtube_video_id,
          description: row.description || '',
          status: row.status,
          createdAt: Number(row.created_at) || 0,
          reviewedAt: row.reviewed_at != null ? Number(row.reviewed_at) : undefined,
          reviewedBy: row.reviewed_by,
          rejectReason: row.reject_reason || undefined
        }))
      });
    } catch (e) {
      console.error('[GET /api/admin/partner-videos]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/admin/partner-videos', e, 'Erro ao listar envios.');
    }
  });

  app.post(
    ['/api/admin/partner-videos/:id/approve', '/api/admin/partners/videos/:id/approve'],
    isAdmin,
    async (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const adminId = uidNum(req);
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    try {
      const n = await updatePartnerYoutubeApprove(id, adminId, Date.now());
      if (!n) {
        res.status(404).json({ error: 'Envio não encontrado ou já processado.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[POST /api/admin/partner-videos/:id/approve]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/admin/partner-videos/:id/approve', e, 'Erro ao aprovar.');
    }
  }
  );

  app.post(
    ['/api/admin/partner-videos/:id/reject', '/api/admin/partners/videos/:id/reject'],
    isAdmin,
    async (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const adminId = uidNum(req);
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const body = (req.body || {}) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    try {
      const n = await updatePartnerYoutubeReject(id, adminId, reason || null, Date.now());
      if (!n) {
        res.status(404).json({ error: 'Envio não encontrado ou já processado.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[POST /api/admin/partner-videos/:id/reject]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/admin/partner-videos/:id/reject', e, 'Erro ao recusar.');
    }
  }
  );

  app.get('/api/admin/partner-youtube-creators/:userId', isAdmin, async (req: Request, res: Response) => {
    const uid = parseInt(String(req.params.userId || '').trim(), 10);
    if (!Number.isFinite(uid) || uid < 1) {
      res.status(400).json({ error: 'ID de utilizador inválido.' });
      return;
    }
    try {
      const row = await getPartnerYoutubeCreatorProfile(uid);
      res.json({
        channelUrl: row?.channel_url ?? '',
        avatarUrl: row?.avatar_url ?? ''
      });
    } catch (e) {
      console.error('[GET /api/admin/partner-youtube-creators/:userId]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/admin/partner-youtube-creators/:userId',
        e,
        'Erro ao carregar perfil.'
      );
    }
  });

  app.put('/api/admin/partner-youtube-creators/:userId', isAdmin, async (req: Request, res: Response) => {
    const uid = parseInt(String(req.params.userId || '').trim(), 10);
    if (!Number.isFinite(uid) || uid < 1) {
      res.status(400).json({ error: 'ID de utilizador inválido.' });
      return;
    }
    const adminId = uidNum(req);
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const body = (req.body || {}) as { channelUrl?: unknown; avatarUrl?: unknown };
    const rawCh = typeof body.channelUrl === 'string' ? body.channelUrl : '';
    const rawAv = typeof body.avatarUrl === 'string' ? body.avatarUrl : '';
    const channelUrl = sanitizePartnerCreatorChannelUrl(rawCh);
    const avatarUrl = sanitizePartnerCreatorAvatarUrl(rawAv);
    if (rawCh.trim() && !channelUrl) {
      res.status(400).json({ error: 'Link do canal inválido (use https:// no YouTube).' });
      return;
    }
    if (rawAv.trim() && !avatarUrl) {
      res.status(400).json({ error: 'URL da foto inválida (https:// ou caminho /...).' });
      return;
    }
    try {
      await upsertPartnerYoutubeCreatorProfile({
        userId: uid,
        channelUrl,
        avatarUrl,
        updatedAt: Date.now(),
        updatedBy: adminId
      });
      res.json({ ok: true, channelUrl, avatarUrl });
    } catch (e) {
      console.error('[PUT /api/admin/partner-youtube-creators/:userId]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'PUT /api/admin/partner-youtube-creators/:userId',
        e,
        'Erro ao guardar perfil (verifica se o utilizador existe).'
      );
    }
  });

  app.delete(
    ['/api/admin/partner-videos/:id', '/api/admin/partners/videos/:id/archive'],
    isAdmin,
    async (req: Request, res: Response) => {
    const raw = String(req.params.id || '').trim();
    if (!raw || raw.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(raw)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    if (!uidNum(req)) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    try {
      const n = await deletePartnerYoutubeSubmission(raw);
      if (!n) {
        res.status(404).json({ error: 'Envio não encontrado.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/admin/partner-videos/:id]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'DELETE /api/admin/partner-videos/:id', e, 'Erro ao apagar.');
    }
  }
  );
}
