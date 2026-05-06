import crypto from 'node:crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import {
  countPartnerSubmissionsForUserSince,
  getPartnerAccessLevelIdsLower,
  insertPartnerYoutubeSubmission,
  listPartnerYoutubeApprovedPublic,
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
  extractYoutubeVideoId,
  partnerYoutubeUtcDayStartMs,
  userAccessSetHasPartnerLevel,
  sanitizePartnerCreatorAvatarUrl,
  sanitizePartnerCreatorChannelUrl
} from '../utils/partnerYoutubeHelpers.js';

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
      const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
      const rows = await listPartnerYoutubeApprovedPublic(limit, offset);
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
        }))
      });
    } catch (e) {
      console.error('[GET /api/partner-videos/public]', e);
      res.status(500).json({ error: 'Erro ao listar vídeos.' });
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
      const dayStart = partnerYoutubeUtcDayStartMs(Date.now());
      const usedToday = await countPartnerSubmissionsForUserSince(uid, dayStart);
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
      res.status(500).json({ error: 'Erro ao carregar envios.' });
    }
  });

  app.post('/api/partner-videos/submit', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const youtubeUrl = typeof body.youtubeUrl === 'string' ? body.youtubeUrl.trim().slice(0, 500) : '';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    if (!title || title.length < 3) {
      res.status(400).json({ error: 'Título inválido (mín. 3 caracteres).' });
      return;
    }
    if (!youtubeUrl) {
      res.status(400).json({ error: 'URL do YouTube obrigatória.' });
      return;
    }
    const vid = extractYoutubeVideoId(youtubeUrl);
    if (!vid) {
      res.status(400).json({ error: 'URL do YouTube inválida (use watch, youtu.be ou shorts).' });
      return;
    }
    const canonicalUrl = `https://www.youtube.com/watch?v=${vid}`;
    try {
      const idSet = await getPartnerAccessLevelIdsLower(uid);
      const manualListed = await isPartnerYoutubeManualAllowlisted(uid);
      if (!userAccessSetHasPartnerLevel(idSet) && !manualListed) {
        res.status(403).json({
          error:
            'Apenas contas com nível Parceiros/Partners ou adicionadas pelo admin em Parceiros YouTube podem enviar vídeos.'
        });
        return;
      }
      const dayStart = partnerYoutubeUtcDayStartMs(Date.now());
      const usedToday = await countPartnerSubmissionsForUserSince(uid, dayStart);
      if (usedToday >= 1) {
        res.status(429).json({
          error: 'Limite de 1 envio por dia (UTC) atingido. Volta amanhã.',
          code: 'PARTNER_DAILY_LIMIT'
        });
        return;
      }
      const id = crypto.randomUUID();
      const now = Date.now();
      await insertPartnerYoutubeSubmission({
        id,
        userId: uid,
        title,
        youtubeUrl: canonicalUrl,
        youtubeVideoId: vid,
        description,
        createdAt: now
      });
      try {
        await appendGameActivityLog(null, uid, 'partner_youtube_submit', { submissionId: id, videoId: vid });
      } catch {
        /* ignore */
      }
      res.json({ ok: true, id, status: 'pending' });
    } catch (e) {
      console.error('[POST /api/partner-videos/submit]', e);
      res.status(500).json({ error: 'Erro ao guardar envio.' });
    }
  });

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
        res.status(500).json({ error: 'Erro ao procurar utilizador.' });
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
      res.status(500).json({ error: 'Erro ao adicionar à lista.' });
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
      res.status(500).json({ error: 'Erro ao remover da lista.' });
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
      res.status(500).json({ error: 'Erro ao listar parceiros.' });
    }
  });

  app.get('/api/admin/partner-videos', isAdmin, async (req: Request, res: Response) => {
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
      res.status(500).json({ error: 'Erro ao listar envios.' });
    }
  });

  app.post('/api/admin/partner-videos/:id/approve', isAdmin, async (req: Request, res: Response) => {
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
      res.status(500).json({ error: 'Erro ao aprovar.' });
    }
  });

  app.post('/api/admin/partner-videos/:id/reject', isAdmin, async (req: Request, res: Response) => {
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
      res.status(500).json({ error: 'Erro ao recusar.' });
    }
  });

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
      res.status(500).json({ error: 'Erro ao carregar perfil.' });
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
      res.status(500).json({ error: 'Erro ao guardar perfil (verifica se o utilizador existe).' });
    }
  });

  app.delete('/api/admin/partner-videos/:id', isAdmin, async (req: Request, res: Response) => {
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
      res.status(500).json({ error: 'Erro ao apagar.' });
    }
  });
}
