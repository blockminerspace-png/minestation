/** Início do dia civil UTC em milissegundos (para limite 1 envio/dia). */
export function partnerYoutubeUtcDayStartMs(ts: number): number {
  const d = new Date(Number(ts) || Date.now());
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Extrai o ID de 11 caracteres de URLs watch / youtu.be / shorts / embed. */
export function extractYoutubeVideoId(rawUrl: string): string {
  const u = String(rawUrl || '').trim();
  if (!u) return '';
  try {
    const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const url = new URL(withProto);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = (url.pathname || '').replace(/^\//, '').split('/')[0] || '';
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : '';
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const p = (url.pathname || '').toLowerCase();
      if (p.startsWith('/watch')) {
        const v = url.searchParams.get('v') || '';
        return /^[a-zA-Z0-9_-]{11}$/.test(v) ? v : '';
      }
      if (p.startsWith('/embed/')) {
        const id = (p.split('/')[2] || '').trim();
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : '';
      }
      if (p.startsWith('/shorts/')) {
        const id = ((p.split('/')[2] || '').split('?')[0] || '').trim();
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : '';
      }
    }
  } catch {
    return '';
  }
  return '';
}

/** Ids de nível de acesso que podem enviar vídeos (valores reais em users / user_access_levels). */
const PARTNER_LEVEL_IDS = new Set([
  'partners',
  'parceiros',
  'partner',
  'parceiro'
]);

export function userAccessSetHasPartnerLevel(idSet: Set<string>): boolean {
  for (const x of idSet) {
    if (PARTNER_LEVEL_IDS.has(String(x || '').toLowerCase().trim())) return true;
  }
  return false;
}

/** URL do canal YouTube (https, domínio YouTube). Vazio = limpar / não definido. */
export function sanitizePartnerCreatorChannelUrl(raw: string): string {
  const t = String(raw || '').trim().slice(0, 500);
  if (!t) return '';
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:') return '';
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return t;
    return '';
  } catch {
    return '';
  }
}

/** Imagem vitrine: https absoluto ou caminho relativo do site (ex. /brain/...). */
export function sanitizePartnerCreatorAvatarUrl(raw: string): string {
  const t = String(raw || '').trim().slice(0, 800);
  if (!t) return '';
  if (/^https:\/\//i.test(t)) {
    try {
      void new URL(t);
      return t;
    } catch {
      return '';
    }
  }
  if (t.startsWith('/') && /^\/[\w\-./?#+%]{1,700}$/i.test(t)) return t;
  return '';
}
