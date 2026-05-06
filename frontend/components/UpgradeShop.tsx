
import React, { useState, useMemo, useEffect } from 'react';
import { GameState, Upgrade, User } from '../types';
import { ShoppingCart, DollarSign, Package, Zap, Battery, Plus, Minus, Trash2, CheckCircle2, X, Hexagon, Clock, List, Cpu, Server, Plug, Wrench, Activity } from 'lucide-react';
import { normalizePublicAssetUrl } from '../utils/publicUrl';

interface UpgradeShopProps {
    gameState: GameState;
    user: User;
    onBatchBuy: (cart: Record<string, number>, totalCost: number) => void;
    upgrades: Upgrade[];
    onSuggestDeposit?: (amount: number) => void;
    isEnabled?: boolean;
}

export const UpgradeShop: React.FC<UpgradeShopProps> = ({ gameState, user, onBatchBuy, upgrades, onSuggestDeposit, isEnabled = true }) => {
    const [cart, setCart] = useState<Record<string, number>>({});
    const [filterType, setFilterType] = useState<string>('machine');
    const [confirmCheckoutOpen, setConfirmCheckoutOpen] = useState(false);

    // FILTERED UPGRADES: Remove Legacy/Exclusive items
    const displayUpgrades = useMemo(() => {
        return upgrades.filter(u => {
            if (u.status === 'legacy' || u.status === 'exclusive') return false;
            if (u.sellInHardwareMarket === false) return false;

            // VISIBILITY FILTER: Check if user has access to this upgrade
            if (u.visibleToAccessLevelIds && u.visibleToAccessLevelIds.length > 0) {
                const hasPrimary = user.accessLevelId && u.visibleToAccessLevelIds.includes(user.accessLevelId);
                const hasAny = user.accessLevelIds && user.accessLevelIds.some(l => u.visibleToAccessLevelIds!.includes(l));
                if (!hasPrimary && !hasAny) return false;
            }

            // Note: Limited logic updated. We show them even if stock is 0, but disable buy.
            if (u.status === 'limited' && u.maxGlobalStock !== undefined && u.maxGlobalStock <= 0) {
                // Actually, user wants to see it "indicando quantos deste item estão disponivel no estoque e quantos já forão vendidos"
                // So we return true here.
            }
            return true;
        });
    }, [upgrades]);

    // Apply Type Filter and Sort by Price
    const filteredUpgrades = useMemo(() => {
        return displayUpgrades.filter(u => {
            if (filterType === 'all') return true;
            return u.type === filterType;
        }).sort((a, b) => a.baseCost - b.baseCost);
    }, [displayUpgrades, filterType]);

    // Calculate cost based on TOTAL owned (Stock + Active in racks)
    const getOwnedCount = (upgradeId: string) => {
        let count = gameState.stock[upgradeId] || 0;
        const upgrade = upgrades.find(u => u.id === upgradeId);
        if (!upgrade) return count;

        if (upgrade.type === 'infrastructure') {
            count += gameState.placedRacks.filter(r => r.itemId === upgradeId).length;
        } else {
            gameState.placedRacks.forEach(r => {
                r.slots.forEach(s => {
                    if (s === upgradeId) count++;
                });
                // Also check aux slots
                if (r.batteryId === upgradeId) count++;
                if (r.wiringId === upgradeId) count++;
                r.multiplierSlots?.forEach(s => { if (s === upgradeId) count++; });
            });
        }
        return count;
    };

    const calculateItemCost = (baseCost: number, currentOwned: number, amountToBuy: number) => {
        return baseCost * amountToBuy;
    };

    const getSingleNextCost = (upgradeId: string) => {
        const u = upgrades.find(x => x.id === upgradeId);
        if (!u) return 0;
        return calculateItemCost(u.baseCost, 0, 1);
    }

    // Calculate total cart cost
    const cartTotal = useMemo(() => {
        let total = 0;
        (Object.entries(cart) as [string, number][]).forEach(([id, count]) => {
            const u = upgrades.find(x => x.id === id);
            if (u) {
                total += calculateItemCost(u.baseCost, 0, count);
            }
        });
        return total;
    }, [cart, gameState, upgrades]);

    const handleAddToCart = (id: string, amount: number) => {
        setCart(prev => {
            const current = prev[id] || 0;
            const newAmount = Math.max(0, current + amount);
            if (newAmount === 0) {
                const { [id]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [id]: newAmount };
        });
    };

    const handleRemoveFromCart = (id: string) => {
        setCart(prev => {
            const { [id]: _, ...rest } = prev;
            return rest;
        })
    }

    const handleCheckoutClick = () => {
        if (cartTotal === 0 || gameState.usdc < cartTotal || !isEnabled) return;
        setConfirmCheckoutOpen(true);
    };

    const confirmHardwareCheckout = () => {
        if (gameState.usdc < cartTotal) return;
        onBatchBuy(cart, cartTotal);
        setCart({});
        setConfirmCheckoutOpen(false);
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
        return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(val);
    }

    const formatCost = (val: number) => {
        if (val === 0) return "0.00";
        if (val < 0.0001) return val.toFixed(8);
        if (val < 1) return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
        return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    // Items in cart details
    const cartItemsList = (Object.entries(cart) as [string, number][]).map(([id, count]) => {
        const u = upgrades.find(x => x.id === id);
        if (!u) return null;
        const cost = calculateItemCost(u.baseCost, 0, count);
        return { ...u, count, cost };
    }).filter(Boolean) as (Upgrade & { count: number, cost: number })[];

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col shadow-xl transition-colors relative">

            {/* HEADER */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-between items-center shrink-0 z-20 shadow-md">
                <h2 className="text-xl font-bold text-amber-600 dark:text-amber-500 flex items-center gap-2">
                    <Package size={20} /> Lojinha Miner
                </h2>
                <div className="flex flex-col items-end">
                    <span className="text-xs text-slate-500 uppercase tracking-wide">Reserva USDC</span>
                    <span className="text-sm font-mono font-bold text-green-600 dark:text-green-400 flex items-center">
                        <DollarSign size={12} /> {formatCost(gameState.usdc)}
                    </span>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row">

                {/* LEFT COLUMN: PRODUCTS */}
                <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-900/50">

                    {/* FILTER MENU */}
                    <div className="flex overflow-x-auto p-2 gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 custom-scrollbar shrink-0">
                        <button onClick={() => setFilterType('all')} className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${filterType === 'all' ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}>
                            <List size={14} /> Todos
                        </button>
                        <button onClick={() => setFilterType('machine')} className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${filterType === 'machine' ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}>
                            <Cpu size={14} /> GPUs
                        </button>
                        <button onClick={() => setFilterType('infrastructure')} className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${filterType === 'infrastructure' ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}>
                            <Server size={14} /> Rigs
                        </button>
                        <button onClick={() => setFilterType('battery')} className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${filterType === 'battery' ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}>
                            <Battery size={14} /> Baterias
                        </button>
                        <button onClick={() => setFilterType('wiring')} className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${filterType === 'wiring' ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}>
                            <Plug size={14} /> Fiação
                        </button>
                        <button onClick={() => setFilterType('multiplier')} className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${filterType === 'multiplier' ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}>
                            <Zap size={14} /> Chips IA
                        </button>
                        <button onClick={() => setFilterType('charger')} className={`px-3 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors border ${filterType === 'charger' ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}>
                            <Wrench size={14} /> Carregadores
                        </button>
                    </div>

                    {/* ITEMS LIST */}
                    <div className="p-2 space-y-2 custom-scrollbar pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
                        {filteredUpgrades.map((upgrade) => {
                            const nextCost = getSingleNextCost(upgrade.id);
                            const canAffordOne = gameState.usdc >= (cartTotal + nextCost);
                            const isMachine = upgrade.type === 'machine';
                            const isRack = upgrade.type === 'infrastructure';
                            const isBattery = upgrade.type === 'battery';
                            const inCart = cart[upgrade.id] || 0;
                            const rackNames = Array.isArray(upgrade.compatibleRacks) && upgrade.compatibleRacks.length > 0
                                ? upgrade.compatibleRacks.map(id => {
                                    const r = upgrades.find(u => u.id === id);
                                    return r ? r.name : id;
                                })
                                : [];
                            const compText = rackNames.length ? rackNames.join(', ') : 'Qualquer rack compatível';

                            const containerAspectRatio = isRack
                                ? 'aspect-[5/6]'
                                : isMachine
                                    ? 'aspect-video'
                                    : 'aspect-square';

                            return (
                                <div
                                    key={upgrade.id}
                                    className={`
                            w-full flex items-center p-3 rounded-lg border text-left transition-all duration-200 relative
                            ${inCart > 0
                                            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}
                          `}
                                >
                                    <div className={`
                            ${containerAspectRatio} w-24 relative flex items-center justify-center rounded-md border transition-colors shrink-0 overflow-hidden group
                            ${inCart > 0 ? 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-800' : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'}
                          `}>
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
                                                    <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate">
                                                        {upgrade.name}
                                                    </h3>
                                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">{upgrade.category}</span>
                                                </div>
                                                {/* BADGES */}
                                                <div className="flex items-center gap-2 mt-1">
                                                    {upgrade.isNft && <span className="text-[9px] bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 px-1 rounded flex items-center gap-0.5 border border-orange-200 dark:border-orange-800"><Hexagon size={8} /> NFT</span>}
                                                    {upgrade.status === 'limited' && <span className="text-[9px] bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300 px-1 rounded flex items-center gap-0.5 border border-yellow-200 dark:border-yellow-800"><Clock size={8} /> LTD</span>}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end shrink-0">
                                                <div className={`text-sm font-mono font-bold ${canAffordOne ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                                    ${formatCost(nextCost)}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-end mt-1">
                                            <div className="flex flex-col gap-0.5">
                                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                                    {upgrade.description}
                                                </div>
                                                {isMachine && (
                                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-2">
                                                        <span className="text-green-600 dark:text-green-500/80">+{formatProduction(upgrade.baseProduction)} H/s</span>
                                                        {typeof upgrade.powerConsumption === 'number' && (
                                                            <span className="text-red-500 dark:text-red-400/80 flex items-center gap-0.5"><Zap size={8} /> {upgrade.powerConsumption}W</span>
                                                        )}
                                                    </div>
                                                )}
                                                {upgrade.type === 'multiplier' && (
                                                    <div className="text-[10px] text-orange-600 dark:text-orange-400 font-mono flex items-center gap-2">
                                                        <span>+{(((upgrade.multiplier || 0) * 100).toFixed(1))}%</span>
                                                        {typeof upgrade.powerConsumption === 'number' && (
                                                            <span className="text-red-500 dark:text-red-400/80 flex items-center gap-0.5"><Zap size={8} /> {upgrade.powerConsumption}W</span>
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
                                                {upgrade.type === 'charger' && (
                                                    <div className="text-[10px] text-orange-600 dark:text-orange-500 font-mono flex flex-col gap-0.5">
                                                        <span className="flex items-center gap-1">
                                                            <Activity size={8} /> Carga: {formatProduction(upgrade.baseProduction)} Wh/s
                                                        </span>
                                                        <span className="flex items-center gap-1">
                                                            <Zap size={8} /> Interno: {upgrade.powerCapacity?.toLocaleString()} Wh
                                                        </span>
                                                    </div>
                                                )}
                                                {(upgrade.type === 'machine' || upgrade.type === 'battery' || upgrade.type === 'wiring' || upgrade.type === 'multiplier') && (
                                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                                        <Server size={8} /> Compatível: {compText}
                                                    </div>
                                                )}

                                                {/* LIMITED EDITION INFO */}
                                                {upgrade.status === 'limited' && (
                                                    <div className="mt-1 flex items-center gap-2">
                                                        <div className="text-[9px] font-bold text-amber-600 dark:text-amber-500 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                                                            <Clock size={8} />
                                                            ESTOQUE: {Math.max(0, (upgrade.maxGlobalStock || 0) - (upgrade.totalSold || 0))} / {upgrade.maxGlobalStock}
                                                        </div>
                                                        <div className="text-[9px] text-slate-500 flex items-center gap-1">
                                                            VENDIDOS: {upgrade.totalSold || 0}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* ADD TO CART CONTROLS */}
                                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 rounded-lg p-1 border border-slate-200 dark:border-slate-800">
                                                <button
                                                    onClick={() => handleAddToCart(upgrade.id, -1)}
                                                    className="w-6 h-6 flex items-center justify-center rounded bg-white dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-900/50 text-slate-600 dark:text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30"
                                                    disabled={inCart === 0}
                                                >
                                                    <Minus size={12} />
                                                </button>
                                                <span className={`text-xs font-mono font-bold w-6 text-center ${inCart > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                                                    {inCart}
                                                </span>
                                                <button
                                                    onClick={() => handleAddToCart(upgrade.id, 1)}
                                                    className="w-6 h-6 flex items-center justify-center rounded bg-white dark:bg-slate-800 hover:bg-green-100 dark:hover:bg-green-900/50 text-slate-600 dark:text-slate-400 hover:text-green-500 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-600"
                                                    disabled={(upgrade.status === 'limited' && ((upgrade.totalSold || 0) + inCart) >= (upgrade.maxGlobalStock || 0))}
                                                    title={(upgrade.status === 'limited' && ((upgrade.totalSold || 0) + inCart) >= (upgrade.maxGlobalStock || 0)) ? "Lote esgotado" : "Adicionar ao carrinho"}
                                                >
                                                    <Plus size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {filteredUpgrades.length === 0 && (
                            <div className="text-center py-10 text-slate-500 dark:text-slate-400 italic">
                                Nenhum SKU corresponde a este filtro.
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT COLUMN: SHOPPING CART SIDEBAR */}
                <div className="w-full lg:w-80 shrink-0 bg-white dark:bg-slate-950 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 flex flex-col z-10 shadow-[-5px_0_15px_rgba(0,0,0,0.05)]">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-slate-50 dark:bg-slate-900">
                        <ShoppingCart size={18} className="text-slate-600 dark:text-slate-400" />
                        <h3 className="font-bold text-slate-700 dark:text-slate-300">Carrinho Genesis</h3>
                        <span className="bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400 text-xs px-2 py-0.5 rounded-full font-bold ml-auto">
                            {(Object.values(cart) as number[]).reduce((a, b) => a + b, 0)}
                        </span>
                    </div>

                    {/* Cart Items List */}
                    <div className="p-4 space-y-3 custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
                        {cartItemsList.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-600 gap-2 opacity-50">
                                <ShoppingCart size={48} />
                                <span className="text-sm font-bold">Carrinho vazio</span>
                            </div>
                        ) : (
                            cartItemsList.map(item => (
                                <div key={item.id} className="flex gap-3 items-start animate-in slide-in-from-right-2 duration-300">
                                    <div className="w-10 h-10 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-lg shrink-0 overflow-hidden">
                                        {item.image ? (
                                            <img src={item.image} className="w-full h-full object-cover" />
                                        ) : item.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate pr-1">{item.name}</span>
                                            <button onClick={() => handleRemoveFromCart(item.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                                                <X size={12} />
                                            </button>
                                        </div>
                                        <div className="flex justify-between items-end mt-1">
                                            <div className="text-xs text-slate-500">
                                                x{item.count}
                                            </div>
                                            <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-300">
                                                ${formatCost(item.cost)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Cart Footer / Checkout */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 uppercase text-xs font-bold">Total do pedido</span>
                            <span className={`font-mono font-bold text-lg ${gameState.usdc >= cartTotal ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                ${formatCost(cartTotal)}
                            </span>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setCart({})}
                                disabled={cartTotal === 0}
                                className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-500 transition-colors disabled:opacity-50"
                                title="Esvaziar carrinho"
                            >
                                <Trash2 size={18} />
                            </button>
                            {gameState.usdc < cartTotal && (
                                <button
                                    onClick={() => {
                                        const missing = Math.max(0, cartTotal - gameState.usdc);
                                        onSuggestDeposit && onSuggestDeposit(parseFloat(missing.toFixed(2)));
                                    }}
                                    className="px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-md"
                                >
                                    Cobrir déficit (${formatCost(Math.max(0, cartTotal - gameState.usdc))} USDC)
                                </button>
                            )}
                            <button
                                onClick={handleCheckoutClick}
                                disabled={cartTotal === 0 || gameState.usdc < cartTotal || !isEnabled}
                                className={`
                                flex-1 py-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98]
                                ${(cartTotal === 0 || gameState.usdc < cartTotal || !isEnabled)
                                        ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                        : 'bg-green-600 hover:bg-green-500 text-white shadow-green-500/30'}
                            `}
                            >
                                {!isEnabled ? 'Compras pausadas' : (gameState.usdc < cartTotal ? 'USDC insuficiente' : 'Confirmar compra')} <CheckCircle2 size={16} />
                            </button>
                        </div>
                    </div>
                </div>

            </div>

            {confirmCheckoutOpen && (
                <div
                    className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm"
                    role="presentation"
                    onClick={() => setConfirmCheckoutOpen(false)}
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
                            O total em USDC será debitado do seu saldo no servidor após confirmar.
                        </p>
                        <ul className="mt-4 space-y-2 border-y border-slate-200 py-3 dark:border-slate-700">
                            {cartItemsList.map((item) => (
                                <li key={item.id} className="flex justify-between text-sm text-slate-700 dark:text-slate-200">
                                    <span className="truncate pr-2">
                                        {item.name} <span className="text-slate-400">×{item.count}</span>
                                    </span>
                                    <span className="shrink-0 font-mono font-bold">${formatCost(item.cost)}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-3 flex justify-between text-sm text-slate-600 dark:text-slate-400">
                            <span>Saldo atual</span>
                            <span className="font-mono">${formatCost(gameState.usdc)}</span>
                        </div>
                        <div className="mt-1 flex justify-between text-base font-bold text-slate-900 dark:text-white">
                            <span>Total</span>
                            <span className="font-mono text-green-600 dark:text-green-400">${formatCost(cartTotal)}</span>
                        </div>
                        <div className="mt-1 flex justify-between text-sm text-slate-600 dark:text-slate-400">
                            <span>Saldo após</span>
                            <span className={`font-mono font-bold ${gameState.usdc - cartTotal < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'}`}>
                                ${formatCost(gameState.usdc - cartTotal)}
                            </span>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmCheckoutOpen(false)}
                                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={confirmHardwareCheckout}
                                disabled={gameState.usdc < cartTotal}
                                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Confirmar compra
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
