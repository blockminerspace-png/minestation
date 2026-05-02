<<<<<<< Updated upstream
import React, { useState } from 'react';
import { GameState, LootBox, Upgrade } from '../types';
import { normalizePublicAssetUrl } from '../utils/publicUrl';
=======
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { GameState, LootBox, LootBoxItem, Upgrade } from '../types';
>>>>>>> Stashed changes
import { Gift, Package, Sparkles, DollarSign, Box, CheckCircle2, X, Ticket } from 'lucide-react';
import GameView from './roleta/GameView';

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

interface LuckyBoxStoreProps {
    gameState: GameState;
    lootBoxes: LootBox[];
    upgrades: Upgrade[];
    onBuyBox: (boxId: string) => void;
    onOpenBox: (boxId: string) => Promise<{ rewards: any[] } | null>;
    onRedeemSuccess?: (unopenedBoxes: Record<string, number>) => void;
}

export const LuckyBoxStore: React.FC<LuckyBoxStoreProps> = ({ gameState, lootBoxes, upgrades, onBuyBox, onOpenBox, onRedeemSuccess }) => {
    const promoInputRef = useRef<HTMLInputElement>(null);
    const redeemSectionRef = useRef<HTMLDivElement>(null);
    const [redeemHighlight, setRedeemHighlight] = useState(false);
    const [openingBox, setOpeningBox] = useState<string | null>(null);
    const [rewards, setRewards] = useState<any[] | null>(null);
    const [promoCode, setPromoCode] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [roletaCode, setRoletaCode] = useState<string | null>(null);

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

    const shopBoxes = lootBoxes.filter(b => b.isActive !== false);

    // Get boxes the player owns (from any source)
    const ownedBoxes = useMemo(() => (Object.entries(gameState.unopenedBoxes) as [string, number][])
        .filter(([_, qty]) => qty > 0)
        .map(([id, qty]) => {
            const def = lootBoxes.find(b => b.id === id);
            return {
                id,
                qty,
                name: displayLootBoxName(def?.name),
                description: def?.description || 'Recompensa obtida.',
                icon: def?.icon || '🎁',
<<<<<<< Updated upstream
                items: def?.items || [],
                /** Caixa retirada do catálogo público; inventário e abertura continuam válidos. */
                isRetiredCatalog: def?.isActive === false
=======
                trigger: def?.trigger,
                items: effectiveLootBoxItems(def, upgrades)
>>>>>>> Stashed changes
            };
        }), [gameState.unopenedBoxes, lootBoxes, upgrades]);

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
                    setRoletaCode(data.code);
                    setPromoCode('');
                } else {
                    alert('Código resgatado com sucesso!');
                    setPromoCode('');
                    if (onRedeemSuccess && data.unopenedBoxes) {
                        onRedeemSuccess(data.unopenedBoxes);
                    } else if (onRedeemSuccess) {
                        onRedeemSuccess({});
                    }
                }
            } else {
                alert(data.error || 'Erro ao resgatar código');
            }
        } catch (e) {
            alert('Falha na comunicação com o servidor');
        }
        setRedeeming(false);
    };

    const formatCost = (val: number) => {
        if (val < 0.01) return val.toFixed(8);
        return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
    };

    /** Leva ao bloco de código e destaca-o — a roleta só abre após RESGATAR com um código válido. */
    const goToRedeemCode = useCallback(() => {
        setRedeemHighlight(true);
        window.setTimeout(() => setRedeemHighlight(false), 3200);
        const run = () => {
            const section = redeemSectionRef.current ?? document.getElementById('lucky-store-redeem');
            const input = promoInputRef.current;
            if (section instanceof HTMLElement) {
                section.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            }
            input?.focus({ preventScroll: true });
        };
        requestAnimationFrame(() => {
            run();
            requestAnimationFrame(run);
        });
    }, []);

    return (
        <div className="flex flex-col p-6 animate-in fade-in slide-in-from-bottom-4 duration-300 relative">

            <div className="flex items-center gap-3 mb-8 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="bg-gradient-to-br from-amber-500 to-orange-700 p-2 rounded-lg text-white shadow-lg">
                    <Gift size={24} />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">Caixa da Sorte</h2>
                    <p className="text-sm text-slate-500">Tente a sorte e ganhe itens raros ou cripto.</p>
                </div>
            </div>

            {/* REDEEM CODE SECTION */}
            <div
                ref={redeemSectionRef}
                id="lucky-store-redeem"
                className={`mb-8 bg-gradient-to-r from-orange-900/10 to-amber-950/30 border rounded-2xl p-6 shadow-sm transition-shadow duration-300 ${
                    redeemHighlight
                        ? 'border-orange-500 ring-4 ring-orange-500/60 ring-offset-2 ring-offset-white dark:ring-offset-slate-950 shadow-lg shadow-orange-500/25'
                        : 'border-orange-500/20'
                }`}
            >
                <div className="flex flex-col md:flex-row md:items-center gap-6">
                    <div className="flex-1">
                        <h3 className="text-sm font-black text-orange-600 dark:text-orange-400 uppercase tracking-widest flex items-center gap-2 mb-1">
                            <Ticket size={18} /> Código de Resgate
                        </h3>
                        <p className="text-[11px] text-slate-500 uppercase font-bold tracking-tight">Utilize códigos promocionais para obter caixas exclusivas.</p>
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                        <input
                            ref={promoInputRef}
                            type="text"
                            value={promoCode}
                            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                            placeholder="DIGITE SEU CÓDIGO"
                            className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-4 py-2 text-sm font-mono font-bold tracking-widest text-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50 w-full md:w-64"
                        />
                        <button
                            onClick={handleRedeem}
                            disabled={redeeming || !promoCode.trim()}
                            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold px-6 py-2 rounded-xl text-xs uppercase tracking-widest transition-all shadow-lg shadow-orange-600/20 active:scale-95 whitespace-nowrap"
                        >
                            {redeeming ? '...' : 'RESGATAR'}
                        </button>
                    </div>
                </div>
            </div>

            {/* OWNED BOXES SECTION */}
            {ownedBoxes.length > 0 && (
                <div className="mb-8">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Package size={16} /> Suas Caixas ({ownedBoxes.reduce((a, b) => a + b.qty, 0)})
                    </h3>
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
                                {box.trigger === 'roleta_code' ? (
                                    <div className="w-full space-y-2 relative z-10">
                                        <button
                                            type="button"
                                            onClick={goToRedeemCode}
                                            className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2 border border-orange-500/40"
                                        >
                                            <Ticket size={16} /> IR AO CÓDIGO DE RESGATE
                                        </button>
                                        <p className="text-[10px] text-slate-500 leading-snug px-1">
                                            Cole o código no campo destacado acima e toque em <span className="font-bold text-orange-500">RESGATAR</span> — a roleta abre a seguir (não é este botão que a abre).
                                        </p>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => handleOpen(box.id)}
                                        disabled={openingBox !== null}
                                        className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2 relative z-10 disabled:opacity-50"
                                    >
                                        {openingBox === box.id ? <Sparkles className="animate-spin" size={16} /> : <Box size={16} />}
                                        {openingBox === box.id ? 'ABRINDO...' : 'ABRIR AGORA'}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* SHOP SECTION */}
            <div>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <DollarSign size={16} /> Loja de Caixas
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {shopBoxes.map(box => {
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
                    {shopBoxes.length === 0 && (
                        <div className="col-span-full text-center py-12 text-slate-500 italic border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                            Nenhuma caixa disponível para compra no momento.
                        </div>
                    )}
                </div>
            </div>

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

            {/* ROLETA MODAL */}
            {roletaCode && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-300 p-4 sm:p-6">
                    <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-orange-500/25 bg-slate-900/95 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_80px_rgba(0,0,0,0.65)] sm:max-w-2xl">
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-orange-500/10 via-transparent to-amber-950/20" aria-hidden />
                        <button
                            type="button"
                            onClick={() => setRoletaCode(null)}
                            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-600/80 bg-slate-800/90 text-slate-400 transition hover:border-slate-500 hover:bg-slate-700 hover:text-white"
                            aria-label="Fechar"
                        >
                            <X size={20} />
                        </button>
                        <div className="relative max-h-[min(92vh,52rem)] overflow-y-auto px-4 pb-8 pt-12 sm:px-8 sm:pb-10 sm:pt-14 custom-scrollbar">
                            <GameView
                                items={[]}
                                onBack={() => setRoletaCode(null)}
                                redeemCode={roletaCode}
                                upgrades={upgrades}
                                onRedeemComplete={() => {
                                    setRoletaCode(null);
                                    if (onRedeemSuccess) onRedeemSuccess({}); // Refresh inventory
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};
