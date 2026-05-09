import { extractYoutubeVideoId } from '../../utils/partnerYoutubeHelpers.js';

/** Domínios permitidos para envio (sem encurtadores nem terceiros). */
function isAllowedYoutubeSubmitHost(hostname: string): boolean {
  const h = String(hostname || '')
    .replace(/^www\./i, '')
    .toLowerCase();
  return h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtu.be';
}

/**
 * Valida URL (apenas YouTube), extrai ID no servidor e devolve URL canónica `watch?v=`.
 */
export function validateAndCanonicalYoutubeUrl(raw: string): { videoId: string; canonicalUrl: string } | null {
  const t = String(raw || '').trim();
  if (!t || t.length > 500) return null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/.test(t)) return null;
  const lower = t.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('data:') || lower.includes('vbscript:')) return null;
  try {
    const withProto = /^https:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
    const u = new URL(withProto);
    if (u.protocol !== 'https:') return null;
    if (!isAllowedYoutubeSubmitHost(u.hostname)) return null;
  } catch {
    return null;
  }
  const videoId = extractYoutubeVideoId(t);
  if (!videoId) return null;
  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

export function youtubeThumbnailUrl(videoId: string): string {
  const v = String(videoId || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(v)) return '';
  return `https://i.ytimg.com/vi/${v}/hqdefault.jpg`;
}

export function youtubeEmbedUrl(videoId: string): string {
  const v = String(videoId || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(v)) return '';
  return `https://www.youtube.com/embed/${v}`;
}
