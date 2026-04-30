import React, { useMemo, useState, useEffect } from 'react';
import { GameState, Upgrade, MiningCoin, RigRoom } from '../types';
import { ArrowLeft, ArrowUpRight, TrendingUp, Server, Box } from 'lucide-react';
import { getMyRigRooms } from '../services/api';
import { AdminEconomy } from './AdminEconomy';

interface PlayerCalculatorProps {
    gameState: GameState;
    upgrades: Upgrade[];
    miningCoins: MiningCoin[];
    onBack: () => void;
    userEmail?: string;
    isAdmin?: boolean;
}

export const PlayerCalculator: React.FC<PlayerCalculatorProps> = ({ gameState, upgrades, miningCoins, onBack, userEmail, isAdmin }) => {
    const activeCoins = useMemo(() => miningCoins.filter(c => c.isActive), [miningCoins]);
    const [selectedCoinId, setSelectedCoinId] = useState<string | null>(null);
    const [scope, setScope] = useState<'total' | string>('total'); // 'total' or roomId
    const [myRooms, setMyRooms] = useState<RigRoom[]>([]);

    useEffect(() => {
        if (activeCoins.length > 0 && !selectedCoinId) {
            setSelectedCoinId(activeCoins[0].id);
        }
    }, [activeCoins, selectedCoinId]);

    // Fetch Room Names
    useEffect(() => {
        const fetchRooms = async () => {
            if (userEmail) {
                try {
                    const rooms = await getMyRigRooms(userEmail);
                    setMyRooms(rooms);
                } catch (e) {
                    console.error("Failed to fetch rooms", e);
                }
            }
        };
        fetchRooms();
    }, [userEmail]);

    // Room Names Mapping
    const roomData = useMemo(() => {
        const rooms = new Set<string>();
        gameState.placedRacks.forEach(r => {
            if (r.roomId) rooms.add(r.roomId);
        });

        const sortedRooms = Array.from(rooms).sort((a, b) => {
            if (a === 'room_initial') return -1;
            if (b === 'room_initial') return 1;
            return a.localeCompare(b);
        });

        const names: Record<string, string> = {};

        sortedRooms.forEach((id, index) => {
            // Try to find the room in the fetched API data
            const matchedRoom = myRooms.find(r => r.id === id);

            if (matchedRoom) {
                names[id] = matchedRoom.name;
            } else if (id === 'room_initial') {
                names[id] = "Sala Principal"; // Fallback for initial room if api match fails
            } else {
                // If we don't have API data yet (or room not found), use fallback naming
                // Note: user requested real names, so we rely heavily on myRooms being populated.
                // If myRooms is empty (still loading), this might show "Sala X" briefly.
                names[id] = `Sala ${index + 1}`;
            }
        });

        return { list: sortedRooms, names };
    }, [gameState.placedRacks, myRooms]);

    const coinStats = useMemo(() => {
        const stats: Record<string, { power: number, activeRacks: number }> = {};

        // Initialize
        activeCoins.forEach(c => {
            stats[c.id] = { power: 0, activeRacks: 0 };
        });

        // Calculate User Power per Coin
        gameState.placedRacks.forEach(rack => {
            // Scope Filter
            if (scope !== 'total' && rack.roomId !== scope) return;

            if (!rack.selectedCoinId || !stats[rack.selectedCoinId]) return;

            // Check operational status
            const battery = upgrades.find(u => u.id === rack.batteryId);
            const isInfinite = battery && battery.powerCapacity === -1;
            const isOperational = rack.isOn && rack.wiringId && rack.batteryId && (isInfinite || rack.currentCharge > 0);

            if (!isOperational) return;

            let rackBase = 0;
            rack.slots.forEach(sid => {
                if (sid) {
                    const machine = upgrades.find(u => u.id === sid);
                    if (machine) rackBase += machine.baseProduction;
                }
            });

            let mult = 1;
            rack.multiplierSlots?.forEach(sid => {
                const modifier = upgrades.find(u => u.id === sid);
                if (modifier && modifier.multiplier) mult += modifier.multiplier;
            });

            const totalRackHash = rackBase * mult;
            stats[rack.selectedCoinId].power += totalRackHash;
            stats[rack.selectedCoinId].activeRacks++;
        });

        return stats;
    }, [gameState.placedRacks, upgrades, activeCoins, scope]);

    const calculateEarnings = (coin: MiningCoin, userHash: number) => {
        // Safety check to avoid NaN
        if (!coin.blockTime || !coin.networkHashrate) return { dailyCoins: 0, dailyUsd: 0 };

        // 1. Share of the network - Use Reality!
        const netHash = Math.max(1, coin.realNetworkHashrate || coin.networkHashrate);
        const share = userHash / netHash;

        // 2. Blocks per day
        const blocksPerDay = 86400 / coin.blockTime;

        // 3. Coins per day
        const dailyCoins = share * (coin.blockReward || 0) * blocksPerDay;

        // 4. USD per day
        const dailyUsd = dailyCoins * (coin.priceUSD || 0);

        return { dailyCoins, dailyUsd };
    };

    const selectedCoin = activeCoins.find(c => c.id === selectedCoinId);
    const userPower = selectedCoinId ? (coinStats[selectedCoinId]?.power || 0) : 0;
    const { dailyCoins, dailyUsd } = selectedCoin ? calculateEarnings(selectedCoin, userPower) : { dailyCoins: 0, dailyUsd: 0 };

    const projectionPeriods = [
        { label: '1 Hora', multiplier: 1 / 24 },
        { label: '24 Horas', multiplier: 1 },
        { label: '7 Dias', multiplier: 7 },
        { label: '30 Dias', multiplier: 30 },
        { label: '1 Ano', multiplier: 365 },
    ];

    return (
        <div className="flex-1 overflow-hidden bg-slate-950 text-slate-200 flex">
            {/* SIDEBAR */}
            <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col p-4 shrink-0">
                <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 p-2 rounded hover:bg-slate-800 transition-colors">
                    <ArrowLeft size={18} />
                    <span className="font-bold text-sm">Voltar</span>
                </button>

                <div className="text-xs font-bold uppercase text-slate-500 tracking-widest mb-3 px-2">Escopo de Análise</div>

                <div className="space-y-1">
                    <button
                        onClick={() => setScope('total')}
                        className={`w-full flex items-center justify-between p-3 rounded-lg text-sm font-medium transition-all ${scope === 'total' ? 'bg-amber-600/10 text-amber-400 border border-amber-500/50' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                    >
                        <span className="flex items-center gap-2"><Box size={16} /> Poder Total</span>
                    </button>

                    {roomData.list.map(roomId => (
                        <button
                            key={roomId}
                            onClick={() => setScope(roomId)}
                            className={`w-full flex items-center justify-between p-3 rounded-lg text-sm font-medium transition-all ${scope === roomId ? 'bg-amber-600/10 text-amber-400 border border-amber-500/50' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                        >
                            <span className="flex items-center gap-2"><Server size={16} /> {roomData.names[roomId]}</span>
                        </button>
                    ))}
                </div>

                <div className="mt-auto p-4 bg-slate-950/50 rounded-xl border border-slate-800">
                    <div className="text-xs text-slate-500 mb-1">Hashrate Selecionado</div>
                    <div className="text-xl font-mono font-bold text-white">
                        {userPower.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s
                    </div>
                </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col items-center">
                <div className="max-w-5xl w-full flex flex-col gap-6">

                    {/* HEADER / TABS */}
                    <div className="flex justify-center items-center">
                        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-800">
                            {activeCoins.map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => setSelectedCoinId(c.id)}
                                    className={`px-6 py-2 rounded-md text-sm font-bold uppercase tracking-wider transition-all ${selectedCoinId === c.id ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/50' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                                >
                                    {c.symbol || c.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {selectedCoin && (
                        <>
                            {/* HERO CARDS */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Daily Gains Card */}
                                <div className="relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 p-8 flex flex-col justify-between group h-48">
                                    <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-amber-400 to-orange-500 rounded-sm"></div>
                                    <div className="z-10">
                                        <div className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-1">Ganhos 24h ({selectedCoin.symbol})</div>
                                        <div className="text-4xl font-black text-white tracking-tight flex items-end gap-2">
                                            ${dailyUsd.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}
                                        </div>
                                        <div className="text-amber-400 font-mono text-sm mt-2 font-bold">
                                            {dailyCoins.toFixed(8)} {selectedCoin.symbol}
                                        </div>
                                    </div>
                                    <div className="absolute right-[-20px] top-[20px] opacity-5 rotate-12 pointer-events-none">
                                        <TrendingUp size={140} />
                                    </div>
                                </div>

                                {/* Monthly Projection Card */}
                                <div className="relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 p-8 flex flex-col justify-between group h-48">
                                    <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-amber-400 to-orange-600 rounded-sm"></div>
                                    <div className="z-10">
                                        <div className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-1">Projeção 30 Dias</div>
                                        <div className="text-4xl font-black text-white tracking-tight">
                                            ${(dailyUsd * 30).toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}
                                        </div>
                                        <div className="text-orange-400 font-mono text-xs mt-3 italic">
                                            Câmbio: 1 {selectedCoin.symbol} = ${(selectedCoin.priceUSD || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC
                                        </div>
                                    </div>
                                    <div className="absolute right-8 top-8 opacity-20 text-orange-500">
                                        <ArrowUpRight size={48} />
                                    </div>
                                </div>
                            </div>

                            {/* DETAILED TABLE */}
                            <div className="bg-slate-900 rounded-3xl border border-slate-800 p-8">
                                <h3 className="flex items-center gap-2 text-slate-300 font-bold mb-6">
                                    <TrendingUp size={18} className="text-amber-400" />
                                    Detalhamento Financeiro (Projeções)
                                </h3>

                                <div className="w-full">
                                    <div className="grid grid-cols-3 pb-3 border-b border-slate-800 text-[10px] items-center font-bold text-slate-500 uppercase tracking-widest px-4">
                                        <div>Período</div>
                                        <div>Moeda ({selectedCoin.symbol})</div>
                                        <div className="text-right">Equivalente em USDC</div>
                                    </div>
                                    <div className="flex flex-col">
                                        {projectionPeriods.map((period, idx) => {
                                            const coins = dailyCoins * period.multiplier;
                                            const usd = dailyUsd * period.multiplier;
                                            return (
                                                <div key={idx} className="grid grid-cols-3 py-4 border-b border-slate-800/50 hover:bg-white/5 transition-colors px-4 items-center">
                                                    <div className="text-sm font-medium text-slate-300">{period.label}</div>
                                                    <div className="text-sm font-mono text-slate-300">{coins.toFixed(8)}</div>
                                                    <div className="text-right font-mono font-bold text-green-400">${usd.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}


                    {/* ADMIN ECONOMY INTEGRATION */}
                    {isAdmin && (
                        <div className="mt-12 pt-8 border-t border-slate-800 animate-in slide-in-from-bottom-5 fade-in duration-500">
                            <div className="bg-slate-900 overflow-hidden border border-slate-700/50 rounded-3xl p-6 shadow-2xl">
                                <AdminEconomy />
                            </div>
                        </div>
                    )}

                    {/* DISCLAIMER FOOTER */}
                    <div className="text-center text-[10px] text-slate-600 mt-4 max-w-2xl mx-auto">
                        * Estimativas baseadas na dificuldade de rede atual e no seu hashrate. Valores reais podem variar.
                    </div>
                </div>
            </div>
        </div>
    );
};
