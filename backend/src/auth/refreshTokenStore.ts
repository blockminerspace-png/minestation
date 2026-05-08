import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { getJwtAuthConfig } from './config.js';

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

export async function revokeAllRefreshForUser(userId: number): Promise<void> {
  const now = BigInt(Date.now());
  await prisma.jwt_refresh_tokens.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: now }
  });
}

export type InsertRefreshArgs = {
  userId: number;
  rawToken: string;
  familyId: string;
  expiresAt: number;
  userAgent: string | null;
  ip: string | null;
};

export async function insertRefreshToken(args: InsertRefreshArgs): Promise<void> {
  const { userId, rawToken, familyId, expiresAt, userAgent, ip } = args;
  const tokenHash = hashToken(rawToken);
  await prisma.jwt_refresh_tokens.create({
    data: {
      user_id: userId,
      token_hash: tokenHash,
      family_id: familyId,
      expires_at: BigInt(expiresAt),
      created_at: BigInt(Date.now()),
      user_agent: userAgent || null,
      ip: ip || null
    }
  });
}

export type RotateRefreshOk = { ok: true; userId: number; newRefreshRaw: string };
export type RotateRefreshFail = { ok: false; code: string };
export type RotateRefreshResult = RotateRefreshOk | RotateRefreshFail;

export async function rotateRefreshToken(
  rawOld: string,
  { userAgent, ip }: { userAgent: string | null; ip: string | null }
): Promise<RotateRefreshResult> {
  const oldHash = hashToken(rawOld);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: bigint; user_id: number; family_id: string; expires_at: bigint }>
    >(
      Prisma.sql`SELECT id, user_id, family_id, expires_at FROM jwt_refresh_tokens WHERE token_hash = ${oldHash} AND revoked_at IS NULL FOR UPDATE LIMIT 1`
    );
    const row = rows[0];
    if (!row) {
      return { ok: false, code: 'invalid' } as const;
    }
    if (Number(row.expires_at) < Date.now()) {
      return { ok: false, code: 'expired' } as const;
    }
    const cfg = getJwtAuthConfig();
    const newRaw = crypto.randomBytes(48).toString('base64url');
    const newHash = hashToken(newRaw);
    const expMs = Date.now() + cfg.refreshTtlSec * 1000;
    const now = BigInt(Date.now());
    await tx.jwt_refresh_tokens.delete({ where: { id: row.id } });
    await tx.jwt_refresh_tokens.create({
      data: {
        user_id: row.user_id,
        token_hash: newHash,
        family_id: row.family_id,
        expires_at: BigInt(expMs),
        created_at: now,
        user_agent: userAgent || null,
        ip: ip || null
      }
    });
    return { ok: true, userId: row.user_id, newRefreshRaw: newRaw } as const;
  });
}
