import { prisma } from '../../config/prisma.js';
import { HttpControlledError } from '../../utils/apiErrorResponse.js';
import {
  getConflictingUserIdByUsername,
  validateSignupUsername
} from '../../models/registrationValidation.js';
import {
  isReservedProfileUsername,
  stripInvisibleUsernameChars
} from '../../models/profileUsernameReserved.js';
import { appendProfileAuditLog } from './profileAudit.service.js';

export async function patchProfileIdentity(input: {
  userId: number;
  displayUsername: unknown;
  requestId?: string | null;
  route?: string;
}): Promise<{ username: string }> {
  const uid = Number(input.userId);
  const raw = stripInvisibleUsernameChars(
    typeof input.displayUsername === 'string' ? input.displayUsername : ''
  );
  const vu = validateSignupUsername(raw);
  if (!vu.ok) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'profile_username_invalid',
      route: input.route,
      requestId: input.requestId,
      meta: { reason: 'validation' }
    });
    throw new HttpControlledError(400, { error: vu.error, code: 'VALIDATION' });
  }
  const next = vu.username;
  if (isReservedProfileUsername(next)) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'profile_username_reserved',
      route: input.route,
      requestId: input.requestId,
      meta: {}
    });
    throw new HttpControlledError(422, {
      error: 'Este nome de utilizador é reservado ou não é permitido.',
      code: 'USERNAME_RESERVED'
    });
  }

  const clash = await getConflictingUserIdByUsername(next, uid);
  if (clash != null) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'profile_username_conflict',
      route: input.route,
      requestId: input.requestId,
      meta: {}
    });
    throw new HttpControlledError(409, {
      error: 'Este nome de utilizador já está em uso.',
      code: 'USERNAME_TAKEN'
    });
  }

  const before = await prisma.users.findUnique({
    where: { id: uid },
    select: { username: true }
  });
  const prev = before?.username ?? '';

  await prisma.users.update({
    where: { id: uid },
    data: { username: next }
  });

  await appendProfileAuditLog({
    userId: uid,
    action: 'profile_username_changed',
    route: input.route,
    requestId: input.requestId,
    meta: { from: prev.slice(0, 80), to: next.slice(0, 80) }
  });

  return { username: next };
}
