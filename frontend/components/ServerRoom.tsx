import React, { useEffect, useState, useMemo } from 'react';
import { PlacedRack, StoredBattery, Upgrade, RigRoom } from '../types';
import { normalizePublicAssetUrl } from '../utils/publicUrl';
import { getMyRigRooms, purchaseRoomSlot } from '../services/api';
import { Server, XCircle, Zap, Power, Plus, Cog, X, Box, Save, Activity, Terminal, Calculator } from 'lucide-react';

interface ServerRoomProps {
    stock: Record<string, number>;
    storedBatteries: StoredBattery[];
    placedRacks: PlacedRack[];
    onPlaceRack: (rackTypeId: string, roomId: string, slotIndex: number) => void;
    onRemoveRack: (id: string) => void;
    onEquipMiner: (rackId: string, slotIndex: number, minerId: string) => void;
    onUnequipMiner: (rackId: string, slotIndex: number) => void;
    onEquipAux: (rackId: string, itemId: string, type: 'battery' | 'wiring' | 'multiplier', storedBatteryId?: string, slotIndex?: number) => void;
    onUnequipAux: (rackId: string, type: 'battery' | 'wiring' | 'multiplier', slotIndex?: number) => void;
    onTogglePower: (rackId: string) => void;
    onRecharge: (rackId: string) => void;
    upgrades: Upgrade[];
    miningCoins?: { id: string; name: string; isActive: boolean }[];
    onSetRackCoin?: (rackId: string, coinId: string) => void;
    userEmail?: string;
    onRoomPurchase?: (newUsdc: number) => void;
    onOpenCalculator?: () => void;
}

interface SelectionContext {
    rackId: string | null;
    slotIndex: number | null;
    type: 'machine' | 'battery' | 'wiring' | 'multiplier' | 'rack';
    roomId?: string | null;
}

const AnimatedMiner = ({ src, isOperational, className, style, item }: { src: string, isOperational: boolean, className: string, style: any, item: Upgrade | undefined }) => {
    const [staticImage, setStaticImage] = useState<string | null>(null);

    useEffect(() => {
        if (!isOperational && src && !staticImage) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    try {
                        setStaticImage(canvas.toDataURL());
                    } catch (e) {
                        console.error("Failed to freeze GIF:", e);
                    }
                }
            };
            img.src = src;
        } else if (isOperational && staticImage) {
            setStaticImage(null);
        }
    }, [isOperational, src, staticImage]);

    const finalStyle = {
        ...style,
        backgroundImage: (item && src) ? `url(${JSON.stringify(!isOperational && staticImage ? staticImage : src)})` : 'none',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat'
    };

    return <div className={className} style={finalStyle} />;
};

export const ServerRoom: React.FC<ServerRoomProps> = ({
    stock,
    storedBatteries,
    placedRacks,
    onPlaceRack,
    onRemoveRack,
    onEquipMiner,
    onUnequipMiner,
    onEquipAux,
    onUnequipAux,
    onTogglePower,
    onRecharge,
    upgrades,
    miningCoins = [],
    onSetRackCoin,
    userEmail,
    onRoomPurchase,
    onOpenCalculator
}) => {
    const [selectionContext, setSelectionContext] = useState<SelectionContext | null>(null);
    const [detailContext, setDetailContext] = useState<{ rackId: string; slotIndex: number | null; type: 'machine' | 'battery' | 'wiring' | 'multiplier'; item: Upgrade } | null>(null);
    const [configRackId, setConfigRackId] = useState<string | null>(null);
    const [myRooms, setMyRooms] = useState<RigRoom[]>([]);
    const [roomsLoading, setRoomsLoading] = useState(false);
    const [purchaseBusyId, setPurchaseBusyId] = useState<string | null>(null);
    const [roomIndex, setRoomIndex] = useState(0);

    const rackLayoutSignature = useMemo(
        () => placedRacks.map((r) => `${r.id}:${r.roomId ?? ''}:${r.slotIndex ?? 0}`).sort().join('|'),
        [placedRacks]
    );

    useEffect(() => {
        if (!userEmail) return;
        let cancelled = false;
        (async () => {
            setRoomsLoading(true);
            try {
                const rooms = await getMyRigRooms(userEmail);
                if (!cancelled) setMyRooms(rooms);
            } finally {
                if (!cancelled) setRoomsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [userEmail, rackLayoutSignature]);

    useEffect(() => {
        if (myRooms.length === 0) {
            setRoomIndex(0);
            return;
        }
        setRoomIndex((i) => Math.min(Math.max(0, i), myRooms.length - 1));
    }, [myRooms]);

    const currentRoom = myRooms.length > 0 ? myRooms[Math.min(roomIndex, myRooms.length - 1)] : null;

    const calculateRackConsumption = (rack: PlacedRack, upgrades: Upgrade[]) => {
        const slotsWatts = (rack.slots || []).reduce((acc, sid) => {
            const m = upgrades.find(u => u.id === sid);
            return acc + (m?.powerConsumption || 0);
        }, 0);
        const multWatts = (rack.multiplierSlots || []).reduce((acc, sid) => {
            const m = upgrades.find(u => u.id === sid);
            return acc + (m?.powerConsumption || 0);
        }, 0);

        let total = slotsWatts + multWatts;

        if (rack.wiringId) {
            const wiring = upgrades.find(u => u.id === rack.wiringId);
            if (wiring && wiring.energyConsumptionReduction) {
                total = total * (1 - wiring.energyConsumptionReduction);
            }
        }
        return total;
    };

    const calculateProduction = (racks: PlacedRack[], upgrades: Upgrade[]) => {
        let total = 0;
        racks.forEach(rack => {
            const battery = upgrades.find(u => u.id === rack.batteryId);
            const isInfinite = battery && battery.powerCapacity === -1;
            const isOperational = rack.isOn && rack.wiringId && rack.batteryId && (isInfinite || rack.currentCharge > 0);

            if (isOperational) {
                const baseProd = rack.slots.reduce((acc, sid) => {
                    const m = upgrades.find(u => u.id === sid);
                    return acc + (m?.baseProduction || 0);
                }, 0);
                let mult = 1;
                if (rack.multiplierSlots) {
                    rack.multiplierSlots.forEach(sid => {
                        const m = upgrades.find(u => u.id === sid);
                        if (m && m.multiplier) mult += m.multiplier;
                    });
                }
                total += baseProd * mult;
            }
        });
        return total;
    };

    const currentRoomRacks = useMemo(() => {
        if (!currentRoom) return [];
        return placedRacks.filter(r => r.roomId === currentRoom.id);
    }, [placedRacks, currentRoom]);

    const roomTotalProduction = useMemo(() => {
        return calculateProduction(currentRoomRacks, upgrades);
    }, [currentRoomRacks, upgrades]);

    const roomPlacedCount = currentRoomRacks.length;
    const roomCapacity = currentRoom ? (currentRoom.initialCapacity + (currentRoom.unlockedSlots || 0)) : 0;
    const nextSlotPrice = currentRoom ? currentRoom.baseSlotPrice * Math.pow(1 + currentRoom.slotPriceIncreasePercent / 100, currentRoom.unlockedSlots || 0) : 0;

    const handlePurchaseSlot = async (roomId: string) => {
        if (!userEmail) return;
        if (purchaseBusyId) return;
        setPurchaseBusyId(roomId);
        const resp = await purchaseRoomSlot(userEmail, roomId);
        if (!resp.ok) {
            if (resp.error === 'Insufficient USDC') alert(`Saldo insuficiente`);
            else if (resp.error === 'Level not allowed') alert('Seu nível não tem permissão para comprar esta sala.');
            else if (resp.error === 'Already owned') alert('Você já possui esta sala.');
            else alert('Falha na compra');
            setPurchaseBusyId(null);
            return;
        }
        if (typeof resp.newUsdc === 'number' && onRoomPurchase) onRoomPurchase(resp.newUsdc);
        if (userEmail) {
            const rooms = await getMyRigRooms(userEmail);
            setMyRooms(rooms);
        }
        setPurchaseBusyId(null);
    };

    const availableRacks = upgrades.filter(u => u.type === 'infrastructure' && (stock[u.id] || 0) > 0);

    const getDefaultLayout = (rackDef: Upgrade): { slots: any[], canvasWidth: number, canvasHeight: number } => {
        const slots: any[] = [];
        const slotCount = rackDef.slotsCapacity || 0;
        for (let i = 0; i < slotCount; i++) {
            const col = i % 3;
            const row = Math.floor(i / 3);
            slots.push({ id: `slot_${i}`, type: 'machine', x: 5 + (col * 31), y: 10 + (row * 15), w: 28, h: 12 });
        }
        slots.push({ id: 'battery', type: 'battery', x: 75, y: 70, w: 20, h: 8 });
        slots.push({ id: 'wiring', type: 'wiring', x: 75, y: 80, w: 20, h: 8 });
        const aiCount = rackDef.aiSlotsCapacity || 0;
        for (let i = 0; i < aiCount; i++) {
            slots.push({ id: `slot_${i}`, type: 'multiplier', x: 75, y: 10 + (i * 10), w: 20, h: 8 });
        }
        slots.push({ id: 'power', type: 'power', x: 10, y: 85, w: 12, h: 10 });
        slots.push({ id: 'config', type: 'config', x: 25, y: 85, w: 12, h: 10 });
        slots.push({ id: 'coin_selector', type: 'coin_selector', x: 40, y: 85, w: 30, h: 10 });
        return { slots, canvasWidth: 500, canvasHeight: 600 };
    };

    const handleSlotClick = (rackId: string | null, slotIndex: number, currentItemId: string | null, isRoomSlot: boolean = false) => {
        if (isRoomSlot) {
            if (!currentItemId) {
                setSelectionContext({ rackId: null, slotIndex, type: 'rack', roomId: currentRoom?.id });
            }
            return;
        }
        if (!rackId) return;
        if (currentItemId) {
            const item = upgrades.find(u => u.id === currentItemId);
            if (item) setDetailContext({ rackId, slotIndex, type: 'machine', item });
        } else {
            setSelectionContext({ rackId, slotIndex, type: 'machine' });
        }
    };

    const handleAuxClick = (rackId: string, currentItemId: string | null, type: 'battery' | 'wiring' | 'multiplier', slotIndex?: number) => {
        if (currentItemId) {
            const item = upgrades.find(u => u.id === currentItemId);
            if (item) setDetailContext({ rackId, slotIndex: slotIndex ?? null, type, item });
        } else {
            setSelectionContext({ rackId, slotIndex: slotIndex ?? null, type });
        }
    };

    const handleItemSelect = (itemId: string, storedBatteryId?: string) => {
        if (!selectionContext) return;
        const { rackId, slotIndex, type, roomId } = selectionContext;
        if (type === 'rack') {
            if (roomId && slotIndex !== null) onPlaceRack(itemId, roomId, slotIndex);
        } else if (rackId) {
            if (type === 'machine' && slotIndex !== null) onEquipMiner(rackId, slotIndex, itemId);
            else onEquipAux(rackId, itemId, type as 'battery' | 'wiring' | 'multiplier', storedBatteryId, slotIndex ?? undefined);
        }
        setSelectionContext(null);
    };

    const getAvailableItems = () => {
        if (!selectionContext) return [];
        if (selectionContext.type === 'rack') return upgrades.filter(u => u.type === 'infrastructure' && (stock[u.id] || 0) > 0);
        let filtered = upgrades.filter(u => u.type === selectionContext.type && (stock[u.id] || 0) > 0);
        const currentRack = placedRacks.find(r => r.id === selectionContext.rackId);
        if (currentRack) {
            filtered = filtered.filter(u => {
                if (u.compatibleRacks && u.compatibleRacks.length > 0) return u.compatibleRacks.includes(currentRack.itemId);
                return true;
            });
        }
        return filtered;
    };

    const getAvailableStoredBatteries = () => {
        if (!selectionContext || selectionContext.type !== 'battery') return [];
        const currentRack = placedRacks.find(r => r.id === selectionContext.rackId);
        return storedBatteries.filter(sb => {
            const def = upgrades.find(u => u.id === sb.itemId);
            if (currentRack && def && def.compatibleRacks && def.compatibleRacks.length > 0) return def.compatibleRacks.includes(currentRack.itemId);
            return true;
        });
    }

    const formatProduction = (val: number) => {
        if (val === 0) return "0";
        if (val < 0.0001) return val.toFixed(8);
        return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(val);
    }

    return (
        <div className="flex flex-col gap-6 relative">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="flex flex-col gap-1">
                    <h3 className="text-slate-700 dark:text-slate-300 font-bold flex items-center gap-2">
                        <Server size={18} /> {currentRoom?.name || 'SALA DE RIGS DE MINERAÇÃO'}
                    </h3>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full text-[10px] font-bold border border-amber-500/20">
                            <Activity size={10} />
                            {formatProduction(roomTotalProduction)} H/s
                        </div>
                        {onOpenCalculator && (
                            <button
                                onClick={onOpenCalculator}
                                className="flex items-center gap-1.5 bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded-full text-[10px] font-bold border border-orange-500/20 hover:bg-orange-500/20 transition-colors"
                            >
                                <Calculator size={10} /> Calculadora
                            </button>
                        )}
                        <div className="text-[10px] text-slate-500 font-mono">
                            Capacidade: {roomPlacedCount} / {roomCapacity} Rigs {currentRoom && roomCapacity < currentRoom.maxCapacity && `(Max: ${currentRoom.maxCapacity})`}
                        </div>
                    </div>
                </div>
            </div>

            {
                userEmail && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                            <div className="text-xs text-slate-500 dark:text-slate-400">Salas de Mineração</div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setRoomIndex(i => Math.max(0, i - 1))} className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-300 hover:text-white">Anterior</button>
                                <div className="text-[10px] text-slate-400">{myRooms.length > 0 ? `${roomIndex + 1} / ${myRooms.length}` : '0 / 0'}</div>
                                <button onClick={() => setRoomIndex(i => Math.min(Math.max(0, myRooms.length - 1), i + 1))} className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-300 hover:text-white">Próxima</button>
                            </div>
                        </div>
                        {roomsLoading ? (
                            <div className="text-xs text-slate-500">Carregando...</div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                                {myRooms.map((room, idx) => {
                                    const cap = room.initialCapacity + (room.unlockedSlots || 0);
                                    const nextPrice = room.baseSlotPrice * Math.pow(1 + room.slotPriceIncreasePercent / 100, room.unlockedSlots || 0);
                                    return (
                                        <div key={room.id} className={`p-3 rounded border ${roomIndex === idx ? 'border-amber-700 bg-amber-900/10 shadow-[0_0_15px_rgba(245,158,11,0.1)]' : 'border-slate-800 bg-slate-900/40'}`}>
                                            <div className="flex justify-between items-center">
                                                <button onClick={() => setRoomIndex(idx)} className="font-bold text-slate-200 text-sm text-left hover:text-amber-400 transition-colors uppercase tracking-wider">{room.name}</button>
                                            </div>
                                            <div className="text-[10px] text-slate-500 mt-1 font-mono uppercase">Slots: {cap} / {room.maxCapacity}</div>
                                            {cap < room.maxCapacity && (
                                                <div className="mt-3 flex justify-between items-center pt-2 border-t border-white/5">
                                                    <div className="text-[10px] text-amber-400 font-bold">USDC {nextPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handlePurchaseSlot(room.id); }}
                                                        disabled={!!purchaseBusyId}
                                                        className={`text-[9px] font-black px-2 py-1 rounded transition-all uppercase ${purchaseBusyId ? 'bg-slate-700 text-slate-500' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500 hover:text-white'}`}
                                                    >
                                                        {purchaseBusyId ? 'Processando' : 'Novo Slot'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {myRooms.length === 0 && <div className="text-xs text-slate-500">Nenhuma sala configurada.</div>}
                            </div>
                        )}
                    </div>
                )
            }

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12 justify-items-center p-4">
                {Array.from({ length: roomCapacity }).map((_, slotIdx) => {
                    const rack = currentRoomRacks.find(r => r.slotIndex === slotIdx);

                    if (!rack) {
                        return (
                            <div
                                key={`empty-${slotIdx}`}
                                className="flex flex-col animate-in fade-in zoom-in duration-500 w-full"
                                style={{
                                    maxWidth: '500px',
                                    aspectRatio: '1 / 1'
                                }}
                            >
                                <button
                                    onClick={() => handleSlotClick(null, slotIdx, null, true)}
                                    className="flex-1 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/5 hover:border-amber-400 dark:hover:border-amber-800/50 transition-all flex flex-col items-center justify-center gap-4 group p-8"
                                >
                                    <div className="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800 group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30 flex items-center justify-center transition-all group-hover:scale-110 shadow-inner">
                                        <Plus size={40} className="text-slate-400 dark:text-slate-600 group-hover:text-amber-600 dark:group-hover:text-amber-400" />
                                    </div>
                                    <div className="text-center">
                                        <div className="font-extrabold text-slate-400 dark:text-slate-500 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors uppercase tracking-[0.2em] text-[10px]">Slot de Estrutura {slotIdx + 1}</div>
                                        <div className="text-[10px] text-slate-400 dark:text-slate-600 mt-2 font-mono uppercase opacity-60">Vazio - Clique para Instalar</div>
                                    </div>
                                </button>
                            </div>
                        );
                    }

                    // RACK EXISTE NO SLOT
                    const rackDef = upgrades.find(u => u.id === rack.itemId);
                    const rackSkin = normalizePublicAssetUrl(rackDef?.image);

                    const totalWatts = calculateRackConsumption(rack, upgrades);
                    const finalProd = calculateProduction([rack], upgrades);

                    const battery = upgrades.find(u => u.id === rack.batteryId);
                    const isInfinite = battery && battery.powerCapacity === -1;
                    const chargePercent = battery && battery.powerCapacity && !isInfinite
                        ? (rack.currentCharge / battery.powerCapacity) * 100
                        : (isInfinite ? 100 : 0);

                    const isOperational = rack.isOn && rack.wiringId && rack.batteryId && (isInfinite || rack.currentCharge > 0);

                    const layoutToUse = rackDef?.layout || (rackDef ? getDefaultLayout(rackDef) : { canvasWidth: 500, canvasHeight: 600 });
                    const canvasW = layoutToUse.canvasWidth || 500;
                    const canvasH = layoutToUse.canvasHeight || 600;

                    return (
                        <div key={rack.id} className="flex flex-col animate-in fade-in zoom-in duration-500 w-full"
                            style={{
                                maxWidth: `${canvasW}px`,
                                aspectRatio: `${canvasW} / ${canvasH}`
                            }}
                        >
                            <div
                                className={`flex-1 relative flex flex-col transition-all duration-500
                                    ${isOperational ? '' : 'grayscale-[0.3] brightness-90'}
                                    ${rackSkin ? '' : 'bg-slate-800 dark:bg-slate-900 border border-white/5 rounded-none'}
                                `}
                                style={{
                                    ...(rackSkin ? {
                                        backgroundImage: `url(${JSON.stringify(rackSkin)})`,
                                        backgroundSize: '100% 100%',
                                        backgroundRepeat: 'no-repeat',
                                        border: 'none',
                                    } : {}),
                                    ...(canvasW && canvasH ? {
                                        aspectRatio: `${canvasW} / ${canvasH}`,
                                        width: '100%',
                                    } : {
                                        minHeight: '500px',
                                        aspectRatio: '400 / 285'
                                    })
                                }}
                            >
                                <div className="relative w-full h-full flex-1">
                                    {(() => {
                                        const layoutToUse = rackDef?.layout || (rackDef ? getDefaultLayout(rackDef) : null);
                                        if (!layoutToUse) return null;

                                        return (
                                            <>
                                                <div className="absolute top-0 right-0 p-2 z-20">
                                                    <button
                                                        onClick={() => onRemoveRack(rack.id)}
                                                        className="text-white/40 hover:text-red-500 transition-all hover:scale-110 active:scale-95 bg-black/20 rounded-full p-1 backdrop-blur-sm"
                                                    >
                                                        <XCircle size={18} />
                                                    </button>
                                                </div>

                                                <div className="absolute inset-0 z-10 p-2">
                                                    {layoutToUse.slots.map((slot, i) => {
                                                        const idx = parseInt(slot.id.split('_')[1]);
                                                        const slotContent = slot.type === 'machine' ? rack.slots[idx] :
                                                            slot.type === 'multiplier' ? rack.multiplierSlots[idx] :
                                                                slot.type === 'wiring' ? rack.wiringId :
                                                                    slot.type === 'battery' ? rack.batteryId : null;

                                                        const item = slotContent ? upgrades.find(u => u.id === slotContent) : null;
                                                        const itemImg = normalizePublicAssetUrl(item?.image);

                                                        const handleClick = () => {
                                                            if (slot.type === 'machine') handleSlotClick(rack.id, idx, slotContent);
                                                            else if (slot.type === 'multiplier') handleAuxClick(rack.id, slotContent, 'multiplier', idx);
                                                            else if (slot.type === 'wiring') handleAuxClick(rack.id, rack.wiringId, 'wiring');
                                                            else if (slot.type === 'battery') handleAuxClick(rack.id, rack.batteryId, 'battery');
                                                        };

                                                        if (slot.type === 'power') {
                                                            const selectedCoin = miningCoins?.find(c => c.id === rack.selectedCoinId);
                                                            const missing = [];
                                                            if (!rack.selectedCoinId) missing.push("Moeda");
                                                            else if (selectedCoin && !selectedCoin.isActive) missing.push("Moeda Suspensa");

                                                            if (!rack.batteryId) missing.push("Bateria");
                                                            if (!rack.wiringId) missing.push("Circuito");
                                                            if (!rack.slots.some(s => s !== null)) missing.push("GPU");
                                                            const isReady = missing.length === 0;

                                                            return (
                                                                <button
                                                                    key={i}
                                                                    onClick={(e) => { e.stopPropagation(); onTogglePower(rack.id); }}
                                                                    title={!rack.isOn && !isReady ? `Faltando: ${missing.join(", ")}` : (rack.isOn ? "Power Off" : "Power On")}
                                                                    className={`absolute overflow-hidden rounded-full flex items-center justify-center border-2 shadow-2xl active:scale-90 transition-all z-20 group
                                                                        ${rack.isOn
                                                                            ? 'bg-green-500 border-green-300 text-white shadow-green-500/40'
                                                                            : (isReady
                                                                                ? 'bg-slate-800 border-slate-600 text-slate-400 hover:text-white hover:border-slate-400'
                                                                                : 'bg-red-950/60 border-red-700/50 text-red-500 animate-pulse')}
                                                                    `}
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <Power size={slot.w > 10 ? 16 : 12} className={!rack.isOn && !isReady ? "opacity-30" : "drop-shadow-sm"} />
                                                                </button>
                                                            );
                                                        }

                                                        if (slot.type === 'config') {
                                                            return (
                                                                <button
                                                                    key={i}
                                                                    onClick={(e) => { e.stopPropagation(); setConfigRackId(rack.id); }}
                                                                    className="absolute overflow-hidden rounded-full flex items-center justify-center border-2 border-slate-700 bg-slate-900/80 backdrop-blur-sm text-slate-300 hover:bg-slate-800 hover:text-white hover:border-slate-500 active:scale-90 transition-all z-20"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <Cog size={slot.w > 10 ? 16 : 12} />
                                                                </button>
                                                            );
                                                        }

                                                        if (slot.type === 'coin_selector') {
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    className={`absolute z-20 bg-black/80 backdrop-blur-md border rounded-md overflow-hidden transition-all duration-300 ${!rack.selectedCoinId ? 'border-amber-500/50 animate-pulse' : 'border-white/10 hover:border-white/20'}`}
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <select
                                                                        value={rack.selectedCoinId || ''}
                                                                        onChange={e => { e.stopPropagation(); onSetRackCoin && onSetRackCoin(rack.id, e.target.value); }}
                                                                        className={`w-full h-full bg-transparent border-none text-[9px] appearance-none text-center outline-none cursor-pointer p-0 font-black tracking-tighter ${!rack.selectedCoinId ? 'text-amber-500' : 'text-amber-400'}`}
                                                                    >
                                                                        <option value="" className="bg-slate-900">SEL_COIN</option>
                                                                        {(miningCoins || []).map(c => (
                                                                            <option key={c.id} value={c.id} disabled={!c.isActive} className="bg-slate-900">{c.name}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            );
                                                        }

                                                        if (slot.type === 'battery_bar') {
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    className="absolute z-20 bg-black/40 backdrop-blur-[2px] border border-white/10 rounded-full overflow-hidden p-0.5 shadow-inner"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <div
                                                                        className={`h-full rounded-full transition-all duration-500 ${isInfinite ? 'bg-amber-400 shadow-[0_0_10px_#f59e0b]' : (chargePercent < 20 ? 'bg-red-500' : 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.3)]')} ${isOperational && chargePercent < 99.9 ? 'animate-super-pulse' : (rack.isOn ? 'animate-pulse opacity-80' : '')}`}
                                                                        style={{ width: `${Math.min(100, chargePercent)}%` }}
                                                                    ></div>
                                                                </div>
                                                            );
                                                        }

                                                        if (slot.type === 'stat_monitor') {
                                                            const selectedCoin = miningCoins?.find(c => c.id === rack.selectedCoinId);
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    className="absolute z-20 bg-black/95 backdrop-blur-xl rounded-none p-2 font-mono leading-tight flex flex-col justify-between shadow-2xl"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <div className="flex justify-between items-center pb-1 mb-1 relative">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <Terminal size={10} className="text-amber-400 animate-pulse" />
                                                                            <span className="text-[7px] text-amber-400/80 uppercase tracking-[0.2em] font-black">
                                                                                CMD PANEL
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex gap-1">
                                                                            <div className={`w-1 h-1 rounded-full ${isOperational ? 'bg-green-500 shadow-[0_0_4px_#22c55e]' : 'bg-red-500'}`}></div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[8px]">
                                                                        <div className="flex flex-col">
                                                                            <span className="text-white/30 uppercase text-[5px] font-black tracking-widest">Rate</span>
                                                                            <span className="text-amber-400 font-black truncate">{isOperational ? formatProduction(finalProd) : "0.00"}</span>
                                                                        </div>
                                                                        <div className="flex flex-col">
                                                                            <span className="text-white/30 uppercase text-[5px] font-black tracking-widest">Target</span>
                                                                            <span className={`font-black truncate ${!rack.selectedCoinId ? 'text-amber-500 animate-pulse' : 'text-amber-500'}`}>
                                                                                {selectedCoin?.name || "NONE"}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex flex-col">
                                                                            <span className="text-white/30 uppercase text-[5px] font-black tracking-widest">Power</span>
                                                                            <span className={`font-black truncate ${isInfinite ? 'text-amber-400' : (chargePercent < 20 ? 'text-red-500' : 'text-emerald-500')}`}>
                                                                                {isInfinite ? " ∞ | INFINITE" : `${rack.currentCharge.toFixed(0)}Wh`}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex flex-col">
                                                                            <span className="text-white/30 uppercase text-[5px] font-black tracking-widest">Load</span>
                                                                            <span className="text-red-400 font-black truncate">{totalWatts}W</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }

                                                        if (slot.type === 'production_display') {
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    className="absolute z-20 bg-black/60 backdrop-blur-md border border-amber-500/20 rounded flex items-center justify-center p-1 shadow-inner shadow-amber-500/5"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <span className="text-[11px] font-mono font-black text-amber-400 tracking-tighter">
                                                                        {isOperational ? formatProduction(finalProd) : "0.00"}
                                                                    </span>
                                                                </div>
                                                            );
                                                        }

                                                        return (
                                                            <button
                                                                key={i}
                                                                onClick={handleClick}
                                                                className={`absolute group transition-all overflow-hidden border shadow-inner
                                                                    ${item ? (itemImg ? 'border-none shadow-xl scale-100 hover:scale-[1.02]' : 'bg-slate-800/90 border-white/10') : (
                                                                        (slot.type === 'machine' && !rack.slots.some(s => s !== null)) ||
                                                                            (slot.type === 'battery' && !rack.batteryId) ||
                                                                            (slot.type === 'wiring' && !rack.wiringId)
                                                                            ? 'bg-red-500/10 border-red-500/30 animate-pulse border-dashed'
                                                                            : 'bg-amber-500/5 border-dashed border-amber-500/10 hover:bg-amber-500/10 hover:border-amber-500/30'
                                                                    )}
                                                                    ${slot.type === 'machine' ? 'rounded-md' : 'rounded-lg'}
                                                                    ${item && !isOperational ? 'grayscale opacity-70 contrast-125' : ''}
                                                                `}
                                                                style={{
                                                                    left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%`,
                                                                }}
                                                            >
                                                                {item && itemImg && (
                                                                    <AnimatedMiner
                                                                        src={itemImg}
                                                                        isOperational={isOperational}
                                                                        className="absolute inset-0 w-full h-full pointer-events-none"
                                                                        style={{}}
                                                                        item={item}
                                                                    />
                                                                )}

                                                                {item && !itemImg && !isOperational && <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[1px]"></div>}

                                                                {item && isOperational && (
                                                                    <>
                                                                        <div className="absolute inset-0 bg-amber-400/5 animate-pulse mix-blend-overlay pointer-events-none"></div>
                                                                        <div className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_10px_#22c55e]`}></div>
                                                                    </>
                                                                )}
                                                                {!item && (
                                                                    <div className="h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-amber-500/10 backdrop-blur-[2px]">
                                                                        <Plus size={10} className="text-amber-400 drop-shadow-[0_0_3px_rgba(251,191,36,0.45)]" />
                                                                    </div>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>


            {/* INVENTORY MODAL */}
            {
                selectionContext && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 uppercase">
                                    <Box size={18} className="text-amber-600 dark:text-amber-400" />
                                    {selectionContext.type === 'machine' ? 'GPU' :
                                        selectionContext.type === 'battery' ? 'BATERIA' :
                                            selectionContext.type === 'multiplier' ? 'MÓDULO IA' :
                                                selectionContext.type === 'rack' ? 'RACK' : 'FIAÇÃO'}
                                </h3>
                                <button onClick={() => setSelectionContext(null)} className="text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                                <div className="flex flex-col gap-2">
                                    {/* STORED BATTERIES SECTION */}
                                    {selectionContext.type === 'battery' && getAvailableStoredBatteries().length > 0 && (
                                        <div className="mb-4">
                                            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                <Save size={10} /> Usadas / Carregadas (Compatíveis)
                                            </div>
                                            {getAvailableStoredBatteries().map(stored => {
                                                const def = upgrades.find(u => u.id === stored.itemId);
                                                if (!def) return null;
                                                const defImg = normalizePublicAssetUrl(def.image);
                                                const isInfiniteStored = def.powerCapacity === -1;
                                                const chargePct = isInfiniteStored ? 100 : (stored.currentCharge / (def.powerCapacity || 1)) * 100;

                                                return (
                                                    <button
                                                        key={stored.id}
                                                        onClick={() => handleItemSelect(stored.itemId, stored.id)}
                                                        className="w-full flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:bg-white dark:hover:bg-slate-800 hover:border-yellow-500/30 transition-all text-left group mb-2"
                                                    >
                                                        <div className="text-xl bg-white dark:bg-slate-900 w-10 h-10 flex items-center justify-center rounded border border-slate-200 dark:border-slate-800 text-yellow-600 dark:text-yellow-500 overflow-hidden">
                                                            {defImg ? (
                                                                <img src={defImg} alt={def.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                def.icon
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-slate-700 dark:text-slate-300 text-sm flex justify-between">
                                                                <span>{def.name}</span>
                                                                <span className="text-yellow-600 dark:text-yellow-500 font-mono text-xs">{isInfiniteStored ? '∞' : chargePct.toFixed(0)}%</span>
                                                            </div>
                                                            <div className="w-full h-1 bg-slate-200 dark:bg-slate-900 rounded-full mt-1 overflow-hidden">
                                                                <div
                                                                    className="h-full bg-yellow-500 dark:bg-yellow-600"
                                                                    style={{ width: `${chargePct}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </button>
                                                )
                                            })}
                                            <div className="border-b border-slate-200 dark:border-slate-800 my-4"></div>
                                        </div>
                                    )}

                                    {/* NEW ITEMS SECTION */}
                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                                        Novas (Estoque Compatível)
                                    </div>

                                    {getAvailableItems().length === 0 ? (
                                        <div className="text-center py-4 text-slate-500 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-800/50 border-dashed">
                                            <p className="text-sm">Estoque vazio ou incompatível.</p>
                                            <p className="text-xs mt-1">Compre mais no Mercado.</p>
                                        </div>
                                    ) : (
                                        getAvailableItems().map(item => {
                                            const listImg = normalizePublicAssetUrl(item.image);
                                            return (
                                            <button
                                                key={item.id}
                                                onClick={() => handleItemSelect(item.id)}
                                                className="flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-750 hover:border-amber-500/50 transition-all text-left group"
                                            >
                                                <div className="text-2xl bg-white dark:bg-slate-900 w-12 h-12 flex items-center justify-center rounded border border-slate-200 dark:border-slate-800 group-hover:border-amber-500/30 overflow-hidden">
                                                    {listImg ? (
                                                        <img src={listImg} className="w-full h-full object-cover" />
                                                    ) : item.icon}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">{item.name}</div>
                                                    <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
                                                        {item.type === 'machine' && (
                                                            <>
                                                                <span className="text-green-600 dark:text-green-400">+{formatProduction(item.baseProduction)} N/s</span>
                                                                <span className="text-red-500 dark:text-red-400">-{item.powerConsumption} W</span>
                                                            </>
                                                        )}
                                                        {item.type === 'battery' && (
                                                            <span className="text-yellow-600 dark:text-yellow-400">{item.powerCapacity === -1 ? '∞ Cap' : `${item.powerCapacity} Wh`}</span>
                                                        )}
                                                        {item.type === 'multiplier' && (
                                                            <>
                                                                <span className="text-orange-600 dark:text-orange-400">+{((item.multiplier || 0) * 100).toFixed(1)}% Boost</span>
                                                                <span className="text-red-500 dark:text-red-400">-{item.powerConsumption} W</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="bg-slate-100 dark:bg-slate-950 px-2 py-1 rounded text-xs font-mono text-amber-700 dark:text-amber-500 border border-slate-200 dark:border-slate-800">
                                                    x{stock[item.id]}
                                                </div>
                                            </button>
                                        );
                                        })
                                    )}
                                </div>
                            </div>

                            <div className="p-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 text-center">
                                <button onClick={() => setSelectionContext(null)} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                configRackId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 uppercase"><Cog size={18} className="text-amber-600 dark:text-amber-400" /> Configuração do Rig</h3>
                                <button onClick={() => setConfigRackId(null)} className="text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-4 space-y-4">
                                {(() => {
                                    const rack = placedRacks.find(r => r.id === configRackId)!;
                                    const wiring = rack.wiringId ? upgrades.find(u => u.id === rack.wiringId) : null;
                                    const battery = rack.batteryId ? upgrades.find(u => u.id === rack.batteryId) : null;
                                    const machineDefs = rack.slots.map(sid => sid ? upgrades.find(u => u.id === sid) || null : null).filter(Boolean) as Upgrade[];
                                    const baseProd = machineDefs.reduce((acc, u) => acc + (u.baseProduction || 0), 0);
                                    let mult = 1;
                                    rack.multiplierSlots?.forEach(sid => { const up = sid ? upgrades.find(u => u.id === sid) : null; if (up && up.multiplier) mult += up.multiplier; });
                                    const totalPower = baseProd * mult;
                                    const battCap = battery?.powerCapacity || 1;
                                    const isInfiniteConf = battCap === -1;
                                    const chargePercent = isInfiniteConf ? 100 : (battery && battery.powerCapacity ? Math.min(100, Math.max(0, (rack.currentCharge / battery.powerCapacity) * 100)) : 0);

                                    return (
                                        <>
                                            <div>
                                                <label className="text-xs uppercase font-bold text-slate-500">Criptomoeda do Rig</label>
                                                <select
                                                    value={rack.selectedCoinId || ''}
                                                    onChange={e => onSetRackCoin && onSetRackCoin(rack.id, e.target.value)}
                                                    className={`w-full bg-slate-900 border rounded p-2 text-sm transition-colors ${!rack.selectedCoinId ? 'border-amber-500 text-amber-500 font-bold' : 'border-slate-700 text-white'}`}
                                                >
                                                    <option value="">Nenhuma</option>
                                                    {(miningCoins || []).map(c => (
                                                        <option key={c.id} value={c.id} disabled={!c.isActive}>{c.name}{!c.isActive ? ' (indisponível)' : ''}</option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-slate-500 mt-1">Moedas inativas aparecem mas não podem ser selecionadas.</p>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="bg-slate-100 dark:bg-slate-800 rounded p-3 border border-slate-200 dark:border-slate-700">
                                                    <div className="font-bold text-sm text-slate-800 dark:text-white mb-2">GPUs</div>
                                                    {machineDefs.length === 0 ? (
                                                        <div className="text-xs text-slate-500">Nenhuma instalada.</div>
                                                    ) : machineDefs.map((m, i) => (
                                                        <div key={i} className="text-xs text-slate-600 dark:text-slate-300">
                                                            <span className="font-bold text-slate-700 dark:text-white">{m.name}</span> — {m.description}
                                                            <div className="text-[10px] text-green-600 dark:text-green-400">Poder: +{m.baseProduction} H/s</div>
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="bg-slate-100 dark:bg-slate-800 rounded p-3 border border-slate-200 dark:border-slate-700">
                                                    <div className="font-bold text-sm text-slate-800 dark:text-white mb-2">Bateria</div>
                                                    {battery ? (
                                                        <>
                                                            <div className="text-xs text-slate-600 dark:text-slate-300"><span className="font-bold text-slate-700 dark:text-white">{battery.name}</span> — {battery.description}</div>
                                                            <div className="text-[10px] text-yellow-600 dark:text-yellow-400">Capacidade: {battery.powerCapacity} Wh</div>
                                                            <div className="w-full h-2 bg-slate-300 dark:bg-black rounded-sm border border-slate-400 dark:border-slate-700 relative overflow-hidden mt-1">
                                                                <div className="h-full bg-yellow-500" style={{ width: `${chargePercent}%` }}></div>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="text-xs text-slate-500">Nenhuma instalada.</div>
                                                    )}
                                                </div>

                                                <div className="bg-slate-100 dark:bg-slate-800 rounded p-3 border border-slate-200 dark:border-slate-700">
                                                    <div className="font-bold text-sm text-slate-800 dark:text-white mb-2">Fiação</div>
                                                    {wiring ? (
                                                        <div className="text-xs text-slate-600 dark:text-slate-300"><span className="font-bold text-slate-700 dark:text-white">{wiring.name}</span> — {wiring.description}</div>
                                                    ) : (
                                                        <div className="text-xs text-slate-500">Nenhuma instalada.</div>
                                                    )}
                                                </div>

                                                <div className="bg-slate-100 dark:bg-slate-800 rounded p-3 border border-slate-200 dark:border-slate-700">
                                                    <div className="font-bold text-sm text-slate-800 dark:text-white mb-2">Hashrate Total</div>
                                                    <div className="text-xs text-slate-700 dark:text-slate-200">{totalPower.toFixed(2)} H/s</div>
                                                </div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                )
            }

            {
                detailContext && (() => {
                    const detailImg = normalizePublicAssetUrl(detailContext.item.image);
                    return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                                <h3 className="font-bold text-slate-800 dark:text-white text-sm">
                                    {detailContext.item.name}
                                </h3>
                                <button onClick={() => setDetailContext(null)} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-14 h-14 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center text-2xl">
                                        {detailImg ? (
                                            <img src={detailImg} className="w-full h-full object-cover" />
                                        ) : (
                                            detailContext.item.icon
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs text-slate-500 dark:text-slate-400">{detailContext.item.category}</div>
                                        <div className="text-[10px] text-slate-400 dark:text-slate-500">ID: {detailContext.item.id}</div>
                                    </div>
                                </div>
                                <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                    {detailContext.item.description}
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400">
                                    {typeof detailContext.item.baseProduction === 'number' && detailContext.item.baseProduction > 0 && (
                                        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded p-2">
                                            <div className="font-bold text-slate-800 dark:text-slate-200">Produção</div>
                                            <div>{detailContext.item.baseProduction} N/s</div>
                                        </div>
                                    )}
                                    {typeof detailContext.item.powerConsumption === 'number' && detailContext.item.powerConsumption! > 0 && (
                                        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded p-2">
                                            <div className="font-bold text-slate-800 dark:text-slate-200">Consumo</div>
                                            <div>{detailContext.item.powerConsumption} W</div>
                                        </div>
                                    )}
                                    {typeof detailContext.item.powerCapacity === 'number' && detailContext.item.powerCapacity! > 0 && (
                                        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded p-2">
                                            <div className="font-bold text-slate-800 dark:text-slate-200">Capacidade</div>
                                            <div>{detailContext.item.powerCapacity} Wh</div>
                                        </div>
                                    )}
                                    {typeof detailContext.item.multiplier === 'number' && detailContext.item.multiplier! > 0 && (
                                        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded p-2">
                                            <div className="font-bold text-slate-800 dark:text-slate-200">Multiplicador</div>
                                            <div>{(detailContext.item.multiplier * 100).toFixed(1)}%</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                                <button onClick={() => setDetailContext(null)} className="bg-slate-700 text-white px-4 py-2 rounded font-bold">
                                    Fechar
                                </button>
                                <button
                                    onClick={() => {
                                        if (!detailContext) return;
                                        if (detailContext.type === 'machine' && detailContext.slotIndex !== null) {
                                            onUnequipMiner(detailContext.rackId, detailContext.slotIndex);
                                        } else {
                                            onUnequipAux(detailContext.rackId, detailContext.type as 'battery' | 'wiring' | 'multiplier', detailContext.slotIndex ?? undefined);
                                        }
                                        setDetailContext(null);
                                    }}
                                    className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-bold flex-1"
                                >
                                    Remover
                                </button>
                            </div>
                        </div>
                    </div>
                    );
                })()}
        </div >
    );
};
