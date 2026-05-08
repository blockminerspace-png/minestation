/**
 * URLs públicas de assets.
 * - `/img/...` — **só backend** (Vite em dev faz proxy; catálogo, favicon do jogo).
 * - `/static/img/...` — ficheiros no disco em `frontend/public/static/img/` (kebab-case por pastas).
 * Manter o favicon do `index.html` alinhado com `FAVICON_PNG_URL`.
 */

/** Prefixo Vite (`/` ou `/subpath/`). */
function withViteBase(absolutePath: string): string {
  const p = absolutePath.startsWith('/') ? absolutePath : `/${absolutePath}`;
  const raw = import.meta.env.BASE_URL;
  const base = typeof raw === 'string' ? raw : '/';
  if (base === '/') return p;
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${prefix}${p}`;
}

/** URL de imagem estática versionada no repo: `public/static/img/<caminho-kebab>`. */
export function staticImgUrl(relativeKebabPath: string): string {
  const sub = String(relativeKebabPath || '').replace(/^\/+/, '');
  return withViteBase(`/static/img/${sub}`);
}

/** Favicon + logo no header (servidor: `img/favicon/`). */
export const FAVICON_PNG_URL = '/img/favicon/genesis-miner-logo.png';

/** Cópia local do logo (fallback / PWA); ficheiro: `public/static/img/brand/genesis-miner-logo.png`. */
export const LOCAL_BRAND_LOGO_PNG = staticImgUrl('brand/genesis-miner-logo.png');

/** Base de uploads no servidor (`/brain/...`). */
export const BRAIN_ASSET_BASE = '/brain';

/** Constrói URL sob `/brain/...` (sem duplicar barras). */
export function brainAsset(relativePath: string): string {
  const p = String(relativePath || '').replace(/^\/+/, '');
  return p ? `${BRAIN_ASSET_BASE}/${p}` : BRAIN_ASSET_BASE;
}

/**
 * Placeholders de UI (`public/static/img/placeholders/`, nomes kebab-case).
 */
export const UI_PLACEHOLDER_ADS = {
  premium1: staticImgUrl('placeholders/ad-premium-1.svg'),
  premium2: staticImgUrl('placeholders/ad-premium-2.svg'),
  skyLeft: staticImgUrl('placeholders/skyscraper-160x600-left.svg'),
  skyRight: staticImgUrl('placeholders/skyscraper-160x600-right.svg')
} as const;

/** @deprecated alias de `UI_PLACEHOLDER_ADS`. */
export const BRAIN_PLACEHOLDER_ADS = UI_PLACEHOLDER_ADS;
