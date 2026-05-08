import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import {
  getGameState as apiGetGameState,
  updateUser as apiUpdateUser,
  getUpgrades,
  getAccessLevels,
  getLootBoxes,
  getSystemNews,
  getWeb3Settings,
  web3DepositFlagDisabled,
  buyLootBox,
  openLootBox,
  discardLootBox,
  buyUpgrades,
  impersonateUser,
  stopImpersonate,
  claimAdReward,
  performDailyBoost,
  getEconomySettings,
  getMarketListings,
  sellMarketListing,
  buyMarketListing,
  cancelMarketListing,
  claimMarketFunds,
  sellCoin,
  requestWithdrawal,
  getWithdrawalRequests,
  updateWithdrawalStatus,
  getSession,
  getServerTime,
  getMiningCoins,
  getMonetizationSettings,
  getGameNavLabels,
  getPublicBootstrap,
  getPublicBootstrapLite,
  performWorkshopInstantRecharge,
  saveGameState as apiSaveGameState,
  postServerRoomBulkBatteries,
  postServerRoomRoomCoins,
  setUpgrades as apiSetUpgrades,
  setAccessLevels as apiSetAccessLevels,
  setLootBoxes as apiSetLootBoxes,
  logout as apiLogout
} from './services/api';
import { GameState, PlacedRack, StoredBattery, User, MarketListing, Upgrade, AccessLevel, LootBox, MiningCoin, Web3Settings, MonetizationSettings, EconomySettings, SystemNews, normalizePlacedRackRoomId, NFT_AUTO_ALLOWED_CHASSIS_ID, isNftAutoArmario1OnlyRoomContext } from './types';
import { DEFAULT_GAME_NAV_LABELS, type GameNavLabelKey } from './constants/gameNavLabels';
import { appendUsdcShortfallLine } from './utils/playerMoneyMessages';
import { trackSpaPageView } from './lib/analytics';
import { useStackSocketStore } from './stores/useStackSocketStore';
import type { BulkRoomBatteryRunOptions } from './controllers/roomBatteryController';
import { MarketNews } from './components/MarketNews';
import { RemoteBannerImage } from './components/RemoteBannerImage';
import { UiNoticeModal, type UiNotice } from './components/UiNoticeModal';
import { HomePage } from './components/HomePage';
import { Footer } from './components/Footer';
import { Wallet, TrendingUp, RefreshCw, DollarSign, Coins, Server, ShoppingCart, LayoutDashboard, Package, LogOut, Home, BookOpen, User as UserIcon, Sun, Moon, Skull, Shield, Crown, Gift, ChevronDown, ChevronUp, Menu, X, Play, Wrench, Gamepad2, Trophy, Scale, Sparkles, Battery, LifeBuoy, Clapperboard } from 'lucide-react';

const DocsPage = lazy(() => import('./components/DocsPage').then((m) => ({ default: m.DocsPage })));
const AuthPage = lazy(() => import('./components/AuthPage').then((m) => ({ default: m.AuthPage })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const ProfilePage = lazy(() => import('./components/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const TransparencyPage = lazy(() => import('./components/TransparencyPage').then((m) => ({ default: m.TransparencyPage })));
const ServerRoom = lazy(() => import('./components/ServerRoom').then((m) => ({ default: m.ServerRoom })));
const PlayerCalculator = lazy(() => import('./components/PlayerCalculator').then((m) => ({ default: m.PlayerCalculator })));
const WorkshopRoom = lazy(() => import('./components/WorkshopRoom').then((m) => ({ default: m.WorkshopRoom })));
const InventoryView = lazy(() => import('./components/InventoryView').then((m) => ({ default: m.InventoryView })));
const UpgradeShop = lazy(() => import('./components/UpgradeShop').then((m) => ({ default: m.UpgradeShop })));
const LuckyBoxStore = lazy(() => import('./components/LuckyBoxStore').then((m) => ({ default: m.LuckyBoxStore })));
const RoletaPage = lazy(() => import('./components/RoletaPage').then((m) => ({ default: m.RoletaPage })));
const SupportPage = lazy(() => import('./components/SupportPage').then((m) => ({ default: m.SupportPage })));
const PartnersPage = lazy(() => import('./components/PartnersPage').then((m) => ({ default: m.PartnersPage })));
const BlackMarket = lazy(() => import('./components/BlackMarket').then((m) => ({ default: m.BlackMarket })));
const Exchange = lazy(() => import('./components/Exchange').then((m) => ({ default: m.Exchange })));
const WalletActions = lazy(() => import('./components/WalletActions').then((m) => ({ default: m.WalletActions })));
const UpgradeAccount = lazy(() => import('./components/UpgradeAccount').then((m) => ({ default: m.UpgradeAccount })));
const AdminRanking = lazy(() => import('./components/AdminRanking').then((m) => ({ default: m.AdminRanking })));
const RewardLoadingScreen = lazy(() =>
  import('./components/RewardLoadingScreen').then((m) => ({ default: m.RewardLoadingScreen }))
);

function LazyRouteFallback() {
  return (
    <div className="flex min-h-[32vh] w-full items-center justify-center text-amber-500/90" aria-busy="true" aria-label="A carregar">
      <RefreshCw className="animate-spin" size={28} />
    </div>
  );
}

const TelegramIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden>
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 1 0 24 0 12 12 0 0 0-12-12zm4.962 7.224c.1-.422.436-.698.795-.652l2.318.327c.36 0 .65.268.65.588 0 .12-.025.24-.065.358l-3.738 13.45c-.23.824-.704 1.03-1.38.644l-3.84-2.83-1.854 1.78c-.204.205-.376.376-.77.376-.244 0-.49-.11-.642-.355l-1.314-2.01-3.68-2.84c-.66-.54-.53-.978.11-1.46l14.378-8.284z" />
  </svg>
);

// --- GAME LOGIC HELPERS ---

const calculateProduction = (placedRacks: PlacedRack[], upgradesList: Upgrade[]) => {
  let total = 0;
  placedRacks.forEach(rack => {
    const battery = upgradesList.find(u => u.id === rack.batteryId);
    const isInfinite = battery && battery.powerCapacity == -1;
    if (rack.isOn && rack.wiringId && rack.batteryId && (isInfinite || rack.currentCharge > 0)) {
      let rackBaseProd = 0;
      rack.slots.forEach(slotItemId => {
        if (slotItemId) {
          const upgrade = upgradesList.find(u => u.id === slotItemId);
          if (upgrade) rackBaseProd += upgrade.baseProduction;
        }
      });
      let multiplierFactor = 1;
      rack.multiplierSlots?.forEach(slotItemId => {
        if (slotItemId) {
          const upgrade = upgradesList.find(u => u.id === slotItemId);
          if (upgrade && upgrade.multiplier) multiplierFactor += upgrade.multiplier;
        }
      });
      total += (rackBaseProd * multiplierFactor);
    }
  });
  return total;
};

const calculateRackConsumption = (rack: PlacedRack, upgradesList: Upgrade[]) => {
  let totalWatts = 0;
  rack.slots.forEach(slotItemId => {
    if (slotItemId) {
      const upgrade = upgradesList.find(u => u.id === slotItemId);
      if (upgrade && upgrade.powerConsumption) totalWatts += upgrade.powerConsumption;
    }
  });
  rack.multiplierSlots?.forEach(slotItemId => {
    if (slotItemId) {
      const upgrade = upgradesList.find(u => u.id === slotItemId);
      if (upgrade && upgrade.powerConsumption) totalWatts += upgrade.powerConsumption;
    }
  });
  return totalWatts;
};

const countActiveMachines = (placedRacks: PlacedRack[]) => {
  let count = 0;
  placedRacks.forEach(rack => {
    rack.slots.forEach(slot => { if (slot) count++; });
  });
  return count;
}

const INITIAL_STATE: GameState = {
  usdc: 0,
  startTime: Date.now(),
  stock: {},
  unopenedBoxes: {},
  storedBatteries: [],
  placedRacks: [],
  playerListings: [],
  coinBalances: {},
  claimedReferrals: 0,
  referralBonusClaimed: false,
  workshopSlots: [null, null, null, null, null, null],
  claimedBoxes: [],
  dailyActions: {}
};

const processLoadedState = (parsed: any, userEmail: string): GameState => {
  const state = { ...INITIAL_STATE, ...parsed };

  // --- MIGRATION LOGIC START ---
  if (!state.storedBatteries) state.storedBatteries = [];
  if (!state.playerListings) state.playerListings = [];
  if (!state.unopenedBoxes) state.unopenedBoxes = {};
  if (state.claimedReferrals === undefined) state.claimedReferrals = 0;
  if (state.referralBonusClaimed === undefined) state.referralBonusClaimed = false;
  if (!state.workshopSlots) {
    state.workshopSlots = [null, null, null, null, null, null];
  } else if (state.workshopSlots.length < 6) {
    const padded = [...state.workshopSlots];
    while (padded.length < 6) padded.push(null);
    state.workshopSlots = padded;
  }
  if (!state.claimedBoxes) state.claimedBoxes = [];
  if (!state.dailyActions) state.dailyActions = {};

  state.workshopSlots = state.workshopSlots.map((s: any, idx: number) => {
    if (typeof s === 'string') {
      const structure: any = { id: `ws_${userEmail}_${idx}`, itemId: s, internalSlots: {}, currentCharge: 0 };
      return structure;
    }
    return s;
  });

  if (state.placedRacks) {
    state.placedRacks = state.placedRacks.map((r: any) => {
      const isLegacyRack = !r.itemId || r.itemId === 'server_rack';
      const itemId = isLegacyRack ? 'rack_10u' : r.itemId;
      let multiSlots = r.multiplierSlots || [];
      if (isLegacyRack && multiSlots.length === 0) multiSlots = [null, null];
      return {
        ...r,
        itemId: itemId,
        wiringId: r.wiringId || null,
        batteryId: r.batteryId || null,
        multiplierSlots: multiSlots,
        currentCharge: r.currentCharge !== undefined ? r.currentCharge : 0,
        isOn: r.isOn !== undefined ? r.isOn : false,
        roomId: normalizePlacedRackRoomId(r.roomId)
      }
    });
  }
  if (state.stock && state.stock['server_rack']) {
    state.stock['rack_10u'] = (state.stock['rack_10u'] || 0) + state.stock['server_rack'];
    delete state.stock['server_rack'];
  }
  // --- MIGRATION LOGIC END ---

  return state;
};

type SaveGameApiResponse = Awaited<ReturnType<typeof apiSaveGameState>>;

/** Quando o servidor desmonta rigs ilegais na sala NFT AUTO, sincroniza ref + estado para não reaparecerem no próximo save. */
function applyNftAutoSanitizedClientSync(
  res: SaveGameApiResponse,
  gameStateRef: React.MutableRefObject<GameState>,
  setGameState: React.Dispatch<React.SetStateAction<GameState>>
) {
  if (!res || res.forceReload || res.ok === false) return;
  if (!res.nftAutoSanitized || !Array.isArray(res.placedRacks)) return;
  const next: GameState = {
    ...gameStateRef.current,
    placedRacks: res.placedRacks,
    stock: res.stock != null ? { ...res.stock } : { ...gameStateRef.current.stock },
    storedBatteries: Array.isArray(res.storedBatteries) ? res.storedBatteries : [...gameStateRef.current.storedBatteries]
  };
  gameStateRef.current = next;
  setGameState(next);
}

type View = 'servers' | 'inventory' | 'hardware_store' | 'black_market' | 'wallet' | 'profile' | 'upgrade' | 'lucky_store' | 'roleta' | 'oficina' | 'arcade' | 'calculator' | 'ranking' | 'transparency' | 'support' | 'partners';
type GlobalView = 'home' | 'docs' | 'auth' | 'game' | 'admin';

const VALID_GAME_VIEWS: readonly View[] = [
  'servers',
  'inventory',
  'hardware_store',
  'black_market',
  'wallet',
  'profile',
  'upgrade',
  'lucky_store',
  'roleta',
  'oficina',
  'arcade',
  'calculator',
  'ranking',
  'transparency',
  'support',
  'partners',
] as const;

function parseSavedGameView(raw: string | null | undefined): View {
  if (!raw || typeof raw !== 'string') return 'servers';
  const t = raw.trim();
  return (VALID_GAME_VIEWS as readonly string[]).includes(t) ? (t as View) : 'servers';
}
type Theme = 'light' | 'dark';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  /** Admin operador (não super): sem calculadora mining no jogo; Relatórios/Web3 já restringidos no painel. */
  const isOperatorAdminOnly = useMemo(
    () => !!(user?.isAdmin && !user?.isSuperAdmin),
    [user?.isAdmin, user?.isSuperAdmin]
  );
  const [globalView, setGlobalView] = useState<GlobalView>('home');
  const [theme, setTheme] = useState<Theme>('dark');
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const [web3SettingsState, setWeb3SettingsState] = useState<Web3Settings | null>(null);
  const [monetizationSettings, setMonetizationSettings] = useState<MonetizationSettings | null>(null);

  // Game State
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const gameStateRef = useRef(gameState);



  const handleRewardComplete = useCallback(() => {
    setShowRewardModal(false);
  }, []);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  /** Socket.IO (stack): tempo real paralelo ao WS legado do jogo. */
  useEffect(() => {
    const api = import.meta.env.VITE_API_URL?.trim();
    if (!api) return;
    const base = api.replace(/\/api\/?$/i, '');
    if (!base) return;
    useStackSocketStore.getState().connect(base);
    return () => {
      useStackSocketStore.getState().disconnect();
    };
  }, []);

  const [productionRate, setProductionRate] = useState(0);
  /** Hash por moeda + total vindos de `/ws/player-game` (BD). `null` = usar só cálculo local. */
  const [livePlayerGameWs, setLivePlayerGameWs] = useState<{
    hashByCoinId: Record<string, number>;
    totalHash: number;
  } | null>(null);
  const [currentView, setCurrentView] = useState<View>(() => {
    try {
      return parseSavedGameView(sessionStorage.getItem('lastView'));
    } catch {
      return 'servers';
    }
  });
  const [depositPrefill, setDepositPrefill] = useState<number | undefined>(undefined);
  const [saveLoaded, setSaveLoaded] = useState<boolean>(false);
  /** Erro ao carregar `/api/game-state/me` (UI de retry em vez de spinner infinito). */
  const [gameStateLoadError, setGameStateLoadError] = useState<string | null>(null);
  const [gameStateReloadNonce, setGameStateReloadNonce] = useState(0);

  useEffect(() => {
    sessionStorage.setItem('lastView', currentView);
  }, [currentView]);

  /** GA4: enviar `page_view` em cada mudança de vista (SPA sem router de URL). */
  useEffect(() => {
    if (globalView === 'game') {
      trackSpaPageView(`/game/${currentView}`, `Genesis Miner — ${currentView}`);
    } else {
      const titles: Record<GlobalView, string> = {
        home: 'Genesis Miner — Início',
        docs: 'Genesis Miner — Documentação',
        auth: 'Genesis Miner — Entrar',
        game: 'Genesis Miner — Jogo',
        admin: 'Genesis Miner — Admin'
      };
      trackSpaPageView(`/${globalView}`, titles[globalView]);
    }
  }, [globalView, currentView]);

  useEffect(() => {
    if (isOperatorAdminOnly && currentView === 'calculator') {
      setCurrentView('servers');
    }
  }, [isOperatorAdminOnly, currentView]);

  // Dynamic Data
  const [gameUpgrades, setGameUpgrades] = useState<Upgrade[]>([]);
  const isReady = saveLoaded && gameUpgrades.length > 0;

  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [gameNavLabels, setGameNavLabels] = useState(() => ({ ...DEFAULT_GAME_NAV_LABELS }));

  const [lootBoxDefs, setLootBoxDefs] = useState<LootBox[]>([]);
  const [miningCoins, setMiningCoins] = useState<MiningCoin[]>([]);
  const [coinsExpanded, setCoinsExpanded] = useState<boolean>(false);
  const [highlightedCoinId, setHighlightedCoinId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [economySettings, setEconomySettings] = useState<EconomySettings>({
    hardwareMarketEnabled: true,
    blackMarketEnabled: true,
    marketTaxPercent: 0,
    blackMarketPriceBandPercent: 20
  });
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [offlineStats, setOfflineStats] = useState<Record<string, number>>({});
  const [pendingRewardSummary, setPendingRewardSummary] = useState<{ id: string, name: string, count: number }[]>([]);
  const [marketRefreshTrigger, setMarketRefreshTrigger] = useState(0);
  const [saveTrigger, setSaveTrigger] = useState(0);
  const [verticalAds, setVerticalAds] = useState<SystemNews[]>([]);
  const [bulkBatteryNotice, setBulkBatteryNotice] = useState<{ title: string; message: string } | null>(null);
  const [hardwareShopNotice, setHardwareShopNotice] = useState<UiNotice | null>(null);
  const [luckyBoxNotice, setLuckyBoxNotice] = useState<UiNotice | null>(null);
  /** Passa código à Roleta após resgate em Caixas (consumido pelo `RoletaPage`). */
  const [roletaBootstrap, setRoletaBootstrap] = useState<{ v: number; code: string } | null>(null);

  const openRoletaWithCode = useCallback((code: string) => {
    const t = String(code || '').trim();
    if (!t) return;
    setRoletaBootstrap((prev) => ({ v: (prev?.v ?? 0) + 1, code: t }));
    setCurrentView('roleta');
  }, []);

  const clearRoletaBootstrap = useCallback(() => {
    setRoletaBootstrap(null);
  }, []);

  const requestSave = useCallback(() => {
    setSaveTrigger(prev => prev + 1);
  }, []);

  const handleReloadGameState = useCallback(async (newBoxes?: Record<string, number>) => {
    if (!user?.email) return;

    if (newBoxes) {
      setGameState(p => ({ ...p, unopenedBoxes: newBoxes }));
    }

    const [gs, freshUpgrades] = await Promise.all([apiGetGameState('me'), getUpgrades()]);
    const { data } = gs;
    if (data) {
      const parsed = processLoadedState(data, user.email);
      setGameState(parsed);
    }
    if (Array.isArray(freshUpgrades)) {
      setGameUpgrades(freshUpgrades);
    }
  }, [user]);

  /** Save completo + retentativas em falhas transitórias (502/522/rede). Usado pelo debounce e pelo auto-save. */
  const runPlayerSaveWithRetries = useCallback(
    async (showAlertOnHardFail: boolean) => {
      const email = user?.email;
      if (!email || user.isAdmin) return;

      const transientSaveError = (msg: string) =>
        /502|503|504|522|network|fetch|failed|timeout|econnreset|socket/i.test(String(msg || ''));

      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await apiSaveGameState(email, gameStateRef.current);
        if (res && res.forceReload) {
          await handleReloadGameState();
          return;
        }
        if (res && res.ok === false) {
          const errMsg = String((res as { error?: string }).error || '');
          if (attempt < 2 && transientSaveError(errMsg)) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          console.error('[SaveGame]', errMsg);
          if (showAlertOnHardFail) {
            alert('Não foi possível guardar: ' + errMsg + '\nA recarregar o estado do servidor.');
          }
          await handleReloadGameState();
          return;
        }
        applyNftAutoSanitizedClientSync(res, gameStateRef, setGameState);
        return;
      }
    },
    [user, handleReloadGameState]
  );

  // Structural Save Effect (for user actions)
  useEffect(() => {
    if (saveTrigger === 0 || !user?.email || user.isAdmin || !saveLoaded) return;
    const timeout = setTimeout(() => {
      void runPlayerSaveWithRetries(true);
    }, 500); // 500ms debounce
    return () => clearTimeout(timeout);
  }, [saveTrigger, user, saveLoaded, runPlayerSaveWithRetries]);

  // Save on Before Unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (user?.email && !user.isAdmin && saveLoaded) {
        apiSaveGameState(user.email, gameStateRef.current, { keepalive: true });
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user, saveLoaded]);
  const getAllowedPages = (): string[] => {
    const userLvls = user?.accessLevelIds || (user?.accessLevelId ? [user.accessLevelId] : []);
    let pages: string[];
    if (userLvls.length === 0) {
      const defaultLvl = accessLevels.find(l => l.id === (user?.accessLevelId || ''));
      pages =
        defaultLvl?.allowedPages ||
        ['servers', 'inventory', 'oficina', 'arcade', 'ranking', 'hardware_store', 'black_market', 'lucky_store', 'wallet', 'upgrade', 'profile', 'transparency', 'support', 'partners'];
    } else {
      const allAllowed = new Set<string>();
      userLvls.forEach((lid) => {
        const lvl = accessLevels.find((l) => l.id === lid);
        if (lvl?.allowedPages) {
          lvl.allowedPages.forEach((p) => allAllowed.add(p));
        }
      });
      pages =
        allAllowed.size > 0
          ? Array.from(allAllowed)
          : ['servers', 'inventory', 'oficina', 'arcade', 'ranking', 'hardware_store', 'black_market', 'lucky_store', 'wallet', 'upgrade', 'profile', 'transparency', 'support', 'partners'];
    }
    // Níveis antigos podem não incluir `black_market` em allowedPages; se o P2P está ligado na economia, mostrar o separador.
    if (economySettings.blackMarketEnabled && !pages.includes('black_market')) {
      return [...pages, 'black_market'];
    }
    return pages;
  };

  /** Evita ecrã em branco se `lastView` ou permissões mudarem (ex.: roleta sem `lucky_store`). */
  useEffect(() => {
    if (!saveLoaded || !user || user.isAdmin) return;
    const pages = getAllowedPages();
    const gated: Array<{ view: View; requiredPage: string }> = [
      { view: 'roleta', requiredPage: 'lucky_store' },
      { view: 'transparency', requiredPage: 'transparency' },
      { view: 'support', requiredPage: 'support' },
      { view: 'partners', requiredPage: 'partners' },
    ];
    for (const { view, requiredPage } of gated) {
      if (currentView === view && !pages.includes(requiredPage)) {
        setCurrentView('servers');
        break;
      }
    }
  }, [saveLoaded, user, currentView, accessLevels, economySettings.blackMarketEnabled]);

  const gameNav = useCallback((k: GameNavLabelKey) => {
    const t = gameNavLabels[k];
    return typeof t === 'string' && t.trim() ? t.trim() : DEFAULT_GAME_NAV_LABELS[k];
  }, [gameNavLabels]);

  const updateGameUpgrades = async (newUpgrades: Upgrade[]) => {
    try {
      await apiSetUpgrades(newUpgrades);
      setGameUpgrades(newUpgrades);
    } catch (e: any) {
      console.error('Failed to save upgrades:', e);
      throw e; // Propagate to caller (AdminPanel -> AdminEditor)
    }
  };

  const updateAccessLevels = async (newLevels: AccessLevel[]) => {
    try {
      setAccessLevels(newLevels);
      await apiSetAccessLevels(newLevels);
    } catch (e: any) {
      console.error('Failed to save access levels:', e);
      alert('Erro ao salvar níveis de acesso: ' + (e.message || 'Erro desconhecido'));
    }
  };

  const updateLootBoxes = async (newBoxes: LootBox[]) => {
    try {
      setLootBoxDefs(newBoxes);
      await apiSetLootBoxes(newBoxes, { replaceCatalog: true });
      const fresh = await getLootBoxes();
      setLootBoxDefs(fresh);
    } catch (e: any) {
      console.error('Failed to save loot boxes:', e);
      alert('Erro ao salvar as caixas: ' + (e.message || 'Erro desconhecido'));
      const fresh = await getLootBoxes();
      setLootBoxDefs(fresh);
    }
  };

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = (window.location.pathname || '').toLowerCase().replace(/\/+$/, '');
        const resetTokenParam = new URLSearchParams(window.location.search).get('token');
        const isPasswordResetUrl = Boolean(resetTokenParam && path.includes('redefinir-senha'));

        const [sess, ms, timeRes] = await Promise.all([
          getSession(),
          getMonetizationSettings(),
          getServerTime()
        ]);
        if (cancelled) return;

        const serverTime =
          timeRes && typeof (timeRes as { serverTime?: unknown }).serverTime === 'number'
            ? (timeRes as { serverTime: number }).serverTime
            : Date.now();

        if (sess) {
          setUser(sess);
          if (isPasswordResetUrl) setGlobalView('auth');
          else setGlobalView(sess.isAdmin ? 'admin' : 'game');
        } else {
          setUser(null);
          if (isPasswordResetUrl) setGlobalView('auth');
          else setGlobalView('home');
        }
        if (ms) setMonetizationSettings(ms);
        setTimeOffset(serverTime - Date.now());
      } catch (e) {
        console.error('[SessionInit]', e);
        if (!cancelled) {
          setUser(null);
          setGlobalView('home');
          setTimeOffset(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed dynamic data from DB (um GET /api/bootstrap em vez de 8 pedidos em paralelo)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boot = await getPublicBootstrap();
        if (cancelled) return;
        if (boot) {
          console.log('[Init] Loaded (bootstrap):', {
            up: boot.upgrades.length,
            lv: boot.accessLevels.length,
            lb: boot.lootBoxes.length,
            mc: boot.miningCoins.length
          });
          setGameUpgrades(boot.upgrades);
          setAccessLevels(boot.accessLevels);
          setLootBoxDefs(boot.lootBoxes);
          setMiningCoins(boot.miningCoins);
          if (boot.economySettings) setEconomySettings(boot.economySettings);
          if (boot.web3Settings) setWeb3SettingsState(boot.web3Settings);
          setVerticalAds(boot.systemNews.filter((n) => n.adType === 'vertical' && n.active));
          setGameNavLabels({ ...DEFAULT_GAME_NAV_LABELS, ...boot.gameNavLabels });
          return;
        }
        const [up, lv, lb, mc, econ, web3, news, navLab] = await Promise.all([
          getUpgrades(),
          getAccessLevels(),
          getLootBoxes(),
          getMiningCoins(),
          getEconomySettings(),
          getWeb3Settings(),
          getSystemNews(),
          getGameNavLabels()
        ]);
        if (cancelled) return;
        console.log('[Init] Loaded (fallback):', { up: up.length, lv: lv.length, lb: lb.length, mc: mc.length });
        setGameUpgrades(up);
        setAccessLevels(lv);
        setLootBoxDefs(lb);
        setMiningCoins(mc);
        if (econ) setEconomySettings(econ);
        if (web3) setWeb3SettingsState(web3);
        setVerticalAds(news.filter((n) => n.adType === 'vertical' && n.active));
        setGameNavLabels({ ...DEFAULT_GAME_NAV_LABELS, ...navLab });
      } catch (e) {
        console.error('[Init] Fatal Error loading initial data:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // WebSocket: cabeçalho do jogo — saldos (coin_balances + USDC) e hashrate alinhados à BD (~3,5s)
  useEffect(() => {
    if (!user || user.isAdmin || globalView !== 'game' || !saveLoaded) {
      setLivePlayerGameWs(null);
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/player-game`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type?: string;
            event?: string;
            data?: {
              coinBalances?: Record<string, number>;
              usdc?: number;
              hashByCoinId?: Record<string, number>;
              totalHash?: number;
            };
          };
          if (msg.type !== 'player_game' || msg.event !== 'tick' || !msg.data) return;
          const d = msg.data;
          const hashByCoinId =
            d.hashByCoinId && typeof d.hashByCoinId === 'object' && !Array.isArray(d.hashByCoinId)
              ? d.hashByCoinId
              : {};
          const totalHash = typeof d.totalHash === 'number' && Number.isFinite(d.totalHash) ? d.totalHash : 0;
          setLivePlayerGameWs({ hashByCoinId, totalHash });
          setGameState((prev) => {
            const nextCb =
              d.coinBalances && typeof d.coinBalances === 'object' && !Array.isArray(d.coinBalances)
                ? { ...prev.coinBalances, ...d.coinBalances }
                : prev.coinBalances;
            const nextUsdc = typeof d.usdc === 'number' && Number.isFinite(d.usdc) ? d.usdc : prev.usdc;
            if (nextCb === prev.coinBalances && nextUsdc === prev.usdc) return prev;
            return { ...prev, coinBalances: nextCb, usdc: nextUsdc };
          });
        } catch {
          /* frame inválido */
        }
      };
      ws.onclose = () => setLivePlayerGameWs(null);
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      setLivePlayerGameWs(null);
    }
    return () => {
      setLivePlayerGameWs(null);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [user, globalView, saveLoaded]);

  // Load Save when User changes (inclui admin: ranking / troféu na header; auto-save continua a ignorar admin)
  useEffect(() => {
    if (!user) {
      setGameState(INITIAL_STATE);
      setSaveLoaded(false);
      setGameStateLoadError(null);
      return;
    }

    let cancelled = false;
    setGameStateLoadError(null);
    (async () => {
      try {
        const { data, status, error: errBody } = await apiGetGameState('me');
        if (cancelled) return;
        if (data) {
          setOfflineStats((data as any).offlineMined || {});
          const parsed = processLoadedState(data, user.email);
          setGameState(parsed);
          setSaveLoaded(true);
          setGameStateLoadError(null);
        } else if (status === 404) {
          setGameState(INITIAL_STATE);
          await apiSaveGameState(user.email, INITIAL_STATE);
          if (!cancelled) {
            setSaveLoaded(true);
            setGameStateLoadError(null);
          }
        } else {
          const hint =
            errBody ||
            (status === 401
              ? 'Sessão expirou. Entre novamente.'
              : status >= 500
                ? 'Servidor não conseguiu carregar o guardado. Tente de novo em instantes.'
                : 'Não foi possível carregar o estado do jogo.');
          console.error('[GameState] Falha ao carregar:', status, hint);
          if (!cancelled) setGameStateLoadError(hint);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro inesperado ao processar o guardado.';
        console.error('[GameState] Excepção ao carregar:', e);
        if (!cancelled) setGameStateLoadError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, gameStateReloadNonce]);

  // INTRO PRESENTATION (CMD STYLE)
  // Trigger on every fresh login (session start)
  const hasShownIntro = useRef(false);

  // Reset intro flag when user logs out
  useEffect(() => {
    if (!user) {
      hasShownIntro.current = false;
    }
  }, [user]);

  useEffect(() => {
    // Terminal intro first: do not wait for save (avoids flashing the game shell before the overlay).
    if (user && !user.isAdmin && !hasShownIntro.current) {
      hasShownIntro.current = true;

      const rewardsToShow = [];
      if ((user as any).isNewRegistration) {
        rewardsToShow.push({ id: 'reg_bonus', name: 'Pacote de Boas-vindas', count: 1 });
        if (user.referredBy) rewardsToShow.push({ id: 'ref_bonus', name: 'Prêmio de Indicado', count: 1 });
      }

      setPendingRewardSummary(rewardsToShow);
      setShowRewardModal(true);
    }
  }, [user]);

  // Recalculate Production Rate
  useEffect(() => {
    setProductionRate(calculateProduction(gameState.placedRacks, gameUpgrades));
  }, [gameState.placedRacks, gameUpgrades]);

  // Game Loop (visual: bateria / oficina — só estado local; não faz fetch HTTP)
  const VISUAL_TICK_MS = 2000;
  useEffect(() => {
    if (!user || user.isAdmin || !saveLoaded || gameUpgrades.length === 0) return;

    const tickScale = VISUAL_TICK_MS / 1000;

    const interval = setInterval(() => {
      setGameState(prev => {
        let changed = false;

        // --- 1.2 RACK DEPLETION (Real-time Battery Drain) ---
        // Battery drain remains continuous (real-time physics)
        const nextRacks = prev.placedRacks.map(r => {
          const batt = gameUpgrades.find(u => u.id === r.batteryId);
          const isInf = batt && batt.powerCapacity === -1;
          if (r.isOn && r.wiringId && r.batteryId && r.currentCharge > 0 && !isInf) {
            let watts = 0;
            r.slots.forEach(sid => {
              const up = gameUpgrades.find(u => u.id === sid);
              if (up) watts += up.powerConsumption || 0;
            });
            r.multiplierSlots?.forEach(sid => {
              const mod = gameUpgrades.find(u => u.id === sid);
              if (mod) watts += mod.powerConsumption || 0;
            });

            if (watts > 0) {
              const depletion = (watts / 3600) * 0.1 * tickScale;
              const newCharge = Math.max(0, r.currentCharge - depletion);
              if (newCharge !== r.currentCharge) {
                changed = true;
                return { ...r, currentCharge: newCharge };
              }
            }
          }
          return r;
        });

        // --- 2. WORKSHOP ESTIMATOR ---
        const nextWorkshop = (prev.workshopSlots || []).map(ws => {
          if (!ws || !ws.itemId) return ws;
          const def = gameUpgrades.find(u => u.id === ws.itemId);
          if (!def || def.type !== 'charger') return ws;

          const layout = def.layout;
          if (!layout) return ws;

          const batterySlots = layout.slots.filter(s => s.type === 'battery');
          const wiringSlot = layout.slots.find(s => s.type === 'wiring');

          if (batterySlots.length === 0) return ws;

          const gsv = (obj: any, sid: string) => {
            if (!obj || !sid) return null;
            if (obj[sid] !== undefined) return obj[sid];
            const entry = Object.entries(obj).find(([k]) => k.toLowerCase().trim() === sid.toLowerCase().trim());
            return entry ? entry[1] : null;
          };

          if (wiringSlot && !gsv(ws.internalSlots, wiringSlot.id)) return ws;

          // Calculate Base Speed (Total output)
          let speed = (def.baseProduction || 0.5);

          // Apply Wiring Transfer Bonus (Computed once for the charger)
          if (wiringSlot) {
            const wId = gsv(ws.internalSlots, wiringSlot.id);
            if (wId) {
              const wSavedId = gsv(ws.slotItemIds, wiringSlot.id);
              let wDef = gameUpgrades.find(u => u.id === wSavedId);
              if (!wDef) wDef = gameUpgrades.find(u => u.id === wId);

              if (wDef && wDef.energyTransferRateBonus) {
                speed = speed * (1 + wDef.energyTransferRateBonus);
              }
            }
          }

          let internalBuffer = ws.currentCharge ?? 0;
          const nextSlotCharges = { ...ws.slotCharges };
          let hasChanges = false;

          for (const batSlot of batterySlots) {
            const batteryIid = gsv(ws.internalSlots, batSlot.id);
            if (!batteryIid) continue;

            let bDef = gameUpgrades.find(u => u.id === gsv(ws.slotItemIds, batSlot.id));
            if (!bDef) {
              const bInst = prev.storedBatteries.find(b => b.id === batteryIid);
              if (bInst) bDef = gameUpgrades.find(u => u.id === bInst.itemId);
            }
            if (!bDef) continue;

            const maxB = bDef.powerCapacity || 100;
            const currentB = nextSlotCharges[batSlot.id] !== undefined ? nextSlotCharges[batSlot.id] : 0;

            if (currentB < maxB && internalBuffer > 0) {
              // Transfer per tick (speed * 0.1 per second of sim). Scaled by VISUAL_TICK_MS.
              const transfer = Math.min(speed * 0.1 * tickScale, internalBuffer, maxB - currentB);

              if (transfer > 0) {
                internalBuffer -= transfer;
                nextSlotCharges[batSlot.id] = currentB + transfer;
                hasChanges = true;
              }
            }

            if (internalBuffer <= 0.0001) break;
          }

          if (hasChanges) {
            changed = true;
            return {
              ...ws,
              currentCharge: internalBuffer,
              slotCharges: nextSlotCharges
            };
          }

          return ws;
        });

        if (!changed) return prev;
        return { ...prev, workshopSlots: nextWorkshop, placedRacks: nextRacks };
      });
    }, VISUAL_TICK_MS);

    return () => clearInterval(interval);
  }, [user, gameUpgrades, saveLoaded]);

  // Auto-Save (mesmas retentativas que o save por ação — evita reload em picos 522/502)
  useEffect(() => {
    if (!user || user.isAdmin || !saveLoaded) return;
    const saveInterval = setInterval(() => {
      if (saveLoaded) void runPlayerSaveWithRetries(false);
    }, 30000); // Optimized: 30s instead of 5s to reduce network and CPU load
    return () => clearInterval(saveInterval);
  }, [user, saveLoaded, runPlayerSaveWithRetries]);

  // Atualizações globais (loja / economia / web3) — só com sessão; pausa em separador oculto para menos rede/CPU
  useEffect(() => {
    if (!user) return;
    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const lite = await getPublicBootstrapLite();
        if (lite) {
          setAccessLevels(lite.accessLevels);
          setMiningCoins(lite.miningCoins);
          if (lite.economySettings) setEconomySettings(lite.economySettings);
          setLootBoxDefs(lite.lootBoxes);
          if (lite.web3Settings) setWeb3SettingsState(lite.web3Settings);
          return;
        }
        const [lv, mc, econ, lb, web3] = await Promise.all([
          getAccessLevels(),
          getMiningCoins(),
          getEconomySettings(),
          getLootBoxes(),
          getWeb3Settings()
        ]);
        setAccessLevels(lv);
        setMiningCoins(mc);
        if (econ) setEconomySettings(econ);
        setLootBoxDefs(lb);
        if (web3) setWeb3SettingsState(web3);
      } catch (e) {
        console.error('[Global refresh] failed', e);
      }
    };
    void tick();
    const interval = setInterval(tick, 10000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user]);

  // Auth Handlers
  const handleLogin = async (u: User) => {
    if (!u) return;
    setUser(u);
    setGlobalView(u.isAdmin ? 'admin' : 'game');
  };

  const handleLogout = async () => {
    await apiLogout();
    setUser(null);
    setGlobalView('home');
    setGameState(INITIAL_STATE);
  };



  const handleUpdateUser = async (updatedUser: User) => {
    await apiUpdateUser(updatedUser);
    setUser(updatedUser);
  };

  const handleUpgradeAccess = (newLevelId: string) => {
    if (!user) return;
    const newLvlIds = Array.from(new Set([...(user.accessLevelIds || []), newLevelId]));
    const updatedUser = { ...user, accessLevelId: newLevelId, accessLevelIds: newLvlIds };
    handleUpdateUser(updatedUser);
    // Give Upgrade Rewards if any
    const rewardBoxes = lootBoxDefs.filter(b => b.trigger === 'upgrade');
    if (rewardBoxes.length > 0) {
      setGameState(prev => {
        const newBoxes = { ...prev.unopenedBoxes };
        rewardBoxes.forEach(b => newBoxes[b.id] = (newBoxes[b.id] || 0) + 1);
        return { ...prev, unopenedBoxes: newBoxes };
      });
    }
  }

  // --- ACTIONS ---

  const handleBatchBuy = useCallback(async (cart: Record<string, number>, totalCost: number) => {
    if (!user?.email) return;

    const tc = Number(totalCost);
    if (!Number.isFinite(tc) || tc <= 0) {
      setHardwareShopNotice({
        variant: 'error',
        title: 'Lojinha Miner',
        message: 'Valor da compra inválido.'
      });
      return;
    }
    let recomputed = 0;
    for (const [id, rawQty] of Object.entries(cart)) {
      const q = Math.floor(Number(rawQty));
      if (!Number.isFinite(q) || q < 1) {
        setHardwareShopNotice({
          variant: 'error',
          title: 'Lojinha Miner',
          message: 'Quantidade inválida no carrinho.'
        });
        return;
      }
      const u = gameUpgrades.find((x) => x.id === id);
      if (!u) {
        setHardwareShopNotice({
          variant: 'error',
          title: 'Lojinha Miner',
          message: 'Item desconhecido no carrinho.'
        });
        return;
      }
      recomputed += u.baseCost * q;
    }
    if (Math.abs(recomputed - tc) > 1e-5) {
      setHardwareShopNotice({
        variant: 'error',
        title: 'Lojinha Miner',
        message: 'O total não confere com os itens. Recarrega a página (F5) e tenta de novo.'
      });
      return;
    }

    if (gameState.usdc < tc) {
      setHardwareShopNotice({
        variant: 'error',
        title: 'Lojinha Miner',
        message: 'Saldo USDC insuficiente na reserva.'
      });
      return;
    }

    const res = await buyUpgrades(user.email, cart);
    if (res.ok) {
      await handleReloadGameState();
      setHardwareShopNotice({
        variant: 'success',
        title: 'Lojinha Miner',
        message: 'Compra realizada com sucesso! O teu estoque foi actualizado.'
      });
    } else {
      setHardwareShopNotice({
        variant: 'error',
        title: 'Lojinha Miner',
        message: res.error || 'Erro ao realizar compra.'
      });
    }
  }, [user, gameState.usdc, gameUpgrades, handleReloadGameState]);

  const handleSuggestDeposit = useCallback((amount: number) => {
    setDepositPrefill(amount);
    setCurrentView('wallet');
  }, []);

  const handlePassPurchased = useCallback((seasonId: string, passId: string, newUsdc: number) => {
    setGameState(prev => ({ ...prev, usdc: newUsdc }));
  }, []);



  const handleP2PBuy = useCallback(async (listing: MarketListing) => {
    const q = Math.max(1, parseInt(String(listing.qty ?? 1), 10) || 1);
    const res = await buyMarketListing(listing.id, q);
    if (!res.ok) {
      if (res.error === 'Insufficient USDC') alert(`Saldo insuficiente.Faltam $${res.missing?.toFixed(2) || '0.00'} `);
      if (res.error === 'Not authenticated') alert('Você precisa estar logado para comprar.');
      return;
    }
    setMarketRefreshTrigger(p => p + 1);
    if (!user?.email) return;
    const { data } = await apiGetGameState(user.email);
    if (data) {
      const parsed = processLoadedState(data, user.email);
      setGameState(parsed);
    }
  }, [user]);

  const handleCreateListing = useCallback(async (itemId: string, price: number, qty: number) => {
    if (!user?.email) return;
    const res = await sellMarketListing(itemId, price, qty);
    if (res.ok) {
      setMarketRefreshTrigger(p => p + 1);
      handleReloadGameState();
      alert('Item listado com sucesso!');
    } else {
      alert('Erro ao listar item: ' + (res.error || 'Erro desconhecido'));
    }
  }, [user]);

  const handleCancelListing = useCallback(async (listingId: string) => {
    const res = await cancelMarketListing(listingId);
    if (res.ok) {
      setMarketRefreshTrigger(p => p + 1);
      handleReloadGameState();
      alert('Listagem cancelada!');
    } else {
      alert('Erro ao cancelar: ' + (res.error || 'Erro desconhecido'));
    }
  }, []);

  // Venda de Nanit removida: apenas moedas definidas no backend podem ser vendidas


  /* handleSellCoin moved below to use API */


  const handleAddUSDC = useCallback(async (amt: number, network: string = 'polygon'): Promise<{ ok: boolean; tx?: string; cancelled?: boolean }> => {
    if (!amt || amt < 0.001) return { ok: false };
    if (!user?.polygonWallet) return { ok: false };
    const s = await getWeb3Settings();
    if (!s) {
      alert('Não foi possível carregar as configurações de depósito. Atualiza a página e tenta novamente.');
      return { ok: false };
    }
    const netKey = (network || 'polygon').toLowerCase();
    if (netKey === 'polygon' || netKey === 'matic') {
      if (web3DepositFlagDisabled(s.depositPolygonDisabled)) {
        alert('Depósitos na Polygon estão desativados pelo administrador.');
        return { ok: false };
      }
    } else if (netKey === 'bnb' || netKey === 'bsc') {
      if (web3DepositFlagDisabled(s.depositBnbDisabled)) {
        alert('Depósitos na BNB Chain estão desativados pelo administrador.');
        return { ok: false };
      }
    } else if (netKey === 'base') {
      if (web3DepositFlagDisabled(s.depositBaseDisabled)) {
        alert('Depósitos na Base estão desativados pelo administrador.');
        return { ok: false };
      }
    }

    let contract = '';
    let targetChainId = '0x89';
    let chainName = 'Polygon Mainnet';
    let nativeCurrency = { name: 'MATIC', symbol: 'MATIC', decimals: 18 };
    let rpcUrls = ['https://polygon-rpc.com'];
    let blockExplorerUrls = ['https://polygonscan.com'];

    if (network === 'bnb' || network === 'bsc') {
      contract = s?.depositTokenContractBnb || '';
      targetChainId = '0x38';
      chainName = 'Binance Smart Chain';
      nativeCurrency = { name: 'BNB', symbol: 'BNB', decimals: 18 };
      rpcUrls = ['https://bsc-dataseed.binance.org/'];
      blockExplorerUrls = ['https://bscscan.com'];
    } else if (network === 'base') {
      contract = s?.depositTokenContractBase || '';
      targetChainId = '0x2105';
      chainName = 'Base Mainnet';
      nativeCurrency = { name: 'ETH', symbol: 'ETH', decimals: 18 };
      rpcUrls = ['https://mainnet.base.org'];
      blockExplorerUrls = ['https://basescan.org'];
    } else {
      contract = s?.depositTokenContract || ''; // Polygon
    }

    const dest = s?.depositWallet || '';
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract) || !/^0x[a-fA-F0-9]{40}$/.test(dest)) {
      alert(`Configuração de contrato/carteira incompleta para a rede ${network}.`);
      return { ok: false };
    }

    const eth = (window as any).ethereum;
    if (!eth) return { ok: false };
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    const from = accounts && accounts[0];
    if (!from || !/^0x[a-fA-F0-9]{40}$/.test(from)) return { ok: false };
    if (from.toLowerCase() !== user.polygonWallet.toLowerCase()) { alert('Depósito deve ser realizado exclusivamente pela carteira conectada no Perfil.'); return { ok: false }; }

    try {
      const chainId = await eth.request({ method: 'eth_chainId' });
      if (chainId.toLowerCase() !== targetChainId.toLowerCase()) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainId }] });
        } catch {
          try {
            await eth.request({
              method: 'wallet_addEthereumChain', params: [{
                chainId: targetChainId,
                chainName,
                nativeCurrency,
                rpcUrls,
                blockExplorerUrls
              }]
            });
          } catch { }
        }
      }
    } catch { }

    let decimals = 6;
    try {
      const decRes = await eth.request({ method: 'eth_call', params: [{ to: contract, data: '0x313ce567' }, 'latest'] });
      if (typeof decRes === 'string' && decRes.startsWith('0x')) {
        const d = parseInt(decRes, 16);
        if (!isNaN(d) && d > 0 && d < 36) decimals = d;
      }
    } catch { }

    const raw = BigInt(Math.round(amt * Math.pow(10, decimals)));
    const amountHex = raw.toString(16);
    const toPadded = dest.replace(/^0x/, '').padStart(64, '0');
    const amtPadded = amountHex.padStart(64, '0');
    const data = '0xa9059cbb' + toPadded + amtPadded;

    try {
      const proceed = window.confirm(`Atenção: você pagará o gas na rede ${network.toUpperCase()}. Deseja continuar?`);
      if (!proceed) return { ok: false, cancelled: true };
      const tx = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: contract, value: '0x0', data }] });
      if (typeof tx === 'string' && tx) {
        // Wait for receipt
        for (let i = 0; i < 30; i++) {
          await new Promise(res => setTimeout(res, 2000));
          try {
            const receipt = await eth.request({ method: 'eth_getTransactionReceipt', params: [tx] });
            if (receipt && typeof receipt === 'object' && 'status' in receipt) {
              const ok = receipt.status === '0x1' || receipt.status === 1;
              return { ok, tx };
            }
          } catch { }
        }
        return { ok: false, tx };
      }
      return { ok: false };
    } catch {
      return { ok: false, cancelled: true };
    }
  }, [getWeb3Settings, user]);

  const [depositFlow, setDepositFlow] = useState<{
    pending: boolean;
    status?: 'awaiting' | 'success' | 'queued' | 'cancelled' | 'failed';
    amount?: number;
    txHash?: string;
    network?: string;
    /** Mensagem do servidor / rede quando o depósito falha (ex.: saldo insuficiente on-chain). */
    failureReason?: string;
  }>({ pending: false });

  const verifyDepositWithServer = useCallback(
    async (txHash: string, network: string): Promise<{ ok: boolean; pending?: boolean; error?: string }> => {
      if (!user?.email) return { ok: false, error: 'Sessão inválida.' };
      const txNorm = String(txHash || '').trim().toLowerCase();
      const verifyRes = await fetch('/api/deposit/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: user.email, txHash: txNorm, network })
      });
      let verifyData: { ok?: boolean; pending?: boolean; newUsdc?: number; error?: string; message?: string };
      try {
        verifyData = await verifyRes.json();
      } catch {
        return { ok: false, error: 'Resposta inválida do servidor.' };
      }
      if (verifyRes.ok && verifyData.ok) {
        setGameState((p) => ({ ...p, usdc: verifyData.newUsdc ?? p.usdc }));
        return { ok: true };
      }
      if (verifyData.pending) return { ok: false, pending: true };
      return {
        ok: false,
        error: verifyData.error || (!verifyRes.ok ? 'Pedido rejeitado pelo servidor.' : 'Falha na validação.')
      };
    },
    [user?.email]
  );

  useEffect(() => {
    if (depositFlow.status !== 'queued' || !depositFlow.txHash || !user?.email) return;
    const network = depositFlow.network || 'polygon';
    const txHash = depositFlow.txHash;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 24;
    const tick = async () => {
      if (cancelled || attempts++ >= maxAttempts) return;
      const out = await verifyDepositWithServer(txHash, network);
      if (cancelled) return;
      if (out.ok) {
        setDepositFlow((f) => ({ ...f, status: 'success' }));
      }
    };
    const id = setInterval(tick, 15000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [depositFlow.status, depositFlow.txHash, depositFlow.network, user?.email, verifyDepositWithServer]);

  const handleStartDeposit = useCallback(async (amt: number, network: string = 'polygon') => {
    const minDep = web3SettingsState?.minDepositUsdc ?? 0.001;
    if (!amt || amt < minDep || !user?.polygonWallet || !user?.email) return;

    setDepositFlow({ pending: true, status: 'awaiting', amount: amt, network });
    const res = await handleAddUSDC(amt, network);

    // Com hash de tx, validar sempre no servidor — mesmo se a carteira não devolveu o recibo a tempo
    // (timeout devolve ok:false mas tx presente; na chain a tx pode já estar confirmada).
    if (res && res.tx && !res.cancelled) {
      try {
        const verifyDataResult = await verifyDepositWithServer(res.tx, network);
        if (verifyDataResult.ok) {
          setDepositFlow({ pending: false, status: 'success', amount: amt, txHash: res.tx, network });
        } else if (verifyDataResult.pending) {
          setDepositFlow({ pending: false, status: 'queued', amount: amt, txHash: res.tx, network });
          alert(
            'Transação enviada. Os USDC serão creditados quando a rede confirmar — esta página tenta sincronizar sozinha a cada 15 s; também pode usar «Sincronizar agora» na carteira. Na Polygon, USDC nativo (Circle) e USDC.e contam, desde que o destino seja o endereço de depósito do jogo.'
          );
        } else {
          setDepositFlow({
            pending: false,
            status: 'failed',
            amount: amt,
            txHash: res.tx,
            network,
            failureReason: verifyDataResult.error || 'Não foi possível validar o depósito.'
          });
          console.error('[DepositVerify] Failed:', verifyDataResult.error);
        }
      } catch (e: any) {
        console.error('[DepositVerify] Connection Error:', e);
        setDepositFlow({
          pending: false,
          status: 'failed',
          amount: amt,
          txHash: res.tx,
          network,
          failureReason: e?.message ? `Erro ao falar com o servidor: ${e.message}` : 'Erro de rede ao validar o depósito.'
        });
      }
    } else if (res && res.cancelled) {
      setDepositFlow({ pending: false, status: 'cancelled', amount: amt, network });
    } else {
      setDepositFlow({ pending: false, status: 'failed', amount: amt, txHash: res?.tx, network });
    }
  }, [handleAddUSDC, user, web3SettingsState, verifyDepositWithServer]);

  /* Custom Exchange Handler */
  const handleSellCoin = useCallback(async (coinId: string, percentage: number) => {
    if (!user?.email) return;
    if (confirm(`Tem certeza que deseja vender ${(percentage * 100).toFixed(0)}% do seu saldo desta moeda?`)) {
      const res = await sellCoin(coinId, percentage);
      if (res.ok) {
        setGameState(p => ({
          ...p,
          usdc: res.newUsdc ?? p.usdc,
          coinBalances: { ...p.coinBalances, [coinId]: res.newCoinBalance ?? 0 }
        }));
        const feeMsg = res.feeUsdc && res.feeUsdc > 0 ? ` (Taxa: $${res.feeUsdc.toFixed(4)})` : '';
        alert(`Venda realizada com sucesso! +$${res.netUsdc?.toFixed(4)} USDC${feeMsg}`);
        requestSave();
      } else {
        alert(res.error || "Falha na venda.");
      }
    }
  }, [user, requestSave]);

  const [adSelection, setAdSelection] = useState<{ wsIdx: number } | null>(null);
  useEffect(() => { (async () => { const s = await getWeb3Settings(); setWeb3SettingsState(s); })(); }, []);
  useEffect(() => {
    if (!saveLoaded || currentView !== 'wallet') return;
    let cancelled = false;
    (async () => {
      const s = await getWeb3Settings();
      if (!cancelled) setWeb3SettingsState(s);
    })();
    return () => { cancelled = true; };
  }, [saveLoaded, currentView]);
  const handleMintNFT = useCallback((id: string, amt: number) => { setGameState(p => ({ ...p, stock: { ...p.stock, [id]: (p.stock[id] || 0) + amt } })); requestSave(); }, [requestSave]);
  const handleBurnNFT = useCallback((id: string, amt: number) => { setGameState(p => { const cur = p.stock[id] || 0; if (cur < amt) return p; return { ...p, stock: { ...p.stock, [id]: cur - amt } }; }); requestSave(); }, [requestSave]);

  const handlePlaceRack = useCallback(
    (typeId: string, roomId: string, slotIndex: number, ctx?: { roomName?: string; nftAutoArmario1Only?: boolean }) => {
      if (isNftAutoArmario1OnlyRoomContext(roomId, ctx?.roomName, ctx?.nftAutoArmario1Only) && typeId !== NFT_AUTO_ALLOWED_CHASSIS_ID) {
        alert('Nesta sala só é permitido o chassis Rack H1 NFT Collection.');
        return;
      }
      setGameState((p) => {
        if ((p.stock[typeId] || 0) < 1) return p;
        const def = gameUpgrades.find((u) => u.id === typeId);
        if (!def) return p;
        const nr: PlacedRack = {
          id: crypto.randomUUID(),
          itemId: typeId,
          slots: Array(def.slotsCapacity || 10).fill(null),
          multiplierSlots: Array(def.aiSlotsCapacity || 0).fill(null),
          batteryId: null,
          wiringId: null,
          currentCharge: 0,
          isOn: false,
          roomId,
          slotIndex
        };
        return { ...p, stock: { ...p.stock, [typeId]: p.stock[typeId] - 1 }, placedRacks: [...p.placedRacks, nr] };
      });
      requestSave();
    },
    [gameUpgrades, requestSave]
  );

  const handleRemoveRack = useCallback((rackId: string) => {
    if (!confirm('Desmontar esta rig? Todos os componentes (GPUs, fiação, bateria, multiplicadores) voltam para o estoque.')) return;
    setGameState(p => {
      const r = p.placedRacks.find(x => x.id === rackId);
      if (!r) return p;
      const ns = { ...p.stock };
      let nb = [...p.storedBatteries];
      ns[r.itemId] = (ns[r.itemId] || 0) + 1;
      (Array.isArray(r.slots) ? r.slots : []).forEach(i => { if (i) ns[i] = (ns[i] || 0) + 1; });
      (Array.isArray(r.multiplierSlots) ? r.multiplierSlots : []).forEach(i => { if (i) ns[i] = (ns[i] || 0) + 1; });
      if (r.wiringId) ns[r.wiringId] = (ns[r.wiringId] || 0) + 1;
      if (r.batteryId) {
        const upg = gameUpgrades.find(u => u.id === r.batteryId);
        const capacity = upg?.powerCapacity || 100;
        const isFull = r.currentCharge >= (capacity * 0.999);
        if (isFull) {
          ns[r.batteryId] = (ns[r.batteryId] || 0) + 1;
        } else {
          nb.push({ id: crypto.randomUUID(), itemId: r.batteryId, currentCharge: r.currentCharge });
        }
      }
      return { ...p, stock: ns, storedBatteries: nb, placedRacks: p.placedRacks.filter(x => x.id !== rackId) };
    });
    requestSave();
  }, [gameUpgrades, requestSave]);

  const handleEquipMiner = useCallback((rid: string, idx: number, mid: string) => {
    setGameState(p => {
      if ((p.stock[mid] || 0) < 1) return p; const ri = p.placedRacks.findIndex(r => r.id === rid); if (ri === -1) return p;
      const ur = [...p.placedRacks]; const r = { ...ur[ri], slots: [...ur[ri].slots] }; if (r.slots[idx]) return p;
      r.slots[idx] = mid; ur[ri] = r; return { ...p, stock: { ...p.stock, [mid]: p.stock[mid] - 1 }, placedRacks: ur };
    });
    requestSave();
  }, [requestSave]);

  const handleUnequipMiner = useCallback((rid: string, idx: number) => {
    setGameState(p => {
      const ri = p.placedRacks.findIndex(r => r.id === rid); if (ri === -1) return p;
      const ur = [...p.placedRacks]; const r = { ...ur[ri], slots: [...ur[ri].slots] }; const item = r.slots[idx]; if (!item) return p;
      r.slots[idx] = null; ur[ri] = r; return { ...p, stock: { ...p.stock, [item]: (p.stock[item] || 0) + 1 }, placedRacks: ur };
    });
    requestSave();
  }, [requestSave]);

  const handleEquipAux = useCallback((rid: string, iid: string, type: string, sbid?: string, idx?: number) => {
    setGameState(p => {
      const ri = p.placedRacks.findIndex(r => r.id === rid); if (ri === -1) return p;
      const ur = [...p.placedRacks]; const r = { ...ur[ri] }; let ns = { ...p.stock }; let nb = [...p.storedBatteries]; let initCharge = 0;

      // --- [FIX] Recover old item if slot is occupied ---
      let oldItemId: string | null = null;
      let oldCharge = 0;
      if (type === 'battery' && r.batteryId) {
        oldItemId = r.batteryId;
        oldCharge = r.currentCharge;
      } else if (type === 'wiring' && r.wiringId) {
        oldItemId = r.wiringId;
      } else if (type === 'multiplier' && idx !== undefined && r.multiplierSlots[idx]) {
        oldItemId = r.multiplierSlots[idx];
      }

      if (oldItemId) {
        const upg = gameUpgrades.find(u => u.id === oldItemId);
        if (type === 'battery') {
          const capacity = upg?.powerCapacity || 100;
          const isFull = oldCharge >= (capacity * 0.999);
          if (isFull) {
            ns[oldItemId] = (ns[oldItemId] || 0) + 1;
          } else {
            nb.push({ id: crypto.randomUUID(), itemId: oldItemId, currentCharge: oldCharge });
          }
        } else {
          ns[oldItemId] = (ns[oldItemId] || 0) + 1;
        }
      }
      // ------------------------------------------------

      if (type === 'battery') {
        if (sbid) { const s = nb.find(b => b.id === sbid); if (!s) return p; initCharge = s.currentCharge; nb = nb.filter(b => b.id !== sbid); }
        else { if ((ns[iid] || 0) < 1) return p; ns[iid]--; initCharge = gameUpgrades.find(u => u.id === iid)?.powerCapacity || 0; }
        r.batteryId = iid; r.currentCharge = initCharge; r.isOn = true;
      } else if (type === 'wiring') { if ((ns[iid] || 0) < 1) return p; ns[iid]--; r.wiringId = iid; }
      else if (type === 'multiplier' && idx !== undefined) { if ((ns[iid] || 0) < 1) return p; ns[iid]--; r.multiplierSlots = [...r.multiplierSlots]; r.multiplierSlots[idx] = iid; }
      ur[ri] = r; return { ...p, stock: ns, storedBatteries: nb, placedRacks: ur };
    });
    requestSave();
  }, [gameUpgrades, requestSave]);

  const handleUnequipAux = useCallback((rid: string, type: string, idx?: number) => {
    setGameState(p => {
      const ri = p.placedRacks.findIndex(r => r.id === rid); if (ri === -1) return p;
      const ur = [...p.placedRacks]; const r = { ...ur[ri] }; let id: string | null = null;
      if (type === 'battery') id = r.batteryId; else if (type === 'wiring') id = r.wiringId; else if (type === 'multiplier' && idx !== undefined) id = r.multiplierSlots[idx];
      if (!id) return p; let ns = { ...p.stock }; let nb = [...p.storedBatteries];
      if (type === 'battery') {
        const upg = gameUpgrades.find(u => u.id === id);
        const capacity = upg?.powerCapacity || 100;
        const isFull = r.currentCharge >= (capacity * 0.999);
        if (isFull) {
          ns[id] = (ns[id] || 0) + 1;
        } else {
          nb.push({ id: crypto.randomUUID(), itemId: id, currentCharge: r.currentCharge });
        }
        r.batteryId = null; r.currentCharge = 0; r.isOn = false;
      }
      else if (type === 'wiring') { ns[id] = (ns[id] || 0) + 1; r.wiringId = null; }
      else if (type === 'multiplier' && idx !== undefined) { ns[id] = (ns[id] || 0) + 1; r.multiplierSlots = [...r.multiplierSlots]; r.multiplierSlots[idx] = null; }
      ur[ri] = r; return { ...p, stock: ns, storedBatteries: nb, placedRacks: ur };
    });
    requestSave();
  }, [gameUpgrades, requestSave]);

  const handleTogglePower = useCallback((rid: string) => {
    setGameState(p => {
      const ri = p.placedRacks.findIndex(r => r.id === rid);
      if (ri === -1) return p;
      const rack = p.placedRacks[ri];

      if (!rack.isOn) {
        const missing = [];
        if (!rack.selectedCoinId) missing.push("Escolher uma criptomoeda");
        if (!rack.batteryId) missing.push("Instalar uma Bateria");
        if (!rack.wiringId) missing.push("Conectar o Circuito");
        const hasMiners = rack.slots.some(s => s !== null);
        if (!hasMiners) missing.push("Instalar pelo menos uma GPU");

        if (missing.length > 0) {
          alert("SISTEMA BLOQUEADO! Para ligar a Rig você precisa primeiro:\n\n" + missing.map(m => "• " + m).join("\n"));
          return p;
        }
      }

      const ur = [...p.placedRacks];
      ur[ri] = { ...ur[ri], isOn: !ur[ri].isOn };
      return { ...p, placedRacks: ur };
    });
    requestSave();
  }, [requestSave]);

  const handleRecharge = useCallback((rid: string) => {
    setGameState(p => { const ri = p.placedRacks.findIndex(r => r.id === rid); if (ri === -1) return p; const r = p.placedRacks[ri]; if (!r.batteryId) return p; const cap = gameUpgrades.find(u => u.id === r.batteryId)?.powerCapacity || 0; const ur = [...p.placedRacks]; ur[ri] = { ...r, currentCharge: cap }; return { ...p, placedRacks: ur }; });
    requestSave();
  }, [gameUpgrades, requestSave]);

  const handleSetRackCoin = useCallback((rid: string, coinId: string) => {
    setGameState(prev => {
      const ri = prev.placedRacks.findIndex(r => r.id === rid);
      if (ri === -1) return prev;
      const coin = coinId ? miningCoins.find(c => c.id === coinId) : null;
      if (coinId && coin && !coin.isActive) return prev;
      const ur = [...prev.placedRacks];
      const selected = coinId && coin ? coinId : undefined;
      ur[ri] = { ...ur[ri], selectedCoinId: selected, isOn: selected ? ur[ri].isOn : false };
      return { ...prev, placedRacks: ur };
    });
    requestSave();
  }, [miningCoins, requestSave]);

  const handleSetRoomRacksCoin = useCallback(async (roomId: string, coinId: string) => {
    const roomNorm = normalizePlacedRackRoomId(roomId);
    const res = await postServerRoomRoomCoins(roomNorm, coinId);
    if (!res.ok) {
      setBulkBatteryNotice({ title: 'Moeda na sala', message: 'error' in res ? res.error : 'Erro desconhecido.' });
      return;
    }
    setGameState((prev) => ({ ...prev, placedRacks: res.placedRacks }));
  }, []);

  /** Equipa a mesma bateria (stock + armazém) em massa na sala — regras e persistência no servidor. */
  const handleSetRoomRacksBattery = useCallback(async (roomId: string, batteryUpgradeId: string, opts?: BulkRoomBatteryRunOptions) => {
    const roomNorm = normalizePlacedRackRoomId(roomId);
    const res = await postServerRoomBulkBatteries({
      roomId: roomNorm,
      batteryUpgradeId,
      smartFill: opts?.smartFill,
      rigSort: opts?.rigSort
    });
    if (!res.ok) {
      setBulkBatteryNotice({ title: 'Bateria da sala', message: 'error' in res ? res.error : 'Erro desconhecido.' });
      return;
    }
    const smart = !!res.smartFill;
    const partial = res.appliedRigs < res.compatibleRigs && (!!batteryUpgradeId || smart);
    if (partial) {
      setBulkBatteryNotice({
        title: smart ? 'Distribuição parcial' : 'Aplicação parcial',
        message: smart
          ? `Foram equipadas ${res.appliedRigs} de ${res.compatibleRigs} rigs. As restantes ficaram sem bateria por falta de unidades compatíveis no stock ou no armazém.`
          : `Foram equipadas ${res.appliedRigs} de ${res.compatibleRigs} rigs compatíveis com esta bateria. As outras ficaram sem alteração por falta de unidades (stock + armazém).`
      });
    }
    setGameState((prev) => ({
      ...prev,
      stock: res.stock,
      storedBatteries: res.storedBatteries,
      placedRacks: res.placedRacks
    }));
  }, []);

  const handleEquipWorkshop = useCallback((idx: number, mid: string) => {
    setGameState(p => {
      if ((p.stock[mid] || 0) < 1) return p;
      const ns = { ...p.stock };
      const nw = [...(p.workshopSlots || [null, null, null, null, null, null])];
      if (nw[idx] && nw[idx].itemId) return p;
      const structure: any = { id: `ws_${user?.email || 'anon'}_${idx}`, itemId: mid, internalSlots: {}, currentCharge: 0, installedAt: Date.now() };
      nw[idx] = structure;
      ns[mid]--;
      const newState = { ...p, stock: ns, workshopSlots: nw };
      return newState;
    });
    requestSave();
  }, [user, requestSave]);

  const handleUnequipWorkshop = useCallback((idx: number) => {
    // Generate logs BEFORE state update to avoid duplicates
    const currentState = gameStateRef.current;
    const currentItem = currentState.workshopSlots?.[idx];

    if (currentItem) {
      const def = gameUpgrades.find(u => u.id === currentItem.itemId);
      let allowed = true;
      if (def?.type === 'charger') {
        if ((currentItem.currentCharge ?? 0) > 0.000001) allowed = false;
        const installedAt = currentItem.installedAt || 0;
        if (installedAt > 0) {
          const instDate = new Date(installedAt);
          const midnight = new Date(instDate);
          midnight.setDate(midnight.getDate() + 1);
          midnight.setHours(0, 0, 0, 0);
          if (Date.now() < midnight.getTime()) allowed = false;
        }
      }

      if (allowed) {
        Object.entries(currentItem.internalSlots || {}).forEach(([slotId, val]) => {
          const vid = val as string | null;
          if (vid) {
            const originalItemId = currentItem.slotItemIds?.[slotId];
            if (originalItemId) {
              const upg = gameUpgrades.find(u => u.id === originalItemId);
              const isBattery = upg?.type === 'battery' || vid.length > 20;
              if (isBattery) {
                const charge = currentItem.slotCharges?.[slotId] ?? 0;
                const logData = {
                  action: 'removed_to_stock',
                  workshop_slot_index: idx,
                  component_slot_id: slotId,
                  battery_instance_id: vid,
                  battery_item_id: originalItemId,
                  charge_amount: charge,
                  stock_confirmed: true,
                  details: { batteryName: upg?.name || originalItemId, method: 'structure_removal' }
                };
                fetch('/api/charging-history/log', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(logData)
                }).catch(e => console.error('[Log] Failed:', e));
              }
            }
          }
        });
      }
    }

    setGameState(p => {
      const nw = [...(p.workshopSlots || [null, null, null, null, null, null])];
      const item = nw[idx];
      if (!item) return p;
      const def = gameUpgrades.find(u => u.id === item.itemId);
      if (def?.type === 'charger') {
        if ((item.currentCharge ?? 0) > 0.000001) return p;

        // 00:00 Restriction
        const installedAt = item.installedAt || 0;
        if (installedAt > 0) {
          const instDate = new Date(installedAt);
          const midnight = new Date(instDate);
          midnight.setDate(midnight.getDate() + 1);
          midnight.setHours(0, 0, 0, 0);

          if (Date.now() < midnight.getTime()) {
            alert('Este carregador só pode ser removido após as 00:00 do dia seguinte à instalação.');
            return p;
          }
        }
      }
      let ns = { ...p.stock };
      ns[item.itemId] = (ns[item.itemId] || 0) + 1;
      nw[idx] = null;
      let nb = [...p.storedBatteries];
      Object.entries(item.internalSlots || {}).forEach(([slotId, val]) => {
        const vid = val as string | null;
        if (vid) {
          const originalItemId = item.slotItemIds?.[slotId];
          if (!originalItemId) {
            console.error(`[App] Critical: Missing originalItemId for ${vid} in full removal. Skipping to prevent data corruption.`);
            return;
          }

          const upg = gameUpgrades.find(u => u.id === originalItemId);
          const isBattery = upg?.type === 'battery' || vid.length > 20;

          if (isBattery) {
            const charge = item.slotCharges?.[slotId] ?? 0;
            const capacity = upg?.powerCapacity || 100;
            const isFull = charge >= (capacity * 0.999);

            if (isFull) {
              ns[originalItemId] = (ns[originalItemId] || 0) + 1;
            } else {
              nb.push({ id: vid.length > 20 ? vid : crypto.randomUUID(), itemId: originalItemId, currentCharge: charge });
            }
          } else {
            ns[vid] = (ns[vid] || 0) + 1;
          }
        }
      });
      return { ...p, stock: ns, storedBatteries: nb, workshopSlots: nw };
    });
    requestSave();
  }, [gameUpgrades, requestSave]);

  const handleEquipWorkshopComponent = useCallback((wsIdx: number, slotId: string, iid: string, sbid?: string) => {
    // [LOGGING] Prepare log and ID outside state updater
    const currentState = gameStateRef.current;
    const nwGlobal = currentState.workshopSlots || [null, null, null, null, null, null];
    const sourceItemGlobal = nwGlobal[wsIdx];

    let preCalculatedId: string | null = null;
    let logPayload = null;

    if (sourceItemGlobal) {
      // --- [FIX] Log removal of old item if it's a battery being replaced ---
      const oldInstanceId = sourceItemGlobal.internalSlots[slotId];
      const oldItemId = sourceItemGlobal.slotItemIds?.[slotId];
      if (oldInstanceId && oldItemId) {
        const oldUpg = gameUpgrades.find(u => u.id === oldItemId);
        const oldIsBattery = oldUpg?.type === 'battery' || oldInstanceId.length > 20;
        if (oldIsBattery) {
          const oldCharge = sourceItemGlobal.slotCharges?.[slotId] ?? 0;
          fetch('/api/charging-history/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'removed_to_stock',
              workshop_slot_index: wsIdx,
              component_slot_id: slotId,
              battery_instance_id: oldInstanceId,
              battery_item_id: oldItemId,
              charge_amount: oldCharge,
              stock_confirmed: true, // It will be confirmed in this very handle call
              details: { batteryName: oldUpg?.name || oldItemId, note: 'replaced_during_equip' }
            })
          }).catch(e => console.error('[Log] Removal Failed:', e));
        }
      }
      // ----------------------------------------------------------------------

      const upgrade = gameUpgrades.find(u => u.id === sourceItemGlobal.itemId);
      const layoutSlot = upgrade?.layout?.slots.find(s => s.id === slotId);
      const isBattery = layoutSlot?.type === 'battery';

      if (isBattery) {
        let actualItemId = iid;
        let initCharge = 0;
        let valid = false;

        if (sbid) {
          const s = currentState.storedBatteries.find(b => b.id === sbid);
          if (s) {
            preCalculatedId = sbid;
            actualItemId = s.itemId;
            initCharge = s.currentCharge;
            valid = true;
          }
        } else {
          if ((currentState.stock[iid] || 0) >= 1) {
            preCalculatedId = crypto.randomUUID();
            actualItemId = iid;
            const batDef = gameUpgrades.find(u => u.id === iid);
            initCharge = batDef?.powerCapacity || 100;
            valid = true;
          }
        }

        if (valid && preCalculatedId) {
          logPayload = {
            action: 'inserted',
            workshop_slot_index: wsIdx,
            component_slot_id: slotId,
            battery_instance_id: preCalculatedId,
            battery_item_id: actualItemId,
            charge_amount: initCharge,
            stock_confirmed: false,
            details: { batteryName: gameUpgrades.find(u => u.id === actualItemId)?.name || actualItemId }
          };
        }
      }
    }

    if (logPayload) {
      fetch('/api/charging-history/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logPayload)
      }).catch(e => console.error('[Log] Insert Failed:', e));
    }

    setGameState(p => {
      const nw = [...(p.workshopSlots || [null, null, null, null, null, null])];
      const sourceItem = nw[wsIdx];
      if (!sourceItem) return p;

      // Create a shallow copy of the workshop structure to avoid direct mutation
      const item = { ...sourceItem };
      let ns = { ...p.stock };
      let nb = [...p.storedBatteries];

      // --- [FIX] Recover old item before overwriting ---
      const oldInstanceId = item.internalSlots[slotId];
      const oldItemId = item.slotItemIds?.[slotId];
      if (oldInstanceId && oldItemId) {
        const oldUpg = gameUpgrades.find(u => u.id === oldItemId);
        const oldIsBattery = oldUpg?.type === 'battery' || oldInstanceId.length > 20;
        if (oldIsBattery) {
          const oldCharge = item.slotCharges?.[slotId] ?? 0;
          const capacity = oldUpg?.powerCapacity || 100;
          const isFull = oldCharge >= (capacity * 0.999);
          if (isFull) {
            ns[oldItemId] = (ns[oldItemId] || 0) + 1;
          } else {
            nb.push({ id: oldInstanceId, itemId: oldItemId, currentCharge: oldCharge });
          }
        } else {
          ns[oldItemId] = (ns[oldItemId] || 0) + 1;
        }
      }
      // -----------------------------------------------

      let initCharge = 0;
      const upgrade = gameUpgrades.find(u => u.id === item.itemId);
      const layoutSlot = upgrade?.layout?.slots.find(s => s.id === slotId);
      const isBattery = layoutSlot?.type === 'battery';

      if (isBattery) {
        let actualItemId = iid;
        let finalInstanceId = sbid;

        if (sbid) {
          const s = nb.find(b => b.id === sbid);
          if (!s) return p;
          initCharge = s.currentCharge;
          actualItemId = s.itemId;
          finalInstanceId = sbid;
          nb = nb.filter(b => b.id !== sbid);
        }
        else {
          if ((ns[iid] || 0) < 1) return p;
          ns = { ...ns, [iid]: ns[iid] - 1 };
          const batDef = gameUpgrades.find(u => u.id === iid);
          initCharge = batDef?.powerCapacity || 100;
          actualItemId = iid;
          // Generate UUID for any battery coming from stock
          finalInstanceId = preCalculatedId || crypto.randomUUID();
        }

        item.internalSlots = { ...item.internalSlots, [slotId]: finalInstanceId! };
        item.slotCharges = { ...item.slotCharges, [slotId]: initCharge };
        item.slotItemIds = { ...(item.slotItemIds || {}), [slotId]: actualItemId };
      } else {
        if ((ns[iid] || 0) < 1) return p;
        ns = { ...ns, [iid]: ns[iid] - 1 };
        item.internalSlots = { ...item.internalSlots, [slotId]: iid };
        item.slotItemIds = { ...(item.slotItemIds || {}), [slotId]: iid };
      }

      nw[wsIdx] = item;
      return { ...p, stock: ns, storedBatteries: nb, workshopSlots: nw };
    });
    requestSave();
  }, [gameUpgrades, requestSave]);

  const handleUnequipWorkshopComponent = useCallback((wsIdx: number, slotId: string) => {
    const currentState = gameStateRef.current;
    const currentWS = currentState.workshopSlots?.[wsIdx];
    if (!currentWS) return;
    const valPreview = currentWS.internalSlots?.[slotId];
    if (!valPreview) return;
    const originalPreview = currentWS.slotItemIds?.[slotId];
    if (!originalPreview) {
      console.error(
        `[App] Oficina: falta referência da peça (slotItemIds) no slot ${slotId}. Recarrega (F5) para o servidor reparar o estado.`
      );
      return;
    }

    const chargePreview = currentWS.slotCharges?.[slotId] ?? 0;
    const upgPreview = gameUpgrades.find(u => u.id === originalPreview);
    const isBatteryPreview = upgPreview?.type === 'battery' || String(valPreview).length > 20;
    if (isBatteryPreview) {
      fetch('/api/charging-history/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'removed_to_stock',
          workshop_slot_index: wsIdx,
          component_slot_id: slotId,
          battery_instance_id: valPreview,
          battery_item_id: originalPreview,
          charge_amount: chargePreview,
          stock_confirmed: true,
          details: { batteryName: upgPreview?.name || originalPreview }
        })
      }).catch(e => console.error('[Log] Failed:', e));
    }

    setGameState(p => {
      const nw = [...(p.workshopSlots || [null, null, null, null, null, null])];
      const items = nw[wsIdx];
      if (!items) return p;
      const val = items.internalSlots[slotId];
      if (!val) return p;

      let ns = { ...p.stock };
      let nb = [...p.storedBatteries];
      const charge = items.slotCharges?.[slotId] ?? 0;
      const originalItemId = items.slotItemIds?.[slotId];

      if (!originalItemId) {
        return p;
      }

      const upg = gameUpgrades.find(u => u.id === originalItemId);
      const isBattery = upg?.type === 'battery' || val.length > 20;

      if (isBattery) {
        const capacity = upg?.powerCapacity || 100;
        const isFull = charge >= (capacity * 0.999);

        if (isFull) {
          // Rule: 100% charge batteries go back to stock (state of "new")
          ns = { ...ns, [originalItemId]: (ns[originalItemId] || 0) + 1 };
        } else {
          // Less than 100% stays as unique instance
          nb.push({ id: val.length > 20 ? val : crypto.randomUUID(), itemId: originalItemId, currentCharge: charge });
        }
      }
      else {
        ns = { ...ns, [originalItemId]: (ns[originalItemId] || 0) + 1 };
      }

      const newInternal = { ...items.internalSlots };
      delete newInternal[slotId];
      const newCharges = { ...(items.slotCharges || {}) };
      delete newCharges[slotId];
      const newItemIds = { ...(items.slotItemIds || {}) };
      delete newItemIds[slotId];

      nw[wsIdx] = { ...items, internalSlots: newInternal, slotCharges: newCharges, slotItemIds: newItemIds };
      return { ...p, stock: ns, storedBatteries: nb, workshopSlots: nw };
    });
    requestSave();
  }, [gameUpgrades, requestSave]);

  const handleWorkshopInstantRecharge = useCallback(async (wsIdx: number) => {
    if (!user?.email) return;
    try {
      const res = await performWorkshopInstantRecharge(user.email, wsIdx);
      if (res.ok && res.newCharge !== undefined) {
        setGameState(p => {
          const nw = [...(p.workshopSlots || [null, null, null, null, null, null])];
          const item = nw[wsIdx]; if (!item) return p;
          nw[wsIdx] = { ...item, currentCharge: res.newCharge || 0 };
          const nextDaily = { ...(p.dailyActions || {}), [`instant_recharge_slot_${wsIdx}`]: Date.now() };
          return { ...p, workshopSlots: nw, dailyActions: nextDaily };
        });
      } else {
        alert(res.error || "Erro ao recarregar carregador.");
      }
    } catch (err) {
      console.error("[Workshop] Instant recharge failed", err);
      alert("Erro de rede ao recarregar.");
    }
  }, [user, gameUpgrades, requestSave]);

  const launchApplixir = useCallback(async (wsIdx: number) => {
    if (!monetizationSettings?.applixirSiteId || !monetizationSettings?.applixirZoneId) {
      alert("Configuração da Applixir incompleta no painel admin.");
      return;
    }

    const adStatusCallback = async (status: string) => {
      console.log('[Applixir] Status do anúncio recebido:', status);
      if (status === "completed") {
        console.log('[Applixir] Vídeo concluído. Aplicando recompensa...');
        if (user?.email) {
          const res = await claimAdReward(user.email, wsIdx);
          if (res.ok && res.newCharge !== undefined) {
            setGameState(p => {
              const nw = [...(p.workshopSlots || [null, null, null, null, null, null])];
              const item = nw[wsIdx]; if (!item) return p;
              nw[wsIdx] = { ...item, currentCharge: res.newCharge || 0 };
              const nextDaily = { ...(p.dailyActions || {}), [`reward_ad_slot_${wsIdx}`]: Date.now() };
              return { ...p, workshopSlots: nw, dailyActions: nextDaily };
            });
            alert(res.rewardMsg || "Parabéns! Você ganhou energia.");
          } else {
            alert("Erro ao validar recompensa no servidor.");
          }
        }
      } else if (status === "no_ads") {
        alert("Não há anúncios disponíveis para Applixir no momento. Tente novamente ou use outro provedor.");
      }
    };

    (window as any).adStatusCallback = adStatusCallback;

    if (!document.getElementById('applixir-sdk')) {
      const script = document.createElement('script');
      script.id = 'applixir-sdk';
      script.src = "https://cdn.applixir.com/applixir.sdk3.0.js";
      script.async = true;
      document.body.appendChild(script);
    }

    const options = {
      zoneId: monetizationSettings.applixirZoneId,
      accountId: monetizationSettings.applixirAccountId || "8993",
      siteId: monetizationSettings.applixirSiteId,
      userId: user?.email || "0",
      adStatusCallback: "adStatusCallback",
      test: false,
      custom: wsIdx.toString()
    };

    const invoke = () => {
      if ((window as any).invokeApplixirVideoUnit) {
        (window as any).invokeApplixirVideoUnit(options);
      } else {
        alert("O módulo Applixir ainda está carregando ou foi bloqueado. Desative o AdBlock.");
      }
    };

    if ((window as any).invokeApplixirVideoUnit) invoke();
    else setTimeout(invoke, 1000);
  }, [monetizationSettings, user]);

  const launchEzoic = useCallback(async (wsIdx: number) => {
    if (!monetizationSettings?.ezoicPublisherId) {
      alert("Configuração da Ezoic incompleta no painel admin.");
      return;
    }

    // Lógica padrão de carregado de SDK da Ezoic
    if (!document.getElementById('ezoic-sdk')) {
      const script = document.createElement('script');
      script.id = 'ezoic-sdk';
      script.src = `//g.ezoic.net/ezoic/sa.min.js`;
      script.async = true;
      document.body.appendChild(script);
    }

    alert("Iniciando anúncio via Ezoic... (Aguardando resposta do SDK)");

    // Simulação do fluxo Ezoic (pode precisar de ajuste conforme placeholderId)
    const handleCompletion = async () => {
      if (user?.email) {
        const res = await claimAdReward(user.email, wsIdx);
        if (res.ok && res.newCharge !== undefined) {
          setGameState(p => {
            const nw = [...(p.workshopSlots || [null, null, null, null, null, null])];
            const item = nw[wsIdx]; if (!item) return p;
            nw[wsIdx] = { ...item, currentCharge: res.newCharge || 0 };
            const nextDaily = { ...(p.dailyActions || {}), [`reward_ad_slot_${wsIdx}`]: Date.now() };
            return { ...p, workshopSlots: nw, dailyActions: nextDaily };
          });
          alert(res.rewardMsg || "Energia Ezoic creditada com sucesso!");
        }
      }
    };

    // Chamada fictícia baseada em padrões de vídeo recompensado
    console.log('[Ezoic] Placeholder:', monetizationSettings.ezoicPlaceholderId);
    // setTimeout(handleCompletion, 5000); // Para teste, finge carregar

    // Nota: A integração real depende do ezstandalone.showRewardedAd(placeholderId)
    if ((window as any).ezstandalone) {
      (window as any).ezstandalone.showRewardedAd(monetizationSettings.ezoicPlaceholderId);
      // O SDK da Ezoic costuma disparar eventos globais ou callbacks configurados no dashboard
    } else {
      alert("SDK da Ezoic não detectado. Note que anúncios da Ezoic requerem domínio aprovado e scripts ativos.");
      // Fallback para teste manual se necessário
    }
  }, [monetizationSettings, user]);

  const handleRewardedAd = useCallback((wsIdx: number) => {
    if (!monetizationSettings) return;

    const active = [];
    if (monetizationSettings.applixirEnabled) active.push('applixir');
    if (monetizationSettings.ezoicEnabled) active.push('ezoic');

    if (active.length === 0) {
      alert("Nenhum provedor de recompensas em vídeo está ativo no momento.");
      return;
    }

    if (active.length === 1) {
      if (active[0] === 'applixir') launchApplixir(wsIdx);
      else launchEzoic(wsIdx);
      return;
    }

    setAdSelection({ wsIdx });
  }, [monetizationSettings, launchApplixir, launchEzoic]);

  const handleReset = () => { if (user && window.confirm("ATENÇÃO: Isso apagará seu save permanentemente.")) { const st = INITIAL_STATE; setGameState(st); requestSave(); } }

  const handleWithdrawCoin = useCallback(async (coinId: string, amt: number) => {
    const s = web3SettingsState;
    const coin = miningCoins.find(c => c.id === coinId);
    const matching = s?.withdrawTokens?.find(t => {
      const isNameMatch = t.name === (coin?.name || '');
      const isNative = ['POL', 'POLYGON', 'BNB', 'ETH', 'WETH'].includes(t.name?.toUpperCase() || '');
      const hasValidContract = /^0x[a-fA-F0-9]{40}$/.test(t.contract || '');
      return isNameMatch && (isNative || hasValidContract);
    });
    if (!user?.polygonWallet || !matching || !coin) {
      alert("Configuração de saque incompleta ou carteira não vinculada.");
      return;
    }

    let minW = matching?.minAmount ?? 0;
    if (matching?.minWithdrawalUsdc && coin.priceUSD > 0) {
      minW = matching.minWithdrawalUsdc / coin.priceUSD;
    }

    const cur = (gameState.coinBalances || {})[coinId] || 0;

    if (amt <= 0 || amt < minW) {
      alert(`Valor mínimo para saque: ${minW.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${coin.symbol}`);
      return;
    }
    if (amt > cur) {
      alert("Saldo insuficiente.");
      return;
    }

    const fee = matching.feePercent ? (amt * (matching.feePercent / 100)) : 0;
    const net = amt - fee;
    const msg = fee > 0
      ? `Confirmar solicitação de saque de ${amt} ${coin.symbol} para ${user.polygonWallet}?\n- Taxa (${matching.feePercent}%): ${fee.toFixed(8)} ${coin.symbol}\n- Valor Líquido: ${net.toFixed(8)} ${coin.symbol}`
      : `Confirmar solicitação de saque de ${amt} ${coin.symbol} para a carteira ${user.polygonWallet}?`;

    if (!confirm(msg)) return;

    const res = await requestWithdrawal(coinId, amt, user.polygonWallet);

    if (res.ok) {
      setGameState(prev => {
        const next = { ...(prev.coinBalances || {}) };
        next[coinId] = (next[coinId] || 0) - amt;
        return { ...prev, coinBalances: next };
      });
      alert(res.message || "Solicitação de saque enviada com sucesso!");
      requestSave();
    } else {
      alert(res.error || "Erro ao solicitar saque.");
    }
  }, [web3SettingsState, miningCoins, user, gameState.coinBalances, requestSave]);


  const handleDailyBoost = useCallback(async (wsIdx: number) => {
    if (!user?.email) return;
    const res = await performDailyBoost(user.email, wsIdx);
    if (res.ok && res.newCharge !== undefined) {
      setGameState(p => {
        const nw = [...(p.workshopSlots || [null, null, null, null, null, null])];
        const item = nw[wsIdx]; if (!item) return p;
        nw[wsIdx] = { ...item, currentCharge: res.newCharge || 0 };
        const nextDaily = { ...(p.dailyActions || {}), [`daily_boost_slot_${wsIdx}`]: Date.now() };
        return { ...p, workshopSlots: nw, dailyActions: nextDaily };
      });
      alert(`Boost diário aplicado! Sua estação foi 100% carregada.`);
    } else {
      alert(res.error || "Falha ao aplicar boost.");
    }
  }, [user]);

  // --- LOOT BOX LOGIC ---
  const handleBuyBox = async (boxId: string) => {
    if (!user?.email) return;
    const box = lootBoxDefs.find(b => b.id === boxId);
    if (!box) return;

    if (!Number.isFinite(box.price) || box.price <= 0) {
      setLuckyBoxNotice({
        variant: 'error',
        title: 'Caixas da Sorte',
        message: 'Esta caixa não está à venda (preço inválido). Contacta o suporte.'
      });
      return;
    }

    // Optimistic check
    if (gameState.usdc < box.price) {
      const short = Math.max(0, box.price - gameState.usdc);
      setLuckyBoxNotice({
        variant: 'error',
        title: 'Caixas da Sorte',
        message: appendUsdcShortfallLine('Saldo USDC insuficiente na reserva.', short)
      });
      return;
    }

    const saldoApos = gameState.usdc - box.price;
    const ok = window.confirm(
      `Confirmar compra da caixa «${box.name}»?\n\n` +
        `Preço: USDC ${Number(box.price).toFixed(2)}\n` +
        `Saldo após: USDC ${saldoApos.toFixed(2)}\n\n` +
        `O valor será debitado no servidor.`
    );
    if (!ok) return;

    // Call API
    const res = await buyLootBox(user.email, boxId);

    if (res.ok) {
      await handleReloadGameState();
      setLuckyBoxNotice({
        variant: 'success',
        title: 'Caixas da Sorte',
        message: 'Caixa comprada com sucesso! O inventário de caixas foi actualizado.'
      });
    } else {
      setLuckyBoxNotice({
        variant: 'error',
        title: 'Caixas da Sorte',
        message: appendUsdcShortfallLine(res.error || 'Erro ao comprar a caixa.', res.missing)
      });
    }
  };

  const handleOpenBox = async (boxId: string) => {
    if (!user?.email) return null;
    // Não exigir definição no catálogo ativo: inventário pode ter caixas retiradas da loja.

    // Call API
    const res = await openLootBox(user.email, boxId);

    if (res.ok && res.rewards) {
      // Update local state to reflect changes (Server is authority, but we update UI optimistically/reactively)
      // Actually, to be safe and consistent with server, we should probably fetch the latest game state.
      // But for better UX, we can apply the changes locally based on rewards returned.

      setGameState(prev => {
        const newBoxes = { ...prev.unopenedBoxes };
        if (newBoxes[boxId] > 0) newBoxes[boxId]--;
        if (newBoxes[boxId] <= 0) delete newBoxes[boxId];

        const newStock = { ...prev.stock };
        const newCoinBalances = { ...(prev.coinBalances || {}) };

        // Apply rewards to local state
        res.rewards.forEach((r: any) => {
          if (r.type === 'item') {
            newStock[r.id] = (newStock[r.id] || 0) + r.qty;
          } else if (r.type === 'coin') {
            newCoinBalances[r.id] = (newCoinBalances[r.id] || 0) + r.qty;
          }
          // Currency updates are handled below in 'next' object construction if simple logic,
          // but here we need to sum them up first if we want to add to prev.
        });

        const earnedUsdc = res.rewards.filter((r: any) => r.type === 'currency' && r.id === 'usdc').reduce((a: number, b: any) => a + b.qty, 0);

        return {
          ...prev,
          unopenedBoxes: newBoxes,
          stock: newStock,
          coinBalances: newCoinBalances,
          usdc: prev.usdc + earnedUsdc,
        };
      });
      return { rewards: res.rewards };
    } else {
      setLuckyBoxNotice({
        variant: 'error',
        title: 'Caixas da Sorte',
        message: res.error || 'Erro ao abrir a caixa.'
      });
      return null;
    }
  };

  const handleDiscardLootBox = async (boxId: string) => {
    if (!user?.email) return { ok: false as const, error: 'Sessão inválida' };
    const res = await discardLootBox(user.email, boxId);
    if (res.ok && res.discardedQty != null) {
      setGameState((prev) => {
        const nb = { ...prev.unopenedBoxes };
        const remaining = typeof res.remainingQty === 'number' ? res.remainingQty : 0;
        if (remaining <= 0) delete nb[boxId];
        else nb[boxId] = remaining;
        return { ...prev, unopenedBoxes: nb };
      });
      return { ok: true as const };
    }
    return { ok: false as const, error: res.error || 'Erro ao descartar.' };
  };

  // Refresh loot boxes after code redemption (as it may create new box types)
  const handleRedeemSuccess = useCallback(async (newBoxes?: Record<string, number>) => {
    const lb = await getLootBoxes();
    setLootBoxDefs(lb);
    handleReloadGameState(newBoxes);
  }, [handleReloadGameState]);

  // Formatters
  const formatAmount = (val: number) => {
    if (val === 0) return "0";
    if (val < 1) return val.toFixed(12);
    if (val < 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 2 }).format(val);
  };
  const formatMoney = (val: number) => val < 0.01 && val > 0 ? val.toFixed(3) : val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const formatHash = (val: number) => val === 0 ? "0 H/s" : (val < 0.0001 ? val.toFixed(8) + " H/s" : Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 2 }).format(val) + " H/s");

  return (
    <div className="h-screen min-h-0 w-full min-w-0 max-w-full flex flex-col bg-slate-50 dark:bg-[#0f0c08] text-slate-800 dark:text-slate-200 font-sans selection:bg-amber-500/30 overflow-hidden transition-colors duration-300">
      <a
        href="#main-content"
        className="fixed left-4 top-0 z-[9999] -translate-y-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-stone-950 shadow-lg outline-none ring-2 ring-amber-200 transition focus:translate-y-4 focus:ring-offset-2 focus:ring-offset-[#0f0c08]"
      >
        Saltar para o conteúdo principal
      </a>
      {/* GLOBAL NAVIGATION HEADER */}
      <header className="bg-white/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-amber-900/30 shrink-0 backdrop-blur-md z-50 shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto min-w-0 w-full px-4 py-2 md:py-2.5 flex flex-col md:flex-row justify-between items-center gap-2 md:gap-3">
          {/* Logo */}
          <div
            className="flex items-center gap-3 cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label="Ir para início — Genesis Miner"
            onClick={() => setGlobalView(user ? (user.isAdmin ? 'admin' : 'game') : 'home')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setGlobalView(user ? (user.isAdmin ? 'admin' : 'game') : 'home');
              }
            }}
          >
            <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 ring-2 ring-amber-500/50 shadow-lg shadow-amber-600/25 bg-slate-900">
              <img src="/img/favicon/genesis-miner-logo.png" alt="" className="w-full h-full object-cover" width={40} height={40} fetchPriority="high" aria-hidden />
            </div>
            <div>
              <p className="text-xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-400 bg-clip-text text-transparent">Genesis Miner</p>
              <span className="text-[10px] font-semibold tracking-wider bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-400 bg-clip-text text-transparent">Ecossistema online V0.5 — Genesis DAO</span>
            </div>
          </div>

          {/* In-Game Stats */}
          {user && globalView === 'game' && (
            <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800/50 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700/50 text-xs md:text-sm shadow-inner">
              <div className="flex flex-col items-end px-3 border-r border-slate-300 dark:border-slate-700">
                <span className="text-[10px] text-amber-600 dark:text-amber-500 uppercase tracking-wider flex gap-1 items-center"><Coins size={10} /> Tokens <button onClick={() => setCoinsExpanded(e => !e)} className="ml-1 p-0.5 rounded text-slate-500 hover:text-slate-800 dark:hover:text-white">{coinsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button></span>
                <div className="flex flex-col gap-0.5 items-end">
                  {miningCoins.length === 0 ? (
                    <span className="font-mono text-slate-500">—</span>
                  ) : (
                    (() => {
                      // Calcular poder para todas as moedas e ordenar
                      const coinsWithPower = miningCoins.map((c) => {
                        const wsP = livePlayerGameWs?.hashByCoinId?.[c.id];
                        if (wsP != null && Number.isFinite(wsP)) {
                          return { ...c, power: wsP };
                        }
                        let base = 0;
                        gameState.placedRacks.forEach(r => {
                          const batt = gameUpgrades.find(u => u.id === r.batteryId);
                          const isInf = batt && batt.powerCapacity == -1;
                          if (!r.isOn || !r.wiringId || !r.batteryId || (!isInf && r.currentCharge <= 0 && r.currentCharge !== undefined)) return;
                          if (r.selectedCoinId === c.id) {
                            let rbase = 0;
                            r.slots.forEach(sid => { const up = gameUpgrades.find(u => u.id === sid); if (up) rbase += up.baseProduction; });
                            let mult = 1;
                            r.multiplierSlots?.forEach(sid => { const mod = gameUpgrades.find(u => u.id === sid); if (mod && mod.multiplier) mult += mod.multiplier; });
                            base += rbase * mult;
                          }
                        });
                        return { ...c, power: base };
                      }).sort((a, b) => {
                        // Sort by Power DESC, then by Name ASC
                        if (b.power !== a.power) return b.power - a.power;
                        return String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, {
                          sensitivity: 'base',
                        });
                      });

                      if (coinsExpanded) {
                        return coinsWithPower.map(c => {
                          const total = (gameState.coinBalances || {})[c.id] || 0;
                          const isActive = highlightedCoinId === c.id;
                          return (
                            <button key={c.id} onClick={() => setHighlightedCoinId(c.id)} className={`flex items-center gap-2 ${isActive ? 'text-amber-600 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>
                              <span className="font-mono font-bold">{c.name}: {formatAmount(total)} • H/s {formatAmount(c.power)}</span>
                            </button>
                          );
                        });
                      } else {
                        // Show highlighted if set, OR the first one (which is now the one with most power)
                        const c = highlightedCoinId ? coinsWithPower.find(x => x.id === highlightedCoinId) || coinsWithPower[0] : coinsWithPower[0];
                        if (!c) return <span className="font-mono text-slate-500">—</span>;
                        const total = (gameState.coinBalances || {})[c.id] || 0;
                        return <span className="font-mono font-bold text-amber-700 dark:text-amber-300">{c.name}: {formatAmount(total)}</span>;
                      }
                    })()
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end px-3 border-r border-slate-300 dark:border-slate-700">
                <span className="text-[10px] text-green-600 dark:text-green-500 uppercase tracking-wider flex gap-1"><DollarSign size={10} /> USDC</span>
                <span className="font-mono font-bold text-green-600 dark:text-green-400">${formatMoney(gameState.usdc)}</span>
              </div>
              <div className="flex flex-col items-end px-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider flex gap-1"><TrendingUp size={10} /> Hash Total</span>
                <span className="font-mono text-slate-700 dark:text-slate-200">{formatHash(livePlayerGameWs ? livePlayerGameWs.totalHash : productionRate)}</span>
              </div>
            </div>
          )}

          {/* Navigation Links */}
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors mr-2">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button onClick={() => setMobileMenuOpen(v => !v)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors md:hidden">{mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}</button>
            {user && (
              <div className="flex md:hidden items-center gap-3">
                {globalView === 'game' && (
                  <button onClick={() => setCurrentView('profile')} className={`p-2 rounded-lg transition-colors ${currentView === 'profile' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`} title="Meu Perfil"><UserIcon size={16} /></button>
                )}
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 uppercase">{user.isAdmin ? 'ADMINISTRATOR' : 'Operador'}</div>
                  <div className={`text-xs font-bold ${user.isAdmin ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>{user.username}</div>
                </div>
                <button onClick={handleLogout} className="bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 p-2 rounded border border-red-200 dark:border-red-900/50 transition" title="Logout"><LogOut size={16} /></button>
              </div>
            )}
            <div className="hidden md:flex items-center gap-2">
              <button onClick={() => setGlobalView('home')} className={`px-3 py-2 text-sm font-bold rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition ${globalView === 'home' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`} title="Início (landing)"><Home size={18} /></button>
              <a href="https://t.me/+Fm72joLwb-tjYTZh" target="_blank" rel="noopener noreferrer" className="px-3 py-2 text-sm font-bold rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-[#229ED9] transition" title="Telegram — Genesis Miner"><TelegramIcon size={18} /></a>
              <button onClick={() => { if (!user) setGlobalView('auth'); else { setGlobalView('game'); setCurrentView('ranking'); } }} className="px-3 py-2 text-sm font-bold rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-yellow-500 transition" title="Ranking de mineradores"><Trophy size={18} /></button>
              <button onClick={() => setGlobalView('docs')} className={`px-3 py-2 text-sm font-bold rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition ${globalView === 'docs' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`} title="Documentação"><BookOpen size={18} /></button>
              {user && (globalView === 'home' || globalView === 'docs') && !user.isAdmin && (
                <div className="flex gap-2">
                  <button onClick={() => { setGlobalView('game'); setCurrentView('servers'); }} className="px-3 py-2 text-sm font-bold rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition text-amber-600 dark:text-amber-400" title="Voltar ao Jogo"><Play size={18} fill="currentColor" /></button>
                </div>
              )}

              {!user ? (
                <button onClick={() => setGlobalView('auth')} className="bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-stone-950 px-4 py-2 rounded font-bold text-sm shadow-lg shadow-amber-600/30 border border-amber-300/40 transition flex items-center gap-2"><UserIcon size={16} /> LOGIN</button>
              ) : (
                <div className="flex items-center gap-4">
                  {globalView === 'game' && (
                    <button onClick={() => setCurrentView('profile')} className={`p-2 rounded-lg transition-colors ${currentView === 'profile' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`} title="Meu Perfil"><UserIcon size={18} /></button>
                  )}
                  <div className="text-right">
                    <div className="text-xs text-slate-500 uppercase">{user.isAdmin ? 'ADMINISTRATOR' : 'Operador'}</div>
                    <div className={`text-sm font-bold ${user.isAdmin ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>{user.username}</div>
                  </div>

                  {(user.isAdmin || user.isImpersonating) && globalView !== 'admin' && (
                    <button onClick={async () => {
                      if (user.isImpersonating) {
                        await stopImpersonate();
                        window.location.reload();
                      } else {
                        setGlobalView('admin');
                      }
                    }} className="text-red-500 hover:text-red-400 font-bold text-sm">
                      {user.isImpersonating ? 'ADMIN' : 'ADMIN'}
                    </button>
                  )}
                  <button onClick={handleLogout} className="bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 p-2 rounded border border-red-200 dark:border-red-900/50 transition" title="Logout"><LogOut size={18} /></button>
                </div>
              )}
            </div>
          </div>
          {mobileMenuOpen && (
            <div className="w-full md:hidden">
              <div className="w-full grid grid-cols-1 gap-2">
                <button onClick={() => { setGlobalView('home'); setMobileMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${globalView === 'home' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Home size={16} /> Início</button>
                <a href="https://t.me/+Fm72joLwb-tjYTZh" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border border-slate-200 dark:border-slate-700 text-[#229ED9] hover:bg-slate-100 dark:hover:bg-slate-800 transition"><TelegramIcon size={16} /> Telegram</a>
                <button onClick={() => { setMobileMenuOpen(false); if (!user) setGlobalView('auth'); else { setGlobalView('game'); setCurrentView('ranking'); } }} className="flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border border-slate-200 dark:border-slate-700 text-yellow-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"><Trophy size={16} /> Ranking</button>
                <button onClick={() => { setGlobalView('docs'); setMobileMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${globalView === 'docs' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><BookOpen size={16} /> Docs</button>
                {user && (globalView === 'home' || globalView === 'docs') && !user.isAdmin && (
                  <>
                    <button onClick={() => { setGlobalView('game'); setCurrentView('servers'); setMobileMenuOpen(false); }} className="flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border border-amber-500 text-amber-600 dark:text-amber-400"><Play size={16} fill="currentColor" /> Jogar</button>
                  </>
                )}

                {!user ? (
                  <button onClick={() => { setGlobalView('auth'); setMobileMenuOpen(false); }} className="flex items-center gap-2 px-3 py-2 text-sm font-bold rounded bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-stone-950 border border-amber-300/40 shadow-md"><UserIcon size={16} /> Login</button>
                ) : (
                  <>

                    {user.isAdmin && globalView !== 'admin' && (<button onClick={() => { setGlobalView('admin'); setMobileMenuOpen(false); }} className="flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border border-slate-200 dark:border-slate-700 text-red-500"><Shield size={16} /> Painel Admin</button>)}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* CONTENT AREA — um único <main> (evita landmark aninhado no jogo) */}
      <main id="main-content" className="flex-1 min-h-0 min-w-0 overflow-hidden relative flex flex-col">
        {globalView === 'home' && <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col"><div className="flex-1 min-w-0"><HomePage onNavigate={setGlobalView} /></div><Footer /></div>}
        {globalView === 'docs' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <DocsPage />
              </Suspense>
            </div>
            <Footer />
          </div>
        )}
        {globalView === 'auth' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50 dark:bg-slate-950 flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <AuthPage onLogin={handleLogin} accessLevels={accessLevels} />
              </Suspense>
            </div>
            <Footer />
          </div>
        )}

        {globalView === 'admin' && user?.isAdmin && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <AdminPanel
                  user={user}
                  onUpdateGameUpgrades={updateGameUpgrades} gameUpgrades={gameUpgrades}
                  onUpdateAccessLevels={updateAccessLevels} accessLevels={accessLevels}
                  onUpdateLootBoxes={updateLootBoxes} lootBoxes={lootBoxDefs}
                />
              </Suspense>
            </div>
            <Footer />
          </div>
        )}

        {globalView === 'game' && user && (
          <>
            {/* GAME NAVIGATION */}
            <nav className="min-w-0 w-full bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 shrink-0 transition-colors duration-300">
              <div className="max-w-7xl mx-auto md:hidden px-4 py-2 flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Menu</div>
                <button onClick={() => setGameMenuOpen(v => !v)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">{gameMenuOpen ? <X size={18} /> : <Menu size={18} />}</button>
              </div>
              {gameMenuOpen && (
                <div className="max-w-7xl mx-auto md:hidden px-4 pb-3 grid grid-cols-1 gap-2">
                  {getAllowedPages().includes('servers') && (<button onClick={() => { setCurrentView('servers'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'servers' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Server size={16} /> {gameNav('servers')}</button>)}
                  {getAllowedPages().includes('inventory') && (<button onClick={() => { setCurrentView('inventory'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'inventory' ? 'border-yellow-500 text-yellow-600 dark:text-yellow-500' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Package size={16} /> {gameNav('inventory')}</button>)}
                  {getAllowedPages().includes('oficina') && (<button onClick={() => { setCurrentView('oficina'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'oficina' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Wrench size={16} /> {gameNav('oficina')}</button>)}
                  {getAllowedPages().includes('hardware_store') && (<button onClick={() => { setCurrentView('hardware_store'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'hardware_store' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><ShoppingCart size={16} /> {gameNav('hardware_store')}</button>)}
                  {getAllowedPages().includes('black_market') && (<button onClick={() => { setCurrentView('black_market'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'black_market' ? 'border-red-500 text-red-600 dark:text-red-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Skull size={16} /> {gameNav('black_market')}</button>)}
                  {getAllowedPages().includes('arcade') && (<button onClick={() => { setCurrentView('arcade'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'arcade' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Gamepad2 size={16} /> {gameNav('arcade')}</button>)}
                  {getAllowedPages().includes('lucky_store') && (<button onClick={() => { setCurrentView('lucky_store'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'lucky_store' ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Gift size={16} /> {gameNav('lucky_store')}</button>)}
                  {getAllowedPages().includes('lucky_store') && (<button onClick={() => { setCurrentView('roleta'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'roleta' ? 'border-rose-500 text-rose-600 dark:text-rose-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Sparkles size={16} /> {gameNav('roleta')}</button>)}
                  {getAllowedPages().includes('wallet') && (<button onClick={() => { setCurrentView('wallet'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'wallet' ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Wallet size={16} /> {gameNav('wallet')}</button>)}
                  {getAllowedPages().includes('ranking') && (<button onClick={() => { setCurrentView('ranking'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'ranking' ? 'border-yellow-500 text-yellow-600 dark:text-yellow-500' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Trophy size={16} /> {gameNav('ranking')}</button>)}
                  {getAllowedPages().includes('upgrade') && (<button onClick={() => { setCurrentView('upgrade'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'upgrade' ? 'border-yellow-500 text-yellow-600 dark:text-yellow-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Crown size={16} /> {gameNav('upgrade')}</button>)}
                  {getAllowedPages().includes('transparency') && (<button onClick={() => { setCurrentView('transparency'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'transparency' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Scale size={16} /> {gameNav('transparency')}</button>)}
                  {getAllowedPages().includes('support') && (<button onClick={() => { setCurrentView('support'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'support' ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><LifeBuoy size={16} /> {gameNav('support')}</button>)}
                  {getAllowedPages().includes('partners') && (<button onClick={() => { setCurrentView('partners'); setGameMenuOpen(false); }} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded border ${currentView === 'partners' ? 'border-violet-500 text-violet-600 dark:text-violet-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}><Clapperboard size={16} /> {gameNav('partners')}</button>)}
                </div>
              )}
              <div className="max-w-7xl mx-auto hidden md:flex w-full max-w-full min-w-0 flex-wrap justify-center gap-x-0 gap-y-0.5 px-2 sm:px-3 py-1">
                {getAllowedPages().includes('servers') && (<button onClick={() => { setCurrentView('servers'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'servers' ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Server size={15} className="shrink-0" /> {gameNav('servers')}</button>)}
                {getAllowedPages().includes('inventory') && (<button onClick={() => { setCurrentView('inventory'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'inventory' ? 'border-yellow-600 text-yellow-600 dark:text-yellow-500 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Package size={15} className="shrink-0" /> {gameNav('inventory')}</button>)}
                {getAllowedPages().includes('oficina') && (<button onClick={() => { setCurrentView('oficina'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'oficina' ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Wrench size={15} className="shrink-0" /> {gameNav('oficina')}</button>)}
                {getAllowedPages().includes('hardware_store') && (<button onClick={() => { setCurrentView('hardware_store'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold tracking-wide normal-case border-b-2 transition-all duration-300 shrink-0 ${currentView === 'hardware_store' ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><ShoppingCart size={15} className="shrink-0" /> {gameNav('hardware_store')}</button>)}
                {getAllowedPages().includes('black_market') && (<button onClick={() => { setCurrentView('black_market'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'black_market' ? 'border-red-500 text-red-600 dark:text-red-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Skull size={15} className="shrink-0" /> {gameNav('black_market')}</button>)}
                {getAllowedPages().includes('arcade') && (<button onClick={() => { setCurrentView('arcade'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'arcade' ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Gamepad2 size={15} className="shrink-0" /> {gameNav('arcade')}</button>)}
                {getAllowedPages().includes('lucky_store') && (<button onClick={() => { setCurrentView('lucky_store'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'lucky_store' ? 'border-orange-500 text-orange-600 dark:text-orange-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Gift size={15} className="shrink-0" /> {gameNav('lucky_store')}</button>)}
                {getAllowedPages().includes('lucky_store') && (<button onClick={() => { setCurrentView('roleta'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'roleta' ? 'border-rose-500 text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Sparkles size={15} className="shrink-0" /> {gameNav('roleta')}</button>)}
                {getAllowedPages().includes('wallet') && (<button onClick={() => { setCurrentView('wallet'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'wallet' ? 'border-orange-500 text-orange-600 dark:text-orange-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Wallet size={15} className="shrink-0" /> {gameNav('wallet')}</button>)}
                {getAllowedPages().includes('ranking') && (<button onClick={() => { setCurrentView('ranking'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'ranking' ? 'border-yellow-600 text-yellow-600 dark:text-yellow-500 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Trophy size={15} className="shrink-0" /> {gameNav('ranking')}</button>)}
                {getAllowedPages().includes('upgrade') && (<button onClick={() => { setCurrentView('upgrade'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'upgrade' ? 'border-yellow-500 text-yellow-600 dark:text-yellow-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Crown size={15} className="shrink-0" /> {gameNav('upgrade')}</button>)}
                {getAllowedPages().includes('transparency') && (<button onClick={() => { setCurrentView('transparency'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'transparency' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Scale size={15} className="shrink-0" /> {gameNav('transparency')}</button>)}
                {getAllowedPages().includes('support') && (<button onClick={() => { setCurrentView('support'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'support' ? 'border-sky-500 text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><LifeBuoy size={15} className="shrink-0" /> {gameNav('support')}</button>)}
                {getAllowedPages().includes('partners') && (<button onClick={() => { setCurrentView('partners'); }} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs font-bold normal-case tracking-wide border-b-2 transition-all duration-300 shrink-0 ${currentView === 'partners' ? 'border-violet-500 text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}><Clapperboard size={15} className="shrink-0" /> {gameNav('partners')}</button>)}
              </div>
            </nav>

            {/* GAME CONTENT WRAPPER WITH SIDEBARS */}
            <div className="flex-1 min-w-0 flex justify-center overflow-hidden relative w-full h-full">

              {/* Left Skyscraper (Dynamic) */}
              <aside className="hidden 2xl:flex shrink-0 w-[145.6px] h-[546px] sticky top-24 mx-4 overflow-hidden rounded-xl border border-amber-500/20 bg-slate-900/40 backdrop-blur-sm self-start mt-4 transition-all duration-500 hover:border-amber-500/40 shadow-2xl shadow-amber-500/5">
                {verticalAds[0] ? (
                  <a href={verticalAds[0].link || '#'} target={verticalAds[0].link ? "_blank" : "_self"} rel="noopener noreferrer" className="w-full h-full block">
                    {verticalAds[0].imageUrl ? (
                      <RemoteBannerImage
                        src={verticalAds[0].imageUrl}
                        alt={verticalAds[0].text}
                        className="w-full h-full object-contain"
                        failureHint="Lateral — URL falhou"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-4 text-center bg-slate-950/50">
                        <span className="text-xs text-amber-400 font-bold uppercase">{verticalAds[0].text}</span>
                      </div>
                    )}
                  </a>
                ) : (
                  <RemoteBannerImage
                    src="/brain/c5bf420e-fa44-42f3-b118-ac4247fdd4b0/skyscrapers_ad_160x600_left_1768840833778.png"
                    alt="Lateral Esquerda"
                    className="w-full h-full object-contain"
                    failureHint="Sem imagem"
                  />
                )}
              </aside>

              <div className="flex-1 min-w-0 overflow-hidden relative max-w-7xl w-full flex flex-col min-h-0">
                <div className="shrink-0 z-20"><MarketNews /></div>
                <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar relative min-h-0 flex flex-col font-mono">
                  {!saveLoaded && gameStateLoadError && (
                    <div className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-4 bg-slate-900/80 text-slate-200 font-mono rounded-xl border border-red-900/30 px-6 py-8 text-center">
                      <p className="text-sm text-red-300 max-w-md">{gameStateLoadError}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setGameStateLoadError(null);
                          setGameStateReloadNonce((n) => n + 1);
                        }}
                        className="rounded-lg border border-amber-500/60 bg-amber-600/20 px-4 py-2 text-sm font-bold text-amber-200 hover:bg-amber-600/30 transition"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  )}
                  {!saveLoaded && !gameStateLoadError && (
                    <div className="flex min-h-[40vh] w-full items-center justify-center bg-slate-900/80 text-amber-500 font-mono rounded-xl border border-amber-900/20">
                      <div className="text-xl animate-pulse tracking-widest">Carregando estado…</div>
                    </div>
                  )}

                  {saveLoaded && currentView === 'servers' && (
                    <div className="flex-1 p-6 space-y-6 animate-in fade-in zoom-in-95 duration-300 flex flex-col">
                      <div className="flex-1 flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <ServerRoom {...gameState} onPlaceRack={handlePlaceRack} onRemoveRack={handleRemoveRack} onEquipMiner={handleEquipMiner} onUnequipMiner={handleUnequipMiner} onEquipAux={handleEquipAux} onUnequipAux={handleUnequipAux} onTogglePower={handleTogglePower} onRecharge={handleRecharge} upgrades={gameUpgrades} miningCoins={miningCoins} onSetRackCoin={handleSetRackCoin} onSetRoomRacksCoin={handleSetRoomRacksCoin} onSetRoomRacksBattery={handleSetRoomRacksBattery} userEmail={user?.email} onRoomPurchase={() => handleReloadGameState()} onOpenCalculator={isOperatorAdminOnly ? undefined : () => setCurrentView('calculator')} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}

                  {saveLoaded && currentView === 'calculator' && !isOperatorAdminOnly && (
                    <div className="flex-1 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300">
                      <Suspense fallback={<LazyRouteFallback />}>
                        <PlayerCalculator gameState={gameState} upgrades={gameUpgrades} miningCoins={miningCoins} onBack={() => setCurrentView('servers')} userEmail={user?.email} isAdmin={user?.isAdmin} />
                      </Suspense>
                    </div>
                  )}


                  {saveLoaded && currentView === 'oficina' && (
                    <div className="flex-1 p-6 space-y-6 animate-in fade-in zoom-in-95 duration-300 flex flex-col">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <WorkshopRoom slots={gameState.workshopSlots || [null, null, null, null, null, null]} stock={gameState.stock} upgrades={gameUpgrades} onEquip={handleEquipWorkshop} onUnequip={handleUnequipWorkshop} onEquipComponent={handleEquipWorkshopComponent} onUnequipComponent={handleUnequipWorkshopComponent} storedBatteries={gameState.storedBatteries} onInstantRecharge={handleWorkshopInstantRecharge} onRewardedAd={handleRewardedAd} onDailyBoost={handleDailyBoost} timeOffset={timeOffset} dailyActions={gameState.dailyActions} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'arcade' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500 py-20">
                      <Gamepad2 size={48} className="animate-bounce" />
                      <h2 className="text-2xl font-bold uppercase tracking-widest bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">Arcade em preparação</h2>
                      <p className="max-w-md text-center text-sm">Estamos montando uma zona arcade dentro do Genesis Miner. Volte em breve para novidades.</p>
                    </div>
                  )}
                  {saveLoaded && currentView === 'inventory' && (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1 p-6">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <InventoryView stock={gameState.stock} storedBatteries={gameState.storedBatteries} upgrades={gameUpgrades} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'hardware_store' && (
                    <div className="flex-1 flex flex-col p-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <UpgradeShop gameState={gameState} user={user} onBatchBuy={handleBatchBuy} upgrades={gameUpgrades} onSuggestDeposit={handleSuggestDeposit} isEnabled={economySettings.hardwareMarketEnabled} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'lucky_store' && (
                    <div className="flex-1 flex flex-col p-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <LuckyBoxStore
                            gameState={gameState}
                            lootBoxes={lootBoxDefs}
                            upgrades={gameUpgrades}
                            onBuyBox={handleBuyBox}
                            onOpenBox={handleOpenBox}
                            onDiscardBox={handleDiscardLootBox}
                            onRedeemSuccess={handleRedeemSuccess}
                            onOpenRoleta={openRoletaWithCode}
                          />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'roleta' && getAllowedPages().includes('lucky_store') && (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden custom-scrollbar animate-in fade-in slide-in-from-right-4 duration-300">
                      <Suspense fallback={<LazyRouteFallback />}>
                        <RoletaPage
                          upgrades={gameUpgrades}
                          onRedeemSuccess={handleRedeemSuccess}
                          bootstrap={roletaBootstrap}
                          onBootstrapConsumed={clearRoletaBootstrap}
                          usdcBalance={gameState.usdc}
                          onReloadGameState={handleReloadGameState}
                        />
                      </Suspense>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'black_market' && (
                    <div className="flex-1 flex flex-col p-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-h-0" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
                        <Suspense fallback={<LazyRouteFallback />}>
                          <BlackMarket gameState={gameState} onBuyListing={handleP2PBuy} onCreateListing={handleCreateListing} onCancelListing={handleCancelListing} upgrades={gameUpgrades} currentUserName={user?.username} currentUserEmail={user?.email} isEnabled={economySettings.blackMarketEnabled} onClaimSuccess={handleReloadGameState} refreshTrigger={marketRefreshTrigger} priceBandPercent={economySettings.blackMarketPriceBandPercent ?? 20} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'wallet' && (
                    <div className="flex-1 flex flex-col p-6 space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                            <Exchange coinBalances={gameState.coinBalances || {}} miningCoins={miningCoins.map(c => ({ id: c.id, name: c.name, usdcRate: c.usdcRate, showInExchange: c.showInExchange }))} onSellCoin={handleSellCoin} />
                            <WalletActions onAddUSDC={handleAddUSDC} onStartDeposit={handleStartDeposit} depositStatus={depositFlow.status} depositAmount={depositFlow.amount} depositFailureMessage={depositFlow.failureReason} onCloseDepositStatus={() => setDepositFlow({ pending: false })} onSyncQueuedDeposit={depositFlow.status === 'queued' && depositFlow.txHash && user?.email ? async () => { const net = depositFlow.network || 'polygon'; const out = await verifyDepositWithServer(depositFlow.txHash!, net); if (out.ok) setDepositFlow((f) => ({ ...f, status: 'success' })); else if (out.pending) alert('Ainda à espera de confirmação na rede.'); else alert(out.error || 'Não foi possível sincronizar.'); } : undefined} userEmail={user?.email || null} onVerifyDepositByHash={user?.email ? async (txHash, network) => verifyDepositWithServer(txHash.trim(), network) : undefined} hasWallet={!!user?.polygonWallet} coinBalances={gameState.coinBalances || {}} miningCoins={miningCoins.map(c => ({ id: c.id, name: c.name, symbol: c.symbol, priceUSD: c.priceUSD || 0 }))} coinRates={(() => { const rates: Record<string, number> = {}; gameState.placedRacks.forEach(r => { if (!r.isOn || !r.wiringId || !r.batteryId || !r.selectedCoinId) return; let base = 0; r.slots.forEach(sid => { if (!sid) return; const up = gameUpgrades.find(u => u.id === sid); if (up) base += up.baseProduction; }); let mult = 1; r.multiplierSlots?.forEach(sid => { if (!sid) return; const mod = gameUpgrades.find(u => u.id === sid); if (mod && mod.multiplier) mult += mod.multiplier; }); const prod = base * mult; const coin = miningCoins.find(c => c.id === r.selectedCoinId); const yieldPerHash = coin ? (coin.minProportion || 0) : 0; const rate = prod * yieldPerHash; rates[r.selectedCoinId] = (rates[r.selectedCoinId] || 0) + rate; }); return rates; })()} onWithdrawCoin={handleWithdrawCoin} prefillAmount={depositPrefill} withdrawTokens={web3SettingsState?.withdrawTokens?.map(t => ({ name: t.name, contract: t.contract, minAmount: t.minAmount, minWithdrawalUsdc: t.minWithdrawalUsdc, feePercent: t.feePercent }))} minDepositUsdc={web3SettingsState?.minDepositUsdc} depositPolygonDisabled={web3SettingsState?.depositPolygonDisabled} depositBnbDisabled={web3SettingsState?.depositBnbDisabled} depositBaseDisabled={web3SettingsState?.depositBaseDisabled} />
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-lg flex flex-col justify-between md:col-span-2 lg:col-span-2 xl:col-span-2 transition-colors">
                              <div>
                                <h3 className="text-slate-700 dark:text-slate-300 font-bold flex items-center gap-2 mb-4 border-b border-slate-200 dark:border-slate-800 pb-2"><LayoutDashboard size={18} /> ESTATÍSTICAS</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                  <div className="flex flex-col bg-slate-50 dark:bg-slate-950 p-4 rounded border border-slate-200 dark:border-slate-800"><span className="text-slate-500 text-sm">Máquinas Ativas</span><span className="font-mono text-slate-700 dark:text-slate-200">{countActiveMachines(gameState.placedRacks)} Unidades</span></div>
                                  <div className="flex flex-col bg-slate-50 dark:bg-slate-950 p-4 rounded border border-slate-200 dark:border-slate-800"><span className="text-slate-500 text-sm">Rigs Instalados</span><span className="font-mono text-slate-700 dark:text-slate-200">{gameState.placedRacks.length} Unidades</span></div>
                                </div>
                              </div>
                              <div className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-800" />
                            </div>
                          </div>
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}

                  {saveLoaded && currentView === 'upgrade' && (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <UpgradeAccount user={user} accessLevels={accessLevels} onUpgrade={handleUpgradeAccess} usdcBalance={gameState.usdc} onSuggestDeposit={handleSuggestDeposit} onPassPurchased={handlePassPurchased} onReloadGameState={handleReloadGameState} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'ranking' && (
                    <div className="flex-1 flex flex-col p-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <AdminRanking isPublic={true} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'transparency' && getAllowedPages().includes('transparency') && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <TransparencyPage />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'support' && getAllowedPages().includes('support') && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <SupportPage userEmail={user?.email} onClose={() => setCurrentView('servers')} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'partners' && getAllowedPages().includes('partners') && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <PartnersPage />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'profile' && user && (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <ProfilePage user={user} onUpdateProfile={handleUpdateUser} onUpdateGameState={(next) => setGameState(next)} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                </div>
              </div>

              {/* Right Skyscraper (Dynamic) */}
              <aside className="hidden 2xl:flex shrink-0 w-[145.6px] h-[546px] sticky top-24 mx-4 overflow-hidden rounded-xl border border-orange-500/20 bg-slate-900/40 backdrop-blur-sm self-start mt-4 transition-all duration-500 hover:border-orange-500/40 shadow-2xl shadow-orange-500/5">
                {verticalAds[1] || verticalAds[0] ? (
                  <a href={(verticalAds[1] || verticalAds[0]).link || '#'} target={(verticalAds[1] || verticalAds[0]).link ? "_blank" : "_self"} rel="noopener noreferrer" className="w-full h-full block">
                    {(verticalAds[1] || verticalAds[0]).imageUrl ? (
                      <RemoteBannerImage
                        src={(verticalAds[1] || verticalAds[0]).imageUrl!}
                        alt={(verticalAds[1] || verticalAds[0]).text}
                        className="w-full h-full object-contain"
                        failureHint="Lateral — URL falhou"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-4 text-center bg-slate-950/50">
                        <span className="text-xs text-orange-400 font-bold uppercase">{(verticalAds[1] || verticalAds[0]).text}</span>
                      </div>
                    )}
                  </a>
                ) : (
                  <RemoteBannerImage
                    src="/brain/c5bf420e-fa44-42f3-b118-ac4247fdd4b0/skyscrapers_ad_160x600_right_1768840857057.png"
                    alt="Lateral Direita"
                    className="w-full h-full object-contain"
                    failureHint="Sem imagem"
                  />
                )}
              </aside>

            </div>
          </>
        )}
        {adSelection !== null && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl p-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4">
                <button onClick={() => setAdSelection(null)} className="text-slate-500 hover:text-white transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="text-center mb-8">
                <div className="bg-green-600/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-green-600/30">
                  <Play className="text-green-500" fill="currentColor" size={28} />
                </div>
                <h2 className="text-xl font-bold text-white tracking-widest uppercase">Escolha o Provedor</h2>
                <p className="text-xs text-slate-400 mt-2">Assista um anúncio para carregar seu dispositivo</p>
              </div>

              <div className="space-y-4">
                {monetizationSettings?.applixirEnabled && (
                  <button
                    onClick={() => { launchApplixir(adSelection.wsIdx); setAdSelection(null); }}
                    className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-green-600/50 p-6 rounded-2xl flex items-center justify-between transition-all group active:scale-[0.98]"
                  >
                    <div className="text-left">
                      <div className="text-white font-bold text-sm tracking-widest">APPLIXIR</div>
                      <div className="text-[10px] text-slate-500 group-hover:text-green-500">Global Rewarded Ads</div>
                    </div>
                    <Play size={18} className="text-slate-600 group-hover:text-green-500" />
                  </button>
                )}

                {monetizationSettings?.ezoicEnabled && (
                  <button
                    onClick={() => { launchEzoic(adSelection.wsIdx); setAdSelection(null); }}
                    className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-amber-600/50 p-6 rounded-2xl flex items-center justify-between transition-all group active:scale-[0.98]"
                  >
                    <div className="text-left">
                      <div className="text-white font-bold text-sm tracking-widest uppercase">Ezoic Ads</div>
                      <div className="text-[10px] text-slate-500 group-hover:text-amber-500">Premium Video Network</div>
                    </div>
                    <Play size={18} className="text-slate-600 group-hover:text-amber-500" />
                  </button>
                )}
              </div>

              <p className="text-center text-[9px] text-slate-600 mt-8 uppercase tracking-widest">A energia será creditada após a conclusão</p>
            </div>
          </div>
        )}
        {showRewardModal && (
          <Suspense fallback={<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80"><RefreshCw className="animate-spin text-amber-400" size={32} /></div>}>
            <RewardLoadingScreen
              rewards={pendingRewardSummary}
              onComplete={handleRewardComplete}
              isReturningUser={!(user as any).isNewRegistration}
              offlineEarnings={offlineStats}
              coinNames={Object.fromEntries(miningCoins.map(c => [c.id, c.name]))}
            />
          </Suspense>
        )}

        <UiNoticeModal
          notice={hardwareShopNotice}
          onClose={() => setHardwareShopNotice(null)}
          overlayZClassName="z-[140]"
        />
        <UiNoticeModal
          notice={luckyBoxNotice}
          onClose={() => setLuckyBoxNotice(null)}
          overlayZClassName="z-[140]"
        />

        {bulkBatteryNotice && (
          <div
            className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/60 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-battery-notice-title"
          >
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-200 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex gap-3 border-b border-amber-500/35 bg-amber-50 p-4 dark:border-amber-600/30 dark:bg-amber-950/25">
                <Battery className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={22} aria-hidden />
                <div className="min-w-0">
                  <h3 id="bulk-battery-notice-title" className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">
                    {bulkBatteryNotice.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{bulkBatteryNotice.message}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setBulkBatteryNotice(null)}
                  className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-bold uppercase tracking-wide text-white shadow-md shadow-amber-600/20 transition hover:bg-amber-500 active:scale-[0.98]"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}


      </main>
    </div>
  );
}
