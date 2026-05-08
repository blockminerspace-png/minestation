/** IDs de páginas que aparecem na barra de navegação do jogo (ordem do menu). */
export const GAME_NAV_LABEL_KEYS = [
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
] as const;

export type GameNavLabelKey = (typeof GAME_NAV_LABEL_KEYS)[number];

/** Rótulos padrão quando o servidor ainda não tem `game_nav_labels` gravado. */
export const DEFAULT_GAME_NAV_LABELS: Record<GameNavLabelKey, string> = {
  servers: 'Servidores',
  inventory: 'Estoque',
  oficina: 'Oficina',
  hardware_store: 'Lojinha Miner',
  black_market: 'P2P',
  arcade: 'Arcade',
  lucky_store: 'Caixas da Sorte',
  roleta: 'Roleta',
  wallet: 'Carteira',
  ranking: 'Ranking',
  upgrade: 'UPGRADE',
  transparency: 'Transparência',
  support: 'Suporte',
  partners: 'Parceiros',
};
