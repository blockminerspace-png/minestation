/**
 * Alinhado com `frontend/utils/publicUrl.ts`: garante URLs de imagem servidas em `/img/...`
 * (evita `/miner/...` que o SPA não serve e cai em HTML).
 */
const IMG_SUBFOLDER = /^(miner|moedas|carregadores|baterias|favicon|uploads)\//i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|ico|svg)(\?.*)?$/i;

export function normalizePublicAssetUrl(src: string | null | undefined): string | undefined {
  if (src == null) return undefined;
  let s = String(src).trim();
  if (!s) return undefined;
  s = s.replace(/^\.\/+/, '');
  if (/^backend\//i.test(s)) {
    s = s.replace(/^backend\//i, '').replace(/^\.\/+/, '');
  }
  if (/^data:/i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return s;
  if (s.toLowerCase().startsWith('/img/')) return s;

  const underImg = (rel: string) => `/img/${rel.replace(/^\/+/, '')}`;

  if (s.startsWith('/')) {
    const rest = s.replace(/^\/+/, '');
    if (IMG_SUBFOLDER.test(rest) && IMG_EXT.test(rest)) return underImg(rest);
    if (!rest.includes('/') && IMG_EXT.test(rest)) return underImg(rest);
    return s;
  }

  if (/^img\//i.test(s)) return `/${s.replace(/^\/+/, '')}`;

  if (IMG_SUBFOLDER.test(s) && IMG_EXT.test(s)) return underImg(s);
  if (!s.includes('/') && IMG_EXT.test(s)) return underImg(s);
  return s;
}
