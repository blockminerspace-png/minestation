import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { PlacedRack, StoredBattery, Upgrade, RigRoom, MiningCoin, normalizePlacedRackRoomId, isNftAutoArmario1OnlyRoom, NFT_AUTO_ALLOWED_CHASSIS_ID } from '../types';
import { orphanCatalogUpgrade } from '../models/orphanCatalogItem';
import { normalizePublicAssetUrl } from '../utils/publicUrl';
import { bulkBatteryWillApplyCount, totalBatteryInstances } from '../models/roomBatteryModel';
import {
  calculatePlacedRacksProductionHashrate,
  calculateRackConsumptionWatts,
  formatHashrateDisplay,
  getDefaultRackLayout,
  mergeBatteryWidgetsIfAbsent,
  getRackBatteryRuntimeHint,
  getRackBatteryRuntimeShortLabel,
  resolvePlacedRackBatteryCatalogId,
  formatRackEnergyWh,
  listInfrastructureInStock,
  listItemsForSelection,
  listStoredBatteriesForSelection,
  type ServerRoomSelectionContext
} from '../models/serverRoomModel';
import { runValidatedItemSelection } from '../controllers/serverRoomController';
import {
    cssSafeBackgroundUrl,
    isValidRigRoomId,
    isValidUserEmailForRoomsFetch,
    sanitizeEmailForRoomsFetch,
    MAX_RIG_SLOTS_PURCHASE_PER_REQUEST,
    parseRigSlotPurchaseQuantity,
    previewRigSlotBulkPurchase
} from '../validation/serverRoomValidation';
import { getMyRigRooms, purchaseRoomSlot } from '../services/api';
import type { BulkRoomBatteryRunOptions } from '../controllers/roomBatteryController';
import { MiningCoinSelect } from './MiningCoinSelect';
import {
    Server,
    XCircle,
    Zap,
    Power,
    Plus,
    Cog,
    X,
    Box,
    Save,
    Activity,
    Calculator,
    Coins,
    Battery,
    LayoutGrid,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';

type RoomActionIcon = React.ComponentType<{ className?: string; size?: number; 'aria-hidden'?: boolean }>;

function RoomActionCard({
    icon: Icon,
    title,
    subtitle,
    children
}: {
    icon: RoomActionIcon;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="group relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-4 shadow-lg shadow-amber-900/10 dark:from-slate-900/95 dark:via-slate-950 dark:to-slate-950 dark:border-amber-600/25 dark:shadow-black/50">
            <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                    background:
                        'radial-gradient(120% 80% at 100% 0%, rgba(245, 158, 11, 0.08) 0%, transparent 55%)'
                }}
            />
            <div className="relative flex min-h-0 flex-1 flex-col">
                <div className="mb-3 flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/35 bg-amber-500/12 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-300">
                        <Icon className="h-5 w-5 shrink-0" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-800 dark:text-amber-100/95">{title}</h4>
                        {subtitle ? (
                            <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">{subtitle}</p>
                        ) : null}
                    </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col justify-end gap-2">{children}</div>
            </div>
        </div>
    );
}

function sameRigRoom(a: string | null | undefined, b: string | null | undefined): boolean {
    return normalizePlacedRackRoomId(a) === normalizePlacedRackRoomId(b);
}

interface ServerRoomProps {
    stock: Record<string, number>;
    storedBatteries: StoredBattery[];
    placedRacks: PlacedRack[];
    onPlaceRack: (
        rackTypeId: string,
        roomId: string,
        slotIndex: number,
        ctx?: { roomName?: string; nftAutoArmario1Only?: boolean }
    ) => void;
    onRemoveRack: (id: string) => void;
    onEquipMiner: (rackId: string, slotIndex: number, minerId: string) => void;
    onUnequipMiner: (rackId: string, slotIndex: number) => void;
    onEquipAux: (rackId: string, itemId: string, type: 'battery' | 'wiring' | 'multiplier', storedBatteryId?: string, slotIndex?: number) => void;
    onUnequipAux: (rackId: string, type: 'battery' | 'wiring' | 'multiplier', slotIndex?: number) => void;
    onTogglePower: (rackId: string) => void;
    onRecharge: (rackId: string) => void;
    upgrades: Upgrade[];
    miningCoins?: MiningCoin[];
    onSetRackCoin?: (rackId: string, coinId: string) => void;
    /** Define a mesma moeda (ou limpa) em todas as rigs da sala de uma vez. */
    onSetRoomRacksCoin?: (roomId: string, coinId: string) => void;
    /** Equipa bateria em massa, remove todas (id vazio) ou preenchimento inteligente (opts.smartFill). */
    onSetRoomRacksBattery?: (roomId: string, batteryUpgradeId: string, opts?: BulkRoomBatteryRunOptions) => void;
    userEmail?: string;
    /** Saldo USDC (para validar compra de slots no modal). */
    usdc?: number;
    onRoomPurchase?: (newUsdc: number) => void;
    onOpenCalculator?: () => void;
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

    const bgSrc = !isOperational && staticImage ? staticImage : src;
    const finalStyle = {
        ...style,
        backgroundImage: item && src ? (cssSafeBackgroundUrl(bgSrc) || 'none') : 'none',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat'
    };

    return <div className={className} style={finalStyle} />;
};

function BatteryOptionRow({
    upgrade,
    selected,
    disabled,
    subtitle,
    onPick
}: {
    upgrade: Upgrade;
    selected: boolean;
    disabled: boolean;
    subtitle: string;
    onPick: () => void;
}) {
    const src = normalizePublicAssetUrl(upgrade.image);
    const [broken, setBroken] = useState(false);
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onPick}
            className={`flex w-full items-center gap-3 rounded-lg border px-2 py-2 text-left text-sm transition-colors ${
                selected
                    ? 'border-blue-500 bg-blue-600/20 text-white ring-1 ring-blue-400/60'
                    : 'border-slate-200 bg-white text-slate-900 hover:border-amber-500/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-amber-600/40'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                {src && !broken ? (
                    <img
                        src={src}
                        alt=""
                        className="h-full w-full object-contain"
                        onError={() => setBroken(true)}
                    />
                ) : (
                    <Battery className="text-amber-600 dark:text-amber-400" size={22} aria-hidden />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{upgrade.name}</div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</div>
            </div>
        </button>
    );
}

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
    onSetRoomRacksCoin,
    onSetRoomRacksBattery,
    userEmail,
    usdc = 0,
    onRoomPurchase,
    onOpenCalculator
}) => {
    const [selectionContext, setSelectionContext] = useState<ServerRoomSelectionContext | null>(null);
    const [detailContext, setDetailContext] = useState<{ rackId: string; slotIndex: number | null; type: 'machine' | 'battery' | 'wiring' | 'multiplier'; item: Upgrade } | null>(null);
    const [configRackId, setConfigRackId] = useState<string | null>(null);
    const [myRooms, setMyRooms] = useState<RigRoom[]>([]);
    const [roomsLoading, setRoomsLoading] = useState(false);
    const [purchaseBusyId, setPurchaseBusyId] = useState<string | null>(null);
    const [roomIndex, setRoomIndex] = useState(0);
    const [bulkRoomCoinId, setBulkRoomCoinId] = useState('');
    const [roomBulkCoinModal, setRoomBulkCoinModal] = useState<RigRoom | null>(null);
    const [roomBulkCoinSelect, setRoomBulkCoinSelect] = useState('');
    const [roomBulkBatteryModal, setRoomBulkBatteryModal] = useState<RigRoom | null>(null);
    const [roomBulkBatterySelect, setRoomBulkBatterySelect] = useState('');
    const [roomBulkBatterySmartFill, setRoomBulkBatterySmartFill] = useState(false);
    const [roomBulkBatteryRigSort, setRoomBulkBatteryRigSort] = useState<'slot_asc' | 'hashrate_desc'>('slot_asc');
    const [coinApplyBusy, setCoinApplyBusy] = useState(false);
    const [slotPurchaseModal, setSlotPurchaseModal] = useState<RigRoom | null>(null);
    const [slotPurchaseQty, setSlotPurchaseQty] = useState(1);

    const rackLayoutSignature = useMemo(
        () => placedRacks.map((r) => `${r.id}:${r.roomId ?? ''}:${r.slotIndex ?? 0}`).sort().join('|'),
        [placedRacks]
    );

    useEffect(() => {
        if (!userEmail || !isValidUserEmailForRoomsFetch(userEmail)) return;
        const emailParam = sanitizeEmailForRoomsFetch(userEmail);
        let cancelled = false;
        (async () => {
            setRoomsLoading(true);
            try {
                const rooms = await getMyRigRooms(emailParam);
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

    useEffect(() => {
        setBulkRoomCoinId('');
    }, [currentRoom?.id]);

    const currentRoomRacks = useMemo(() => {
        if (!currentRoom) return [];
        return placedRacks.filter((r) => sameRigRoom(r.roomId, currentRoom.id));
    }, [placedRacks, currentRoom]);

    const roomTotalProduction = useMemo(() => {
        return calculatePlacedRacksProductionHashrate(currentRoomRacks, upgrades, storedBatteries);
    }, [currentRoomRacks, upgrades, storedBatteries]);

    const roomPlacedCount = currentRoomRacks.length;

    const roomCapacity = currentRoom ? (currentRoom.initialCapacity + (currentRoom.unlockedSlots || 0)) : 0;

    /** Sala "NFTs AUTO": foco em moeda/bateria em massa — sem barras de carga nem painel de runtime no rack. */
    const nftAutoRoomHideEnergyTimerUi = currentRoom != null && isNftAutoArmario1OnlyRoom(currentRoom);

    const openSlotPurchaseModal = (room: RigRoom) => {
        if (!userEmail || !isValidUserEmailForRoomsFetch(userEmail)) return;
        if (!isValidRigRoomId(room.id)) {
            alert('Identificador de sala inválido.');
            return;
        }
        setSlotPurchaseQty(1);
        setSlotPurchaseModal(room);
    };

    const closeSlotPurchaseModal = useCallback(() => {
        setSlotPurchaseModal(null);
        setSlotPurchaseQty(1);
    }, []);

    useEffect(() => {
        if (!slotPurchaseModal) return;
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeSlotPurchaseModal();
        };
        window.addEventListener('keydown', onEsc);
        return () => window.removeEventListener('keydown', onEsc);
    }, [slotPurchaseModal, closeSlotPurchaseModal]);

    const slotPurchasePreview = useMemo(() => {
        if (!slotPurchaseModal) return null;
        const q = parseRigSlotPurchaseQuantity(slotPurchaseQty) ?? 1;
        return previewRigSlotBulkPurchase(slotPurchaseModal, q, usdc);
    }, [slotPurchaseModal, slotPurchaseQty, usdc]);

    const confirmPurchaseSlots = async () => {
        if (!slotPurchaseModal || !userEmail || !isValidUserEmailForRoomsFetch(userEmail)) return;
        const roomId = slotPurchaseModal.id;
        if (!isValidRigRoomId(roomId) || purchaseBusyId) return;
        const qtyParsed = parseRigSlotPurchaseQuantity(slotPurchaseQty) ?? 1;
        const preview = previewRigSlotBulkPurchase(slotPurchaseModal, qtyParsed, usdc);
        if (!preview.ok || preview.appliedQty < 1) {
            alert(preview.message || 'Não é possível comprar esta quantidade.');
            return;
        }
        setPurchaseBusyId(roomId);
        const resp = await purchaseRoomSlot(sanitizeEmailForRoomsFetch(userEmail), roomId, preview.appliedQty);
        if (!resp.ok) {
            if (resp.error === 'Insufficient USDC') alert(`Saldo insuficiente${typeof resp.missing === 'number' ? ` (faltam ~$${resp.missing.toFixed(2)})` : ''}`);
            else if (resp.error === 'Level not allowed') alert('Seu nível não tem permissão para comprar esta sala.');
            else if (resp.error === 'Already owned') alert('Você já possui esta sala.');
            else if (resp.error === 'Max capacity reached') alert('Capacidade máxima da sala.');
            else alert(resp.error || 'Falha na compra');
            setPurchaseBusyId(null);
            return;
        }
        closeSlotPurchaseModal();
        if (typeof resp.newUsdc === 'number' && onRoomPurchase) onRoomPurchase(resp.newUsdc);
        if (userEmail) {
            const rooms = await getMyRigRooms(sanitizeEmailForRoomsFetch(userEmail));
            setMyRooms(rooms);
        }
        setPurchaseBusyId(null);
    };

    const availableRacks = useMemo(() => {
        const all = listInfrastructureInStock(upgrades, stock);
        if (currentRoom && isNftAutoArmario1OnlyRoom(currentRoom)) {
            return all.filter((u) => u.id === NFT_AUTO_ALLOWED_CHASSIS_ID);
        }
        return all;
    }, [upgrades, stock, currentRoom]);

    const handleSlotClick = (rackId: string | null, slotIndex: number, currentItemId: string | null, isRoomSlot: boolean = false) => {
        if (isRoomSlot) {
            if (!currentItemId) {
                setSelectionContext({
                    rackId: null,
                    slotIndex,
                    type: 'rack',
                    roomId: currentRoom?.id,
                    roomName: currentRoom?.name,
                    nftAutoArmario1Only: currentRoom?.nftAutoArmario1Only
                });
            }
            return;
        }
        if (!rackId) return;
        if (currentItemId) {
            const item = upgrades.find((u) => u.id === currentItemId) ?? orphanCatalogUpgrade(currentItemId, 'machine');
            setDetailContext({ rackId, slotIndex, type: 'machine', item });
        } else {
            setSelectionContext({ rackId, slotIndex, type: 'machine' });
        }
    };

    const handleAuxClick = (rackId: string, currentItemId: string | null, type: 'battery' | 'wiring' | 'multiplier', slotIndex?: number) => {
        if (!currentItemId) {
            setSelectionContext({ rackId, slotIndex: slotIndex ?? null, type });
            return;
        }
        let item: Upgrade | undefined = upgrades.find((u) => u.id === currentItemId);
        if (!item && type === 'battery') {
            const sb = storedBatteries.find((b) => String(b.id) === String(currentItemId));
            const cat = sb?.itemId != null ? String(sb.itemId).trim() : '';
            if (cat) item = upgrades.find((u) => u.id === cat);
        }
        if (item) {
            setDetailContext({ rackId, slotIndex: slotIndex ?? null, type, item });
            return;
        }
        if (type === 'battery') {
            const fb = upgrades.find((u) => u.type === 'battery');
            if (fb) {
                setDetailContext({
                    rackId,
                    slotIndex: slotIndex ?? null,
                    type: 'battery',
                    item: {
                        ...fb,
                        id: String(currentItemId),
                        name: `${fb.name} (referência em reparo)`,
                        description:
                            'A ligação ao catálogo desta bateria está incompleta; podes remover para o armazém. O servidor repara o tipo ao gravar ou na rotina de integridade.'
                    } as Upgrade
                });
                return;
            }
            setDetailContext({
                rackId,
                slotIndex: slotIndex ?? null,
                type: 'battery',
                item: orphanCatalogUpgrade(String(currentItemId), 'battery')
            });
            return;
        }
        if (type === 'wiring' || type === 'multiplier') {
            setDetailContext({
                rackId,
                slotIndex: slotIndex ?? null,
                type,
                item: orphanCatalogUpgrade(String(currentItemId), type)
            });
            return;
        }
        setSelectionContext({ rackId, slotIndex: slotIndex ?? null, type });
    };

    const handleItemSelect = (itemId: string, storedBatteryId?: string) => {
        if (!selectionContext) return;
        const result = runValidatedItemSelection(selectionContext, itemId, storedBatteryId, {
            onPlaceRack,
            onEquipMiner,
            onEquipAux
        });
        if (!result.ok) {
            alert('message' in result ? result.message : 'Ação inválida.');
            return;
        }
        setSelectionContext(null);
    };

    const getAvailableItems = () => {
        if (!selectionContext) return [];
        return listItemsForSelection(selectionContext, placedRacks, upgrades, stock);
    };

    const getAvailableStoredBatteries = () => {
        if (!selectionContext) return [];
        return listStoredBatteriesForSelection(selectionContext, placedRacks, storedBatteries, upgrades);
    };

    const openRoomBulkCoinModal = (room: RigRoom) => {
        if (!onSetRoomRacksCoin) return;
        const racksHere = placedRacks.filter((r) => sameRigRoom(r.roomId, room.id));
        if (racksHere.length === 0) return;
        const firstSet = racksHere.find(r => r.selectedCoinId)?.selectedCoinId ?? '';
        setRoomBulkCoinSelect(firstSet);
        setRoomBulkCoinModal(room);
    };

    const closeRoomBulkCoinModal = () => {
        setRoomBulkCoinModal(null);
        setRoomBulkCoinSelect('');
    };

    const openRoomBulkBatteryModal = (room: RigRoom) => {
        if (!onSetRoomRacksBattery) return;
        const racksHere = placedRacks.filter((r) => sameRigRoom(r.roomId, room.id));
        if (racksHere.length === 0) return;
        const firstBatt = racksHere.find((r) => r.batteryId)?.batteryId ?? '';
        const canPickManual = firstBatt && (stock[firstBatt] || 0) > 0;
        setRoomBulkBatterySelect(canPickManual ? firstBatt : '');
        setRoomBulkBatterySmartFill(false);
        setRoomBulkBatteryRigSort('slot_asc');
        setRoomBulkBatteryModal(room);
    };

    const closeRoomBulkBatteryModal = () => {
        setRoomBulkBatteryModal(null);
        setRoomBulkBatterySelect('');
        setRoomBulkBatterySmartFill(false);
        setRoomBulkBatteryRigSort('slot_asc');
    };

    const handleApplyRoomCoin = async () => {
        if (!currentRoom || !onSetRoomRacksCoin || coinApplyBusy || currentRoomRacks.length === 0) return;
        setCoinApplyBusy(true);
        try {
            await onSetRoomRacksCoin(currentRoom.id, bulkRoomCoinId);
        } finally {
            setCoinApplyBusy(false);
        }
    };

    const showQuickControlRow = Boolean(onSetRoomRacksCoin || onSetRoomRacksBattery || userEmail);

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
                            {formatHashrateDisplay(roomTotalProduction)} H/s
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

            {showQuickControlRow && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
                    <RoomActionCard
                        icon={Coins}
                        title="Moeda da sala"
                        subtitle="Uma moeda para todas as rigs desta sala. «Nenhuma» desliga a produção nas rigs sem moeda."
                    >
                        {!onSetRoomRacksCoin ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Indisponível nesta sessão.</p>
                        ) : !currentRoom ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">A carregar dados da sala…</p>
                        ) : currentRoomRacks.length === 0 ? (
                            <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
                                Instala pelo menos uma rig nesta sala para aplicar moeda em massa.
                            </p>
                        ) : (
                            <>
                                <MiningCoinSelect
                                    value={bulkRoomCoinId}
                                    onChange={setBulkRoomCoinId}
                                    coins={miningCoins || []}
                                    noneLabel="Nenhuma (desliga rigs sem moeda)"
                                    buttonClassName="rounded-lg px-2 py-2 text-sm"
                                    disabled={coinApplyBusy}
                                />
                                <button
                                    type="button"
                                    disabled={coinApplyBusy}
                                    onClick={() => void handleApplyRoomCoin()}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-amber-600 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-amber-900/20 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {coinApplyBusy ? 'A aplicar…' : `Aplicar a todas (${currentRoomRacks.length})`}
                                </button>
                            </>
                        )}
                    </RoomActionCard>

                    <RoomActionCard
                        icon={Battery}
                        title="Baterias da sala"
                        subtitle="Lista só baterias com stock. Preenchimento inteligente usa também o armazém."
                    >
                        {!onSetRoomRacksBattery ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Indisponível nesta sessão.</p>
                        ) : !currentRoom ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">A carregar dados da sala…</p>
                        ) : currentRoomRacks.length === 0 ? (
                            <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
                                Instala pelo menos uma rig nesta sala para configurar baterias em massa.
                            </p>
                        ) : (
                            <button
                                type="button"
                                onClick={() => openRoomBulkBatteryModal(currentRoom)}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-yellow-600/55 bg-gradient-to-r from-yellow-700 to-amber-700 px-4 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-yellow-900/25 transition hover:from-yellow-600 hover:to-amber-600"
                            >
                                <Battery size={18} aria-hidden />
                                Configurar baterias
                            </button>
                        )}
                    </RoomActionCard>

                    <RoomActionCard
                        icon={LayoutGrid}
                        title="Mudar de sala"
                        subtitle="Escolhe outra sala de mineração. A vista abaixo mostra slots, compras e atalhos por sala."
                    >
                        {!userEmail ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Inicia sessão para ver e gerir várias salas.</p>
                        ) : roomsLoading ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">A carregar salas…</p>
                        ) : myRooms.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma sala configurada.</p>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        aria-label="Sala anterior"
                                        disabled={roomIndex <= 0}
                                        onClick={() => setRoomIndex((i) => Math.max(0, i - 1))}
                                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:border-amber-500/50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-amber-500/40 dark:hover:text-amber-300"
                                    >
                                        <ChevronLeft className="h-5 w-5" aria-hidden />
                                    </button>
                                    <select
                                        aria-label="Selecionar sala de mineração"
                                        className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                        value={String(Math.min(roomIndex, Math.max(0, myRooms.length - 1)))}
                                        onChange={(e) => setRoomIndex(Number(e.target.value))}
                                    >
                                        {myRooms.map((room, idx) => (
                                            <option key={room.id} value={String(idx)}>
                                                {room.name}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        aria-label="Sala seguinte"
                                        disabled={roomIndex >= myRooms.length - 1}
                                        onClick={() => setRoomIndex((i) => Math.min(myRooms.length - 1, i + 1))}
                                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:border-amber-500/50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-amber-500/40 dark:hover:text-amber-300"
                                    >
                                        <ChevronRight className="h-5 w-5" aria-hidden />
                                    </button>
                                </div>
                                <p className="text-center text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                    Sala {roomIndex + 1} de {myRooms.length}
                                    {currentRoom ? (
                                        <>
                                            {' '}
                                            · {placedRacks.filter((r) => sameRigRoom(r.roomId, currentRoom.id)).length} rig
                                            {placedRacks.filter((r) => sameRigRoom(r.roomId, currentRoom.id)).length === 1 ? '' : 's'}
                                        </>
                                    ) : null}
                                </p>
                            </div>
                        )}
                    </RoomActionCard>
                </div>
            )}

            {userEmail && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/80">
                        <div className="mb-3 border-b border-slate-200 pb-2 dark:border-slate-700/80">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Visão geral das salas</div>
                            <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">Slots, compra de espaço e atalhos por sala.</p>
                        </div>
                        {roomsLoading ? (
                            <div className="text-xs text-slate-500">Carregando...</div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                                {myRooms.map((room, idx) => {
                                    const cap = room.initialCapacity + (room.unlockedSlots || 0);
                                    const nextPrice = room.baseSlotPrice * Math.pow(1 + room.slotPriceIncreasePercent / 100, room.unlockedSlots || 0);
                                    const rigsInRoom = placedRacks.filter((r) => sameRigRoom(r.roomId, room.id)).length;
                                    return (
                                        <div key={room.id} className={`p-3 rounded border ${roomIndex === idx ? 'border-amber-700 bg-amber-900/10 shadow-[0_0_15px_rgba(245,158,11,0.1)]' : 'border-slate-800 bg-slate-900/40'}`}>
                                            <div className="flex justify-between items-center">
                                                <button onClick={() => setRoomIndex(idx)} className="font-bold text-slate-200 text-sm text-left hover:text-amber-400 transition-colors uppercase tracking-wider">{room.name}</button>
                                            </div>
                                            <div className="text-[10px] text-slate-500 mt-1 font-mono uppercase">Slots: {cap} / {room.maxCapacity}</div>
                                            {(onSetRoomRacksCoin || onSetRoomRacksBattery) && (
                                                <div className="mt-2 flex flex-col gap-1.5">
                                                    {onSetRoomRacksCoin && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); openRoomBulkCoinModal(room); }}
                                                            disabled={rigsInRoom === 0}
                                                            title={rigsInRoom === 0 ? 'Instale ao menos uma rig nesta sala.' : 'Define a mesma moeda em todas as rigs desta sala.'}
                                                            className={`w-full flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-wide px-2 py-1.5 rounded border transition-colors ${rigsInRoom === 0 ? 'border-slate-700 text-slate-600 cursor-not-allowed bg-slate-900/30' : 'border-amber-500/40 text-amber-400 bg-amber-500/10 hover:bg-amber-500/25 hover:border-amber-500/60'}`}
                                                        >
                                                            <Coins size={12} className="shrink-0" />
                                                            Moeda em todas as rigs
                                                            {rigsInRoom > 0 && <span className="font-mono opacity-80">({rigsInRoom})</span>}
                                                        </button>
                                                    )}
                                                    {onSetRoomRacksBattery && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); openRoomBulkBatteryModal(room); }}
                                                            disabled={rigsInRoom === 0}
                                                            title={rigsInRoom === 0 ? 'Instale ao menos uma rig nesta sala.' : 'Define a mesma bateria (estoque) em todas as rigs compatíveis desta sala.'}
                                                            className={`w-full flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-wide px-2 py-1.5 rounded border transition-colors ${rigsInRoom === 0 ? 'border-slate-700 text-slate-600 cursor-not-allowed bg-slate-900/30' : 'border-yellow-600/40 text-yellow-500 bg-yellow-600/10 hover:bg-yellow-600/20 hover:border-yellow-600/60'}`}
                                                        >
                                                            <Battery size={12} className="shrink-0" />
                                                            Bateria em todas as rigs
                                                            {rigsInRoom > 0 && <span className="font-mono opacity-80">({rigsInRoom})</span>}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {cap < room.maxCapacity && (
                                                <div className="mt-3 flex justify-between items-center pt-2 border-t border-white/5">
                                                    <div className="text-[10px] text-amber-400 font-bold">USDC {nextPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); openSlotPurchaseModal(room); }}
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
            )}

            {slotPurchaseModal && slotPurchasePreview && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={closeSlotPurchaseModal}
                    role="presentation"
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="slot-purchase-title"
                        className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 id="slot-purchase-title" className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-wide">
                            Confirmar compra de slots
                        </h2>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                            Sala: <span className="font-semibold text-slate-900 dark:text-white">{slotPurchaseModal.name}</span>
                        </p>
                        {(() => {
                            const maxSelectable = Math.min(
                                MAX_RIG_SLOTS_PURCHASE_PER_REQUEST,
                                Math.max(
                                    1,
                                    slotPurchaseModal.maxCapacity -
                                        slotPurchaseModal.initialCapacity -
                                        (slotPurchaseModal.unlockedSlots || 0)
                                )
                            );
                            return (
                                <div className="mt-4 space-y-3">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Quantidade de slots (1 a {maxSelectable})
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={maxSelectable}
                                        value={slotPurchaseQty}
                                        onChange={(e) => {
                                            const v = Math.floor(Number(e.target.value));
                                            if (!Number.isFinite(v)) {
                                                setSlotPurchaseQty(1);
                                                return;
                                            }
                                            setSlotPurchaseQty(Math.min(Math.max(1, v), maxSelectable));
                                        }}
                                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
                                    />
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-950/80">
                                        <div className="flex justify-between text-slate-600 dark:text-slate-400">
                                            <span>Total a debitar</span>
                                            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                                                USDC{' '}
                                                {slotPurchasePreview.totalUsdc.toLocaleString('en-US', {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2
                                                })}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex justify-between text-slate-600 dark:text-slate-400">
                                            <span>Slots a adicionar</span>
                                            <span className="font-mono font-bold text-slate-900 dark:text-white">{slotPurchasePreview.appliedQty}</span>
                                        </div>
                                        <div className="mt-1 flex justify-between text-slate-600 dark:text-slate-400">
                                            <span>Saldo atual</span>
                                            <span className="font-mono">USDC {usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                                        </div>
                                        <div className="mt-1 flex justify-between text-slate-800 dark:text-slate-200">
                                            <span>Saldo após</span>
                                            <span
                                                className={`font-mono font-bold ${slotPurchasePreview.saldoApos < 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}
                                            >
                                                USDC{' '}
                                                {slotPurchasePreview.saldoApos.toLocaleString('en-US', {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 4
                                                })}
                                            </span>
                                        </div>
                                    </div>
                                    {!slotPurchasePreview.ok && slotPurchasePreview.message && (
                                        <p className="text-sm text-red-600 dark:text-red-400">{slotPurchasePreview.message}</p>
                                    )}
                                    <div className="mt-4 flex gap-2 justify-end">
                                        <button
                                            type="button"
                                            onClick={closeSlotPurchaseModal}
                                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void confirmPurchaseSlots()}
                                            disabled={!slotPurchasePreview.ok || !!purchaseBusyId}
                                            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {purchaseBusyId ? 'A processar…' : 'Confirmar compra'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

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
                    const rackDef =
                        upgrades.find((u) => u.id === rack.itemId) ??
                        (rack.itemId ? orphanCatalogUpgrade(String(rack.itemId), 'infrastructure') : undefined);
                    const rackSkin = normalizePublicAssetUrl(rackDef?.image);

                    const totalWatts = calculateRackConsumptionWatts(rack, upgrades);
                    const finalProd = calculatePlacedRacksProductionHashrate([rack], upgrades, storedBatteries);

                    const batteryCatalogId = resolvePlacedRackBatteryCatalogId(rack, storedBatteries, upgrades);
                    const battery = batteryCatalogId ? upgrades.find((u) => u.id === batteryCatalogId) : null;
                    const isInfinite = battery && battery.powerCapacity === -1;
                    const chargePercent = battery && battery.powerCapacity && !isInfinite
                        ? (rack.currentCharge / battery.powerCapacity) * 100
                        : (isInfinite ? 100 : 0);

                    const isOperational = rack.isOn && rack.wiringId && Boolean(battery) && (isInfinite || rack.currentCharge > 0);
                    const batteryRuntimeShort = getRackBatteryRuntimeShortLabel(rack, upgrades, storedBatteries);
                    const batteryRuntimeHint = getRackBatteryRuntimeHint(rack, upgrades, storedBatteries);

                    const layoutToUse = mergeBatteryWidgetsIfAbsent(
                      rackDef?.layout || (rackDef ? getDefaultRackLayout(rackDef) : { canvasWidth: 500, canvasHeight: 600, slots: [] })
                    );
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
                                        backgroundImage: cssSafeBackgroundUrl(rackSkin),
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
                                        const layoutToUse = rackDef
                                          ? mergeBatteryWidgetsIfAbsent(rackDef.layout || getDefaultRackLayout(rackDef))
                                          : null;
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

                                                        const catalogForBatterySlot =
                                                            slot.type === 'battery' ? batteryCatalogId : null;
                                                        const item =
                                                            slot.type === 'battery'
                                                                ? catalogForBatterySlot
                                                                    ? upgrades.find((u) => u.id === catalogForBatterySlot) ??
                                                                      orphanCatalogUpgrade(String(catalogForBatterySlot), 'battery')
                                                                    : null
                                                                : slotContent
                                                                  ? upgrades.find((u) => u.id === slotContent) ??
                                                                    orphanCatalogUpgrade(
                                                                        String(slotContent),
                                                                        slot.type === 'machine'
                                                                            ? 'machine'
                                                                            : slot.type === 'multiplier'
                                                                              ? 'multiplier'
                                                                              : 'wiring'
                                                                    )
                                                                  : null;
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

                                                            if (!battery) missing.push("Bateria");
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
                                                                    {onSetRackCoin ? (
                                                                        <MiningCoinSelect
                                                                            value={rack.selectedCoinId || ''}
                                                                            onChange={(id) => {
                                                                                onSetRackCoin(rack.id, id);
                                                                            }}
                                                                            coins={miningCoins || []}
                                                                            noneLabel="Moeda"
                                                                            compact
                                                                            stopPointerPropagation
                                                                            buttonClassName="h-full min-h-0 border-0 bg-transparent px-0.5 py-0 text-center font-black tracking-tighter shadow-none ring-0 focus:ring-0"
                                                                        />
                                                                    ) : null}
                                                                </div>
                                                            );
                                                        }

                                                        if (slot.type === 'battery_bar') {
                                                            if (nftAutoRoomHideEnergyTimerUi) return <React.Fragment key={i} />;
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    className="pointer-events-none absolute z-30 cursor-help bg-black/40 backdrop-blur-[2px] border border-white/10 rounded-full overflow-hidden p-0.5 shadow-inner"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                    title={batteryRuntimeHint}
                                                                >
                                                                    <div
                                                                        className={`h-full rounded-full transition-all duration-500 ${isInfinite ? 'bg-amber-400 shadow-[0_0_10px_#f59e0b]' : (chargePercent < 20 ? 'bg-red-500' : 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.3)]')} ${isOperational && chargePercent < 99.9 ? 'animate-super-pulse' : (rack.isOn ? 'animate-pulse opacity-80' : '')}`}
                                                                        style={{ width: `${Math.min(100, chargePercent)}%` }}
                                                                    ></div>
                                                                </div>
                                                            );
                                                        }

                                                        if (slot.type === 'stat_monitor') {
                                                            if (nftAutoRoomHideEnergyTimerUi) return <React.Fragment key={i} />;
                                                            const selectedCoin = miningCoins?.find(c => c.id === rack.selectedCoinId);
                                                            const powerStoredLabel = isInfinite
                                                                ? '∞'
                                                                : formatRackEnergyWh(rack.currentCharge);
                                                            const powerCapLabel =
                                                                !isInfinite && battery?.powerCapacity && battery.powerCapacity > 0
                                                                    ? formatRackEnergyWh(battery.powerCapacity)
                                                                    : null;
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    className="pointer-events-none absolute z-30 flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-emerald-500/25 bg-black/92 p-1.5 font-mono leading-tight shadow-[0_4px_28px_rgba(0,0,0,0.5)] backdrop-blur-md"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <div className="flex shrink-0 items-center justify-end border-b border-white/10 pb-1">
                                                                        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${isOperational ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-red-500'}`} title={isOperational ? 'Operacional' : 'Offline / incompleto'} />
                                                                    </div>
                                                                    <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-2 gap-y-0.5 overflow-hidden pt-1 text-[7px]">
                                                                        <div className="flex min-w-0 flex-col">
                                                                            <span className="text-white/35 uppercase text-[5px] font-black tracking-widest">Rate</span>
                                                                            <span className="truncate font-black text-amber-400">{isOperational ? formatHashrateDisplay(finalProd) : '0'}</span>
                                                                        </div>
                                                                        <div className="flex min-w-0 flex-col">
                                                                            <span className="text-white/35 uppercase text-[5px] font-black tracking-widest">Target</span>
                                                                            <span className={`truncate font-black ${!rack.selectedCoinId ? 'animate-pulse text-amber-500' : 'text-amber-400'}`}>
                                                                                {selectedCoin?.name || 'NONE'}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex min-w-0 flex-col">
                                                                            <span className="text-white/35 uppercase text-[5px] font-black tracking-widest">Power</span>
                                                                            <span
                                                                                className={`truncate font-black ${isInfinite ? 'text-amber-400' : chargePercent < 20 ? 'text-red-400' : 'text-emerald-400'}`}
                                                                                title={powerCapLabel ? `${rack.currentCharge.toFixed(0)} Wh / ${battery?.powerCapacity} Wh máx.` : String(rack.currentCharge)}
                                                                            >
                                                                                {powerCapLabel ? (
                                                                                    <>
                                                                                        {powerStoredLabel}
                                                                                        <span className="font-normal text-white/35"> / </span>
                                                                                        {powerCapLabel}
                                                                                    </>
                                                                                ) : (
                                                                                    powerStoredLabel
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex min-w-0 flex-col">
                                                                            <span className="text-white/35 uppercase text-[5px] font-black tracking-widest">Load</span>
                                                                            <span className="truncate font-black text-red-400">{totalWatts}W</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }

                                                        if (slot.type === 'production_display') {
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    className="pointer-events-none absolute z-20 bg-black/60 backdrop-blur-md border border-amber-500/20 rounded flex items-center justify-center p-1 shadow-inner shadow-amber-500/5"
                                                                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                                                                >
                                                                    <span className="text-[11px] font-mono font-black text-amber-400 tracking-tighter">
                                                                        {isOperational ? formatHashrateDisplay(finalProd) : "0.00"}
                                                                    </span>
                                                                </div>
                                                            );
                                                        }

                                                        return (
                                                            <button
                                                                key={i}
                                                                type="button"
                                                                onClick={handleClick}
                                                                className={`absolute z-[35] group transition-all overflow-hidden border shadow-inner
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

                                                                {item && !itemImg && !isOperational && (
                                                                    <div className="pointer-events-none absolute inset-0 bg-slate-900/60 backdrop-blur-[1px]" />
                                                                )}

                                                                {item && isOperational && (
                                                                    <>
                                                                        <div className="absolute inset-0 bg-amber-400/5 animate-pulse mix-blend-overlay pointer-events-none"></div>
                                                                        <div className="pointer-events-none absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_10px_#22c55e]" />
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
                            {battery && rack.batteryId && !nftAutoRoomHideEnergyTimerUi ? (
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => handleAuxClick(rack.id, rack.batteryId, 'battery')}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleAuxClick(rack.id, rack.batteryId, 'battery');
                                        }
                                    }}
                                    className="mt-1.5 flex w-full max-w-full shrink-0 cursor-pointer items-stretch gap-2 rounded-lg border border-emerald-600/30 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none hover:border-emerald-500/50 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                                    title={`${batteryRuntimeHint} — Clique para abrir detalhes da bateria.`}
                                >
                                    <Battery className="self-center shrink-0 text-emerald-400 opacity-90" size={15} strokeWidth={2} />
                                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                                        <div className="h-2 rounded-full border border-white/10 bg-black/50 p-px">
                                            <div
                                                className={`h-full rounded-full transition-all duration-500 ${isInfinite ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]' : chargePercent < 20 ? 'bg-red-500' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'}`}
                                                style={{ width: `${Math.min(100, chargePercent)}%` }}
                                            />
                                        </div>
                                        <div className="flex items-baseline justify-between gap-2 text-[8px]">
                                            <span className="min-w-0 truncate font-mono text-slate-400" title={batteryRuntimeHint}>
                                                {isInfinite ? 'Ilimitada' : `${formatRackEnergyWh(rack.currentCharge)} · máx ${formatRackEnergyWh(battery.powerCapacity || 0)}`}
                                            </span>
                                            <span className="shrink-0 font-mono text-[9px] font-bold tabular-nums text-emerald-300">
                                                {isInfinite ? '∞' : batteryRuntimeShort}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col justify-center border-l border-white/10 pl-2 text-right">
                                        <span className="text-[6px] font-bold uppercase tracking-wider text-slate-500">Carga</span>
                                        <span className="font-mono text-sm font-black tabular-nums leading-none text-white">
                                            {isInfinite ? '∞' : `${Math.round(Math.min(100, chargePercent))}%`}
                                        </span>
                                    </div>
                                </div>
                            ) : null}
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
                                                                <span className="text-green-600 dark:text-green-400">+{formatHashrateDisplay(item.baseProduction)} N/s</span>
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
                                    const wiring = rack.wiringId
                                        ? upgrades.find((u) => u.id === rack.wiringId) ??
                                          orphanCatalogUpgrade(String(rack.wiringId), 'wiring')
                                        : null;
                                    const battCat = resolvePlacedRackBatteryCatalogId(rack, storedBatteries, upgrades);
                                    const battery = battCat
                                        ? upgrades.find((u) => u.id === battCat) ??
                                          orphanCatalogUpgrade(String(battCat), 'battery')
                                        : null;
                                    const machineDefs = rack.slots
                                        .map((sid) =>
                                            sid
                                                ? upgrades.find((u) => u.id === sid) ?? orphanCatalogUpgrade(String(sid), 'machine')
                                                : null
                                        )
                                        .filter(Boolean) as Upgrade[];
                                    const baseProd = machineDefs.reduce((acc, u) => acc + (u.baseProduction || 0), 0);
                                    let mult = 1;
                                    rack.multiplierSlots?.forEach((sid) => {
                                        const up = sid
                                            ? upgrades.find((u) => u.id === sid) ?? orphanCatalogUpgrade(String(sid), 'multiplier')
                                            : null;
                                        if (up && up.multiplier) mult += up.multiplier;
                                    });
                                    const totalPower = baseProd * mult;
                                    const battCap = battery?.powerCapacity || 1;
                                    const isInfiniteConf = battCap === -1;
                                    const chargePercent = isInfiniteConf ? 100 : (battery && battery.powerCapacity ? Math.min(100, Math.max(0, (rack.currentCharge / battery.powerCapacity) * 100)) : 0);

                                    return (
                                        <>
                                            <div>
                                                <label className="text-xs uppercase font-bold text-slate-500">Criptomoeda do Rig</label>
                                                {onSetRackCoin ? (
                                                    <MiningCoinSelect
                                                        value={rack.selectedCoinId || ''}
                                                        onChange={(id) => onSetRackCoin(rack.id, id)}
                                                        coins={miningCoins || []}
                                                        noneLabel="Nenhuma"
                                                        buttonClassName={`rounded p-2 text-sm ${!rack.selectedCoinId ? 'border-amber-500 text-amber-500 font-bold' : 'border-slate-700 text-white'}`}
                                                    />
                                                ) : null}
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

            {roomBulkCoinModal && onSetRoomRacksCoin && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-sm uppercase">
                                <Coins size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
                                Moeda da sala
                            </h3>
                            <button type="button" onClick={closeRoomBulkCoinModal} className="text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors" aria-label="Fechar">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                                <span className="font-bold text-slate-800 dark:text-slate-200">{roomBulkCoinModal.name}</span>
                                {' — '}aplica a todas as rigs desta sala de uma vez.
                            </p>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Criptomoeda</label>
                                <MiningCoinSelect
                                    value={roomBulkCoinSelect}
                                    onChange={setRoomBulkCoinSelect}
                                    coins={miningCoins || []}
                                    noneLabel="Nenhuma (desliga rigs sem moeda)"
                                    buttonClassName="rounded p-2"
                                />
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-2 justify-end bg-slate-50 dark:bg-slate-950">
                            <button type="button" onClick={closeRoomBulkCoinModal} className="px-4 py-2 rounded-md text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onSetRoomRacksCoin(roomBulkCoinModal.id, roomBulkCoinSelect);
                                    closeRoomBulkCoinModal();
                                }}
                                className="px-4 py-2 rounded-md text-sm font-bold uppercase tracking-wide bg-amber-600 text-white hover:bg-amber-500 border border-amber-500/50 transition-colors"
                            >
                                Aplicar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {roomBulkBatteryModal && onSetRoomRacksBattery && (() => {
                const racksHere = placedRacks.filter((r) => sameRigRoom(r.roomId, roomBulkBatteryModal.id));
                const needForSelect = roomBulkBatterySelect
                    ? (() => {
                        const def = upgrades.find(u => u.id === roomBulkBatterySelect && u.type === 'battery');
                        if (!def) return 0;
                        return racksHere.filter(rack =>
                            !def.compatibleRacks?.length || (def.compatibleRacks || []).includes(rack.itemId)
                        ).length;
                    })()
                    : 0;
                const availForSelect = roomBulkBatterySelect
                    ? totalBatteryInstances(roomBulkBatterySelect, stock, storedBatteries)
                    : 0;
                const modalWillApply =
                    roomBulkBatterySelect && needForSelect > 0
                        ? bulkBatteryWillApplyCount(needForSelect, roomBulkBatterySelect, stock, storedBatteries)
                        : 0;
                const batteryApplyInvalid =
                    roomBulkBatterySelect !== '' && (needForSelect === 0 || availForSelect < 1);
                const hasSmartFillPool =
                    racksHere.length > 0 &&
                    upgrades.some((u) => {
                        if (u.type !== 'battery') return false;
                        if (totalBatteryInstances(u.id, stock, storedBatteries) < 1) return false;
                        return racksHere.some(
                            (rack) => !u.compatibleRacks?.length || (u.compatibleRacks || []).includes(rack.itemId)
                        );
                    });
                const applyDisabled = roomBulkBatterySmartFill ? !hasSmartFillPool : batteryApplyInvalid;
                return (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[min(92vh,36rem)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-sm uppercase">
                                    <Battery size={18} className="text-yellow-600 dark:text-yellow-400 shrink-0" />
                                    Bateria da sala
                                </h3>
                                <button type="button" onClick={closeRoomBulkBatteryModal} className="text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors" aria-label="Fechar">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
                                <p className="text-xs text-slate-600 dark:text-slate-400">
                                    <span className="font-bold text-slate-800 dark:text-slate-200">{roomBulkBatteryModal.name}</span>
                                    {' — '}Stock ou armazém: equipa até o número de unidades que tiver (não precisa cobrir todas as rigs). Modo inteligente: retira todas as baterias da sala e redistribui priorizando <span className="font-semibold">mais energia útil (Wh)</span> em cada unidade, depois modelo de maior capacidade como desempate; rigs na ordem que escolher abaixo.
                                </p>
                                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-600 dark:bg-slate-950/80">
                                    <label className="text-[10px] uppercase font-bold text-slate-500 block">Ordem das rigs ao distribuir</label>
                                    <select
                                        value={roomBulkBatteryRigSort}
                                        onChange={(e) =>
                                            setRoomBulkBatteryRigSort(e.target.value === 'hashrate_desc' ? 'hashrate_desc' : 'slot_asc')
                                        }
                                        className="w-full rounded border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                                    >
                                        <option value="slot_asc">Por slot (número da posição)</option>
                                        <option value="hashrate_desc">Por hashrate teórico (maior primeiro)</option>
                                    </select>
                                    <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
                                        <input
                                            type="checkbox"
                                            checked={roomBulkBatterySmartFill}
                                            onChange={(e) => {
                                                const on = e.target.checked;
                                                setRoomBulkBatterySmartFill(on);
                                                if (on) setRoomBulkBatterySelect('');
                                            }}
                                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400"
                                        />
                                        <span>
                                            <span className="font-semibold">Preenchimento inteligente</span>
                                            {' — '}prioriza <span className="font-semibold">mais energia (Wh)</span> nas unidades (evita rig com bateria vazia se há outra carregada); entre unidades parecidas, modelo de maior capacidade primeiro.
                                        </span>
                                    </label>
                                </div>
                                <div className={roomBulkBatterySmartFill ? 'pointer-events-none opacity-50' : ''}>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Escolher ação / bateria</label>
                                    <div className="max-h-[min(52vh,20rem)] space-y-1.5 overflow-y-auto rounded-lg border border-slate-300 bg-slate-50 p-1.5 dark:border-slate-600 dark:bg-slate-950/80 custom-scrollbar">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setRoomBulkBatterySmartFill(false);
                                                setRoomBulkBatterySelect('');
                                            }}
                                            className={`flex w-full items-center gap-3 rounded-lg border px-2 py-2 text-left text-sm ${
                                                roomBulkBatterySelect === ''
                                                    ? 'border-blue-500 bg-blue-600/15 text-slate-900 dark:text-white'
                                                    : 'border-transparent hover:bg-slate-200 dark:hover:bg-slate-800'
                                            }`}
                                        >
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-200 dark:bg-slate-800">
                                                <XCircle size={20} className="text-slate-600 dark:text-slate-300" aria-hidden />
                                            </div>
                                            <div className="min-w-0 flex-1 font-semibold">Remover todas</div>
                                        </button>
                                        {/* Lista manual: só tipos com unidades no estoque (x0 some); modo inteligente ainda usa armazém. */}
                                        {upgrades
                                            .filter((u) => u.type === 'battery' && (stock[u.id] || 0) > 0)
                                            .map((u) => {
                                                const need = racksHere.filter(
                                                    (rack) =>
                                                        !u.compatibleRacks?.length ||
                                                        (u.compatibleRacks || []).includes(rack.itemId)
                                                ).length;
                                                const have = totalBatteryInstances(u.id, stock, storedBatteries);
                                                const will = need > 0 ? Math.min(need, have) : 0;
                                                const subtitle =
                                                    need > 0
                                                        ? `Compatíveis: ${need} · disponível ${have} → até ${will} rig(s)`
                                                        : 'Sem rigs compatíveis';
                                                return (
                                                    <BatteryOptionRow
                                                        key={u.id}
                                                        upgrade={u}
                                                        selected={roomBulkBatterySelect === u.id}
                                                        disabled={need === 0}
                                                        subtitle={subtitle}
                                                        onPick={() => {
                                                            setRoomBulkBatterySmartFill(false);
                                                            setRoomBulkBatterySelect(u.id);
                                                        }}
                                                    />
                                                );
                                            })}
                                    </div>
                                </div>
                            </div>
                            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-2 justify-end bg-slate-50 dark:bg-slate-950">
                                <button type="button" onClick={closeRoomBulkBatteryModal} className="px-4 py-2 rounded-md text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    disabled={applyDisabled}
                                    title={
                                        applyDisabled
                                            ? roomBulkBatterySmartFill
                                                ? 'Sem baterias no stock ou armazém compatíveis com as rigs desta sala.'
                                                : 'Sem rigs compatíveis ou sem unidades desta bateria.'
                                            : undefined
                                    }
                                    onClick={() => {
                                        const opts: BulkRoomBatteryRunOptions = {
                                            rigSort: roomBulkBatteryRigSort
                                        };
                                        if (roomBulkBatterySmartFill) opts.smartFill = true;
                                        onSetRoomRacksBattery(
                                            roomBulkBatteryModal.id,
                                            roomBulkBatterySmartFill ? '' : roomBulkBatterySelect,
                                            opts
                                        );
                                        closeRoomBulkBatteryModal();
                                    }}
                                    className={`px-4 py-2 rounded-md text-sm font-bold uppercase tracking-wide border transition-colors ${applyDisabled ? 'bg-slate-600 text-slate-400 border-slate-600 cursor-not-allowed' : 'bg-yellow-700 text-white hover:bg-yellow-600 border-yellow-600/50'}`}
                                >
                                    {roomBulkBatterySmartFill
                                        ? 'Aplicar inteligente'
                                        : roomBulkBatterySelect
                                          ? `Aplicar (${modalWillApply} rig(s))`
                                          : 'Remover todas'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div >
    );
};
