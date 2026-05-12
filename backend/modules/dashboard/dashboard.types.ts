/**
 * DTO público do endpoint `GET /api/dashboard/state`.
 *
 * Agregador de leitura: todos os campos refletem o estado real do utilizador
 * autenticado (saldos, hash, ranking, etc.) ou `null`/lista vazia quando o
 * dado ainda não existe no jogo (sem inventar valores).
 *
 * Toda a UI da Dashboard depende deste DTO; mudanças aqui têm de ser
 * compatíveis para trás (adicionar campos opcionais; não renomear silenciosamente).
 */

export type DashboardMinerStatus = 'online' | 'idle' | 'offline' | 'frozen';

export interface DashboardMinerState {
  status: DashboardMinerStatus;
  /** Nome legível do nível de acesso do utilizador (p.ex. "Beta", "Premium"). `null` quando não houver. */
  levelLabel: string | null;
  /** Identificador interno do `access_level` (estável). `null` quando não houver. */
  accessLevelId: string | null;
  /** Hash total atual do utilizador, calculado pelo servidor. */
  hashTotal: number;
  /** Hash separado por moeda (mesmo cálculo usado em `/ws/player-game`). */
  hashByCoinId: Record<string, number>;
  /** Bateria global (%) — média ponderada da carga atual / capacidade dos rigs ativos. `null` se não aplicável. */
  energyPercent: number | null;
  /** Para mostrar “100 / 100” quando faz sentido. `null` se nem todos os valores existirem. */
  energyChargeWh: number | null;
  energyCapacityWh: number | null;
  /** Rigs ligados / rigs totais (não inventar consumo se não houver). */
  rigsOnline: number;
  rigsTotal: number;
}

export interface DashboardTokenBalance {
  coinId: string;
  symbol: string;
  name: string;
  amount: number;
  usdcRate: number;
}

export interface DashboardWalletState {
  usdc: number;
  /** Lista das moedas com saldo > 0 ordenada por valor em USDC (descendente). */
  tokens: DashboardTokenBalance[];
}

export type DashboardEcosystemModuleStatus = 'available' | 'coming_soon';

export interface DashboardEcosystemModule {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  href: string;
  external: boolean;
  status: DashboardEcosystemModuleStatus;
}

export type DashboardNotificationType = 'system' | 'reward' | 'event' | 'info';

export interface DashboardNotification {
  id: string;
  type: DashboardNotificationType;
  title: string;
  message: string;
  link?: string | null;
  /** Epoch ms. */
  createdAt: number;
  read: boolean;
}

export interface DashboardEvent {
  id: string;
  title: string;
  subtitle: string;
  /** Epoch ms ou `null` se não tiver fim definido. */
  endsAt: number | null;
  status: 'active' | 'upcoming' | 'ended';
}

export interface DashboardRankingEntry {
  position: number;
  username: string;
  hash: number;
  hashUnit: string;
  isMe: boolean;
}

export interface DashboardRanking {
  top: DashboardRankingEntry[];
  /** Posição do utilizador atual (1-based) ou `null` se não estiver no ranking. */
  myPosition: number | null;
  myHash: number;
}

export interface DashboardQuickAccessItem {
  id: string;
  title: string;
  /** ID interno de View (frontend) — preferir navegação SPA. */
  viewId: string | null;
  /** Caminho público canónico (servirá de fallback para `<a href>`). */
  href: string;
  icon: string;
}

export interface DashboardStateDto {
  ok: true;
  serverTime: number;
  miner: DashboardMinerState;
  wallet: DashboardWalletState;
  ecosystemModules: DashboardEcosystemModule[];
  notifications: DashboardNotification[];
  events: DashboardEvent[];
  ranking: DashboardRanking;
  quickAccess: DashboardQuickAccessItem[];
}
