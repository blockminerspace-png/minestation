import React, { useState, useMemo, useRef, useEffect } from 'react';
import { GameState, LootBox, LootBoxItem, Upgrade } from '../types';
import { normalizePublicAssetUrl } from '../utils/publicUrl';
import { Gift, Package, Sparkles, DollarSign, Box, CheckCircle2, Ticket, Store, Trash2 } from 'lucide-react';
import { UiNoticeModal, type UiNotice } from './UiNoticeModal';

/** Caixas criadas pelo prémio da roleta guardam o item em `description` (`reward_for_<upgradeId>`), não sempre em `items`. */
function effectiveLootBoxItems(def: LootBox | undefined, upgradesList: Upgrade[]): LootBoxItem[] {
    if (!def) return [];
    if (Array.isArray(def.items) && def.items.length > 0) return def.items;
    if (def.trigger === 'roleta_reward' && typeof def.description === 'string' && def.description.startsWith('reward_for_')) {
        const itemId = def.description.slice('reward_for_'.length);
        if (itemId && upgradesList.some(u => u.id === itemId)) {
            return [{ type: 'item', id: itemId, minQty: 1, maxQty: 1, probability: 100 }];
        }
    }
    return [];
}

function displayLootBoxName(raw: string | undefined): string {
    const n = raw || 'Caixa';
    return n.replace(/\bCorigo\b/gi, 'Código');
}

/** Caixas-gatilho `roleta_code` não se abrem aqui — o giro é só na aba Roleta. */
function countOpenableInventoryBoxes(unopened: Record<string, number> | undefined, boxes: LootBox[]): number {
    if (!unopened) return 0;
    let sum = 0;
    for (const [id, q] of Object.entries(unopened)) {
        if (typeof q !== 'number' || q <= 0) continue;
        const def = boxes.find((b) => b.id === id);
        if (def?.trigger === 'roleta_code') continue;
        sum += q;
    }
    return sum;
}

interface LuckyBoxStoreProps {
    gameState: GameState;
    lootBoxes: LootBox[];
    upgrades: Upgrade[];
    onBuyBox: (boxId: string) => void;
    onOpenBox: (boxId: string) => Promise<{ rewards: any[] } | null>;
    /** Remove caixas não abertas do inventário (sem prémio). */
    onDiscardBox?: (boxId: string) => Promise<{ ok: boolean; error?: string }>;
    onRedeemSuccess?: (unopenedBoxes: Record<string, number>) => void;
    /** Após resgatar código de roleta (ou “girar”), leva o jogador à aba Roleta com o código. */
    onOpenRoleta?: (code: string) => void;
}

export const LuckyBoxStore: React.FC<LuckyBoxStoreProps> = ({
    gameState,
    lootBoxes,
    upgrades,
    onBuyBox,
    onOpenBox,
    onDiscardBox,
    onRedeemSuccess,
    onOpenRoleta
}) => {
    const promoInputRef = useRef<HTMLInputElement>(null);
    const [openingBox, setOpeningBox] = useState<string | null>(null);
    const [discardingBox, setDiscardingBox] = useState<string | null>(null);
    const [rewards, setRewards] = useState<any[] | null>(null);
    const [promoCode, setPromoCode] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [notice, setNotice] = useState<UiNotice | null>(null);

    type LuckyTab = 'inventario' | 'loja';

    const shopBoxes = useMemo(() => lootBoxes.filter(b => b.isActive !== false), [lootBoxes]);

    const openableInventoryTotal = useMemo(
        () => countOpenableInventoryBoxes(gameState.unopenedBoxes, lootBoxes),
        [gameState.unopenedBoxes, lootBoxes]
    );

    const [activeTab, setActiveTab] = useState<LuckyTab>(() =>
        countOpenableInventoryBoxes(gameState.unopenedBoxes, lootBoxes) > 0 ? 'inventario' : 'loja'
    );

    const lastOwnedRef = useRef(openableInventoryTotal);
    useEffect(() => {
        if (openableInventoryTotal > lastOwnedRef.current) setActiveTab('inventario');
        lastOwnedRef.current = openableInventoryTotal;
    }, [openableInventoryTotal]);

    const lojaBoxes = useMemo(() => {
        const claimed = gameState.claimedBoxes || [];
        return shopBoxes.filter(b => {
            const t = String(b.trigger || '').trim();
            if (t !== 'shop' && t !== 'shop_once' && t !== 'special') return false;
            if (t === 'shop_once' && claimed.includes(b.id)) return false;
            return true;
        });
    }, [shopBoxes, gameState.claimedBoxes]);

    // Helper to render icon (emoji or image)
    const renderIcon = (icon: string, sizeClass: string = "text-xl", imgClass: string = "") => {
        if (!icon) return <span className={sizeClass}>🎁</span>;

        const isImage = icon.includes('/') || icon.includes('http') ||
            icon.endsWith('.png') || icon.endsWith('.jpg') ||
            icon.endsWith('.gif') || icon.endsWith('.ico') || icon.endsWith('.webp');

        if (isImage) {
            const src = normalizePublicAssetUrl(icon) || icon;
            return <img src={src} alt="icon" className={`object-contain ${imgClass}`} style={{ width: '1em', height: '1em', fontSize: 'inherit' }} />;
        }
        return <span className={sizeClass}>{icon}</span>;
    };

    const getBoxAvailability = (box: LootBox) => {
        const trigger = String(box.trigger || '').trim();
        if (trigger === 'shop' || trigger === 'special') {
            return { canBuy: true, label: box.price <= 0 ? 'GRATIS' : null };
        }
        if (trigger === 'shop_once') {
            const alreadyClaimed = (gameState.claimedBoxes || []).includes(box.id);
            return alreadyClaimed
                ? { canBuy: false, label: 'JA RESGATADA' }
                : { canBuy: true, label: box.price <= 0 ? 'GRATIS' : null };
        }
        if (trigger === 'promo_code') return { canBuy: false, label: 'CODIGO' };
        if (trigger === 'registration') return { canBuy: false, label: 'CADASTRO' };
        if (trigger === 'referral_sender') return { canBuy: false, label: 'INDICADOR' };
        if (trigger === 'referral_receiver') return { canBuy: false, label: 'INDICADO' };
        if (trigger === 'roleta_code') return { canBuy: false, label: 'ROLETA' };
        if (trigger === 'roleta_reward') return { canBuy: false, label: 'PREMIO ROLETA' };
        if (trigger.startsWith('season:')) return { canBuy: false, label: `TEMP ${trigger.split(':')[1] || ''}`.trim() };
        if (trigger === 'upgrade') return { canBuy: false, label: 'BONUS UPGRADE' };
        return { canBuy: false, label: trigger ? trigger.toUpperCase() : 'INDISPONIVEL' };
    };

    // Get boxes the player owns (from any source)
    const ownedBoxes = useMemo(
        () =>
            (Object.entries(gameState.unopenedBoxes) as [string, number][])
                .filter(([_, qty]) => qty > 0)
                .map(([id, qty]) => {
                    const def = lootBoxes.find((b) => b.id === id);
                    return {
                        id,
                        qty,
                        name: displayLootBoxName(def?.name),
                        description: def?.description || 'Recompensa obtida.',
                        icon: def?.icon || '🎁',
                        trigger: def?.trigger,
                        items: effectiveLootBoxItems(def, upgrades),
                        /** Caixa retirada do catálogo público; inventário e abertura continuam válidos. */
                        isRetiredCatalog: def?.isActive === false
                    };
                })
                .filter((box) => box.trigger !== 'roleta_code'),
        [gameState.unopenedBoxes, lootBoxes, upgrades]
    );

    const handleOpen = (boxId: string) => {
        setOpeningBox(boxId);

        // Animation Delay
        setTimeout(async () => {
            const result = await onOpenBox(boxId);
            if (result) {
                setRewards(result.rewards);
            }
            setOpeningBox(null);
        }, 1500);
    };

    const handleDiscardClick = async (boxId: string, name: string, qty: number) => {
        if (!onDiscardBox) return;
        const unit = qty === 1 ? 'esta caixa' : `estas ${qty} caixas`;
        if (
            !window.confirm(
                `Descartar ${unit} «${name}»?\n\nNão recebe qualquer recompensa. Esta ação não pode ser anulada.`
            )
        ) {
            return;
        }
        setDiscardingBox(boxId);
        try {
            const result = await onDiscardBox(boxId);
            if (!result.ok) alert(result.error || 'Não foi possível descartar.');
        } finally {
            setDiscardingBox(null);
        }
    };

    const handleCloseRewards = () => {
        setRewards(null);
    };

    const handleRedeem = async () => {
        if (!promoCode.trim()) return;
        setRedeeming(true);
        try {
            const res = await fetch('/api/redeem-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code: promoCode.trim() })
            });
            const data = await res.json();
            if (res.ok) {
                if (data.type === 'roleta') {
                    const c = typeof data.code === 'string' ? data.code.trim() : '';
                    setPromoCode('');
                    if (c && onOpenRoleta) {
                        onOpenRoleta(c);
                    } else if (c) {
                        setNotice({
                            variant: 'info',
                            title: 'Resgate OK',
                            message: 'Abra o menu Roleta para girar.'
                        });
                    }
                } else {
                    setNotice({ variant: 'success', message: 'Código resgatado com sucesso!' });
                    setPromoCode('');
                    if (onRedeemSuccess && data.unopenedBoxes) {
                        onRedeemSuccess(data.unopenedBoxes);
                    } else if (onRedeemSuccess) {
                        onRedeemSuccess({});
                    }
                }
            } else {
                setNotice({ variant: 'error', message: data.error || 'Erro ao resgatar código' });
            }
        } catch (e) {
            setNotice({ variant: 'error', message: 'Falha na comunicação com o servidor' });
        }
        setRedeeming(false);
    };

    const formatCost = (val: number) => {
        if (val < 0.01) return val.toFixed(8);
        return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
    };

    return (
        <div className="relative flex flex-col p-3 animate-in fade-in slide-in-from-bottom-4 duration-300 sm:p-6">

            <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div className="rounded-lg bg-gradient-to-br from-amber-500 to-orange-700 p-2 text-white shadow-lg">
                    <Gift size={24} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 sm:text-xl">Caixa da Sorte</h2>
                    <p className="text-xs text-slate-500 sm:text-sm">Loja para comprar; inventário separado para abrir o que você já tem.</p>
                </div>
            </div>

            <div
                id="lucky-store-redeem"
                className="mb-6 rounded-2xl border border-orange-500/25 bg-gradient-to-r from-orange-900/15 to-amber-950/35 p-4 shadow-sm sm:p-6"
            >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 flex-1">
                        <h3 className="mb-1 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-600 dark:text-orange-400 sm:text-sm">
                            <Ticket size={18} aria-hidden /> Código promocional
                        </h3>
                        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                            Caixas, USDC ou outros prémios de campanha. Códigos da{' '}
                            <span className="font-bold text-slate-800 dark:text-slate-200">Roleta</span> abrem automaticamente no menu{' '}
                            <span className="font-bold text-rose-600 dark:text-rose-400">Roleta</span> — não precisa de os colar aqui.
                        </p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-stretch md:w-auto md:shrink-0">
                        <input
                            ref={promoInputRef}
                            type="text"
                            value={promoCode}
                            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                            placeholder="CÓDIGO"
                            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-4 py-2 font-mono text-sm font-bold tracking-widest text-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50 dark:border-slate-700 dark:bg-slate-950 dark:text-orange-400 sm:min-w-[12rem] md:w-56"
                        />
                        <button
                            type="button"
                            onClick={handleRedeem}
                            disabled={redeeming || !promoCode.trim()}
                            className="min-h-[44px] shrink-0 rounded-xl bg-orange-600 px-6 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-orange-600/25 transition hover:bg-orange-500 disabled:opacity-50"
                        >
                            {redeeming ? '…' : 'Resgatar'}
                        </button>
                    </div>
                </div>
            </div>

            <nav className="mb-6 flex flex-wrap gap-2" aria-label="Secções da loja de caixas">
                <button
                    type="button"
                    onClick={() => setActiveTab('inventario')}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-all ${
                        activeTab === 'inventario'
                            ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/25'
                            : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                >
                    <Package size={16} />
                    Meu inventário
                    {openableInventoryTotal > 0 ? (
                        <span className="ml-0.5 rounded-full bg-white/20 px-2 py-0.5 text-[10px] tabular-nums">{openableInventoryTotal}</span>
                    ) : null}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('loja')}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-all ${
                        activeTab === 'loja'
                            ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/25'
                            : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                >
                    <Store size={16} />
                    Loja
                </button>
            </nav>

            {activeTab === 'inventario' && (
                <div className="mb-8">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Package size={16} /> Inventário — abrir caixas ({openableInventoryTotal})
                    </h3>
                    {ownedBoxes.length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-6 py-14 text-center">
                            <p className="text-slate-700 dark:text-slate-300 font-medium mb-2">Você não tem caixas para abrir.</p>
                            <p className="mb-6 text-sm text-slate-500">Compre na loja ou use o código promocional acima.</p>
                            <div className="flex flex-wrap justify-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('loja')}
                                    className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-amber-600/20 transition hover:bg-amber-500 active:scale-95"
                                >
                                    Ir à loja
                                </button>
                            </div>
                        </div>
                    ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {ownedBoxes.map((box: any) => (
                            <div key={box.id} className="bg-white dark:bg-slate-900 border-2 border-orange-500/30 rounded-xl p-4 flex flex-col items-center text-center shadow-lg relative overflow-hidden group">
                                <div className="absolute inset-0 bg-orange-500/5 group-hover:bg-orange-500/10 transition-colors"></div>
                                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-3xl mb-3 shadow-inner relative z-10 overflow-hidden">
                                    {renderIcon(box.icon, "text-3xl", "w-10 h-10")}
                                </div>
                                <div className="font-bold text-slate-800 dark:text-white relative z-10">{box.name}</div>
                                {box.isRetiredCatalog && (
                                    <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1 relative z-10">
                                        Fora da loja — pode abrir normalmente
                                    </div>
                                )}
                                <div className="text-xs text-slate-500 mb-4 relative z-10">{box.description}</div>
                                <div className="w-full text-left relative z-10">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Conteúdo</div>
                                    <div className="space-y-1">
                                        {(box.items || []).map((it: any, idx: number) => {
                                            const isCurrency = it.type === 'currency';
                                            const isCoin = it.type === 'coin';
                                            const itemDef = !isCurrency && !isCoin ? upgrades.find(u => u.id === it.id) : null;
                                            const name = isCurrency ? 'USDC' : (isCoin ? it.id.toUpperCase() : (itemDef?.name || it.id));
                                            const icon = isCurrency ? '💵' : (isCoin ? '🪙' : (itemDef?.icon || '📦'));
                                            return (
                                                <div key={idx} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded p-2 text-[12px]">
                                                    <span className="text-base flex items-center justify-center w-5 h-5">{renderIcon(icon, "text-base", "w-4 h-4")}</span>
                                                    <span className="flex-1 text-slate-700 dark:text-slate-300">{name}</span>
                                                    <span className="font-mono text-slate-600 dark:text-slate-400">x{it.minQty}-{it.maxQty}</span>
                                                    <span className="text-yellow-600 dark:text-yellow-400 font-mono">{Math.round(it.probability)}%</span>
                                                </div>
                                            );
                                        })}
                                        {(box.items || []).length === 0 && (
                                            <div className="text-[12px] text-slate-500">
                                                {box.trigger === 'roleta_code'
                                                    ? 'O prémio é definido na roleta: use um código de resgate e gire antes de receber a caixa de prémio.'
                                                    : 'Sem itens definidos.'}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-3 py-1 rounded-full mb-3 relative z-10">
                                    Quantidade: {box.qty}
                                </div>
                                <div className="relative z-10 flex w-full flex-col gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleOpen(box.id)}
                                        disabled={openingBox !== null || discardingBox !== null}
                                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 py-2 font-bold text-white transition-all hover:bg-orange-500 active:scale-95 disabled:opacity-50"
                                    >
                                        {openingBox === box.id ? (
                                            <Sparkles className="animate-spin" size={16} />
                                        ) : (
                                            <Box size={16} />
                                        )}
                                        {openingBox === box.id ? 'ABRINDO...' : 'ABRIR AGORA'}
                                    </button>
                                    {onDiscardBox && (
                                        <button
                                            type="button"
                                            onClick={() => handleDiscardClick(box.id, box.name, box.qty)}
                                            disabled={openingBox !== null || discardingBox !== null}
                                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 py-2 text-xs font-bold uppercase tracking-wider text-red-600 transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50 dark:text-red-400"
                                        >
                                            {discardingBox === box.id ? (
                                                <Sparkles className="animate-spin" size={14} />
                                            ) : (
                                                <Trash2 size={14} />
                                            )}
                                            {discardingBox === box.id ? 'A descartar…' : 'Descartar'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    )}
                </div>
            )}

            {activeTab === 'loja' && (
            <div>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <DollarSign size={16} /> Loja de Caixas
                </h3>
                <p className="text-xs text-slate-500 mb-4 -mt-2">Só aparecem ofertas que você ainda pode comprar. Caixas que você já tem ficam em <span className="font-semibold text-slate-600 dark:text-slate-400">Meu inventário</span>.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {lojaBoxes.map(box => {
                        const availability = getBoxAvailability(box);
                        const canAfford = gameState.usdc >= box.price;
                        const canBuyNow = availability.canBuy && canAfford;
                        return (
                        <div key={box.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-500 dark:hover:border-amber-500 rounded-xl p-4 flex flex-col items-center text-center shadow-sm transition-all relative overflow-hidden group">
                            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-3xl mb-3 shadow-inner group-hover:scale-110 transition-transform overflow-hidden">
                                {renderIcon(box.icon || '📦', "text-3xl", "w-10 h-10")}
                            </div>
                            <div className="font-bold text-slate-800 dark:text-white">{displayLootBoxName(box.name)}</div>
                            <div className="text-xs text-slate-500 mb-3 h-8 line-clamp-2">{box.description}</div>
                            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
                                Gatilho: {box.trigger || 'sem gatilho'}
                            </div>
                            <div className="w-full text-left mb-3">
                                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Conteúdo</div>
                                <div className="space-y-1">
                                    {effectiveLootBoxItems(box, upgrades).map((it, idx) => {
                                        const isCurrency = it.type === 'currency';
                                        const itemDef = !isCurrency ? upgrades.find(u => u.id === it.id) : null;
                                        const name = isCurrency ? 'USDC' : (itemDef?.name || it.id);
                                        const icon = isCurrency ? '💵' : (itemDef?.icon || '📦');
                                        return (
                                            <div key={idx} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded p-2 text-[12px]">
                                                <span className="text-base flex items-center justify-center w-5 h-5">{renderIcon(icon, "text-base", "w-4 h-4")}</span>
                                                <span className="flex-1 text-slate-700 dark:text-slate-300">{name}</span>
                                                <span className="font-mono text-slate-600 dark:text-slate-400">x{it.minQty}-{it.maxQty}</span>
                                                <span className="text-yellow-600 dark:text-yellow-400 font-mono">{Math.round(it.probability)}%</span>
                                            </div>
                                        );
                                    })}
                                    {effectiveLootBoxItems(box, upgrades).length === 0 && (
                                        <div className="text-[12px] text-slate-500">
                                            {box.trigger === 'roleta_code'
                                                ? 'Prémio pela roleta após resgatar um código — não há lista fixa de itens.'
                                                : 'Sem itens definidos.'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="mt-auto w-full">
                                <button
                                    onClick={() => {
                                        if (availability.canBuy) onBuyBox(box.id);
                                    }}
                                    disabled={!canBuyNow}
                                    className={`
                                w-full py-2 rounded-lg font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-1
                                ${canBuyNow
                                            ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'}
                            `}
                                >
                                    {availability.label ? (
                                        <span className="flex items-center gap-1 uppercase tracking-wider">
                                            <Gift size={14} /> {availability.label}
                                        </span>
                                    ) : box.price <= 0 ? (
                                        <span className="flex items-center gap-1 uppercase tracking-wider">
                                            <Gift size={14} /> GRÁTIS
                                        </span>
                                    ) : (
                                        <>
                                            <DollarSign size={14} /> {formatCost(box.price)}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )})}
                    {lojaBoxes.length === 0 && (
                        <div className="col-span-full text-center py-12 text-slate-500 italic border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                            Nenhuma caixa disponível para compra no momento.
                        </div>
                    )}
                </div>
            </div>
            )}

            {/* REWARDS MODAL */}
            {rewards && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-slate-900 border border-orange-500 rounded-2xl shadow-[0_0_50px_rgba(194,65,12,0.3)] w-full max-w-md p-6 relative animate-in zoom-in-95 duration-300 flex flex-col items-center">
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-orange-600 text-white rounded-full p-4 shadow-lg border-4 border-slate-900 animate-bounce">
                            <Gift size={32} />
                        </div>

                        <h3 className="mt-6 text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-700 uppercase tracking-widest mb-2">
                            RECOMPENSAS!
                        </h3>
                        <p className="text-slate-500 text-sm mb-6">Você encontrou os seguintes itens:</p>

                        <div className="w-full space-y-3 mb-8">
                            {rewards.map((reward, idx) => {
                                const isCurrency = reward.type === 'currency';
                                const itemDef = !isCurrency ? upgrades.find(u => u.id === reward.id) : null;
                                const name = isCurrency ? 'USDC' : (itemDef?.name || reward.id);
                                const icon = isCurrency ? '💵' : (itemDef?.icon || '📦');

                                return (
                                    <div key={idx} className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-4 animate-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: `${idx * 100}ms` }}>
                                        <div className="text-2xl w-10 h-10 flex items-center justify-center">{renderIcon(icon, "text-2xl", "w-8 h-8")}</div>
                                        <div className="flex-1">
                                            <div className="font-bold text-slate-800 dark:text-white text-sm">{name}</div>
                                            <div className="text-xs text-slate-500 uppercase">{isCurrency ? 'Saldo' : itemDef?.category || 'Item'}</div>
                                        </div>
                                        <div className="font-mono font-bold text-green-600 dark:text-green-400">
                                            x{isCurrency && reward.id === 'usdc' ? formatCost(reward.qty) : reward.qty}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            onClick={handleCloseRewards}
                            className="bg-orange-600 hover:bg-orange-500 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform active:scale-95 flex items-center gap-2"
                        >
                            <CheckCircle2 size={18} /> COLETAR TUDO
                        </button>
                    </div>
                </div>
            )}

            <UiNoticeModal notice={notice} onClose={() => setNotice(null)} />
        </div>
    );
};
