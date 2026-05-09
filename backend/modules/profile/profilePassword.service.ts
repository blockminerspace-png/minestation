import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { HttpControlledError } from '../../utils/apiErrorResponse.js';
import { validateLoginPassword } from '../../models/registrationValidation.js';
import { validateProfileNewPasswordStrength } from '../../models/profilePasswordPolicy.js';
import { appendProfileAuditLog } from './profileAudit.service.js';

export async function changeProfilePassword(input: {
  userId: number;
  currentPassword: unknown;
  newPassword: unknown;
  confirmPassword: unknown;
  revokeJwtRefreshForUser: (userId: number) => Promise<void>;
  requestId?: string | null;
  route?: string;
}): Promise<void> {
  const uid = Number(input.userId);
  const curPv = validateLoginPassword(input.currentPassword);
  if (!curPv.ok) {
    throw new HttpControlledError(400, { error: curPv.error, code: 'VALIDATION' });
  }
  const cur = typeof input.currentPassword === 'string' ? input.currentPassword : '';

  const npRaw = input.newPassword;
  const cpRaw = input.confirmPassword;
  if (typeof npRaw !== 'string' || typeof cpRaw !== 'string') {
    throw new HttpControlledError(400, { error: 'Payload inválido.', code: 'VALIDATION' });
  }
  if (npRaw !== cpRaw) {
    throw new HttpControlledError(400, { error: 'A confirmação não coincide com a nova palavra-passe.', code: 'VALIDATION' });
  }

  const row = await prisma.users.findUnique({
    where: { id: uid },
    select: { password: true }
  });
  const hash = row?.password ?? null;
  if (!hash) {
    throw new HttpControlledError(422, {
      error: 'Conta sem palavra-passe definida; utilize o fluxo de recuperação.',
      code: 'PASSWORD_NOT_SET'
    });
  }

  const okCur = await bcrypt.compare(cur, hash);
  if (!okCur) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'profile_password_change_wrong_current',
      route: input.route,
      requestId: input.requestId,
      meta: {}
    });
    throw new HttpControlledError(422, {
      error: 'Palavra-passe atual incorreta.',
      code: 'PASSWORD_CURRENT_WRONG'
    });
  }

  const strength = await validateProfileNewPasswordStrength(npRaw, hash);
  if (!strength.ok) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'profile_password_weak_rejected',
      route: input.route,
      requestId: input.requestId,
      meta: {}
    });
    throw new HttpControlledError(422, { error: strength.error, code: 'PASSWORD_WEAK' });
  }

  const newHash = await bcrypt.hash(npRaw, 10);
  await prisma.users.update({
    where: { id: uid },
    data: { password: newHash }
  });

  await input.revokeJwtRefreshForUser(uid);

  await appendProfileAuditLog({
    userId: uid,
    action: 'profile_password_changed',
    route: input.route,
    requestId: input.requestId,
    meta: {}
  });
}
