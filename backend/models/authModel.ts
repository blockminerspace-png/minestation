import type { users as UsersRow } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { generateReferralCode } from './signupPolicy.js';

export type DbUserRow = Record<string, unknown>;

function userToRow(u: UsersRow): DbUserRow {
  return {
    ...u,
    last_active_at: u.last_active_at != null ? Number(u.last_active_at) : null
  };
}

function sessionToRow(s: {
  session_id: string;
  user_id: number;
  created_at: bigint;
  expires_at: bigint;
  original_user_id: number | null;
  last_seen_at: bigint | null;
}): Record<string, unknown> {
  return {
    session_id: s.session_id,
    user_id: s.user_id,
    created_at: Number(s.created_at),
    expires_at: Number(s.expires_at),
    original_user_id: s.original_user_id,
    last_seen_at: s.last_seen_at != null ? Number(s.last_seen_at) : null
  };
}

export async function findUserByEmail(normalizedEmail: string): Promise<DbUserRow | undefined> {
  const row = await prisma.users.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } }
  });
  return row ? userToRow(row) : undefined;
}

export async function findUserById(id: number): Promise<DbUserRow | undefined> {
  const row = await prisma.users.findUnique({ where: { id } });
  return row ? userToRow(row) : undefined;
}

export async function updateUserPasswordHash(userId: string | number, hash: string): Promise<void> {
  await prisma.users.update({
    where: { id: Number(userId) },
    data: { password: hash }
  });
}

export async function recordLoginIp(userId: string | number, currentIp: string): Promise<void> {
  const uid = Number(userId);
  const now = BigInt(Date.now());
  await prisma.users.updateMany({
    where: { id: uid, registration_ip: null },
    data: { registration_ip: currentIp }
  });
  await prisma.user_history_ips.upsert({
    where: { user_id_ip: { user_id: uid, ip: currentIp } },
    create: { user_id: uid, ip: currentIp, last_used_at: now },
    update: { last_used_at: now }
  });
}

export async function ensureUserReferralCode(
  userId: string | number,
  username: string,
  existingCode: string | null | undefined
): Promise<string> {
  if (existingCode) return existingCode;
  const uid = Number(userId);
  let code = generateReferralCode(username);
  let tries = 0;
  while (tries < 10) {
    const clash = await prisma.users.findFirst({ where: { referral_code: code }, select: { id: true } });
    if (!clash) break;
    code = generateReferralCode(username);
    tries++;
  }
  await prisma.users.update({ where: { id: uid }, data: { referral_code: code } });
  return code;
}

export async function insertSession(
  sessionId: string,
  userId: string | number,
  createdAt: number,
  expiresAt: number
): Promise<void> {
  await prisma.sessions.create({
    data: {
      session_id: sessionId,
      user_id: Number(userId),
      created_at: BigInt(createdAt),
      expires_at: BigInt(expiresAt)
    }
  });
}

export async function loadSessionUser(
  sessionId: string
): Promise<{ session: Record<string, unknown>; user: DbUserRow } | null> {
  const s = await prisma.sessions.findUnique({ where: { session_id: sessionId } });
  if (!s || Number(s.expires_at) < Date.now()) return null;
  const u = await prisma.users.findUnique({ where: { id: s.user_id } });
  if (!u) return null;
  return { session: sessionToRow(s), user: userToRow(u) };
}

export async function listUserAccessLevelIds(
  userId: string | number,
  primaryLevelId: unknown
): Promise<string[]> {
  const rows = await prisma.user_access_levels.findMany({
    where: { user_id: Number(userId) },
    select: { access_level_id: true }
  });
  const userLvlIds = rows.map((l) => l.access_level_id);
  if (primaryLevelId && !userLvlIds.includes(primaryLevelId as string)) {
    userLvlIds.push(primaryLevelId as string);
  }
  return userLvlIds;
}

/** Atualiza só a carteira Polygon; níveis de acesso vêm de compras/admin no servidor (não do body). */
export async function updateUserPolygonAndAccess(userId: string | number, polygonWallet: unknown): Promise<void> {
  if (polygonWallet !== undefined) {
    await prisma.users.update({
      where: { id: Number(userId) },
      data: { polygon_wallet: polygonWallet as string | null }
    });
  }
}

/** Remove o endereço Polygon do perfil (grava `polygon_wallet = null`). */
export async function clearUserPolygonWallet(userId: number): Promise<void> {
  await prisma.users.update({
    where: { id: userId },
    data: { polygon_wallet: null }
  });
}

export async function deleteSessionBySessionId(sessionId: string): Promise<void> {
  await prisma.sessions.deleteMany({ where: { session_id: sessionId } });
}

/** `user_id` da sessão válida (não expirada), ou `null`. */
export async function findActiveSessionUserId(sessionId: string): Promise<number | null> {
  const s = await prisma.sessions.findUnique({ where: { session_id: sessionId } });
  if (!s || Number(s.expires_at) < Date.now()) return null;
  return s.user_id;
}

/** Para logout / revogação JWT: devolve `user_id` mesmo se a sessão já expirou. */
export async function findSessionUserIdIgnoringExpiry(sessionId: string): Promise<number | null> {
  const s = await prisma.sessions.findUnique({
    where: { session_id: sessionId },
    select: { user_id: true }
  });
  return s?.user_id ?? null;
}

/** Metadados da sessão (inclui expiradas). */
export async function findSessionRow(sessionId: string): Promise<Record<string, unknown> | null> {
  const s = await prisma.sessions.findUnique({ where: { session_id: sessionId } });
  return s ? sessionToRow(s) : null;
}
