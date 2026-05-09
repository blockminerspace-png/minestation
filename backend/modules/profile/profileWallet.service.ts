import crypto from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import { prisma } from '../../config/prisma.js';
import { HttpControlledError } from '../../utils/apiErrorResponse.js';
import { validateOptionalPolygonWallet } from '../../models/registrationValidation.js';
import bcrypt from 'bcryptjs';
import { validateLoginPassword } from '../../models/registrationValidation.js';
import { appendProfileAuditLog } from './profileAudit.service.js';

const POLYGON_CHAIN_ID = 137;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function normalizeEthAddress(addr: string): string {
  return getAddress(addr);
}

export async function createWalletConnectChallenge(userId: number): Promise<{
  challengeId: string;
  message: string;
  expiresAt: number;
  chainId: number;
}> {
  const uid = Number(userId);
  const now = Date.now();
  const expiresAt = now + CHALLENGE_TTL_MS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = [
    'Genesis Miner — ligação de carteira de saque (Polygon).',
    `ID interno do utilizador: ${uid}`,
    `Nonce: ${nonce}`,
    `Expira (Unix ms): ${expiresAt}`,
    `Chain ID: ${POLYGON_CHAIN_ID}`,
    '',
    'Assine esta mensagem para confirmar o endereço de saque. Nunca partilhe seed phrase nem chave privada.'
  ].join('\n');

  const row = await prisma.profile_wallet_connect_challenges.create({
    data: {
      user_id: uid,
      message,
      expires_at: BigInt(expiresAt),
      used_at: null
    },
    select: { id: true }
  });

  await appendProfileAuditLog({
    userId: uid,
    action: 'profile_wallet_challenge_created',
    meta: { challengeId: row.id }
  });

  return { challengeId: row.id, message, expiresAt, chainId: POLYGON_CHAIN_ID };
}

export async function verifyWalletConnectSignature(input: {
  userId: number;
  challengeId: unknown;
  address: unknown;
  signature: unknown;
  chainId: unknown;
  requestId?: string | null;
  route?: string;
}): Promise<{ address: string }> {
  const uid = Number(input.userId);
  if (typeof input.chainId !== 'number' && typeof input.chainId !== 'string') {
    throw new HttpControlledError(400, { error: 'Chain ID inválido.', code: 'VALIDATION' });
  }
  const chainNum = typeof input.chainId === 'number' ? input.chainId : parseInt(String(input.chainId), 10);
  if (!Number.isFinite(chainNum) || chainNum !== POLYGON_CHAIN_ID) {
    throw new HttpControlledError(422, {
      error: 'Use a rede Polygon (chain ID 137).',
      code: 'WRONG_CHAIN'
    });
  }

  const chId = typeof input.challengeId === 'string' ? input.challengeId.trim() : '';
  if (!chId) {
    throw new HttpControlledError(400, { error: 'challengeId é obrigatório.', code: 'VALIDATION' });
  }

  const wv = validateOptionalPolygonWallet(input.address);
  if (wv && typeof wv === 'object' && 'error' in wv) {
    throw new HttpControlledError(400, { error: (wv as { error: string }).error, code: 'VALIDATION' });
  }
  if (typeof wv !== 'string') {
    throw new HttpControlledError(400, { error: 'Endereço inválido.', code: 'VALIDATION' });
  }
  const addrNorm = normalizeEthAddress(wv);

  const sigRaw = typeof input.signature === 'string' ? input.signature.trim() : '';
  if (!sigRaw || sigRaw.length > 300) {
    throw new HttpControlledError(400, { error: 'Assinatura inválida.', code: 'VALIDATION' });
  }

  const row = await prisma.profile_wallet_connect_challenges.findFirst({
    where: { id: chId, user_id: uid },
    select: { id: true, message: true, expires_at: true, used_at: true }
  });
  if (!row) {
    throw new HttpControlledError(404, { error: 'Desafio não encontrado.', code: 'CHALLENGE_NOT_FOUND' });
  }
  if (row.used_at != null) {
    throw new HttpControlledError(409, { error: 'Este desafio já foi utilizado.', code: 'NONCE_USED' });
  }
  if (Number(row.expires_at) < Date.now()) {
    throw new HttpControlledError(422, { error: 'Desafio expirado. Gere um novo.', code: 'CHALLENGE_EXPIRED' });
  }

  let recovered: string;
  try {
    recovered = verifyMessage(row.message, sigRaw);
  } catch {
    await appendProfileAuditLog({
      userId: uid,
      action: 'profile_wallet_verify_signature_invalid',
      route: input.route,
      requestId: input.requestId,
      meta: {}
    });
    throw new HttpControlledError(422, { error: 'Assinatura inválida.', code: 'SIGNATURE_INVALID' });
  }

  if (normalizeEthAddress(recovered) !== addrNorm) {
    await appendProfileAuditLog({
      userId: uid,
      action: 'profile_wallet_verify_address_mismatch',
      route: input.route,
      requestId: input.requestId,
      meta: {}
    });
    throw new HttpControlledError(422, {
      error: 'A assinatura não corresponde ao endereço indicado.',
      code: 'ADDRESS_MISMATCH'
    });
  }

  const existing = await prisma.users.findUnique({
    where: { id: uid },
    select: { polygon_wallet: true }
  });
  if (
    existing?.polygon_wallet &&
    normalizeEthAddress(existing.polygon_wallet) === addrNorm
  ) {
    await prisma.profile_wallet_connect_challenges.update({
      where: { id: row.id },
      data: { used_at: BigInt(Date.now()) }
    });
    return { address: addrNorm };
  }

  await prisma.$transaction(async (tx) => {
    const locked = await tx.profile_wallet_connect_challenges.findFirst({
      where: { id: row.id, user_id: uid, used_at: null },
      select: { id: true }
    });
    if (!locked) {
      throw new HttpControlledError(409, { error: 'Desafio já consumido.', code: 'NONCE_USED' });
    }
    await tx.profile_wallet_connect_challenges.update({
      where: { id: row.id },
      data: { used_at: BigInt(Date.now()) }
    });
    await tx.users.update({
      where: { id: uid },
      data: { polygon_wallet: addrNorm }
    });
  });

  await appendProfileAuditLog({
    userId: uid,
    action: 'profile_wallet_connected',
    route: input.route,
    requestId: input.requestId,
    meta: { address: addrNorm }
  });

  return { address: addrNorm };
}

export async function removeProfileWallet(input: {
  userId: number;
  currentPassword?: unknown;
  requestId?: string | null;
  route?: string;
}): Promise<void> {
  const uid = Number(input.userId);
  const row = await prisma.users.findUnique({
    where: { id: uid },
    select: { password: true, polygon_wallet: true }
  });
  if (!row?.polygon_wallet) {
    throw new HttpControlledError(404, { error: 'Nenhuma carteira ligada.', code: 'WALLET_ABSENT' });
  }
  if (row.password) {
    const pv = validateLoginPassword(input.currentPassword);
    if (!pv.ok) {
      throw new HttpControlledError(400, { error: pv.error, code: 'VALIDATION' });
    }
    const cur = typeof input.currentPassword === 'string' ? input.currentPassword : '';
    const ok = await bcrypt.compare(cur, row.password);
    if (!ok) {
      await appendProfileAuditLog({
        userId: uid,
        action: 'profile_wallet_remove_password_fail',
        route: input.route,
        requestId: input.requestId,
        meta: {}
      });
      throw new HttpControlledError(422, {
        error: 'Palavra-passe atual incorreta.',
        code: 'PASSWORD_CURRENT_WRONG'
      });
    }
  }

  await prisma.users.update({
    where: { id: uid },
    data: { polygon_wallet: null }
  });

  await appendProfileAuditLog({
    userId: uid,
    action: 'profile_wallet_removed',
    route: input.route,
    requestId: input.requestId,
    meta: {}
  });
}
