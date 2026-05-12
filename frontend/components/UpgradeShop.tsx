
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { GameState, Upgrade, User } from '../types';
import { ShoppingCart, DollarSign, Package, Zap, Battery, Plus, Minus, Trash2, CheckCircle2, X, Hexagon, Clock, List, Cpu, Server, Plug } from 'lucide-react';
import { normalizePublicAssetUrl } from '../utils/publicUrl';
import {
  getShopState,
  postShopCartItem,
  clearShopCartApi,
  deleteShopCartLineApi,
  postShopCheckout,
  type ShopStateV1Ok,
  type ShopProductApi,
  type ShopCartLineApi
} from '../services/api';
import type { UiNotice } from './UiNoticeModal';

const UPGRADE_TYPES = new Set(['machine', 'infrastructure', 'battery', 'wiring', 'multiplier']);

function mapShopProductToUpgrade(p: ShopProductApi, vis?: Upgrade): Upgrade {
  const t = UPGRADE_TYPES.has(p.type) ? (p.type as Upgrade['type']) : 'machine';
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    type: t,
    baseCost: p.baseCost,
    baseProduction: p.baseProduction,
    powerConsumption: p.powerConsumption,
    powerCapacity: p.powerCapacity,
    multiplier: p.multiplier,
    slotsCapacity: p.slotsCapacity,
    aiSlotsCapacity: p.aiSlotsCapacity,
    description: p.description,
    icon: p.icon,
    status: (p.status === 'normal' || p.status === 'legacy' || p.status === 'exclusive' || p.status === 'limited'
      ? p.status
      : 'normal') as Upgrade['status'],
    maxGlobalStock: p.maxGlobalStock,
    totalSold: p.totalSold,
    image: p.image,
    compatibleRacks: p.compatibleRacks,
    sellInHardwareMarket: p.sellInHardwareMarket,
    isActive: p.isActive,
    isNft: p.isNft,
    visibleToAccessLevelIds: vis?.visibleToAccessLevelIds
  };
}

function qtyOnLines(lines: ShopCartLineApi[], productId: string): number {
  let s = 0;
  for (const ln of lines) {
    if (ln.productId === productId) s += ln.qty;
  }
  return s;
}

interface UpgradeShopProps {
  gameState: GameState;
  user: User;
  upgrades: Upgrade[];
  onSuggestDeposit?: (amount: number) => void;
  isEnabled?: boolean;
  onAfterShopCheckout?: () => Promise<void>;
  onShopNotice?: (notice: UiNotice) => void;
}

const DEBOUNCE_MS = 380;

export const UpgradeShop: React.FC<UpgradeShopProps> = ({
  gameState,
  user,
  upgrades,
  onSuggestDeposit,
  isEnabled = true,
  onAfterShopCheckout,
  onShopNotice
}) => {
  const [shop, setShop] = useState<ShopStateV1Ok | null>(null);
  const [shopError, setShopError] = useState<string | null>(null);
  const [shopLoading, setShopLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('machine');
  const [confirmCheckoutOpen, setConfirmCheckoutOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [syncingProductId, setSyncingProductId] = useState<string | null>(null);
  const checkoutIdemKeyRef = useRef<string | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refreshShop = useCallback(async () => {
    if (!user?.email) {
      setShopLoading(false);
      setShop(null);
      setShopError('Inicia sessão para usar a Lojinha.');
      return;
    }
    setShopLoading(true);
    setShopError(null);
    const out = await getShopState();
    setShopLoading(false);
    if (out.ok !== true) {
      setShop(null);
      setShopError(out.error || 'Não foi possível carregar a loja.');
      return;
    }
    setShop(out);
  }, [user?.email]);

  useEffect(() => {
    void refreshShop();
  }, [refreshShop]);

  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  const applyShopFromResponse = useCallback((next?: ShopStateV1Ok) => {
    if (next) setShop(next);
  }, []);

  const displayUpgrades = useMemo(() => {
    if (!shop?.products?.length) return [];
    return shop.products
      .map((p) => {
        const vis = upgrades.find((u) => u.id === p.id);
        return mapShopProductToUpgrade(p, vis);
      });
  }, [shop, upgrades]);

  const filteredUpgrades = useMemo(() => {
    return displayUpgrades
      .filter((u) => {
        if (filterType === 'all') return true;
        if (filterType === 'nft') return !!u.isNft;
        return u.type === filterType;
      })
      .sort((a, b) => a.baseCost - b.baseCost);
  }, [displayUpgrades, filterType]);

  useEffect(() => {
    if (filterType === 'all' || displayUpgrades.length === 0 || filteredUpgrades.length > 0) return;
    setFilterType('all');
  }, [displayUpgrades.length, filterType, filteredUpgrades.length]);

  const cartLines = shop?.cart.lines ?? [];
  const cartTotal = shop?.cart.totalUsdc ?? 0;
  const reserveUsdc = shop != null ? shop.usdc : gameState.usdc;
  const hardwareOpen = shop != null ? shop.hardwareMarketEnabled : isEnabled;

  const getSingleNextCost = (upgradeId: string) => {
    const u = displayUpgrades.find((x) => x.id === upgradeId);
    if (!u) return 0;
    return u.baseCost;
  };

  const flushQtyUpdate = useCallback(
    async (productId: string, quantity: number) => {
      setSyncingProductId(productId);
      const r = await postShopCartItem(productId, quantity);
      setSyncingProductId(null);
      if (r.ok && r.shop) {
        applyShopFromResponse(r.shop);
        return;
      }
      if (r.status === 409 || r.status === 422) {
        await refreshShop();
        onShopNotice?.({
          variant: 'error',
          title: 'Lojinha Miner',
          message: r.error || 'O carrinho foi atualizado com os dados reais da loja.'
        });
        return;
      }
      onShopNotice?.({
        variant: 'error',
        title: 'Lojinha Miner',
        message: r.error || 'Não foi possível atualizar o carrinho.'
      });
      await refreshShop();
    },
    [applyShopFromResponse, onShopNotice, refreshShop]
  );

  const scheduleQtyUpdate = useCallback(
    (productId: string, quantity: number) => {
      const prev = debounceTimers.current[productId];
      if (prev) clearTimeout(prev);
      debounceTimers.current[productId] = setTimeout(() => {
        delete debounceTimers.current[productId];
        void flushQtyUpdate(productId, quantity);
      }, DEBOUNCE_MS);
    },
    [flushQtyUpdate]
  );

  const handleAddToCart = (id: string, delta: number) => {
    const u = displayUpgrades.find((x) => x.id === id);
    if (u?.isNft) {
      onShopNotice?.({
        variant: 'info',
        title: 'Lojinha Miner',
        message: 'Itens NFT não são compráveis com USDC aqui. Usa a Carteira / Web3 do jogo para obter ou gerir NFTs.'
      });
      return;
    }
    const current = qtyOnLines(cartLines, id);
    const newAmount = Math.max(0, current + delta);
    if (u && u.status === 'limited' && newAmount > 0) {
      const max = u.maxGlobalStock ?? 0;
      const sold = u.totalSold ?? 0;
      const available = Math.max(0, max - sold);
      if (newAmount > available) return;
    }
    void scheduleQtyUpdate(id, newAmount);
  };

  const handleRemoveLine = async (lineId: string) => {
    setSyncingProductId('__line__');
    const r = await deleteShopCartLineApi(lineId);
    setSyncingProductId(null);
    if (r.ok && r.shop) applyShopFromResponse(r.shop);
    else {
      await refreshShop();
      onShopNotice?.({
        variant: 'error',
        title: 'Lojinha Miner',
        message: r.error || 'Não foi possível remover a linha.'
      });
    }
  };

  const handleClearCart = async () => {
    setSyncingProductId('__clear__');
    const r = await clearShopCartApi();
    setSyncingProductId(null);
    if (r.ok && r.shop) applyShopFromResponse(r.shop);
    else {
      await refreshShop();
      onShopNotice?.({
        variant: 'error',
        title: 'Lojinha Miner',
        message: r.error || 'Não foi possível esvaziar o carrinho.'
      });
    }
  };

  const handleCheckoutClick = () => {
    if (cartTotal === 0 || reserveUsdc < cartTotal || !hardwareOpen || !isEnabled) return;
    checkoutIdemKeyRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `shop_${Date.now()}_${Math.random()}`;
    setConfirmCheckoutOpen(true);
  };

  const confirmHardwareCheckout = async () => {
    if (reserveUsdc < cartTotal || checkoutBusy) return;
    const idem = checkoutIdemKeyRef.current;
    if (!idem) return;
    setCheckoutBusy(true);
    const res = await postShopCheckout(idem);
    setCheckoutBusy(false);
    if (res.ok === true) {
      if (res.shop) applyShopFromResponse(res.shop);
      else await refreshShop();
      setConfirmCheckoutOpen(false);
      checkoutIdemKeyRef.current = null;
      if (onAfterShopCheckout) await onAfterShopCheckout();
      const orderBit = res.orderId ? ` Pedido: ${res.orderId.slice(0, 8)}…` : '';
      onShopNotice?.({
        variant: 'success',
        title: 'Lojinha Miner',
        message: `Compra concluída.${orderBit} Seu estoque foi atualizado.`
      });
      return;
    }
    if (res.status === 409 || res.status === 422) {
      await refreshShop();
      const mismatch =
        res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH'
          ? 'Esta confirmação já foi tratada ou a chave de idempotência não corresponde ao carrinho atual. Os dados foram atualizados.'
          : res.error ||
            'O carrinho ou o saldo mudou no servidor. Os dados foram atualizados — verifique novamente antes de confirmar.';
      onShopNotice?.({
        variant: 'error',
        title: 'Lojinha Miner',
        message: mismatch
      });
      setConfirmCheckoutOpen(false);
      return;
    }
    onShopNotice?.({
      variant: 'error',
      title: 'Lojinha Miner',
      message: res.error || 'Erro ao finalizar a compra.'
    });
  };

  useEffect(() => {
    if (!confirmCheckoutOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmCheckoutOpen(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [confirmCheckoutOpen]);

  const formatProduction = (val: number) => {
    if (val < 0.0001) return val.toFixed(8);
    return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(val);
  };

  const formatCost = (val: number) => {
    if (val === 0) return '0.00';
    if (val < 0.0001) return val.toFixed(8);
    if (val < 1) return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
    return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  const cartItemsList = cartLines.map((ln) => {
    const u = displayUpgrades.find((x) => x.id === ln.productId);
    if (!u) return null;
    return { ...u, lineId: ln.lineId, count: ln.qty, cost: ln.lineTotal };
  }).filter(Boolean) as (Upgrade & { lineId: string; count: number; cost: number })[];

  const cartCountSum = cartLines.reduce((a, ln) => a + ln.qty, 0);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col shadow-xl transition-colors relative">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-between items-center shrink-0 z-20 shadow-md">
        <h2 className="text-xl font-bold text-amber-600 dark:text-amber-500 flex items-center gap-2">
          <Package size={20} /> Lojinha Miner
        </h2>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs text-slate-500 uppercase tracking-wide">Reserva USDC</span>
          <span className="text-sm font-mono font-bold text-green-600 dark:text-green-400 flex items-center">
            <DollarSign size={12} /> {formatCost(reserveUsdc)}
          </span>
          {shopError && <span className="text-[10px] text-red-500 max-w-[200px] text-right">{shopError}</span>}
          {shopLoading && <span className="text-[10px] text-slate-500">A sincronizar…</span>}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row">
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex overflow-x-auto p-2 gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 custom-scrollbar shrink-0">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${
                filterType === 'all'
                  ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <List size={14} /> Todos
            </button>
            <button
              type="button"
              onClick={() => setFilterType('machine')}
              className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${
                filterType === 'machine'
                  ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <Cpu size={14} /> GPUs
            </button>
            <button
              type="button"
              onClick={() => setFilterType('infrastructure')}
              className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${
                filterType === 'infrastructure'
                  ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <Server size={14} /> Rigs
            </button>
            <button
              type="button"
              onClick={() => setFilterType('battery')}
              className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${
                filterType === 'battery'
                  ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <Battery size={14} /> Baterias
            </button>
            <button
              type="button"
              onClick={() => setFilterType('wiring')}
              className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${
                filterType === 'wiring'
                  ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <Plug size={14} /> Fiação
            </button>
            <button
              type="button"
              onClick={() => setFilterType('multiplier')}
              className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${
                filterType === 'multiplier'
                  ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <Zap size={14} /> Chips IA
            </button>
            <button
              type="button"
              onClick={() => setFilterType('nft')}
              className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${
                filterType === 'nft'
                  ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <Hexagon size={14} /> NFT
            </button>
          </div>

          <div className="p-2 space-y-2 custom-scrollbar pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
            {filteredUpgrades.map((upgrade) => {
              const nextCost = getSingleNextCost(upgrade.id);
              const canAffordOne = reserveUsdc >= cartTotal + nextCost;
              const isMachine = upgrade.type === 'machine';
              const isRack = upgrade.type === 'infrastructure';
              const isBattery = upgrade.type === 'battery';
              const inCart = qtyOnLines(cartLines, upgrade.id);
              const rackNames =
                Array.isArray(upgrade.compatibleRacks) && upgrade.compatibleRacks.length > 0
                  ? upgrade.compatibleRacks.map((rid) => {
                      const r = upgrades.find((u) => u.id === rid);
                      return r ? r.name : rid;
                    })
                  : [];
              const compText = rackNames.length ? rackNames.join(', ') : 'Qualquer rack compatível';
              const rowBusy = syncingProductId === upgrade.id;
              const isNftRow = !!upgrade.isNft;

              const containerAspectRatio = isRack ? 'aspect-[5/6]' : isMachine ? 'aspect-video' : 'aspect-square';

              return (
                <div
                  key={upgrade.id}
                  className={`
                            w-full flex items-center p-3 rounded-lg border text-left transition-all duration-200 relative
                            ${
                              inCart > 0
                                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                            }
                          `}
                >
                  <div
                    className={`
                            ${containerAspectRatio} w-24 relative flex items-center justify-center rounded-md border transition-colors shrink-0 overflow-hidden group
                            ${
                              inCart > 0
                                ? 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-800'
                                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                            }
                          `}
                  >
                    {upgrade.image ? (
                      <img
                        src={normalizePublicAssetUrl(upgrade.image) || upgrade.image}
                        alt={upgrade.name}
                        className={`w-full h-full ${isRack ? 'object-contain' : 'object-cover'}`}
                      />
                    ) : (
                      <span className="text-3xl relative z-10">{upgrade.icon}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 ml-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex flex-col">
                          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate">{upgrade.name}</h3>
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider">{upgrade.category}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {upgrade.isNft && (
                            <span className="text-[9px] bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 px-1 rounded flex items-center gap-0.5 border border-orange-200 dark:border-orange-800">
                              <Hexagon size={8} /> NFT
                            </span>
                          )}
                          {upgrade.status === 'limited' && (
                            <span className="text-[9px] bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300 px-1 rounded flex items-center gap-0.5 border border-yellow-200 dark:border-yellow-800">
                              <Clock size={8} /> LTD
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <div
                          className={`text-sm font-mono font-bold ${
                            isNftRow
                              ? 'text-slate-400 dark:text-slate-500'
                              : canAffordOne
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-500 dark:text-red-400'
                          }`}
                        >
                          {isNftRow ? '—' : `$${formatCost(nextCost)}`}
                        </div>
                        {isNftRow && (
                          <span className="text-[9px] text-orange-500 dark:text-orange-400 font-bold uppercase mt-0.5">
                            Web3
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-between items-end mt-1">
                      <div className="flex flex-col gap-0.5">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">{upgrade.description}</div>
                        {isMachine && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-2">
                            <span className="text-green-600 dark:text-green-500/80">+{formatProduction(upgrade.baseProduction)} H/s</span>
                            {typeof upgrade.powerConsumption === 'number' && (
                              <span className="text-red-500 dark:text-red-400/80 flex items-center gap-0.5">
                                <Zap size={8} /> {upgrade.powerConsumption}W
                              </span>
                            )}
                          </div>
                        )}
                        {upgrade.type === 'multiplier' && (
                          <div className="text-[10px] text-orange-600 dark:text-orange-400 font-mono flex items-center gap-2">
                            <span>+{(((upgrade.multiplier || 0) * 100).toFixed(1))}%</span>
                            {typeof upgrade.powerConsumption === 'number' && (
                              <span className="text-red-500 dark:text-red-400/80 flex items-center gap-0.5">
                                <Zap size={8} /> {upgrade.powerConsumption}W
                              </span>
                            )}
                          </div>
                        )}
                        {upgrade.type === 'wiring' && typeof upgrade.powerConsumption === 'number' && (
                          <div className="text-[10px] text-red-500 dark:text-red-400/80 font-mono flex items-center gap-0.5">
                            <Zap size={8} /> {upgrade.powerConsumption}W
                          </div>
                        )}
                        {isBattery && (
                          <div className="text-[10px] text-yellow-600 dark:text-yellow-500/80 font-mono flex items-center gap-1">
                            <Battery size={8} /> {upgrade.powerCapacity === -1 ? '∞' : upgrade.powerCapacity?.toLocaleString()} Wh
                          </div>
                        )}
                        {(upgrade.type === 'machine' ||
                          upgrade.type === 'battery' ||
                          upgrade.type === 'wiring' ||
                          upgrade.type === 'multiplier') && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <Server size={8} /> Compatível: {compText}
                          </div>
                        )}

                        {upgrade.status === 'limited' && (
                          <div className="mt-1 flex items-center gap-2">
                            <div className="text-[9px] font-bold text-amber-600 dark:text-amber-500 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                              <Clock size={8} />
                              ESTOQUE: {Math.max(0, (upgrade.maxGlobalStock || 0) - (upgrade.totalSold || 0))} /{' '}
                              {upgrade.maxGlobalStock}
                            </div>
                            <div className="text-[9px] text-slate-500 flex items-center gap-1">
                              VENDIDOS: {upgrade.totalSold || 0}
                            </div>
                          </div>
                        )}
                        {isNftRow && (
                          <p className="text-[10px] text-orange-600/90 dark:text-orange-400/90 mt-1 leading-snug max-w-[14rem]">
                            NFT: obtido via Carteira / fluxos Web3 — não é possível adicionar ao carrinho com USDC.
                          </p>
                        )}
                      </div>

                      {isNftRow ? (
                        <div
                          className="flex flex-col items-end justify-end shrink-0 max-w-[7.5rem] text-right text-[10px] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-2 bg-slate-50 dark:bg-slate-900/80"
                          title="Itens NFT não são compráveis na Lojinha com USDC."
                        >
                          <Hexagon size={14} className="text-orange-500 mx-auto mb-1" />
                          <span className="font-bold uppercase text-[9px] text-orange-600 dark:text-orange-400">Só Web3</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 rounded-lg p-1 border border-slate-200 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => handleAddToCart(upgrade.id, -1)}
                            className="w-6 h-6 flex items-center justify-center rounded bg-white dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-900/50 text-slate-600 dark:text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30"
                            disabled={inCart === 0 || rowBusy || shopLoading || !hardwareOpen || !isEnabled}
                          >
                            <Minus size={12} />
                          </button>
                          <span
                            className={`text-xs font-mono font-bold w-6 text-center ${
                              inCart > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'
                            }`}
                          >
                            {inCart}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleAddToCart(upgrade.id, 1)}
                            className="w-6 h-6 flex items-center justify-center rounded bg-white dark:bg-slate-800 hover:bg-green-100 dark:hover:bg-green-900/50 text-slate-600 dark:text-slate-400 hover:text-green-500 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-600"
                            disabled={
                              rowBusy ||
                              shopLoading ||
                              !hardwareOpen ||
                              !isEnabled ||
                              (upgrade.status === 'limited' &&
                                (upgrade.totalSold || 0) + inCart >= (upgrade.maxGlobalStock || 0))
                            }
                            title={
                              upgrade.status === 'limited' && (upgrade.totalSold || 0) + inCart >= (upgrade.maxGlobalStock || 0)
                                ? 'Lote esgotado'
                                : 'Adicionar ao carrinho'
                            }
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredUpgrades.length === 0 && (
              <div className="text-center py-10 text-slate-500 dark:text-slate-400 italic">
                {shopLoading ? 'A carregar catálogo…' : 'Nenhum SKU corresponde a este filtro.'}
              </div>
            )}
          </div>
        </div>

        <div className="w-full lg:w-80 shrink-0 bg-white dark:bg-slate-950 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 flex flex-col z-10 shadow-[-5px_0_15px_rgba(0,0,0,0.05)]">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-slate-50 dark:bg-slate-900">
            <ShoppingCart size={18} className="text-slate-600 dark:text-slate-400" />
            <h3 className="font-bold text-slate-700 dark:text-slate-300">Carrinho Genesis</h3>
            <span className="bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400 text-xs px-2 py-0.5 rounded-full font-bold ml-auto">
              {cartCountSum}
            </span>
          </div>

          <div className="p-4 space-y-3 custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
            {cartItemsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-600 gap-2 opacity-50">
                <ShoppingCart size={48} />
                <span className="text-sm font-bold">Carrinho vazio</span>
              </div>
            ) : (
              cartItemsList.map((item) => (
                <div key={item.lineId} className="flex gap-3 items-start animate-in slide-in-from-right-2 duration-300">
                  <div className="w-10 h-10 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-lg shrink-0 overflow-hidden">
                    {item.image ? (
                      <img src={normalizePublicAssetUrl(item.image) || item.image} className="w-full h-full object-cover" alt="" />
                    ) : (
                      item.icon
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate pr-1">{item.name}</span>
                      <button
                        type="button"
                        onClick={() => void handleRemoveLine(item.lineId)}
                        className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                        disabled={syncingProductId === '__line__'}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="flex justify-between items-end mt-1">
                      <div className="text-xs text-slate-500">x{item.count}</div>
                      <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-300">${formatCost(item.cost)}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500 uppercase text-xs font-bold">Total do pedido</span>
              <span
                className={`font-mono font-bold text-lg ${
                  reserveUsdc >= cartTotal ? 'text-green-600 dark:text-green-400' : 'text-red-500'
                }`}
              >
                ${formatCost(cartTotal)}
              </span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleClearCart()}
                disabled={cartTotal === 0 || syncingProductId === '__clear__'}
                className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-500 transition-colors disabled:opacity-50"
                title="Esvaziar carrinho"
              >
                <Trash2 size={18} />
              </button>
              {reserveUsdc < cartTotal && (
                <button
                  type="button"
                  onClick={() => {
                    const missing = Math.max(0, cartTotal - reserveUsdc);
                    onSuggestDeposit && onSuggestDeposit(parseFloat(missing.toFixed(2)));
                  }}
                  className="px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-md"
                >
                  Cobrir déficit (${formatCost(Math.max(0, cartTotal - reserveUsdc))} USDC)
                </button>
              )}
              <button
                type="button"
                onClick={handleCheckoutClick}
                disabled={
                  cartTotal === 0 ||
                  reserveUsdc < cartTotal ||
                  !hardwareOpen ||
                  !isEnabled ||
                  checkoutBusy ||
                  shopLoading
                }
                className={`
                                flex-1 py-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98]
                                ${
                                  cartTotal === 0 ||
                                  reserveUsdc < cartTotal ||
                                  !hardwareOpen ||
                                  !isEnabled ||
                                  checkoutBusy ||
                                  shopLoading
                                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                    : 'bg-green-600 hover:bg-green-500 text-white shadow-green-500/30'
                                }
                            `}
              >
                {!hardwareOpen || !isEnabled
                  ? 'Compras pausadas'
                  : reserveUsdc < cartTotal
                    ? 'USDC insuficiente'
                    : checkoutBusy
                      ? 'A processar…'
                      : 'Confirmar compra'}{' '}
                <CheckCircle2 size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirmCheckoutOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm"
          role="presentation"
          onClick={() => !checkoutBusy && setConfirmCheckoutOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hw-checkout-title"
            className="max-w-lg w-full max-h-[85vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="hw-checkout-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Confirmar compra — Lojinha Miner
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              O total em USDC será debitado no servidor; preços e stock são validados na confirmação.
            </p>
            <ul className="mt-4 space-y-2 border-y border-slate-200 py-3 dark:border-slate-700">
              {cartItemsList.map((item) => (
                <li key={item.lineId} className="flex justify-between text-sm text-slate-700 dark:text-slate-200">
                  <span className="truncate pr-2">
                    {item.name} <span className="text-slate-400">×{item.count}</span>
                  </span>
                  <span className="shrink-0 font-mono font-bold">${formatCost(item.cost)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between text-sm text-slate-600 dark:text-slate-400">
              <span>Saldo actual (loja)</span>
              <span className="font-mono">${formatCost(reserveUsdc)}</span>
            </div>
            <div className="mt-1 flex justify-between text-base font-bold text-slate-900 dark:text-white">
              <span>Total</span>
              <span className="font-mono text-green-600 dark:text-green-400">${formatCost(cartTotal)}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm text-slate-600 dark:text-slate-400">
              <span>Saldo após</span>
              <span
                className={`font-mono font-bold ${
                  reserveUsdc - cartTotal < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'
                }`}
              >
                ${formatCost(reserveUsdc - cartTotal)}
              </span>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !checkoutBusy && setConfirmCheckoutOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmHardwareCheckout()}
                disabled={reserveUsdc < cartTotal || checkoutBusy}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkoutBusy ? 'A processar…' : 'Confirmar compra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
