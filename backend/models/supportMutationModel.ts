import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { parseIdempotencyKey } from '../validation/roletaValidation.js';
import {
  getTicketForPlayerAction,
  insertSupportPlayerReply,
  insertSupportPlayerReplyInTx,
  insertSupportTicket,
  insertSupportTicketInTx
} from './supportTicketModel.js';

export class SupportMutationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'SupportMutationError';
  }
}

export type SupportAttachmentItem = { url: string; originalName: string; mime: string };

const IDEM_SCOPE_SUBMIT = 'support_submit_ticket';
const IDEM_SCOPE_PLAYER_REPLY = 'support_player_reply';

function trimSubject(raw: unknown): string {
  const s = raw != null ? String(raw) : '';
  return s.trim().slice(0, 180);
}

function trimMessage(raw: unknown): string {
  const s = raw != null ? String(raw) : '';
  return s.trim().slice(0, 8000);
}

function trimTicketId(raw: unknown): string {
  const s = raw != null ? String(raw) : '';
  return s.trim().slice(0, 80);
}

function advisoryPair(userId: number, scope: string, key: string): [number, number] {
  const h = crypto.createHash('sha256').update(`${userId}\0${scope}\0${key}`).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

async function readIdempotencyTicketId(
  tx: Prisma.TransactionClient,
  userId: number,
  scope: string,
  key: string
): Promise<string | null> {
  const row = await tx.support_submission_idempotency.findFirst({
    where: { user_id: userId, scope, idempotency_key: key },
    select: { response_json: true }
  });
  if (!row?.response_json) return null;
  try {
    const j = JSON.parse(row.response_json) as { id?: string };
    return typeof j.id === 'string' && j.id.length > 0 ? j.id : null;
  } catch {
    return null;
  }
}

async function readIdempotencyReplyId(
  tx: Prisma.TransactionClient,
  userId: number,
  scope: string,
  key: string
): Promise<string | null> {
  const row = await tx.support_submission_idempotency.findFirst({
    where: { user_id: userId, scope, idempotency_key: key },
    select: { response_json: true }
  });
  if (!row?.response_json) return null;
  try {
    const j = JSON.parse(row.response_json) as { id?: string };
    return typeof j.id === 'string' && j.id.length > 0 ? j.id : null;
  } catch {
    return null;
  }
}

export async function runSupportSubmitTicketMutation(params: {
  userId: number;
  subjectRaw: unknown;
  messageRaw: unknown;
  attachments: SupportAttachmentItem[];
  idempotencyKeyRaw?: unknown;
}): Promise<{ id: string; idempotentReplay?: boolean }> {
  const subject = trimSubject(params.subjectRaw);
  const message = trimMessage(params.messageRaw);
  if (subject.length < 3) {
    throw new SupportMutationError('Assunto demasiado curto (mín. 3 caracteres).', 400, 'VALIDATION');
  }
  if (message.length < 10) {
    throw new SupportMutationError('Mensagem demasiado curta (mín. 10 caracteres).', 400, 'VALIDATION');
  }

  const idem = parseIdempotencyKey(params.idempotencyKeyRaw);
  if (!idem) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await insertSupportTicket({
      id,
      userId: params.userId,
      subject,
      message,
      attachmentsJson: JSON.stringify(params.attachments),
      createdAt: now
    });
    return { id };
  }

  return prisma.$transaction(async (tx) => {
    const [k1, k2] = advisoryPair(params.userId, IDEM_SCOPE_SUBMIT, idem);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k1}::int, ${k2}::int)`;

    const existingId = await readIdempotencyTicketId(tx, params.userId, IDEM_SCOPE_SUBMIT, idem);
    if (existingId) {
      return { id: existingId, idempotentReplay: true };
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    await insertSupportTicketInTx(tx, {
      id,
      userId: params.userId,
      subject,
      message,
      attachmentsJson: JSON.stringify(params.attachments),
      createdAt: now
    });
    await tx.support_submission_idempotency.create({
      data: {
        user_id: params.userId,
        scope: IDEM_SCOPE_SUBMIT,
        idempotency_key: idem,
        response_json: JSON.stringify({ id }),
        created_at: BigInt(now)
      }
    });
    return { id };
  });
}

export async function runSupportPlayerReplyMutation(params: {
  userId: number;
  ticketIdRaw: unknown;
  messageRaw: unknown;
  attachments: SupportAttachmentItem[];
  idempotencyKeyRaw?: unknown;
}): Promise<{ replyId: string; idempotentReplay?: boolean }> {
  const ticketId = trimTicketId(params.ticketIdRaw);
  if (!ticketId) {
    throw new SupportMutationError('Pedido inválido.', 400, 'VALIDATION');
  }
  const message = trimMessage(params.messageRaw);
  const hasFiles = params.attachments.length > 0;
  if (message.length < 3 && !hasFiles) {
    throw new SupportMutationError(
      'Escreve uma mensagem (mín. 3 caracteres) ou anexa ficheiros.',
      400,
      'VALIDATION'
    );
  }
  const t = await getTicketForPlayerAction(ticketId);
  if (!t || Number(t.user_id) !== params.userId) {
    throw new SupportMutationError('Pedido não encontrado.', 404, 'NOT_FOUND');
  }
  if (String(t.status) !== 'open') {
    throw new SupportMutationError(
      'Este pedido está arquivado. Só podes ver a conversa. Abre um novo pedido para falar connosco de novo.',
      403,
      'ARCHIVED'
    );
  }

  const idem = parseIdempotencyKey(params.idempotencyKeyRaw);
  const idemScoped = idem ? `${ticketId}:${idem}` : null;

  if (!idemScoped) {
    const replyId = crypto.randomUUID();
    const now = Date.now();
    await insertSupportPlayerReply({
      replyId,
      ticketId,
      userId: params.userId,
      message,
      attachmentsJson: JSON.stringify(params.attachments),
      createdAt: now
    });
    return { replyId };
  }

  return prisma.$transaction(async (tx) => {
    const [k1, k2] = advisoryPair(params.userId, IDEM_SCOPE_PLAYER_REPLY, idemScoped);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k1}::int, ${k2}::int)`;

    const existingReply = await readIdempotencyReplyId(tx, params.userId, IDEM_SCOPE_PLAYER_REPLY, idemScoped);
    if (existingReply) {
      return { replyId: existingReply, idempotentReplay: true };
    }

    const replyId = crypto.randomUUID();
    const now = Date.now();
    await insertSupportPlayerReplyInTx(tx, {
      replyId,
      ticketId,
      userId: params.userId,
      message,
      attachmentsJson: JSON.stringify(params.attachments),
      createdAt: now
    });
    await tx.support_submission_idempotency.create({
      data: {
        user_id: params.userId,
        scope: IDEM_SCOPE_PLAYER_REPLY,
        idempotency_key: idemScoped,
        response_json: JSON.stringify({ id: replyId }),
        created_at: BigInt(now)
      }
    });
    return { replyId };
  });
}
