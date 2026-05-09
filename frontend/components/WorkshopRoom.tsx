import React, { useState } from 'react';
import { Wrench, Plus, X, Box, Power, Cog, Terminal, Zap, RefreshCw, PlayCircle, History, AlertTriangle } from 'lucide-react';
import { Upgrade, SlotLayout, WorkshopStructure, StoredBattery } from '../types';
import { orphanCatalogUpgrade } from '../models/orphanCatalogItem';
import { resolveBatteryLayoutIndexForBatteryBar } from '../lib/workshopBatteryBarMap';
import { readWorkshopBatterySlotField } from '../lib/workshopBatterySlotStorageKey';
import { ChargingHistory } from './ChargingHistory';
import { batteryChargePercentDisplay, BATTERY_FULL_CHARGE_RATIO } from '../lib/batteryChargeUi';

/** `currentCharge` no armazém está em Wh — nunca usar como % directamente. */
function storedBatteryChargePercent(bat: StoredBattery, upg: Upgrade | null | undefined): number {
    const wh = Number(bat.currentCharge) || 0;
    const cap = upg?.powerCapacity;
    if (cap == null || cap === undefined) return Math.min(100, wh);
    return batteryChargePercentDisplay(wh, cap);
}

interface WorkshopRoomProps {
    slots: (WorkshopStructure | null)[];
    stock: Record<string, number>;
    upgrades: Upgrade[];
    storedBatteries: StoredBattery[];
    onEquip: (index: number, itemId: string) => void;
    onUnequip: (index: number) => void;
    onEquipComponent: (wsIdx: number, slotId: string, layoutSlotIndex: number, iid: string, sbid?: string) => void;
    onUnequipComponent: (wsIdx: number, slotId: string, layoutSlotIndex: number) => void;
    onInstantRecharge: (wsIdx: number) => void;
    onRewardedAd: (wsIdx: number) => void;
    onDailyBoost: (wsIdx: number) => void;
    timeOffset: number;
    dailyActions?: Record<string, number>;
}

export const WorkshopRoom: React.FC<WorkshopRoomProps> = ({
    slots,
    stock,
    upgrades,
    storedBatteries,
    onEquip,
    onUnequip,
    onEquipComponent,
    onUnequipComponent,
    onInstantRecharge,
    onRewardedAd,
    onDailyBoost,
    timeOffset,
    dailyActions
}) => {
    const [selectingIndex, setSelectingIndex] = useState<number | null>(null);
    const [selectingComponent, setSelectingComponent] = useState<{
        wsIdx: number;
        slotId: string;
        layoutSlotIndex: number;
        type: string;
    } | null>(null);
    const [detailContext, setDetailContext] = useState<{
        wsIdx: number;
        slotId: string;
        layoutSlotIndex: number;
        type: string;
        item: Upgrade;
        instanceId?: string;
        chargePercent?: number;
    } | null>(null);
    const [showHistory, setShowHistory] = useState(false);

    const formatProduction = (val: number) => {
        if (val === 0) return "0";
        if (val < 0.0001) return val.toFixed(8);
        return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(val);
    };

    const getSlotVal = (obj: any, sid: string) => {
        if (!obj || !sid) return null;
        if (obj[sid] !== undefined) return obj[sid];
        const entry = Object.entries(obj).find(([k]) => k.toLowerCase().trim() === sid.toLowerCase().trim());
        return entry ? entry[1] : null;
    };

    const availableItems = upgrades.filter(u =>
        (u.category === 'Oficina' || u.type === 'charger') && (stock[u.id] || 0) > 0
    );

    const isUsedToday = (key: string) => {
        const lastPerformedAt = dailyActions?.[key];
        if (!lastPerformedAt) return false;

        const serverNow = Date.now() + timeOffset;
        const now = new Date(serverNow);
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
        return lastPerformedAt >= startOfDay;
    };

    const activeBenches = slots.filter(Boolean).length;
    const activeBenchesLabel =
        activeBenches === 0
            ? 'Nenhuma bancada ativa'
            : activeBenches === 1
              ? '1 bancada ativa'
              : `${activeBenches} bancadas ativas`;

    return (
        <div className="flex flex-col gap-6">
            <style>
                {`
                    @keyframes super-pulse {
                        0%, 100% { opacity: 1; filter: brightness(1); }
                        50% { opacity: 0.6; filter: brightness(1.8) drop-shadow(0 0 8px currentColor); }
                    }
                    .animate-super-pulse {
                        animation: super-pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                    }
                `}
            </style>
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-4">
                <h3 className="text-slate-700 dark:text-slate-300 font-bold flex items-center gap-2">
                    <Wrench size={18} /> Oficina Genesis
                </h3>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowHistory(true)}
                        className="text-xs flex items-center gap-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 px-2 py-1 rounded text-slate-600 dark:text-slate-400 transition-colors"
                    >
                        <History size={14} /> Log de carga
                    </button>
                    <div className="text-xs text-slate-500 font-mono">
                        {activeBenchesLabel}
                    </div>
                </div>
            </div>

            {showHistory && <ChargingHistory onClose={() => setShowHistory(false)} />}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {slots.map((wsGroup, idx) => {
                    const item = wsGroup
                        ? upgrades.find((u) => u.id === wsGroup.itemId) ?? orphanCatalogUpgrade(String(wsGroup.itemId), 'charger')
                        : null;
                    const canUnequip = !item || item.type !== 'charger' || (wsGroup?.currentCharge ?? 0) <= 0.000001;
                    /** Chave estável por bancada — evita reaproveitar DOM entre carregadores ao mudar o estado. */
                    const benchReactKey = wsGroup?.id ? String(wsGroup.id) : `workshop-empty-${idx}`;

                    return (
                        <div key={benchReactKey} className={`relative aspect-square transition-all ${!item ? 'border-2 border-dashed border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 hover:border-amber-500/50 rounded-xl' : 'rounded-none'}`}>
                            {item ? (
                                <div className="w-full h-full flex flex-col items-center justify-center relative group">
                                    <button
                                        onClick={() => { if (canUnequip) onUnequip(idx); }}
                                        disabled={!canUnequip}
                                        className={`absolute top-2 right-2 p-1 text-white opacity-0 group-hover:opacity-100 transition-all z-40 bg-black/60 rounded-full ${canUnequip ? 'hover:bg-red-600' : 'cursor-not-allowed opacity-40'}`}
                                        title="Remover estrutura"
                                    >
                                        <X size={18} />
                                    </button>
                                    {item && wsGroup && item.image ? (
                                        <div className="w-full h-full relative group">
                                            <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                                            {item.layout && (
                                                <div className="absolute inset-0 z-10">
                                                    {item.layout.slots.map((slot, i) => {
                                                        // Índice no array incluído na key: vários slots podem repetir o mesmo `id`
                                                        // (ex.: várias `battery_bar` com id "battery_bar") e o React fundia nós → barras “sincronizadas”.
                                                        const slotKey = `${benchReactKey}-i${i}-t${slot.type}-${String(slot.id ?? 'slot')}`;
                                                        const layoutSlots = item.layout!.slots;
                                                        const batteryBarOrdinal = layoutSlots.slice(0, i).filter((s) => s.type === 'battery_bar').length;
                                                        const legacyId = String(slot.id || '');
                                                        const equippedId =
                                                            slot.type === 'battery'
                                                                ? readWorkshopBatterySlotField(
                                                                      wsGroup.internalSlots as Record<string, unknown>,
                                                                      layoutSlots,
                                                                      i
                                                                  )
                                                                : getSlotVal(wsGroup.internalSlots, slot.id);
                                                        const chargeWh =
                                                            slot.type === 'battery'
                                                                ? Number(
                                                                      readWorkshopBatterySlotField(
                                                                          wsGroup.slotCharges as Record<string, unknown>,
                                                                          layoutSlots,
                                                                          i
                                                                      )
                                                                  ) || 0
                                                                : Number(getSlotVal(wsGroup.slotCharges, slot.id)) || 0;

                                                        if (slot.type === 'charger_bar' || slot.type === 'battery_bar') {
                                                            const isCharger = slot.type === 'charger_bar';
                                                            const wiringSlot = item.layout?.slots.find(s => s.type === 'wiring');
                                                            const isWiringMissing = wiringSlot && !getSlotVal(wsGroup.internalSlots, wiringSlot.id);

                                                            if (isWiringMissing && isCharger) {
                                                                return (
                                                                    <div
                                                                        key={slotKey}
                                                                        className="absolute z-30 flex flex-col items-center justify-center bg-red-600/90 text-white rounded px-1 animate-pulse shadow-lg border border-red-400 overflow-hidden"
                                                                        style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                        title="Instale a fiação para liberar a carga"
                                                                    >
                                                                        <AlertTriangle size={slot.w > 15 ? 14 : 10} />
                                                                        {slot.w > 25 && <span className="text-[6px] font-bold uppercase">Sem fiação</span>}
                                                                    </div>
                                                                );
                                                            }
                                                            let percent = 0;
                                                            let isActivelyCharging = false;

                                                            if (isCharger) {
                                                                const capacity = item?.powerCapacity || 100;
                                                                percent = (wsGroup.currentCharge / capacity) * 100;

                                                                // Charger bar pulses if ANY battery is being charged
                                                                isActivelyCharging = wsGroup.currentCharge > 0.1 && (item.layout?.slots.some((s, li) => {
                                                                    if (s.type !== 'battery') return false;
                                                                    const bIid = readWorkshopBatterySlotField(
                                                                        wsGroup.internalSlots as Record<string, unknown>,
                                                                        layoutSlots,
                                                                        li
                                                                    );
                                                                    if (!bIid) return false;
                                                                    const bChargeVal =
                                                                        Number(
                                                                            readWorkshopBatterySlotField(
                                                                                wsGroup.slotCharges as Record<string, unknown>,
                                                                                layoutSlots,
                                                                                li
                                                                            )
                                                                        ) || 0;
                                                                    const bSId = readWorkshopBatterySlotField(
                                                                        wsGroup.slotItemIds as Record<string, unknown>,
                                                                        layoutSlots,
                                                                        li
                                                                    );
                                                                    let bD =
                                                                        (bSId ? upgrades.find((u) => u.id === bSId) : undefined) ??
                                                                        undefined;
                                                                    if (!bD) {
                                                                        const bI = storedBatteries.find((b) => b.id === bIid);
                                                                        if (bI)
                                                                            bD =
                                                                                upgrades.find((u) => u.id === bI.itemId) ??
                                                                                orphanCatalogUpgrade(String(bI.itemId || bI.id), 'battery');
                                                                    }
                                                                    if (!bD && bSId) bD = orphanCatalogUpgrade(String(bSId), 'battery');
                                                                    const bCap = bD?.powerCapacity || 100;
                                                                    return bCap === -1 ? false : bChargeVal < bCap * BATTERY_FULL_CHARGE_RATIO;
                                                                }) ?? false);
                                                            } else {
                                                                const mappedBatLayoutIndex = resolveBatteryLayoutIndexForBatteryBar(
                                                                    layoutSlots,
                                                                    slot,
                                                                    batteryBarOrdinal
                                                                );

                                                                if (mappedBatLayoutIndex != null) {
                                                                    const bChargeWh =
                                                                        Number(
                                                                            readWorkshopBatterySlotField(
                                                                                wsGroup.slotCharges as Record<string, unknown>,
                                                                                layoutSlots,
                                                                                mappedBatLayoutIndex
                                                                            )
                                                                        ) || 0;
                                                                    const bInstanceId = readWorkshopBatterySlotField(
                                                                        wsGroup.internalSlots as Record<string, unknown>,
                                                                        layoutSlots,
                                                                        mappedBatLayoutIndex
                                                                    );
                                                                    const savedItemId = readWorkshopBatterySlotField(
                                                                        wsGroup.slotItemIds as Record<string, unknown>,
                                                                        layoutSlots,
                                                                        mappedBatLayoutIndex
                                                                    );
                                                                    let bDef = savedItemId
                                                                        ? upgrades.find((u) => u.id === savedItemId) ?? undefined
                                                                        : undefined;
                                                                    if (!bDef && bInstanceId) {
                                                                        const batInst = storedBatteries.find((b) => b.id === bInstanceId);
                                                                        if (batInst)
                                                                            bDef =
                                                                                upgrades.find((u) => u.id === batInst.itemId) ??
                                                                                orphanCatalogUpgrade(String(batInst.itemId || batInst.id), 'battery');
                                                                    }
                                                                    if (!bDef && savedItemId)
                                                                        bDef = orphanCatalogUpgrade(String(savedItemId), 'battery');
                                                                    const bCapacity = bDef?.powerCapacity || 100;
                                                                    percent = batteryChargePercentDisplay(bChargeWh, bCapacity);
                                                                    isActivelyCharging =
                                                                        wsGroup.currentCharge > 0.1 &&
                                                                        (bCapacity === -1
                                                                            ? false
                                                                            : bChargeWh < bCapacity * BATTERY_FULL_CHARGE_RATIO);
                                                                }
                                                            }

                                                            // Pulse leve só no próprio segmento (Wh): antes usava currentCharge do carregador
                                                            // para todas as battery_bar → todas as barras verdes pulsavam em sincronia.
                                                            const gentlePulse = !isActivelyCharging && percent > 0.5 && percent < 99.5;

                                                            return (
                                                                <div
                                                                    key={slotKey}
                                                                    className="absolute z-20 bg-black/40 backdrop-blur-[2px] border border-white/10 rounded-full overflow-hidden p-0.5"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <div
                                                                        className={`h-full rounded-full transition-all duration-300 ${isCharger ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-green-500 shadow-[0_0_8px_#22c55e]'} ${isActivelyCharging ? 'animate-super-pulse' : gentlePulse ? 'animate-pulse opacity-80' : ''}`}
                                                                        style={{ width: `${Math.min(100, percent)}%`, color: isCharger ? '#f97316' : '#22c55e' }}
                                                                    />
                                                                </div>
                                                            );
                                                        }
                                                        if (slot.type === 'power') {
                                                            return (
                                                                <button
                                                                    key={slotKey}
                                                                    className="absolute overflow-hidden rounded-full flex items-center justify-center border-2 bg-green-500 border-green-400 text-white z-20 hover:scale-110 active:scale-95 transition-transform"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <Power size={slot.w > 10 ? 12 : 8} />
                                                                </button>
                                                            );
                                                        }
                                                        if (slot.type === 'config') {
                                                            return (
                                                                <button
                                                                    key={slotKey}
                                                                    className="absolute overflow-hidden rounded-full flex items-center justify-center border-2 border-slate-700 bg-slate-900 text-slate-300 z-20 hover:scale-110 active:scale-95 transition-transform"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <Cog size={slot.w > 10 ? 12 : 8} />
                                                                </button>
                                                            );
                                                        }
                                                        if (slot.type === 'machine' || slot.type === 'multiplier' || slot.type === 'battery' || slot.type === 'wiring') {
                                                            let contentItem: Upgrade | null = null;
                                                            let instanceId: string | undefined = undefined;

                                                            if (equippedId) {
                                                                const savedItemId =
                                                                    slot.type === 'battery'
                                                                        ? readWorkshopBatterySlotField(
                                                                              wsGroup.slotItemIds as Record<string, unknown>,
                                                                              layoutSlots,
                                                                              i
                                                                          )
                                                                        : getSlotVal(wsGroup.slotItemIds, slot.id);
                                                                const slotKind: Upgrade['type'] =
                                                                    slot.type === 'machine'
                                                                        ? 'machine'
                                                                        : slot.type === 'multiplier'
                                                                          ? 'multiplier'
                                                                          : slot.type === 'battery'
                                                                            ? 'battery'
                                                                            : 'wiring';
                                                                if (savedItemId) {
                                                                    contentItem =
                                                                        upgrades.find((u) => u.id === savedItemId) ?? null;
                                                                } else {
                                                                    contentItem = upgrades.find((u) => u.id === equippedId) ?? null;
                                                                }
                                                                if (!contentItem) {
                                                                    const batInstance = storedBatteries.find((b) => b.id === equippedId);
                                                                    if (batInstance) {
                                                                        contentItem =
                                                                            upgrades.find((u) => u.id === batInstance.itemId) ?? null;
                                                                        instanceId = batInstance.id;
                                                                    }
                                                                }
                                                                if (!contentItem) {
                                                                    const ref = savedItemId || equippedId;
                                                                    contentItem = orphanCatalogUpgrade(String(ref), slotKind);
                                                                }
                                                                if (equippedId.length > 20) instanceId = equippedId;
                                                            }

                                                            const isWiringCharging = slot.type === 'wiring' && equippedId && wsGroup.currentCharge > 0;

                                                            const handleClick = () => {
                                                                if (equippedId && contentItem) {
                                                                    let chargePercent = undefined;
                                                                    if (slot.type === 'battery') {
                                                                        const bChargeWh =
                                                                            Number(
                                                                                readWorkshopBatterySlotField(
                                                                                    wsGroup.slotCharges as Record<string, unknown>,
                                                                                    layoutSlots,
                                                                                    i
                                                                                )
                                                                            ) || 0;
                                                                        const bCapacity = contentItem.powerCapacity ?? 100;
                                                                        if (bCapacity === -1) {
                                                                            chargePercent = 100;
                                                                        } else if (bCapacity > 0) {
                                                                            chargePercent = batteryChargePercentDisplay(bChargeWh, bCapacity);
                                                                        } else {
                                                                            chargePercent = 0;
                                                                        }
                                                                    }
                                                                    setDetailContext({
                                                                        wsIdx: idx,
                                                                        slotId: slot.id,
                                                                        layoutSlotIndex: i,
                                                                        type: slot.type,
                                                                        item: contentItem,
                                                                        instanceId,
                                                                        chargePercent
                                                                    });
                                                                } else {
                                                                    setSelectingComponent({ wsIdx: idx, slotId: slot.id, layoutSlotIndex: i, type: slot.type });
                                                                }
                                                            };

                                                            return (
                                                                <button
                                                                    key={slotKey}
                                                                    onClick={handleClick}
                                                                    className={`absolute border border-dashed border-amber-500/30 bg-amber-500/5 rounded-sm z-30 flex items-center justify-center hover:bg-amber-500/20 transition-colors overflow-hidden ${equippedId ? 'border-none bg-transparent' : ''} ${isWiringCharging ? 'shadow-[0_0_15px_rgba(245,158,11,0.4)] brightness-125 animate-super-pulse' : ''}`}
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%`, color: '#06b6d4' }}
                                                                >
                                                                    {equippedId ? (
                                                                        contentItem?.image ? (
                                                                            <div className="relative w-full h-full">
                                                                                <img src={contentItem.image} alt={contentItem.name} className="w-full h-full object-contain" />
                                                                                {isWiringCharging && (
                                                                                    <div className="absolute inset-0 bg-amber-400/20 animate-pulse mix-blend-overlay pointer-events-none"></div>
                                                                                )}
                                                                            </div>
                                                                        ) : (
                                                                            <span className={`text-[10px] ${isWiringCharging ? 'animate-pulse text-amber-400' : ''}`}>{contentItem?.icon || '🔋'}</span>
                                                                        )
                                                                    ) : (
                                                                        <Plus size={slot.w > 10 ? 12 : 8} className="text-amber-500/50" />
                                                                    )}
                                                                </button>
                                                            );
                                                        }
                                                        if (slot.type === 'instant_recharge') {
                                                            const instantUsed = isUsedToday(`instant_recharge_slot_${idx}`);
                                                            return (
                                                                <button
                                                                    key={slotKey}
                                                                    disabled={instantUsed}
                                                                    onClick={() => onInstantRecharge(idx)}
                                                                    className={`absolute overflow-hidden rounded-full flex items-center justify-center border z-30 transition-transform shadow-[0_0_10px_rgba(245,158,11,0.3)] ${instantUsed
                                                                        ? 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed opacity-60 grayscale'
                                                                        : 'border-amber-500/50 bg-amber-950/80 text-amber-400 hover:scale-110 active:scale-95 hover:bg-amber-900'
                                                                        }`}
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                    title={instantUsed ? 'Limite diário de recarga instantânea (UTC) já usado nesta bancada.' : 'Recarga instantânea (1× por dia por bancada, UTC)'}
                                                                >
                                                                    <RefreshCw size={slot.w > 10 ? 12 : 8} className={instantUsed ? '' : 'animate-pulse'} />
                                                                </button>
                                                            );
                                                        }
                                                        if (slot.type === 'rewarded_ad') {
                                                            const used = isUsedToday(`reward_ad_slot_${idx}`);
                                                            return (
                                                                <button
                                                                    key={slotKey}
                                                                    disabled={used}
                                                                    onClick={() => onRewardedAd(idx)}
                                                                    className={`absolute overflow-hidden rounded-md flex items-center justify-center border z-30 transition-all shadow-[0_0_15px_rgba(34,197,94,0.4)] group ${used
                                                                        ? 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed opacity-60 grayscale'
                                                                        : 'border-green-500/50 bg-green-950/80 text-green-400 hover:scale-110 active:scale-95 hover:bg-green-900'
                                                                        }`}
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                    title={used ? "Limite diário atingido (ADS)" : "Assistir Anúncio (Recompensa 100%)"}
                                                                >
                                                                    <PlayCircle size={slot.w > 10 ? 16 : 10} className={used ? "" : "group-hover:text-white transition-colors"} />
                                                                </button>
                                                            );
                                                        }
                                                        if (slot.type === 'daily_boost') {
                                                            const used = isUsedToday(`daily_boost_slot_${idx}`);
                                                            return (
                                                                <button
                                                                    key={slotKey}
                                                                    disabled={used}
                                                                    onClick={() => onDailyBoost(idx)}
                                                                    className={`absolute overflow-hidden rounded-md flex items-center justify-center border z-30 transition-all shadow-[0_0_15px_rgba(245,158,11,0.4)] group ${used
                                                                        ? 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed opacity-60 grayscale'
                                                                        : 'border-amber-500/50 bg-amber-950/80 text-amber-400 hover:scale-110 active:scale-95 hover:bg-amber-900'
                                                                        }`}
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                    title={used ? "Ação Diária já realizada" : "Daily Boost (Refill 100%)"}
                                                                >
                                                                    <Zap size={slot.w > 10 ? 16 : 10} className={used ? "" : "group-hover:text-white transition-colors"} />
                                                                </button>
                                                            );
                                                        }
                                                        if (slot.type === 'stat_monitor') {
                                                            const attachedCount = Object.values(wsGroup.internalSlots).filter(v => v !== null).length;

                                                            const monSlots = item.layout?.slots || [];
                                                            const cellPercents: string[] = [];
                                                            for (let li = 0; li < monSlots.length; li++) {
                                                                const bs = monSlots[li];
                                                                if (bs.type !== 'battery') continue;
                                                                const iid = readWorkshopBatterySlotField(
                                                                    wsGroup.internalSlots as Record<string, unknown>,
                                                                    monSlots,
                                                                    li
                                                                );
                                                                if (!iid) {
                                                                    cellPercents.push('—');
                                                                    continue;
                                                                }
                                                                const savedItemId = readWorkshopBatterySlotField(
                                                                    wsGroup.slotItemIds as Record<string, unknown>,
                                                                    monSlots,
                                                                    li
                                                                );
                                                                let def = savedItemId
                                                                    ? upgrades.find((u) => u.id === savedItemId) ?? undefined
                                                                    : undefined;
                                                                if (!def) {
                                                                    const inst = storedBatteries.find((b) => b.id === iid);
                                                                    if (inst)
                                                                        def =
                                                                            upgrades.find((u) => u.id === inst.itemId) ??
                                                                            orphanCatalogUpgrade(String(inst.itemId || inst.id), 'battery');
                                                                }
                                                                if (!def && savedItemId)
                                                                    def = orphanCatalogUpgrade(String(savedItemId), 'battery');
                                                                if (!def && String(iid).trim())
                                                                    def = orphanCatalogUpgrade(String(iid), 'battery');
                                                                const cap = def?.powerCapacity;
                                                                const wh =
                                                                    Number(
                                                                        readWorkshopBatterySlotField(
                                                                            wsGroup.slotCharges as Record<string, unknown>,
                                                                            monSlots,
                                                                            li
                                                                        )
                                                                    ) || 0;
                                                                if (typeof cap === 'number' && cap > 0) {
                                                                    cellPercents.push(`${batteryChargePercentDisplay(wh, cap).toFixed(0)}%`);
                                                                } else if (cap === -1) {
                                                                    cellPercents.push('∞');
                                                                } else {
                                                                    cellPercents.push('—');
                                                                }
                                                            }
                                                            const cellsLabel = cellPercents.length > 0 ? cellPercents.join(' · ') : '—';
                                                            const internalCapacity = item?.powerCapacity || 100;
                                                            const isGlobalCharging =
                                                                wsGroup.currentCharge > 0.1 &&
                                                                monSlots.some((bs, li) => {
                                                                    if (bs.type !== 'battery') return false;
                                                                    const iid = readWorkshopBatterySlotField(
                                                                        wsGroup.internalSlots as Record<string, unknown>,
                                                                        monSlots,
                                                                        li
                                                                    );
                                                                    if (!iid) return false;
                                                                    const wh =
                                                                        Number(
                                                                            readWorkshopBatterySlotField(
                                                                                wsGroup.slotCharges as Record<string, unknown>,
                                                                                monSlots,
                                                                                li
                                                                            )
                                                                        ) || 0;
                                                                    const savedItemId = readWorkshopBatterySlotField(
                                                                        wsGroup.slotItemIds as Record<string, unknown>,
                                                                        monSlots,
                                                                        li
                                                                    );
                                                                    let def = savedItemId
                                                                        ? upgrades.find((u) => u.id === savedItemId)
                                                                        : undefined;
                                                                    if (!def) {
                                                                        const inst = storedBatteries.find((b) => b.id === iid);
                                                                        if (inst)
                                                                            def = upgrades.find((u) => u.id === inst.itemId) ?? undefined;
                                                                    }
                                                                    const cap = def?.powerCapacity ?? 100;
                                                                    return cap !== -1 && wh < cap * 0.999;
                                                                });

                                                            return (
                                                                <div
                                                                    key={slotKey}
                                                                    className="absolute z-20 bg-black/90 backdrop-blur-md rounded-none p-1 font-mono leading-tight flex flex-col justify-between shadow-2xl pointer-events-none"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <div className="flex justify-between items-center pb-0.5 mb-0.5">
                                                                        <div className="flex items-center gap-1">
                                                                            <Terminal size={10} className="text-amber-400 animate-pulse" />
                                                                            <span className="text-[7px] text-amber-400/80 uppercase tracking-widest font-black">CMD PANEL</span>
                                                                        </div>
                                                                        <div className="flex gap-0.5">
                                                                            <div className="w-1 h-1 rounded-full bg-amber-500/40"></div>
                                                                            <div className="w-1 h-1 rounded-full bg-amber-500/40"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[8px]">
                                                                        <div className="flex flex-col">
                                                                            <span className="text-slate-600 uppercase text-[6px] font-bold">Int_Pwr</span>
                                                                            <span className="text-orange-400 font-bold truncate">{wsGroup.currentCharge.toFixed(0)}/{internalCapacity} Wh</span>
                                                                        </div>
                                                                        <div className="flex flex-col">
                                                                            <span className="text-slate-600 uppercase text-[6px] font-bold">Attached</span>
                                                                            <span className="text-amber-400 font-bold truncate">{attachedCount} items</span>
                                                                        </div>
                                                                        <div className="flex flex-col min-w-0">
                                                                            <span className="text-slate-600 uppercase text-[6px] font-bold">Células</span>
                                                                            <span className="text-emerald-500 font-bold truncate" title="Carga por slot de bateria (ordem do layout)">
                                                                                {cellsLabel}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex flex-col">
                                                                            <span className="text-slate-600 uppercase text-[6px] font-bold">Status</span>
                                                                            <span className={`font-bold truncate ${isGlobalCharging ? 'text-amber-400 animate-super-pulse' : 'text-slate-500'}`}>
                                                                                {isGlobalCharging ? 'CHARGING' : 'IDLE'}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="mt-0.5 pt-0.5 border-t border-white/5 flex justify-between items-center">
                                                                        <div className="flex gap-0.5">
                                                                            {Array.from({ length: 4 }).map((_, ledIdx) => (
                                                                                <div key={`${slotKey}-dot-${ledIdx}`} className="w-1 h-0.5 rounded-full bg-amber-500/60 animate-pulse" style={{ animationDelay: `${ledIdx * 0.2}s` }}></div>
                                                                            ))}
                                                                        </div>
                                                                        <span className="text-[7px] font-bold tracking-tighter text-amber-600">STATION_READY</span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }
                                                        if (slot.type === 'production_display') {
                                                            return (
                                                                <div
                                                                    key={slotKey}
                                                                    className="absolute z-20 bg-black/60 backdrop-blur-sm border border-amber-500/30 rounded flex items-center justify-center p-0.5"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <span className="text-[8px] font-mono font-bold text-amber-400">100.0</span>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    ) : item ? (
                                        <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
                                            <div className="text-4xl mb-2">{item.icon}</div>
                                            <div className="text-xs font-bold text-slate-400 uppercase">{item.name}</div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <button
                                    onClick={() => setSelectingIndex(idx)}
                                    className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-amber-500 transition-colors group p-4"
                                >
                                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30 transition-colors">
                                        <Plus size={24} />
                                    </div>
                                    <span className="text-xs font-bold uppercase tracking-wider">Instalar Estrutura</span>
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Selection Modal */}
            {selectingIndex !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 uppercase">
                                <Box size={18} className="text-amber-600 dark:text-amber-400" />
                                ESTRUTURAS DE OFICINA
                            </h3>
                            <button onClick={() => setSelectingIndex(null)} className="text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {availableItems.length === 0 ? (
                                <div className="text-center py-8 text-slate-500 bg-slate-50 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg">
                                    <p>Nenhuma estrutura de oficina no estoque.</p>
                                    <p className="text-xs mt-1">Ative ou adquira itens da categoria Oficina no Genesis Supply.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {availableItems.map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => {
                                                onEquip(selectingIndex, item.id);
                                                setSelectingIndex(null);
                                            }}
                                            className="w-full flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-amber-500 transition-all text-left group"
                                        >
                                            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-white dark:bg-slate-950 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 group-hover:border-amber-500/50">
                                                {item.image ? (
                                                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="text-2xl">{item.icon}</div>
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{item.name}</div>
                                                <div className="text-xs text-slate-500 line-clamp-1">{item.description}</div>
                                            </div>
                                            <div className="bg-slate-100 dark:bg-slate-950 px-2 py-1 rounded text-xs font-mono text-amber-600 border border-slate-200 dark:border-slate-800">x{stock[item.id]}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Component Selection Modal */}
            {selectingComponent !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 uppercase">
                                <Zap size={18} className="text-orange-500" />
                                {selectingComponent.type === 'battery' ? 'SELECIONAR BATERIA' : 'SELECIONAR COMPONENTE'}
                            </h3>
                            <button onClick={() => setSelectingComponent(null)} className="text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {selectingComponent.type === 'battery' ? (
                                <div className="space-y-4">
                                    {/* Filtrar baterias que não estão cheias */}
                                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-100 dark:bg-slate-800 p-2 rounded">Baterias aguardando carga</div>
                                    {storedBatteries.filter(b => {
                                        if (b.workshopSlotIndex != null || b.workshopComponentSlotId != null) return false;
                                        const def =
                                            upgrades.find((u) => u.id === b.itemId) ??
                                            orphanCatalogUpgrade(String(b.itemId || b.id), 'battery');
                                        if (b.currentCharge >= (def?.powerCapacity || 100)) return false;
                                        const currentWS = slots[selectingComponent.wsIdx];
                                        if (currentWS && def?.compatibleRacks && def.compatibleRacks.length > 0) {
                                            return def.compatibleRacks.includes(currentWS.itemId);
                                        }
                                        return true; // Se não houver restrição, é compatível
                                    }).length === 0 ? (
                                        <div className="text-center py-8 text-slate-500 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-dashed border-slate-300 dark:border-slate-800">
                                            Nenhuma bateria compatível para carga.
                                        </div>
                                    ) : (
                                        storedBatteries.filter(b => {
                                            if (b.workshopSlotIndex != null || b.workshopComponentSlotId != null) return false;
                                            const def =
                                                upgrades.find((u) => u.id === b.itemId) ??
                                                orphanCatalogUpgrade(String(b.itemId || b.id), 'battery');
                                            if (b.currentCharge >= (def?.powerCapacity || 100)) return false;
                                            const currentWS = slots[selectingComponent.wsIdx];
                                            if (currentWS && def?.compatibleRacks && def.compatibleRacks.length > 0) {
                                                return def.compatibleRacks.includes(currentWS.itemId);
                                            }
                                            return true; // Se não houver restrição, é compatível
                                        }).map(bat => {
                                            const upg =
                                                upgrades.find((u) => u.id === bat.itemId) ??
                                                orphanCatalogUpgrade(String(bat.itemId || bat.id), 'battery');
                                            const chargePct = storedBatteryChargePercent(bat, upg);
                                            return (
                                                <button
                                                    key={bat.id}
                                                    onClick={() => {
                                                        onEquipComponent(
                                                            selectingComponent.wsIdx,
                                                            selectingComponent.slotId,
                                                            selectingComponent.layoutSlotIndex,
                                                            bat.itemId,
                                                            bat.id
                                                        );
                                                        setSelectingComponent(null);
                                                    }}
                                                    className="w-full flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-orange-500 transition-all text-left group"
                                                >
                                                    <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 group-hover:border-orange-500/30 overflow-hidden">
                                                        {upg?.image ? (
                                                            <img src={upg.image} alt={upg.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="text-2xl">{upg?.icon || '🔋'}</div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{upg?.name || 'Bateria'}</div>
                                                        <div className="w-full bg-slate-200 dark:bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden">
                                                            <div className="bg-orange-500 h-full rounded-full" style={{ width: `${chargePct}%` }}></div>
                                                        </div>
                                                    </div>
                                                    <div className="text-xs font-mono text-orange-600 font-bold">{chargePct.toFixed(1)}%</div>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {upgrades.filter(u => {
                                        if (u.type !== selectingComponent.type || (stock[u.id] || 0) <= 0) return false;
                                        const currentWS = slots[selectingComponent.wsIdx];
                                        if (currentWS && u.compatibleRacks && u.compatibleRacks.length > 0) {
                                            return u.compatibleRacks.includes(currentWS.itemId);
                                        }
                                        return true; // Se não houver restrição, é compatível
                                    }).map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => {
                                                onEquipComponent(
                                                    selectingComponent.wsIdx,
                                                    selectingComponent.slotId,
                                                    selectingComponent.layoutSlotIndex,
                                                    item.id
                                                );
                                                setSelectingComponent(null);
                                            }}
                                            className="w-full flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-amber-500 transition-all text-left"
                                        >
                                            <div className="w-12 h-12 flex items-center justify-center bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
                                                {item.image ? (
                                                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                                                ) : item.icon}
                                            </div>
                                            <div className="flex-1">
                                                <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{item.name}</div>
                                                <div className="text-xs text-slate-500">Disponível: {stock[item.id]}</div>
                                            </div>
                                            <div className="bg-slate-100 dark:bg-slate-950 px-2 py-1 rounded text-xs font-mono text-amber-600 border border-slate-200 dark:border-slate-800">x{stock[item.id]}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Detail Modal */}
            {detailContext && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                            <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider">
                                Detalhes do Componente
                            </h3>
                            <button onClick={() => setDetailContext(null)} className="text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center text-3xl shadow-inner">
                                    {detailContext.item.image ? (
                                        <img src={detailContext.item.image} alt={detailContext.item.name} className="w-full h-full object-cover" />
                                    ) : (
                                        detailContext.item.icon
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-800 dark:text-white text-base truncate">{detailContext.item.name}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 capitalize">{detailContext.type}</div>
                                </div>
                            </div>

                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                                {detailContext.item.description || "Sem descrição disponível."}
                            </p>

                            {detailContext.type === 'battery' && (detailContext.instanceId || detailContext.chargePercent !== undefined) && (
                                <div className="space-y-2">
                                    {(() => {
                                        const wsLive = slots[detailContext.wsIdx];
                                        const cap = detailContext.item.powerCapacity ?? 100;
                                        let detailPct: number;
                                        if (wsLive && detailContext.slotId) {
                                            const chDef =
                                                wsLive.itemId != null
                                                    ? upgrades.find((u) => u.id === wsLive.itemId) ?? null
                                                    : null;
                                            const dLay = chDef?.layout?.slots || [];
                                            const wh =
                                                Number(
                                                    readWorkshopBatterySlotField(
                                                        wsLive.slotCharges as Record<string, unknown>,
                                                        dLay,
                                                        detailContext.layoutSlotIndex
                                                    )
                                                ) || 0;
                                            if (cap === -1) {
                                                detailPct = 100;
                                            } else if (cap > 0) {
                                                detailPct = batteryChargePercentDisplay(wh, cap);
                                            } else {
                                                detailPct = 0;
                                            }
                                        } else {
                                            const sb = detailContext.instanceId
                                                ? storedBatteries.find((b) => b.id === detailContext.instanceId)
                                                : undefined;
                                            detailPct =
                                                detailContext.chargePercent !== undefined
                                                    ? detailContext.chargePercent
                                                    : sb
                                                      ? storedBatteryChargePercent(sb, detailContext.item)
                                                      : 0;
                                        }
                                        return (
                                            <>
                                                <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-tighter">
                                                    <span>Status da Carga</span>
                                                    <span className="text-orange-500 font-mono">{detailPct.toFixed(1)}%</span>
                                                </div>
                                                <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-950 rounded-full overflow-hidden border border-slate-300 dark:border-slate-800">
                                                    <div
                                                        className="h-full bg-orange-500 transition-all duration-500"
                                                        style={{ width: `${Math.min(100, detailPct)}%` }}
                                                    />
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2 pt-2">
                                {detailContext.item.powerCapacity && (
                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded border border-slate-100 dark:border-slate-700">
                                        <div className="text-[10px] text-slate-500 uppercase font-bold">Capacidade</div>
                                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{detailContext.item.powerCapacity} Wh</div>
                                    </div>
                                )}
                                {detailContext.item.baseProduction && (
                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded border border-slate-100 dark:border-slate-700">
                                        <div className="text-[10px] text-slate-500 uppercase font-bold">Produção</div>
                                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">+{detailContext.item.baseProduction} N/s</div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex gap-3">
                            <button
                                onClick={() => setDetailContext(null)}
                                className="px-4 py-2 text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                            >
                                Fechar
                            </button>
                            <button
                                onClick={() => {
                                    onUnequipComponent(detailContext.wsIdx, detailContext.slotId, detailContext.layoutSlotIndex);
                                    setDetailContext(null);
                                }}
                                className="flex-1 bg-red-600 hover:bg-red-500 text-white text-sm font-bold py-2 px-4 rounded-lg shadow-lg shadow-red-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                <X size={16} /> REMOVER
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
