
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GameState, MarketListing, Upgrade, P2PMarketTradeHistoryEntry } from '../types';
import { Skull, DollarSign, PlusCircle, Package, Tag, Trash2, ArrowRight, Lock, ShieldCheck, History, Search } from 'lucide-react';

const P2P_TYPE_OPTIONS: { value: '' | Upgrade['type']; label: string }[] = [
  { value: '', label: 'Todos os tipos' },
  { value: 'machine', label: 'GPUs / máquinas' },
  { value: 'infrastructure', label: 'Racks / gabinete' },
  { value: 'battery', label: 'Baterias' },
  { value: 'wiring', label: 'Fiação' },
  { value: 'multiplier', label: 'Multiplicadores' },
  { value: 'charger', label: 'Carregadores' }
];
import { getMarketListings, reserveMarketListing, cancelMarketReservation, buyMarketListing, claimMarketFunds, getCustodyListings, claimCustodyItem, getMarketTradeHistory } from '../services/api';

/** Preço USDC digitado (ex.: "0,1" em PT). `parseFloat("0,1")` dá 0 — evitar isso. */
function parseUsdcInput(raw: string): number {
  const t = String(raw ?? '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

/** Cofre P2P: API pode enviar buyerPaidUsdc antes de types.ts global ter o campo. */
type CustodyListingRow = MarketListing & { buyerPaidUsdc?: number };

/** Total USDC do lote (preço unit. × qty). Compatível com respostas sem `lineTotal`. */
function p2pLineTotal(l: Pick<MarketListing, 'price' | 'qty' | 'lineTotal'>): number {
  if (l.lineTotal != null && Number.isFinite(l.lineTotal) && l.lineTotal >= 0) return l.lineTotal;
  const q = Math.max(1, Number(l.qty) || 1);
  const u = Number(l.price);
  return (Number.isFinite(u) ? u : 0) * q;
}

interface BlackMarketProps {
  gameState: GameState;
  onBuyListing: (listing: MarketListing) => void;
  onCreateListing?: (itemId: string, price: number, qty: number) => void;
  onCancelListing?: (listingId: string) => void;
  upgrades: Upgrade[];
  currentUserName?: string;
  currentUserEmail?: string;
  isEnabled?: boolean;
  onClaimSuccess?: () => void;
  refreshTrigger?: number;
  /** Desvio máximo permitido vs preço de referência (última oferta ativa ou preço base). Ex.: 30 → entre 70% e 130% da referência. */
  priceBandPercent?: number;
}

export const BlackMarket: React.FC<BlackMarketProps> = ({ gameState, onBuyListing, onCreateListing, onCancelListing, upgrades, currentUserName, currentUserEmail, isEnabled = true, onClaimSuccess, refreshTrigger = 0, priceBandPercent: priceBandProp = 20 }) => {
  const band = Math.min(90, Math.max(1, Number(priceBandProp) || 20));
  const minFactor = 1 - band / 100;
  const maxFactor = 1 + band / 100;
  if (!upgrades || upgrades.length === 0) return <div className="p-8 text-center text-slate-500 animate-pulse">Sincronizando ofertas P2P…</div>;



  const [mode, setMode] = useState<'buy' | 'sell' | 'vault' | 'history'>('buy');
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const [marketListings, setMarketListings] = useState<MarketListing[]>([]);
  const [custodyListings, setCustodyListings] = useState<CustodyListingRow[]>([]);
  const [historyPurchases, setHistoryPurchases] = useState<P2PMarketTradeHistoryEntry[]>([]);
  const [historySales, setHistorySales] = useState<P2PMarketTradeHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTab, setHistoryTab] = useState<'purchases' | 'sales'>('purchases');
  const [historyReloadNonce, setHistoryReloadNonce] = useState(0);
  const [confirmListing, setConfirmListing] = useState<MarketListing | null>(null);
  const [buyQtyDraft, setBuyQtyDraft] = useState('1');
  const [buySearch, setBuySearch] = useState('');
  const [buyCategory, setBuyCategory] = useState('');
  const [buyType, setBuyType] = useState<'' | Upgrade['type']>('');
  /** Ordenação do book na vista Comprar: preço unitário USDC. */
  const [buyPriceSort, setBuyPriceSort] = useState<'asc' | 'desc'>('asc');
  const [sellFilterSearch, setSellFilterSearch] = useState('');
  const [sellFilterCategory, setSellFilterCategory] = useState('');
  const [sellFilterType, setSellFilterType] = useState<'' | Upgrade['type']>('');

  /** Começar em 1 unidade: antes o rascunho ia para o lote inteiro e muitos confirmavam sem alterar → compravam tudo. */
  useEffect(() => {
    if (confirmListing) {
      setBuyQtyDraft('1');
    }
  }, [confirmListing]);

  // Selling Form State
  // Selling Form State
  const [sellItemId, setSellItemId] = useState<string>(upgrades?.[0]?.id || '');
  const [sellPrice, setSellPrice] = useState<string>('');
  const [sellQty, setSellQty] = useState<string>('1');

  const getOwnedCount = (upgradeId: string) => {
    let count = gameState.stock[upgradeId] || 0;
    const up = upgrades.find(u => u.id === upgradeId);
    if (!up) return count;
    if (up.type === 'infrastructure') {
      count += gameState.placedRacks.filter(r => r.itemId === upgradeId).length;
    } else {
      gameState.placedRacks.forEach(r => {
        r.slots.forEach(s => { if (s === upgradeId) count++; });
        if (
          r.batteryId &&
          (r.batteryId === upgradeId ||
            gameState.storedBatteries?.some((sb) => sb.id === r.batteryId && sb.itemId === upgradeId))
        )
          count++;
        if (r.wiringId === upgradeId) count++;
        r.multiplierSlots?.forEach(s => { if (s === upgradeId) count++; });
      });
    }
    return count;
  };

  const getMarketPrice = (upgradeId: string) => {
    const def = upgrades.find(u => u.id === upgradeId);
    if (!def) return 0;
    return def.baseCost;
  };

  /** Âncora do ±band%: preço da Lojinha Miner (baseCost); sem preço de loja (>0), usa a menor oferta ativa no book. */
  const getBandReferencePrice = (upgradeId: string) => {
    const base = getMarketPrice(upgradeId);
    if (base > 0) return base;
    const prices = marketListings
      .filter((l) => l.itemId === upgradeId && (!l.status || l.status === 'active'))
      .map((l) => Number(l.price))
      .filter((p) => Number.isFinite(p) && p > 0);
    const minAsk = prices.length > 0 ? Math.min(...prices) : null;
    return minAsk ?? 0;
  };

  useEffect(() => {
    const suggest = getBandReferencePrice(sellItemId);
    setSellPrice(suggest > 0 ? String(suggest) : '');
  }, [sellItemId, upgrades, marketListings]);

  useEffect(() => {
    (async () => {
      const list = await getMarketListings();
      setMarketListings(list);
      if (mode === 'vault') {
        const custody = await getCustodyListings();
        setCustodyListings(custody as CustodyListingRow[]);
      }
      if (mode === 'history') {
        setHistoryLoading(true);
        try {
          const h = await getMarketTradeHistory();
          setHistoryPurchases(h.purchases);
          setHistorySales(h.sales);
        } finally {
          setHistoryLoading(false);
        }
      }
    })();
  }, [mode, refreshTrigger, historyReloadNonce]);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/market`;
    let ws: WebSocket | null = null;
    let stopped = false;
    let debounceTimer: number | null = null;

    const scheduleGameSync = () => {
      if (!onClaimSuccess) return;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void onClaimSuccess();
      }, 450);
    };

    let listingsRefreshTimer: number | null = null;
    const refresh = async () => {
      const list = await getMarketListings();
      setMarketListings(list);
      if (modeRef.current === 'vault') {
        const custody = await getCustodyListings();
        setCustodyListings(custody as CustodyListingRow[]);
      }
    };

    /** Evita N pedidos /api/market/listings em rajada (vários eventos WS → 502 na origem). */
    const scheduleListingsRefresh = () => {
      if (listingsRefreshTimer !== null) window.clearTimeout(listingsRefreshTimer);
      listingsRefreshTimer = window.setTimeout(() => {
        listingsRefreshTimer = null;
        void refresh();
      }, 400);
    };

    const handleWsMessage = (ev: MessageEvent) => {
      let payload: { type?: string; event?: string } = {};
      try {
        payload = JSON.parse(String(ev.data)) as typeof payload;
      } catch {
        return;
      }
      if (payload.type !== 'market') return;
      scheduleListingsRefresh();
      if (payload.event && payload.event !== 'hello') {
        scheduleGameSync();
      }
    };

    const open = () => {
      if (stopped) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        void refresh();
      };
      ws.onmessage = handleWsMessage;
      ws.onclose = () => {
        if (!stopped) window.setTimeout(open, 2500);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    };
    open();

    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      if (listingsRefreshTimer !== null) window.clearTimeout(listingsRefreshTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [onClaimSuccess]);

  const handleSellSubmit = () => {
    console.log('[BlackMarket] handleSellSubmit called with:', { sellItemId, sellPrice, sellQty });
    if (!onCreateListing) {
      console.warn('[BlackMarket] onCreateListing is undefined');
      return;
    }
    const price = parseUsdcInput(sellPrice);
    const qty = parseInt(sellQty);

    if (price > 0 && qty > 0) {
      console.log('[BlackMarket] Calling onCreateListing');
      onCreateListing(sellItemId, price, qty);
      setSellPrice('');
      setSellQty('1');
    } else {
      console.warn('[BlackMarket] Invalid price or qty', { price, qty });
    }
  };

  const formatCost = (val: number) => {
    if (val < 0.0001) return val.toFixed(8);
    if (val < 1) return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
    return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  const sellableItems = useMemo(
    () => upgrades.filter((u) => (gameState.stock[u.id] || 0) > 0 && u.sellInBlackMarket !== false),
    [upgrades, gameState.stock]
  );

  const sellableFiltered = useMemo(() => {
    return sellableItems.filter((u) => {
      if (sellFilterCategory && u.category !== sellFilterCategory) return false;
      if (sellFilterType && u.type !== sellFilterType) return false;
      if (sellFilterSearch.trim()) {
        const q = sellFilterSearch.toLowerCase().trim();
        if (!`${u.name} ${u.id} ${u.category}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [sellableItems, sellFilterCategory, sellFilterType, sellFilterSearch]);

  useEffect(() => {
    if (sellableFiltered.length > 0) {
      if (!sellableFiltered.some((u) => u.id === sellItemId)) {
        setSellItemId(sellableFiltered[0].id);
      }
    } else if (sellItemId !== '') {
      setSellItemId('');
    }
  }, [sellableFiltered, sellItemId]);

  const buyCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of marketListings) {
      const u = upgrades.find((x) => x.id === l.itemId);
      if (u?.category) set.add(u.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt'));
  }, [marketListings, upgrades]);

  const sellCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of sellableItems) {
      if (u.category) set.add(u.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt'));
  }, [sellableItems]);

  const buyListingsFromOthers = useMemo(() => {
    return marketListings.filter((listing) => {
      const item = upgrades.find((u) => u.id === listing.itemId);
      if (!item || item.sellInBlackMarket === false) return false;
      const isOwn = listing.sellerName === currentUserName || listing.sellerName === currentUserEmail;
      return !isOwn;
    });
  }, [marketListings, upgrades, currentUserName, currentUserEmail]);

  const filteredBuyListings = useMemo(() => {
    return buyListingsFromOthers.filter((listing) => {
      const item = upgrades.find((u) => u.id === listing.itemId);
      if (!item) return false;
      if (buyCategory && item.category !== buyCategory) return false;
      if (buyType && item.type !== buyType) return false;
      if (buySearch.trim()) {
        const q = buySearch.toLowerCase().trim();
        const hay = `${item.name} ${item.id} ${item.category} ${listing.sellerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [buyListingsFromOthers, upgrades, buySearch, buyCategory, buyType]);

  const sortedBuyListings = useMemo(() => {
    const arr = [...filteredBuyListings];
    arr.sort((a, b) => {
      const pa = Number(a.price);
      const pb = Number(b.price);
      const ua = Number.isFinite(pa) ? pa : 0;
      const ub = Number.isFinite(pb) ? pb : 0;
      const d = ua - ub;
      return buyPriceSort === 'asc' ? d : -d;
    });
    return arr;
  }, [filteredBuyListings, buyPriceSort]);

  const selectedSellItem = upgrades.find(u => u.id === sellItemId);
  const marketPrice = selectedSellItem ? getMarketPrice(selectedSellItem.id) : 0;
  const refPrice = getBandReferencePrice(sellItemId);
  const minAllowed = refPrice * minFactor;
  const maxAllowed = refPrice * maxFactor;
  const parsedSellPrice = parseUsdcInput(sellPrice);
  const parsedSellQty = parseInt(sellQty);
  const publishDisabled = (!sellableItems.length || !sellItemId || !sellPrice || !sellQty || isNaN(parsedSellPrice) || parsedSellPrice <= 0 || isNaN(parsedSellQty) || parsedSellQty <= 0 || parsedSellPrice < minAllowed || parsedSellPrice > maxAllowed);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col shadow-2xl relative transition-colors">
      {/* Background Texture */}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] opacity-50 pointer-events-none"></div>

      {/* Header */}
      <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center relative z-10">
        <div>
          <h2 className="text-xl font-bold text-red-500 flex items-center gap-2 animate-pulse">
            <Skull size={20} /> Mercado paralelo (P2P)
          </h2>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest">Liquidez entre operadores • Itens em custódia até o fechamento</p>
        </div>

        <div className="flex gap-2 items-center">
          {(gameState.blackMarketBalance || 0) > 0 && (
            <div className="mr-2 flex items-center gap-2 bg-yellow-900/50 px-3 py-1 rounded border border-yellow-700 animate-in fade-in zoom-in">
              <span className="text-[10px] text-yellow-500 uppercase font-bold">Proventos:</span>
              <span className="text-sm font-mono font-bold text-yellow-400">${formatCost(gameState.blackMarketBalance || 0)}</span>
              <div className="text-[10px] text-yellow-600">(liquidar no cofre)</div>
            </div>
          )}

          <button
            onClick={() => setMode('buy')}
            className={`px-4 py-2 rounded font-bold text-xs transition-colors border ${mode === 'buy' ? 'bg-red-900/50 border-red-500 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            COMPRAR
          </button>
          <button
            onClick={() => setMode('sell')}
            className={`px-4 py-2 rounded font-bold text-xs transition-colors border ${mode === 'sell' ? 'bg-red-900/50 border-red-500 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            VENDER
          </button>

          <button
            onClick={() => setMode('vault')}
            className={`px-4 py-2 rounded font-bold text-xs transition-colors border ${mode === 'vault' ? 'bg-red-900/50 border-red-500 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            COFRE
          </button>
          <button
            onClick={() => setMode('history')}
            className={`px-3 py-2 rounded font-bold text-xs transition-colors border flex items-center gap-1.5 ${mode === 'history' ? 'bg-red-900/50 border-red-500 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}
            title="Histórico de negócios P2P"
          >
            <History size={14} /> HISTÓRICO
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div className="p-4 custom-scrollbar relative z-10 bg-slate-900/80 max-h-[min(70vh,520px)] overflow-y-auto">

        {/* HISTORY */}
        {mode === 'history' && (
          <div className="space-y-3">
            <div className="flex gap-2 border-b border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setHistoryTab('purchases')}
                className={`px-3 py-1.5 rounded text-xs font-bold border transition-colors ${historyTab === 'purchases' ? 'bg-slate-800 border-red-600 text-red-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
              >
                Minhas compras
              </button>
              <button
                type="button"
                onClick={() => setHistoryTab('sales')}
                className={`px-3 py-1.5 rounded text-xs font-bold border transition-colors ${historyTab === 'sales' ? 'bg-slate-800 border-red-600 text-red-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
              >
                Minhas vendas
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              {historyTab === 'purchases'
                ? 'Itens que compraste a outros jogadores: vendedor, quantidade e total em USDC que pagaste.'
                : 'Itens que vendeste: comprador, quantidade e líquido creditado no cofre P2P (após taxa do mercado).'}
            </p>
            {historyLoading ? (
              <div className="py-12 text-center text-slate-500 text-sm animate-pulse">A carregar histórico…</div>
            ) : (
              (() => {
                const rows = historyTab === 'purchases' ? historyPurchases : historySales;
                if (rows.length === 0) {
                  return (
                    <div className="text-center py-10 text-slate-500 border border-dashed border-slate-800 rounded-lg text-sm">
                      Sem registos nesta secção.
                    </div>
                  );
                }
                return (
                  <div className="rounded-lg border border-slate-800 overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="bg-slate-950/80 text-slate-500 uppercase tracking-wider border-b border-slate-800">
                          <th className="p-2 font-bold">Data</th>
                          <th className="p-2 font-bold">{historyTab === 'purchases' ? 'De' : 'Para'}</th>
                          <th className="p-2 font-bold">Item</th>
                          <th className="p-2 font-bold text-right">Qtd</th>
                          <th className="p-2 font-bold text-right">{historyTab === 'purchases' ? 'Paguei' : 'Recebi'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => {
                          const def = upgrades.find((u) => u.id === row.itemId);
                          const label = def?.name || row.itemId;
                          const when =
                            row.at > 0
                              ? new Date(row.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                              : '—';
                          const mainAmount =
                            historyTab === 'purchases' ? row.buyerPaidUsdc : row.sellerReceivedUsdc;
                          return (
                            <tr key={`${row.at}-${row.itemId}-${idx}`} className="border-b border-slate-800/80 hover:bg-slate-800/30">
                              <td className="p-2 text-slate-400 whitespace-nowrap font-mono">{when}</td>
                              <td className="p-2 text-slate-300 max-w-[120px] truncate" title={row.counterpartName}>
                                {row.counterpartName}
                              </td>
                              <td className="p-2 text-slate-200 max-w-[140px] truncate" title={label}>
                                {label}
                              </td>
                              <td className="p-2 text-right font-mono text-amber-400/90">{row.qty}</td>
                              <td className="p-2 text-right font-mono text-green-400">${formatCost(mainAmount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {historyTab === 'sales' && (
                      <p className="text-[9px] text-slate-600 p-2 bg-slate-950/50 border-t border-slate-800">
                        O valor “Recebi” é o líquido no cofre P2P. O comprador pagou o total bruto (inclui taxa à plataforma quando aplicável).
                      </p>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* BUY MODE */}
        {mode === 'buy' && (
          <div className="space-y-3">
            {marketListings.length === 0 ? (
              <div className="text-center py-8 text-slate-400 border border-dashed border-slate-800 rounded-lg">
                Nenhuma oferta aberta neste instante.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[160px] flex-1">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                      <input
                        type="search"
                        value={buySearch}
                        onChange={(e) => setBuySearch(e.target.value)}
                        placeholder="Buscar nome, ID, vendedor…"
                        className="w-full rounded border border-slate-700 bg-slate-900 py-2 pl-8 pr-2 text-xs text-slate-200 outline-none focus:border-red-600"
                      />
                    </div>
                    <select
                      value={buyCategory}
                      onChange={(e) => setBuyCategory(e.target.value)}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 outline-none focus:border-red-600"
                      title="Categoria (catálogo)"
                    >
                      <option value="">Todas as categorias</option>
                      {buyCategoryOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <select
                      value={buyType}
                      onChange={(e) => setBuyType((e.target.value || '') as '' | Upgrade['type'])}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 outline-none focus:border-red-600"
                      title="Tipo de peça"
                    >
                      {P2P_TYPE_OPTIONS.map((o) => (
                        <option key={o.label} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={buyPriceSort}
                      onChange={(e) => setBuyPriceSort(e.target.value as 'asc' | 'desc')}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 outline-none focus:border-red-600"
                      title="Ordenar por preço unitário (USDC)"
                    >
                      <option value="asc">Preço: menor → maior</option>
                      <option value="desc">Preço: maior → menor</option>
                    </select>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {filteredBuyListings.length} de {buyListingsFromOthers.length} ofertas (filtro aplicado; as tuas não
                    aparecem na compra).
                  </p>
                </div>
                {filteredBuyListings.length === 0 ? (
                  <div className="text-center py-8 text-amber-200/80 border border-dashed border-amber-900/40 rounded-lg text-sm">
                    Nenhuma oferta coincide com os filtros. Limpa a pesquisa ou muda categoria/tipo.
                  </div>
                ) : (
              <div className="space-y-2">
                {sortedBuyListings.map(listing => {
                  const item = upgrades.find(u => u.id === listing.itemId);
                  if (!item) return null;
                  if (item.sellInBlackMarket === false) return null;
                  const isOwn = listing.sellerName === currentUserName || listing.sellerName === currentUserEmail;
                  if (isOwn) return null; // Hide own listings from buy view

                  const lineTotal = p2pLineTotal(listing);
                  const unitPrice = Number(listing.price);
                  const canAffordFull = gameState.usdc >= lineTotal;
                  const canAffordAny =
                    Number.isFinite(unitPrice) && unitPrice > 0 && gameState.usdc >= unitPrice;
                  const isReservedForOther = listing.reservedBy && listing.reservedBy !== currentUserName && listing.reservedBy !== currentUserEmail;
                  const hasImage = item.image;
                  return (
                    <div key={listing.id} className="bg-slate-800/50 border border-slate-700 hover:border-slate-500 rounded-lg p-3 flex justify-between items-center group transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-2xl text-slate-400 overflow-hidden">
                          {hasImage ? <img src={hasImage} className="w-full h-full object-cover" /> : item.icon}
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-200 text-sm group-hover:text-red-400 transition-colors">
                            {item.name}
                            {(listing.qty && listing.qty > 1) && (
                              <span className="ml-2 text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded border border-red-800">
                                x{listing.qty}
                              </span>
                            )}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-500">Vendedor: {listing.sellerName}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`font-mono font-bold text-sm ${
                            canAffordFull ? 'text-green-400' : canAffordAny ? 'text-amber-400' : 'text-red-500'
                          }`}
                          title={canAffordFull ? 'Pode comprar o lote inteiro' : canAffordAny ? 'Pode comprar só parte do lote' : 'USDC insuficiente'}
                        >
                          ${formatCost(lineTotal)}
                        </div>
                        {(listing.qty && listing.qty > 1) && (
                          <div className="text-[10px] font-mono text-slate-500">${formatCost(listing.price)}/un.</div>
                        )}
                        <button
                          onClick={async () => {
                            const r = await reserveMarketListing(listing.id);
                            if (r && r.ok) { setConfirmListing(listing); const list = await getMarketListings(); setMarketListings(list); }
                          }}
                          disabled={!canAffordAny || isOwn || isReservedForOther || !isEnabled}
                          className={`
                                            mt-1 px-4 py-1.5 rounded text-xs font-bold flex items-center gap-1 ml-auto transition-colors
                                            ${(!canAffordAny || isOwn || isReservedForOther || !isEnabled) ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-800'}
                                        `}
                        >
                          {!isEnabled ? 'Desk offline' : 'Comprar'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* VAULT MODE */}
      {mode === 'vault' && (
        <div className="space-y-4">
          {/* CLAIM FUNDS UI */}
          {(gameState.blackMarketBalance || 0) > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-800/50 p-4 rounded-lg flex items-center justify-between">
              <div>
                <div className="text-yellow-500 font-bold text-sm uppercase mb-1">Proventos de vendas</div>
                <div className="text-2xl font-mono text-yellow-400 font-bold">${formatCost(gameState.blackMarketBalance || 0)}</div>
              </div>
              <button
                onClick={async () => {
                  const res = await claimMarketFunds();
                  if (res && res.ok) {
                    if (onClaimSuccess) onClaimSuccess();
                  }
                }}
                className="bg-yellow-600 hover:bg-yellow-500 text-black font-bold px-6 py-2 rounded shadow-lg transition-colors border border-yellow-400"
              >
                Liquidar proventos
              </button>
            </div>
          )}

          <h3 className="text-slate-400 font-bold text-xs uppercase flex items-center gap-2 mt-4">
            <Lock size={14} /> Itens em custódia ({custodyListings.length})
          </h3>

          {custodyListings.length === 0 ? (
            <div className="text-center py-12 text-slate-600 border border-dashed border-slate-800 rounded-lg">
              <Lock size={48} className="mx-auto mb-4 opacity-20" />
              Nenhum item aguardando retirada no cofre.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {custodyListings.map(l => {
                const item = upgrades.find(u => u.id === l.itemId);
                if (!item) return null;
                return (
                  <div key={l.id} className="bg-slate-950 border border-slate-800 p-3 rounded flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-slate-500">
                      {item.image ? <img src={item.image} className="w-full h-full object-cover" /> : item.icon}
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-slate-200 text-sm">
                        {item.name}
                        {(l.qty && l.qty > 1) && <span className="text-xs text-slate-500 ml-2">x{l.qty}</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {typeof l.buyerPaidUsdc === 'number' && Number.isFinite(l.buyerPaidUsdc) ? (
                          <>
                            <span className="text-slate-400">USDC debitado: </span>
                            <span className="font-mono text-amber-400">${formatCost(l.buyerPaidUsdc)}</span>
                            {Math.abs(l.buyerPaidUsdc - p2pLineTotal(l)) > 0.0001 && (
                              <span className="mt-0.5 block text-[10px] leading-snug text-rose-400/90">
                                Preço×qtd no anúncio seria ${formatCost(p2pLineTotal(l))}. Se não bate com o teu extrato, pode ser linha antiga — fala com o suporte.
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="text-slate-400">Total (preço×qtd): </span>
                            <span className="font-mono text-slate-400">${formatCost(p2pLineTotal(l))}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const r = await claimCustodyItem(l.id);
                        if (r && r.ok) {
                          if (onClaimSuccess) onClaimSuccess();
                          const custody = await getCustodyListings();
                          setCustodyListings(custody as CustodyListingRow[]);
                        }
                      }}
                      className="bg-amber-900/50 hover:bg-amber-800 border border-amber-700 text-amber-300 text-xs px-3 py-1.5 rounded font-bold transition-colors"
                    >
                      Resgatar item
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* SELL MODE */}
      {mode === 'sell' && (
        <div className="flex flex-col h-full gap-6">

          {/* Sell Form */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2 text-sm border-b border-slate-800 pb-2">
              <PlusCircle size={16} className="text-red-500" /> Nova oferta P2P
            </h3>

            {sellableItems.length > 0 && (
              <div className="mb-4 flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Filtrar estoque</span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[140px] flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="search"
                      value={sellFilterSearch}
                      onChange={(e) => setSellFilterSearch(e.target.value)}
                      placeholder="Nome ou ID…"
                      className="w-full rounded border border-slate-700 bg-slate-900 py-2 pl-8 pr-2 text-xs text-slate-200 outline-none focus:border-red-600"
                    />
                  </div>
                  <select
                    value={sellFilterCategory}
                    onChange={(e) => setSellFilterCategory(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 outline-none focus:border-red-600"
                  >
                    <option value="">Todas as categorias</option>
                    {sellCategoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sellFilterType}
                    onChange={(e) => setSellFilterType((e.target.value || '') as '' | Upgrade['type'])}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 outline-none focus:border-red-600"
                  >
                    {P2P_TYPE_OPTIONS.map((o) => (
                      <option key={`s-${o.label}`} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[10px] text-slate-500">
                  {sellableFiltered.length} de {sellableItems.length} itens no estoque negociável.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase font-bold">Peça no estoque</label>
                <div className="relative">
                  <select
                    value={sellItemId}
                    onChange={(e) => setSellItemId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 pl-9 text-slate-200 text-sm outline-none focus:border-red-500 appearance-none"
                  >
                    {sellableItems.length === 0 && <option value="">Sem itens negociáveis</option>}
                    {sellableItems.length > 0 && sellableFiltered.length === 0 && (
                      <option value="">Nada coincide com o filtro</option>
                    )}
                    {sellableFiltered.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} (x{gameState.stock[u.id]})
                      </option>
                    ))}
                  </select>
                  <Package className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Preço Unit. (USDC)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={sellPrice}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const v = parseUsdcInput(raw);
                        const ref = getBandReferencePrice(sellItemId);
                        const min = ref * minFactor;
                        const max = ref * maxFactor;
                        if (!Number.isFinite(ref) || ref <= 0 || isNaN(v)) {
                          setSellPrice(raw);
                        } else {
                          const clamped = Math.max(min, Math.min(max, v));
                          setSellPrice(String(clamped));
                        }
                      }}
                      placeholder={(selectedSellItem ? getMarketPrice(selectedSellItem.id) : 0).toString() || "0.00"}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 pl-7 text-slate-200 text-sm outline-none focus:border-red-500 font-mono"
                    />
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Quantidade</label>
                  <input
                    type="number"
                    min="1"
                    max={gameState.stock[sellItemId] || 1}
                    value={sellQty}
                    onChange={(e) => setSellQty(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 text-sm outline-none focus:border-red-500 font-mono"
                  />
                </div>
              </div>
            </div>

            {selectedSellItem && (
              <div className="mt-3 flex flex-col gap-1 text-xs text-slate-500 bg-slate-900/50 p-2 rounded">
                <div className="flex justify-between items-center">
                  <span>Genesis Supply (loja): <span className="text-green-500 font-mono">${formatCost(marketPrice)}</span></span>
                  <span>
                    Seu preço:
                    <span className={`font-mono font-bold ${(() => { const p = parseUsdcInput(sellPrice); return isNaN(p) ? '' : (p >= marketPrice ? 'text-red-500' : 'text-green-500'); })()}`}>
                      ${sellPrice ? formatCost(parseUsdcInput(sellPrice)) : '0.00'}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-slate-800/80 pt-1">
                  <span>Base do limite (±{band}%): <span className="text-amber-400 font-mono">${formatCost(refPrice)}</span></span>
                  <span className="text-[10px] text-slate-600 font-mono">${formatCost(minAllowed)} – ${formatCost(maxAllowed)}</span>
                </div>
              </div>
            )}

            {selectedSellItem && (
              <div className="mt-2 text-[10px] text-slate-400">
                {`O limite é ±${band}% sobre o preço da Lojinha Miner (Genesis Supply) desta peça. Ex.: com banda 20%, um item de US$ 1 na loja pode ser anunciado entre US$ 0,80 e US$ 1,20 por unidade.`}
              </div>
            )}

            <button
              onClick={handleSellSubmit}
              disabled={publishDisabled || !isEnabled}
              className="w-full mt-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 rounded transition-colors text-sm flex items-center justify-center gap-2"
            >
              {!isEnabled ? 'Desk offline' : 'Publicar oferta'} <ArrowRight size={16} />
            </button>
          </div>

          {/* Active Player Listings (Custody) */}
          <div className="flex-1 overflow-y-auto bg-slate-950/30 p-3 rounded-lg border border-slate-800/50">
            <h3 className="text-slate-300 font-bold mb-1 flex items-center gap-2 text-xs uppercase tracking-wider">
              <Tag size={14} className="text-green-500" /> Suas ofertas ativas
            </h3>
            <p className="text-[10px] text-slate-500 mb-4 flex items-center gap-1">
              <ShieldCheck size={10} /> Itens ficam bloqueados no cofre até vender ou cancelar.
            </p>

            {gameState.playerListings.length === 0 ? (
              <div className="text-center py-8 text-slate-600 border border-dashed border-slate-800 rounded-lg">
                Nenhuma linha ativa no book.
              </div>
            ) : (
              <div className="space-y-2">
                {gameState.playerListings.filter(l => !l.status || l.status === 'active').map(listing => {
                  const item = upgrades.find(u => u.id === listing.itemId);
                  if (!item) return null;

                  return (
                    <div key={listing.id} className="bg-slate-950 border border-slate-800 rounded p-2 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-xl text-slate-400 overflow-hidden">
                          {item.image ? <img src={item.image} className="w-full h-full object-cover" /> : item.icon}
                        </div>
                        <div>
                          <div className="text-slate-300 font-bold text-xs">{item.name}</div>
                          <div className="text-green-500 font-mono text-xs">
                        ${formatCost(p2pLineTotal(listing))}
                        {(listing.qty && listing.qty > 1) && (
                          <span className="block text-[9px] text-slate-500">${formatCost(listing.price)}/un. × {listing.qty}</span>
                        )}
                      </div>
                        </div>
                      </div>
                      <button
                        onClick={() => onCancelListing && onCancelListing(listing.id)}
                        className="text-slate-500 hover:text-red-500 transition-colors p-2"
                        title="Cancelar Oferta"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}



      {
        confirmListing && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 w-full max-w-md shadow-2xl">
              <h3 className="text-red-500 font-bold text-sm mb-3">Fechar negócio</h3>
              {(() => {
                const item = upgrades.find(u => u.id === confirmListing.itemId);
                const maxQ = Math.max(1, parseInt(String(confirmListing.qty ?? 1), 10) || 1);
                const parsed = parseInt(String(buyQtyDraft ?? '').trim(), 10);
                const buyQ = Number.isFinite(parsed) && parsed >= 1 ? Math.min(maxQ, parsed) : 1;
                const unit = Number(confirmListing.price);
                const confirmTotal = (Number.isFinite(unit) ? unit : 0) * buyQ;
                const canAfford = gameState.usdc >= confirmTotal;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-2xl text-slate-400 overflow-hidden">
                        {item?.image ? <img src={item.image} className="w-full h-full object-cover" /> : item?.icon}
                      </div>
                      <div>
                        <div className="text-slate-200 font-bold text-sm">
                          {item?.name || confirmListing.itemId}
                          {maxQ > 1 && (
                            <span className="ml-1 text-xs font-normal text-slate-500">(até {maxQ} un.)</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">Vendedor: {confirmListing.sellerName}</div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Quantidade a comprar (máx. {maxQ})
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={maxQ}
                        value={buyQtyDraft}
                        onChange={(e) => setBuyQtyDraft(e.target.value)}
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-sm text-slate-200 outline-none focus:border-red-500"
                      />
                      <p className="text-[10px] text-slate-500">
                        Entre 1 e {maxQ} · ${formatCost(confirmListing.price)} por unidade · total do lote até ${formatCost(p2pLineTotal(confirmListing))}
                      </p>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Total a pagar</span>
                      <span className={`font-mono ${canAfford ? 'text-green-400' : 'text-red-500'}`}>${formatCost(confirmTotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Reserva USDC</span>
                      <span className="font-mono text-slate-300">${formatCost(gameState.usdc)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Saldo após compra</span>
                      <span className={`font-mono ${canAfford ? 'text-slate-300' : 'text-red-500'}`}>${formatCost(gameState.usdc - confirmTotal)}</span>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button onClick={async () => {
                        if (!confirmListing) return;
                        await cancelMarketReservation(confirmListing.id);
                        setConfirmListing(null);
                        const list = await getMarketListings();
                        setMarketListings(list);
                      }} className="flex-1 px-3 py-2 text-xs font-bold uppercase rounded border bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300">
                        Cancelar
                      </button>
                      <button onClick={async () => {
                        if (!confirmListing) return;
                        const mq = Math.max(1, parseInt(String(confirmListing.qty ?? 1), 10) || 1);
                        const trimmed = String(buyQtyDraft ?? '').trim();
                        const pq = parseInt(trimmed, 10);
                        const qBuy = Number.isFinite(pq) && pq >= 1 ? Math.min(mq, pq) : 1;
                        const res = await buyMarketListing(confirmListing.id, qBuy);
                        if (res && res.ok) {
                          const got = typeof res.purchasedQty === 'number' ? res.purchasedQty : qBuy;
                          const paid = typeof res.totalUsdc === 'number' ? res.totalUsdc : null;
                          if (got !== qBuy || (paid != null && Math.abs(paid - confirmTotal) > 1e-6)) {
                            console.warn('[BlackMarket] Resposta do servidor difere do pedido:', { pedido: qBuy, confirmTotal, res });
                          }
                          setHistoryReloadNonce((n) => n + 1);
                          if (onClaimSuccess) onClaimSuccess();
                          setConfirmListing(null);
                          const list = await getMarketListings();
                          setMarketListings(list);
                        } else {
                          if (res.error === 'Insufficient USDC') alert(`USDC insuficiente. Déficit: $${res.missing?.toFixed(2) || '0.00'}`);
                          else alert(res.error || 'Não foi possível concluir a compra.');
                        }
                      }} disabled={!canAfford || confirmTotal <= 0} className="flex-1 px-3 py-2 text-xs font-bold uppercase rounded border bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white border-red-700">
                        Confirmar
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
    </div>
  );
};
