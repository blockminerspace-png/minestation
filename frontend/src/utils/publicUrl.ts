/**
 * Garante URL utilizável no browser (CSS url() / <img src>).
 * Caminhos sem barra inicial resolvem contra o path atual e quebram em rotas aninhadas.
 */
export function normalizePublicAssetUrl(src: string | null | undefined): string | undefined {
  if (src == null) return undefined;
  const s = String(src).trim();
  if (!s) return undefined;
  if (/^data:/i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return s;
  if (s.startsWith('/')) return s;
  // Evita tratar emoji ou ids como path (só prefixa se parecer ficheiro / pasta de assets).
  if (/[.](png|jpe?g|gif|webp|ico|svg)(\?|$)/i.test(s) || /^img\//i.test(s)) {
    return `/${s.replace(/^\/+/, '')}`;
  }
  return s;
}
