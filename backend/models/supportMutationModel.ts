import crypto from 'node:crypto';
import {
  getTicketForPlayerAction,
  insertSupportPlayerReply,
  insertSupportTicket
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

export async function runSupportSubmitTicketMutation(params: {
  userId: number;
  subjectRaw: unknown;
  messageRaw: unknown;
  attachments: SupportAttachmentItem[];
}): Promise<{ id: string }> {
  const subject = trimSubject(params.subjectRaw);
  const message = trimMessage(params.messageRaw);
  if (subject.length < 3) {
    throw new SupportMutationError('Assunto demasiado curto (mín. 3 caracteres).', 400, 'VALIDATION');
  }
  if (message.length < 10) {
    throw new SupportMutationError('Mensagem demasiado curta (mín. 10 caracteres).', 400, 'VALIDATION');
  }
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

export async function runSupportPlayerReplyMutation(params: {
  userId: number;
  ticketIdRaw: unknown;
  messageRaw: unknown;
  attachments: SupportAttachmentItem[];
}): Promise<{ replyId: string }> {
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
