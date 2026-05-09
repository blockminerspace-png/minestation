import { prisma } from '../../config/prisma.js';
import { HttpControlledError } from '../../utils/apiErrorResponse.js';
import { validateOptionalReferralCodeInput } from '../../models/registrationValidation.js';
import { executeUserPutCoreTransaction } from '../../models/userPutCoreTransaction.js';
import { appendProfileAuditLog } from './profileAudit.service.js';

/**
 * Vincula código de indicação com as mesmas regras transaccionais que `PUT /api/user`
 * (anti-fraude por IP, recompensas de modelo, linha em `referrals`).
 */
export async function bindProfileReferralCode(input: {
  userId: number;
  codeRaw: unknown;
  clientIp: string;
  requestId?: string | null;
  route?: string;
}): Promise<void> {
  const uid = Number(input.userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new HttpControlledError(401, { error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
  }
  const codeCheck = validateOptionalReferralCodeInput(input.codeRaw);
  if (!codeCheck.ok) {
    throw new HttpControlledError(400, { error: codeCheck.error, code: 'VALIDATION' });
  }
  if (!codeCheck.code) {
    throw new HttpControlledError(400, { error: 'Indique o código de indicação.', code: 'VALIDATION' });
  }
  const codeNormalized = codeCheck.code;

  const selfRow = await prisma.users.findUnique({
    where: { id: uid },
    select: {
      username: true,
      email: true,
      access_level_id: true,
      referred_by: true,
      referral_code: true
    }
  });
  if (!selfRow?.username) {
    throw new HttpControlledError(400, { error: 'Utilizador não encontrado.', code: 'NOT_FOUND' });
  }
  if (selfRow.referred_by) {
    throw new HttpControlledError(409, { error: 'Código já vinculado.', code: 'REFERRAL_ALREADY_BOUND' });
  }

  const referrer = await prisma.users.findFirst({
    where: { referral_code: { equals: codeNormalized, mode: 'insensitive' } },
    select: { id: true, username: true, referral_code: true }
  });
  if (!referrer?.id) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'referral_bind_invalid_code',
      route: input.route,
      requestId: input.requestId,
      meta: { reason: 'code_not_found' }
    });
    throw new HttpControlledError(422, { error: 'Código de indicação inválido.', code: 'REFERRAL_CODE_INVALID' });
  }
  if (referrer.id === uid) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'referral_bind_self_attempt',
      route: input.route,
      requestId: input.requestId,
      meta: {}
    });
    throw new HttpControlledError(422, { error: 'Você não pode usar seu próprio código.', code: 'REFERRAL_SELF' });
  }
  if (
    selfRow.referral_code &&
    selfRow.referral_code.toLowerCase() === String(referrer.referral_code || '').toLowerCase()
  ) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'referral_bind_self_code_match',
      route: input.route,
      requestId: input.requestId,
      meta: {}
    });
    throw new HttpControlledError(422, { error: 'Você não pode usar seu próprio código.', code: 'REFERRAL_SELF' });
  }

  const cycle = await prisma.referrals.findFirst({
    where: { user_id: uid, referred_username: referrer.username }
  });
  if (cycle) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'referral_bind_cycle_blocked',
      route: input.route,
      requestId: input.requestId,
      meta: { referrerId: referrer.id }
    });
    throw new HttpControlledError(422, {
      error: 'Não é possível usar o código de alguém que você já indicou.',
      code: 'REFERRAL_CYCLE'
    });
  }

  const normalizedEmail = String(selfRow.email || '').trim().toLowerCase();

  try {
    await prisma.$transaction(async (tx) => {
      await executeUserPutCoreTransaction(tx, {
        uid,
        usernameForUpdate: String(selfRow.username),
        normalizedEmail,
        passwordHash: null,
        polygonForUpdate: undefined,
        accessLevelIdForUpdate: selfRow.access_level_id ?? null,
        referredByForUpdate: codeNormalized,
        allowAccessLevelFromBody: false,
        accessLevelIdsValidated: null,
        clientIpReferral: input.clientIp
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Auto-indicação')) {
      await appendProfileAuditLog({
        userId: uid,
        action: 'referral_bind_ip_antifraud',
        route: input.route,
        requestId: input.requestId,
        meta: { reason: 'ip_rule' }
      });
      throw new HttpControlledError(422, { error: msg, code: 'REFERRAL_IP_RULE' });
    }
    throw e;
  }

  await appendProfileAuditLog({
    userId: uid,
    action: 'referral_bound',
    route: input.route,
    requestId: input.requestId,
    meta: { referrerId: referrer.id }
  });
}
