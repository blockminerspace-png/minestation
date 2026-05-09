import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  countPartnerYoutubeActiveDuplicateVideo,
  getPartnerAccessLevelIdsLower,
  insertPartnerYoutubeSubmission,
  isPartnerYoutubeManualAllowlisted
} from '../../models/partnerYoutubeModel.js';
import {
  partnerYoutubeUtcDayKeyYYYYMMDD,
  userAccessSetHasPartnerLevel
} from '../../utils/partnerYoutubeHelpers.js';
import { validateAndCanonicalYoutubeUrl } from './partners.youtubeUrl.js';

export class PartnerYoutubeSubmitError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'PartnerYoutubeSubmitError';
  }
}

function trimTitle(raw: unknown): string {
  return raw != null ? String(raw).trim().slice(0, 200) : '';
}

function trimDescription(raw: unknown): string {
  return raw != null ? String(raw).trim().slice(0, 2000) : '';
}

export async function runPartnerYoutubeSubmitVideo(params: {
  userId: number;
  titleRaw: unknown;
  youtubeUrlRaw: unknown;
  descriptionRaw: unknown;
}): Promise<{ id: string }> {
  const title = trimTitle(params.titleRaw);
  if (title.length < 3) {
    throw new PartnerYoutubeSubmitError('Título inválido (mín. 3 caracteres).', 400, 'VALIDATION');
  }

  const parsed = validateAndCanonicalYoutubeUrl(String(params.youtubeUrlRaw ?? ''));
  if (!parsed) {
    throw new PartnerYoutubeSubmitError(
      'URL do YouTube inválida (use apenas youtube.com, m.youtube.com ou youtu.be).',
      422,
      'INVALID_URL'
    );
  }

  const idSet = await getPartnerAccessLevelIdsLower(params.userId);
  const manualListed = await isPartnerYoutubeManualAllowlisted(params.userId);
  if (!userAccessSetHasPartnerLevel(idSet) && !manualListed) {
    throw new PartnerYoutubeSubmitError(
      'Apenas contas com nível Parceiros/Partners ou adicionadas pelo admin em Parceiros YouTube podem enviar vídeos.',
      403,
      'NOT_PARTNER'
    );
  }

  const dup = await countPartnerYoutubeActiveDuplicateVideo(parsed.videoId);
  if (dup > 0) {
    throw new PartnerYoutubeSubmitError(
      'Este vídeo já está na fila de revisão ou na vitrine. Escolhe outro link.',
      409,
      'DUPLICATE_VIDEO'
    );
  }

  const description = trimDescription(params.descriptionRaw);
  const dayKey = partnerYoutubeUtcDayKeyYYYYMMDD(Date.now());
  const id = crypto.randomUUID();
  const now = Date.now();

  try {
    await insertPartnerYoutubeSubmission({
      id,
      userId: params.userId,
      title,
      youtubeUrl: parsed.canonicalUrl,
      youtubeVideoId: parsed.videoId,
      description,
      createdAt: now,
      submitUtcDay: dayKey
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new PartnerYoutubeSubmitError(
        'Limite de 1 envio por dia (UTC) atingido ou conflito de envio. Tenta de novo dentro de instantes.',
        409,
        'DAILY_LIMIT_OR_CONFLICT'
      );
    }
    throw e;
  }

  return { id };
}
