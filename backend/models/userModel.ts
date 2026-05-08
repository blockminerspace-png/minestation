import { Prisma } from '@prisma/client';
import { assertPublicSignupEmailAllowed } from './registrationValidation.js';
import { generateReferralCode } from './signupPolicy.js';
import { prisma } from '../config/prisma.js';

export type GetUserIdOpts = { allowAnyDomain?: boolean; preferredUsername?: string | null };

export class EmailPolicyError extends Error {
  readonly code = 'EMAIL_POLICY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EmailPolicyError';
  }
}

export class IpLimitError extends Error {
  readonly existingAccounts: { username: string; email: string }[];

  constructor(message: string, accounts: { username: string; email: string }[]) {
    super(message);
    this.name = 'IpLimitError';
    this.existingAccounts = accounts;
  }
}

export async function getUserIdByEmail(
  email: string,
  ip: string | null = null,
  opts: GetUserIdOpts = {}
): Promise<string | number> {
  if (!email) throw new Error('Email is required for getUserIdByEmail');
  const normalizedEmail = email.toLowerCase();
  const allowAnyDomain = !!opts.allowAnyDomain;
  const preferred =
    typeof opts.preferredUsername === 'string' && opts.preferredUsername.trim().length > 0
      ? opts.preferredUsername.trim()
      : null;

  const row = await prisma.users.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    select: { id: true, username: true, referral_code: true }
  });

  if (row) {
    if (!row.referral_code) {
      let code = generateReferralCode(row.username);
      let tries = 0;
      while (tries < 10) {
        const clash = await prisma.users.findFirst({ where: { referral_code: code }, select: { id: true } });
        if (!clash) break;
        code = generateReferralCode(row.username);
        tries++;
      }
      await prisma.users.update({ where: { id: row.id }, data: { referral_code: code } });
    }
    return row.id;
  }

  const username = preferred || (email.split('@')[0] || 'user');
  let code = generateReferralCode(username);
  let tries = 0;
  while (tries < 10) {
    const clash = await prisma.users.findFirst({ where: { referral_code: code }, select: { id: true } });
    if (!clash) break;
    code = generateReferralCode(username);
    tries++;
  }

  try {
    if (!allowAnyDomain) {
      const policy = assertPublicSignupEmailAllowed(normalizedEmail);
      if (!policy.ok) {
        throw new EmailPolicyError(policy.error);
      }
    }
    if (ip) {
      const count = await prisma.users.count({ where: { registration_ip: ip } });
      if (count >= 3) {
        const existingRows = await prisma.users.findMany({
          where: { registration_ip: ip },
          take: 3,
          select: { username: true, email: true }
        });
        throw new IpLimitError('Limite de 3 contas por IP atingido.', existingRows);
      }
    }

    const created = await prisma.users.create({
      data: {
        username,
        email: normalizedEmail,
        referral_code: code,
        is_admin: 0,
        is_blocked: 0,
        registration_ip: ip
      },
      select: { id: true }
    });
    const newUid = created.id;
    const now = Date.now();
    const nowBig = BigInt(now);

    if (ip) {
      await prisma.user_history_ips.createMany({
        data: [{ user_id: newUid, ip, last_used_at: nowBig }],
        skipDuplicates: true
      });
    }

    const regBoxes = await prisma.loot_boxes.findMany({
      where: { trigger: 'registration' },
      select: { id: true }
    });
    for (const box of regBoxes) {
      await prisma.unopened_boxes.upsert({
        where: { user_id_box_id: { user_id: newUid, box_id: box.id } },
        create: { user_id: newUid, box_id: box.id, qty: 1 },
        update: { qty: { increment: 1 } }
      });
      await prisma.player_claimed_boxes.createMany({
        data: [{ user_id: newUid, box_id: box.id, claimed_at: nowBig }],
        skipDuplicates: true
      });
    }

    try {
      await prisma.game_states.create({
        data: {
          user_id: newUid,
          usdc: 0,
          start_time: nowBig,
          last_updated_at: nowBig,
          claimed_referrals: 0,
          referral_bonus_claimed: 0,
          black_market_balance: 0
        }
      });
    } catch (gsErr: unknown) {
      if (
        gsErr instanceof Prisma.PrismaClientKnownRequestError &&
        gsErr.code === 'P2002'
      ) {
        // já existe (equivalente a ON CONFLICT DO NOTHING)
      } else {
        console.error('Failed to create game state:', gsErr);
      }
    }

    return newUid;
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const retry = await prisma.users.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        select: { id: true }
      });
      if (retry) return retry.id;
    }
    throw err;
  }
}
