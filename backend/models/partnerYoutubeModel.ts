import { prisma } from '../config/prisma.js';

const PARTNER_YOUTUBE_DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS partner_youtube_submissions (
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
        submit_utc_day INTEGER,
        CONSTRAINT partner_youtube_submissions_status_chk CHECK (status IN ('pending','approved','rejected'))
      )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_youtube_user_created ON partner_youtube_submissions (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_partner_youtube_status ON partner_youtube_submissions (status, reviewed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS partner_youtube_creator_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        channel_url TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        updated_at BIGINT NOT NULL DEFAULT 0,
        updated_by INTEGER REFERENCES users(id)
      )`,
  `CREATE TABLE IF NOT EXISTS partner_youtube_manual_allowlist (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        added_at BIGINT NOT NULL,
        added_by INTEGER REFERENCES users(id)
      )`,
  `ALTER TABLE partner_youtube_submissions ADD COLUMN IF NOT EXISTS submit_utc_day INTEGER`,
  `UPDATE partner_youtube_submissions SET submit_utc_day = CAST(
      TO_CHAR((TIMESTAMP 'epoch' + (created_at::BIGINT / 1000) * INTERVAL '1 second') AT TIME ZONE 'UTC', 'YYYYMMDD') AS INTEGER
    ) WHERE submit_utc_day IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS partner_youtube_submissions_user_utcday_uidx
     ON partner_youtube_submissions (user_id, submit_utc_day)`,
  `CREATE INDEX IF NOT EXISTS partner_youtube_submissions_video_id_status_idx
     ON partner_youtube_submissions (youtube_video_id, status)`
];

export async function ensurePartnerYoutubeSchema(): Promise<void> {
  try {
    for (const sql of PARTNER_YOUTUBE_DDL_STATEMENTS) {
      await prisma.$executeRawUnsafe(sql);
    }
  } catch (e) {
    console.warn('[Migration] partner_youtube_submissions:', e instanceof Error ? e.message : e);
  }
}

export async function getPartnerAccessLevelIdsLower(userId: number): Promise<Set<string>> {
  const id = parseInt(String(userId), 10);
  if (!Number.isFinite(id) || id <= 0) return new Set();
  const r = await prisma.$queryRaw<{ lid: string }[]>`
    SELECT DISTINCT LOWER(TRIM(COALESCE(al, ''))) AS lid FROM (
      SELECT access_level_id::text AS al FROM users WHERE id = ${id}
      UNION ALL
      SELECT access_level_id::text AS al FROM user_access_levels WHERE user_id = ${id}
    ) q WHERE TRIM(COALESCE(al, '')) <> ''
  `;
  return new Set(r.map((row) => String(row.lid || '')));
}

export async function countPartnerSubmissionsForUserSince(userId: number, sinceMs: number): Promise<number> {
  return prisma.partner_youtube_submissions.count({
    where: { user_id: userId, created_at: { gte: BigInt(sinceMs) } }
  });
}

/** Envios no dia civil UTC (via `submit_utc_day`). */
export async function countPartnerSubmissionsForUserUtcDay(
  userId: number,
  submitUtcDay: number
): Promise<number> {
  return prisma.partner_youtube_submissions.count({
    where: { user_id: userId, submit_utc_day: submitUtcDay }
  });
}

/** Vídeo já na fila ou vitrine — evita duplicar o mesmo ID de vídeo. */
export async function countPartnerYoutubeActiveDuplicateVideo(youtubeVideoId: string): Promise<number> {
  return prisma.partner_youtube_submissions.count({
    where: {
      youtube_video_id: youtubeVideoId,
      status: { in: ['pending', 'approved'] }
    }
  });
}

export type PartnerYoutubeApprovedPublicRow = {
  id: string;
  title: string;
  youtube_url: string;
  youtube_video_id: string;
  description: string;
  created_at: bigint | null;
  reviewed_at: bigint | null;
  user_id: number;
  username: string;
  partner_channel_url: string;
  partner_avatar_url: string;
};

export async function listPartnerYoutubeApprovedPublic(
  limit: number,
  offset: number
): Promise<PartnerYoutubeApprovedPublicRow[]> {
  return prisma.$queryRaw<PartnerYoutubeApprovedPublicRow[]>`
    SELECT s.id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.created_at, s.reviewed_at,
           u.id AS user_id,
           u.username,
           COALESCE(NULLIF(BTRIM(p.channel_url), ''), '') AS partner_channel_url,
           COALESCE(NULLIF(BTRIM(p.avatar_url), ''), '') AS partner_avatar_url
    FROM partner_youtube_submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN partner_youtube_creator_profiles p ON p.user_id = u.id
    WHERE s.status = 'approved'
    ORDER BY COALESCE(s.reviewed_at, s.created_at) DESC, s.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function listPartnerYoutubeApprovedPublicCursor(
  limit: number,
  cursor: { sortTs: bigint; id: string } | null
): Promise<PartnerYoutubeApprovedPublicRow[]> {
  const lim = Math.min(48, Math.max(1, limit));
  if (!cursor) {
    return prisma.$queryRaw<PartnerYoutubeApprovedPublicRow[]>`
      SELECT s.id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.created_at, s.reviewed_at,
             u.id AS user_id,
             u.username,
             COALESCE(NULLIF(BTRIM(p.channel_url), ''), '') AS partner_channel_url,
             COALESCE(NULLIF(BTRIM(p.avatar_url), ''), '') AS partner_avatar_url
      FROM partner_youtube_submissions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN partner_youtube_creator_profiles p ON p.user_id = u.id
      WHERE s.status = 'approved'
      ORDER BY COALESCE(s.reviewed_at, s.created_at) DESC, s.id DESC
      LIMIT ${lim}
    `;
  }
  return prisma.$queryRaw<PartnerYoutubeApprovedPublicRow[]>`
    SELECT s.id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.created_at, s.reviewed_at,
           u.id AS user_id,
           u.username,
           COALESCE(NULLIF(BTRIM(p.channel_url), ''), '') AS partner_channel_url,
           COALESCE(NULLIF(BTRIM(p.avatar_url), ''), '') AS partner_avatar_url
    FROM partner_youtube_submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN partner_youtube_creator_profiles p ON p.user_id = u.id
    WHERE s.status = 'approved'
      AND (
        COALESCE(s.reviewed_at, s.created_at) < ${cursor.sortTs}
        OR (COALESCE(s.reviewed_at, s.created_at) = ${cursor.sortTs} AND s.id < ${cursor.id})
      )
    ORDER BY COALESCE(s.reviewed_at, s.created_at) DESC, s.id DESC
    LIMIT ${lim}
  `;
}

export async function getPartnerYoutubeApprovedByPublicId(
  publicId: string
): Promise<PartnerYoutubeApprovedPublicRow | null> {
  const rows = await prisma.$queryRaw<PartnerYoutubeApprovedPublicRow[]>`
    SELECT s.id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.created_at, s.reviewed_at,
           u.id AS user_id,
           u.username,
           COALESCE(NULLIF(BTRIM(p.channel_url), ''), '') AS partner_channel_url,
           COALESCE(NULLIF(BTRIM(p.avatar_url), ''), '') AS partner_avatar_url
    FROM partner_youtube_submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN partner_youtube_creator_profiles p ON p.user_id = u.id
    WHERE s.status = 'approved' AND s.id = ${publicId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getPartnerYoutubeCreatorProfile(
  userId: number
): Promise<{ channel_url: string; avatar_url: string } | null> {
  const row = await prisma.partner_youtube_creator_profiles.findUnique({
    where: { user_id: userId },
    select: { channel_url: true, avatar_url: true }
  });
  if (!row) return null;
  return {
    channel_url: String(row.channel_url ?? '').trim(),
    avatar_url: String(row.avatar_url ?? '').trim()
  };
}

export async function upsertPartnerYoutubeCreatorProfile(params: {
  userId: number;
  channelUrl: string;
  avatarUrl: string;
  updatedAt: number;
  updatedBy: number | null;
}): Promise<void> {
  await prisma.partner_youtube_creator_profiles.upsert({
    where: { user_id: params.userId },
    create: {
      user_id: params.userId,
      channel_url: params.channelUrl,
      avatar_url: params.avatarUrl,
      updated_at: BigInt(params.updatedAt),
      updated_by: params.updatedBy
    },
    update: {
      channel_url: params.channelUrl,
      avatar_url: params.avatarUrl,
      updated_at: BigInt(params.updatedAt),
      updated_by: params.updatedBy
    }
  });
}

export type PartnerYoutubeByUserRow = {
  id: string;
  title: string;
  youtube_url: string;
  youtube_video_id: string;
  description: string;
  status: string;
  created_at: bigint;
  reviewed_at: bigint | null;
  reject_reason: string | null;
};

export async function listPartnerYoutubeByUser(userId: number): Promise<PartnerYoutubeByUserRow[]> {
  const rows = await prisma.partner_youtube_submissions.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      youtube_url: true,
      youtube_video_id: true,
      description: true,
      status: true,
      created_at: true,
      reviewed_at: true,
      reject_reason: true
    }
  });
  return rows;
}

export async function insertPartnerYoutubeSubmission(params: {
  id: string;
  userId: number;
  title: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  description: string;
  createdAt: number;
  submitUtcDay: number;
}): Promise<void> {
  await prisma.partner_youtube_submissions.create({
    data: {
      id: params.id,
      user_id: params.userId,
      title: params.title,
      youtube_url: params.youtubeUrl,
      youtube_video_id: params.youtubeVideoId,
      description: params.description,
      status: 'pending',
      created_at: BigInt(params.createdAt),
      submit_utc_day: params.submitUtcDay
    }
  });
}

export type PartnerYoutubeAdminListRow = {
  id: string;
  user_id: number;
  title: string;
  youtube_url: string;
  youtube_video_id: string;
  description: string;
  status: string;
  created_at: bigint | null;
  reviewed_at: bigint | null;
  reviewed_by: number | null;
  reject_reason: string | null;
  username: string;
  email: string;
};

export async function listPartnerYoutubeSubmissionsForAdmin(
  status: 'all' | 'pending' | 'approved' | 'rejected'
): Promise<PartnerYoutubeAdminListRow[]> {
  if (status === 'all') {
    return prisma.$queryRaw<PartnerYoutubeAdminListRow[]>`
      SELECT s.id, s.user_id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.status, s.created_at,
             s.reviewed_at, s.reviewed_by, s.reject_reason, u.username, u.email
      FROM partner_youtube_submissions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
      LIMIT 300
    `;
  }
  return prisma.$queryRaw<PartnerYoutubeAdminListRow[]>`
    SELECT s.id, s.user_id, s.title, s.youtube_url, s.youtube_video_id, s.description, s.status, s.created_at,
           s.reviewed_at, s.reviewed_by, s.reject_reason, u.username, u.email
    FROM partner_youtube_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE s.status = ${status}
    ORDER BY s.created_at DESC
    LIMIT 300
  `;
}

export async function updatePartnerYoutubeApprove(
  id: string,
  adminUserId: number,
  reviewedAt: number
): Promise<number> {
  const r = await prisma.partner_youtube_submissions.updateMany({
    where: { id, status: 'pending' },
    data: {
      status: 'approved',
      reviewed_at: BigInt(reviewedAt),
      reviewed_by: adminUserId,
      reject_reason: null
    }
  });
  return r.count;
}

export async function updatePartnerYoutubeReject(
  id: string,
  adminUserId: number,
  reason: string | null,
  reviewedAt: number
): Promise<number> {
  const r = await prisma.partner_youtube_submissions.updateMany({
    where: { id, status: 'pending' },
    data: {
      status: 'rejected',
      reviewed_at: BigInt(reviewedAt),
      reviewed_by: adminUserId,
      reject_reason: reason
    }
  });
  return r.count;
}

/** Remove o envio (qualquer estado). Retorna número de linhas apagadas (0 ou 1). */
export async function deletePartnerYoutubeSubmission(id: string): Promise<number> {
  const r = await prisma.partner_youtube_submissions.deleteMany({ where: { id } });
  return r.count;
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
export async function listPartnerYoutubePartnersForAdmin(): Promise<PartnerYoutubeAdminPartnerRow[]> {
  return prisma.$queryRaw<PartnerYoutubeAdminPartnerRow[]>`
    WITH partner_user_ids AS (
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
    ORDER BY u.username ASC
  `;
}

export async function isPartnerYoutubeManualAllowlisted(userId: number): Promise<boolean> {
  const row = await prisma.partner_youtube_manual_allowlist.findUnique({
    where: { user_id: userId },
    select: { user_id: true }
  });
  return row != null;
}

/** true = inserido; false = já existia. */
export async function addPartnerYoutubeManualAllowlist(
  userId: number,
  addedBy: number | null,
  addedAt: number
): Promise<boolean> {
  const n = await prisma.$executeRaw`
    INSERT INTO partner_youtube_manual_allowlist (user_id, added_at, added_by)
    VALUES (${userId}, ${BigInt(addedAt)}, ${addedBy})
    ON CONFLICT (user_id) DO NOTHING
  `;
  return n > 0;
}

/** true = removido; false = não estava na lista manual. */
export async function removePartnerYoutubeManualAllowlist(userId: number): Promise<boolean> {
  const r = await prisma.partner_youtube_manual_allowlist.deleteMany({ where: { user_id: userId } });
  return r.count > 0;
}

export async function findUserIdsByNormalizedEmail(raw: string): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(${raw})) LIMIT 3
  `;
  return rows.map((x) => x.id);
}

export async function findUserIdsByNormalizedUsername(raw: string): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(${raw})) LIMIT 3
  `;
  return rows.map((x) => x.id);
}

export async function userExistsById(userId: number): Promise<boolean> {
  const n = await prisma.users.count({ where: { id: userId } });
  return n > 0;
}
