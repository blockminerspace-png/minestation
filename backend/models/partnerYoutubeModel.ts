import type { Pool, QueryResult } from 'pg';

export async function ensurePartnerYoutubeSchema(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_youtube_submissions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        youtube_url TEXT NOT NULL,
        youtube_video_id TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL,
        reviewed_at BIGINT,
        reviewed_by INTEGER REFERENCES users(id),
        reject_reason TEXT,
        CONSTRAINT partner_youtube_submissions_status_chk CHECK (status IN ('pending','approved','rejected'))
      );
      CREATE INDEX IF NOT EXISTS idx_partner_youtube_user_created ON partner_youtube_submissions (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_partner_youtube_status ON partner_youtube_submissions (status, reviewed_at DESC);

      CREATE TABLE IF NOT EXISTS partner_youtube_creator_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        channel_url TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        updated_at BIGINT NOT NULL DEFAULT 0,
        updated_by INTEGER REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS partner_youtube_manual_allowlist (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        added_at BIGINT NOT NULL,
        added_by INTEGER REFERENCES users(id)
      );
    `);
  } catch (e) {
    console.warn('[Migration] partner_youtube_submissions:', e instanceof Error ? e.message : e);
  }
}

export async function getPartnerAccessLevelIdsLower(pool: Pool, userId: number): Promise<Set<string>> {
  const id = parseInt(String(userId), 10);
  if (!Number.isFinite(id) || id <= 0) return new Set();
  const r = await pool.query(
    `SELECT DISTINCT LOWER(TRIM(COALESCE(al, ''))) AS lid FROM (
       SELECT access_level_id::text AS al FROM users WHERE id = $1
       UNION ALL
       SELECT access_level_id::text AS al FROM user_access_levels WHERE user_id = $1
     ) q WHERE TRIM(COALESCE(al, '')) <> ''`,
    [id]
  );
  return new Set(r.rows.map((row: { lid?: string }) => String(row.lid || '')));
}

export async function countPartnerSubmissionsForUserSince(
  pool: Pool,
  userId: number,
  sinceMs: number
): Promise<number> {
  const cntRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM partner_youtube_submissions WHERE user_id = $1 AND created_at >= $2`,
    [userId, sinceMs]
  );
  return parseInt(String(cntRes.rows[0]?.c ?? '0'), 10) || 0;
}

export async function listPartnerYoutubeApprovedPublic(
  pool: Pool,
  limit: number,
  offset: number
): Promise<
  QueryResult<{
    id: string;
    title: string;
    youtube_url: string;
    youtube_video_id: string;
    description: string;
    created_at: unknown;
    reviewed_at: unknown;
    user_id: number;
    username: string;
    partner_channel_url: string;
    partner_avatar_url: string;
  }>
> {
  return pool.query(
    `SELECT s.id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.created_at, s.reviewed_at,
            u.id AS user_id,
            u.username,
            COALESCE(NULLIF(BTRIM(p.channel_url), ''), '') AS partner_channel_url,
            COALESCE(NULLIF(BTRIM(p.avatar_url), ''), '') AS partner_avatar_url
     FROM partner_youtube_submissions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN partner_youtube_creator_profiles p ON p.user_id = u.id
     WHERE s.status = 'approved'
     ORDER BY COALESCE(s.reviewed_at, s.created_at) DESC, s.id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
}

export async function getPartnerYoutubeCreatorProfile(
  pool: Pool,
  userId: number
): Promise<{ channel_url: string; avatar_url: string } | null> {
  const r = await pool.query(
    `SELECT channel_url, avatar_url FROM partner_youtube_creator_profiles WHERE user_id = $1`,
    [userId]
  );
  const row = r.rows[0] as { channel_url?: string; avatar_url?: string } | undefined;
  if (!row) return null;
  return {
    channel_url: String(row.channel_url ?? '').trim(),
    avatar_url: String(row.avatar_url ?? '').trim()
  };
}

export async function upsertPartnerYoutubeCreatorProfile(
  pool: Pool,
  params: {
    userId: number;
    channelUrl: string;
    avatarUrl: string;
    updatedAt: number;
    updatedBy: number | null;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO partner_youtube_creator_profiles (user_id, channel_url, avatar_url, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       channel_url = EXCLUDED.channel_url,
       avatar_url = EXCLUDED.avatar_url,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by`,
    [params.userId, params.channelUrl, params.avatarUrl, params.updatedAt, params.updatedBy]
  );
}

export async function listPartnerYoutubeByUser(
  pool: Pool,
  userId: number
): Promise<
  QueryResult<{
    id: string;
    title: string;
    youtube_url: string;
    youtube_video_id: string;
    description: string;
    status: string;
    created_at: unknown;
    reviewed_at: unknown;
    reject_reason: string | null;
  }>
> {
  return pool.query(
    `SELECT id, title, youtube_url, youtube_video_id, description, status, created_at, reviewed_at, reject_reason
     FROM partner_youtube_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
}

export async function insertPartnerYoutubeSubmission(
  pool: Pool,
  params: {
    id: string;
    userId: number;
    title: string;
    youtubeUrl: string;
    youtubeVideoId: string;
    description: string;
    createdAt: number;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO partner_youtube_submissions (id, user_id, title, youtube_url, youtube_video_id, description, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [
      params.id,
      params.userId,
      params.title,
      params.youtubeUrl,
      params.youtubeVideoId,
      params.description,
      params.createdAt
    ]
  );
}

export type PartnerYoutubeAdminListRow = {
  id: string;
  user_id: number;
  title: string;
  youtube_url: string;
  youtube_video_id: string;
  description: string;
  status: string;
  created_at: unknown;
  reviewed_at: unknown;
  reviewed_by: number | null;
  reject_reason: string | null;
  username: string;
  email: string;
};

export async function listPartnerYoutubeSubmissionsForAdmin(
  pool: Pool,
  status: 'all' | 'pending' | 'approved' | 'rejected'
): Promise<QueryResult<PartnerYoutubeAdminListRow>> {
  if (status === 'all') {
    return pool.query(
      `SELECT s.id, s.user_id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.status, s.created_at,
              s.reviewed_at, s.reviewed_by, s.reject_reason, u.username, u.email
       FROM partner_youtube_submissions s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC
       LIMIT 300`
    );
  }
  return pool.query(
    `SELECT s.id, s.user_id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.status, s.created_at,
            s.reviewed_at, s.reviewed_by, s.reject_reason, u.username, u.email
     FROM partner_youtube_submissions s
     JOIN users u ON u.id = s.user_id
     WHERE s.status = $1
     ORDER BY s.created_at DESC
     LIMIT 300`,
    [status]
  );
}

export async function updatePartnerYoutubeApprove(
  pool: Pool,
  id: string,
  adminUserId: number,
  reviewedAt: number
): Promise<number> {
  const r = await pool.query(
    `UPDATE partner_youtube_submissions
     SET status = 'approved', reviewed_at = $1, reviewed_by = $2, reject_reason = NULL
     WHERE id = $3 AND status = 'pending'
     RETURNING id`,
    [reviewedAt, adminUserId, id]
  );
  return r.rowCount ?? 0;
}

export async function updatePartnerYoutubeReject(
  pool: Pool,
  id: string,
  adminUserId: number,
  reason: string | null,
  reviewedAt: number
): Promise<number> {
  const r = await pool.query(
    `UPDATE partner_youtube_submissions
     SET status = 'rejected', reviewed_at = $1, reviewed_by = $2, reject_reason = $3
     WHERE id = $4 AND status = 'pending'
     RETURNING id`,
    [reviewedAt, adminUserId, reason, id]
  );
  return r.rowCount ?? 0;
}

/** Remove o envio (qualquer estado). Retorna número de linhas apagadas (0 ou 1). */
export async function deletePartnerYoutubeSubmission(pool: Pool, id: string): Promise<number> {
  const r = await pool.query(`DELETE FROM partner_youtube_submissions WHERE id = $1 RETURNING id`, [id]);
  return r.rowCount ?? 0;
}

export type PartnerYoutubeAdminPartnerRow = {
  user_id: number;
  username: string;
  email: string;
  approved_count: number;
  partner_channel_url: string;
  partner_avatar_url: string;
  is_allowlisted: boolean;
};

/** Parceiros na vitrine: vídeo aprovado OU entrada manual na allowlist (admin). */
export async function listPartnerYoutubePartnersForAdmin(
  pool: Pool
): Promise<QueryResult<PartnerYoutubeAdminPartnerRow>> {
  return pool.query(
    `WITH partner_user_ids AS (
       SELECT DISTINCT user_id FROM partner_youtube_submissions WHERE status = 'approved'
       UNION
       SELECT user_id FROM partner_youtube_manual_allowlist
     )
     SELECT u.id AS user_id,
            u.username,
            u.email,
            (SELECT COUNT(*)::int FROM partner_youtube_submissions s WHERE s.user_id = u.id AND s.status = 'approved') AS approved_count,
            COALESCE(NULLIF(BTRIM(p.channel_url), ''), '') AS partner_channel_url,
            COALESCE(NULLIF(BTRIM(p.avatar_url), ''), '') AS partner_avatar_url,
            EXISTS (SELECT 1 FROM partner_youtube_manual_allowlist m WHERE m.user_id = u.id) AS is_allowlisted
     FROM users u
     INNER JOIN partner_user_ids pu ON pu.user_id = u.id
     LEFT JOIN partner_youtube_creator_profiles p ON p.user_id = u.id
     ORDER BY u.username ASC`
  );
}

export async function isPartnerYoutubeManualAllowlisted(pool: Pool, userId: number): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM partner_youtube_manual_allowlist WHERE user_id = $1 LIMIT 1`, [userId]);
  return !!r.rows[0];
}

/** true = inserido; false = já existia. */
export async function addPartnerYoutubeManualAllowlist(
  pool: Pool,
  userId: number,
  addedBy: number | null,
  addedAt: number
): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO partner_youtube_manual_allowlist (user_id, added_at, added_by) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
    [userId, addedAt, addedBy]
  );
  return (r.rowCount ?? 0) > 0;
}

/** true = removido; false = não estava na lista manual. */
export async function removePartnerYoutubeManualAllowlist(pool: Pool, userId: number): Promise<boolean> {
  const r = await pool.query(`DELETE FROM partner_youtube_manual_allowlist WHERE user_id = $1 RETURNING user_id`, [
    userId
  ]);
  return (r.rowCount ?? 0) > 0;
}
