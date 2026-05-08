/**
 * Rotas públicas em inglês para cada ecrã do jogo (SPA).
 * Mantém os ids internos (`servers`, `hardware_store`, …) na BD e no estado.
 */

export type GamePathView =
  | 'servers'
  | 'inventory'
  | 'oficina'
  | 'hardware_store'
  | 'black_market'
  | 'arcade'
  | 'lucky_store'
  | 'roleta'
  | 'wallet'
  | 'ranking'
  | 'upgrade'
  | 'transparency'
  | 'support'
  | 'partners'
  | 'profile'
  | 'calculator';

export const GAME_PATH_VIEWS: readonly GamePathView[] = [
  'servers',
  'inventory',
  'oficina',
  'hardware_store',
  'black_market',
  'arcade',
  'lucky_store',
  'roleta',
  'wallet',
  'ranking',
  'upgrade',
  'transparency',
  'support',
  'partners',
  'profile',
  'calculator'
];

export function isGamePathView(s: string): s is GamePathView {
  return (GAME_PATH_VIEWS as readonly string[]).includes(s);
}

/** slug inglês (sem / inicial) → vista interna */
export const ENGLISH_PATH_TO_VIEW: Record<string, GamePathView> = {
  servers: 'servers',
  inventory: 'inventory',
  workshop: 'oficina',
  'miner-shop': 'hardware_store',
  'black-market': 'black_market',
  arcade: 'arcade',
  'lucky-boxes': 'lucky_store',
  wheel: 'roleta',
  wallet: 'wallet',
  ranking: 'ranking',
  upgrades: 'upgrade',
  transparency: 'transparency',
  support: 'support',
  partners: 'partners',
  profile: 'profile',
  calculator: 'calculator'
};

const VIEW_TO_ENGLISH_PATH: Record<GamePathView, string> = {
  servers: '/servers',
  inventory: '/inventory',
  oficina: '/workshop',
  hardware_store: '/miner-shop',
  black_market: '/black-market',
  arcade: '/arcade',
  lucky_store: '/lucky-boxes',
  roleta: '/wheel',
  wallet: '/wallet',
  ranking: '/ranking',
  upgrade: '/upgrades',
  transparency: '/transparency',
  support: '/support',
  partners: '/partners',
  profile: '/profile',
  calculator: '/calculator'
};

/** Slugs conhecidos (para fallback dev / verificação). */
export const ENGLISH_GAME_PATHS = new Set(Object.values(VIEW_TO_ENGLISH_PATH));

function normalizePathname(raw: string): string {
  let p = (raw || '').split('?')[0].split('#')[0];
  if (!p || p === '') return '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

/** `/servers` → `servers` (slug); vazio ou desconhecido → null */
export function englishSlugFromPathname(pathname: string): string | null {
  const p = normalizePathname(pathname);
  if (p === '/' || p === '/index.html') return null;
  const withoutSlash = p.startsWith('/') ? p.slice(1) : p;
  const seg = withoutSlash.split('/')[0];
  return seg && ENGLISH_PATH_TO_VIEW[seg] ? seg : null;
}

export function gameViewFromEnglishPathname(pathname: string): GamePathView | null {
  const slug = englishSlugFromPathname(pathname);
  if (!slug) return null;
  return ENGLISH_PATH_TO_VIEW[slug] ?? null;
}

export function gamePathFromView(view: GamePathView): string {
  return VIEW_TO_ENGLISH_PATH[view] ?? '/servers';
}

export function isEnglishGameSpaPath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  return ENGLISH_GAME_PATHS.has(p);
}
