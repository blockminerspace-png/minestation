import React, { useEffect, useState } from 'react';
import { User, Upgrade, PlacedRack } from '../types';
import { Users, Zap, Database, Activity, Clock, Trophy, DollarSign, Download, EyeOff, Eye } from 'lucide-react';
import { getGameState, getTopWithdrawalsByCoin, getMiningCoins, getAdminDashboardStats, toggleRankingExclusion, getAdminTreasuryTokenTxs } from '../services/api';

interface AdminDashboardProps {
    users: User[];
    gameUpgrades: Upgrade[];
}

// Helper to calculate production from a save file logic
const calculateUserProduction = (placedRacks: PlacedRack[], upgradesList: Upgrade[]) => {
    let total = 0;
    if (!placedRacks || !Array.isArray(placedRacks)) return 0;
    placedRacks.forEach(rack => {
        if (rack.isOn && rack.wiringId && rack.currentCharge > 0) {
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

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ users, gameUpgrades }) => {
    const [stats, setStats] = useState<{
        totalUsers: number;
        onlineUsers: number;
        totalHashrate: number;
        top10: { username: string; email: string; power: number; coinBalances?: Record<string, number> }[];
        rankingExcluded: { username: string; email: string }[];
        last10: User[];
        totalDeposited: number;
        topDeposits: { username: string; email: string; amount: number }[];
        totalWithdrawn: number;
        topWithdrawalsByCoin: Array<{ coinId: string; coinName: string; top: { username: string; email: string; total: number }[] }>;
    }>({ totalUsers: 0, onlineUsers: 0, totalHashrate: 0, top10: [], rankingExcluded: [], last10: [], totalDeposited: 0, topDeposits: [], totalWithdrawn: 0, topWithdrawalsByCoin: [] });
    const [selectedCoinId, setSelectedCoinId] = useState<string>('');
    const [miningCoins, setMiningCoins] = useState<{ id: string; name: string }[]>([]);

    useEffect(() => {
        let mounted = true;
        let timer: any;
        let lastEthFetch = 0;

        const load = async () => {
            const data = await getAdminDashboardStats();
            if (!data || !mounted) return;

            const coins = await getMiningCoins();
            if (!mounted) return;

            setMiningCoins(coins.map(c => ({ id: c.id, name: c.name })));

            // Sincronizar com a data definida em Relatórios
            const savedStartDate = localStorage.getItem('adminReportsStartDate') || '2025-12-16';
            const startDateTimestamp = Math.floor(new Date(savedStartDate).getTime() / 1000);

            // Calculate Real-Time USDC from Etherscan - Only fetch every 60s to save API limits/performance
            const now = Date.now();
            let realTotalUSDC = data.totalDeposited;
            let filteredTopDeposits = data.topDeposits;

            if (now - lastEthFetch > 60000) {
                try {
                    const TREASURY_WALLET = '0x3D9bDA32f0cbA0E84C332Fd0151D434A4840F38a';
                    const apiData = (await getAdminTreasuryTokenTxs(1, 1000)) as {
                        status?: string;
                        result?: any[];
                    };

                    if (apiData.status === '1' && Array.isArray(apiData.result)) {
                        const validTxs = apiData.result.filter((tx: any) => {
                            return tx.to.toLowerCase() === TREASURY_WALLET.toLowerCase() &&
                                parseInt(tx.timeStamp) >= startDateTimestamp;
                        });

                        const totalRaw = validTxs.reduce((acc: number, tx: any) => acc + parseFloat(tx.value), 0);
                        realTotalUSDC = totalRaw / 1000000;
                        lastEthFetch = now;

                        // Recalcular Top 10 Depósitos do Período
                        const depositMap: Record<string, number> = {};
                        validTxs.forEach((tx: any) => {
                            const from = tx.from.toLowerCase();
                            const val = parseFloat(tx.value) / 1000000;
                            depositMap[from] = (depositMap[from] || 0) + val;
                        });

                        filteredTopDeposits = Object.entries(depositMap)
                            .map(([wallet, amount]) => {
                                const userMatch = users.find(u => u.polygonWallet?.toLowerCase() === wallet);
                                return {
                                    username: userMatch ? userMatch.username : (wallet.substring(0, 6) + '...' + wallet.substring(38)),
                                    email: userMatch ? userMatch.email : 'External Wallet',
                                    amount: amount
                                };
                            })
                            .sort((a, b) => b.amount - a.amount)
                            .slice(0, 10);
                    }
                } catch (err) {
                    console.error("Dashboard USDC Fetch Error:", err);
                }
            } else {
                // Reuse last value or data from DB during the 60s cooldown
                realTotalUSDC = stats.totalDeposited || data.totalDeposited;
                filteredTopDeposits = stats.topDeposits.length > 0 ? stats.topDeposits : data.topDeposits;
            }

            setStats(prev => ({
                ...prev,
                totalUsers: data.totalUsers,
                onlineUsers: data.onlineUsers,
                totalDeposited: realTotalUSDC,
                totalWithdrawn: data.totalWithdrawn,
                last10: data.last10,
                topDeposits: filteredTopDeposits,
                topWithdrawalsByCoin: data.topWithdrawalsByCoin,
                totalHashrate: data.globalPower || 0,
                top10: (data.topMiners || []).map((m: any) => ({
                    username: m.username,
                    email: m.email,
                    power: m.amount
                })),
                rankingExcluded: Array.isArray(data.rankingExcluded) ? data.rankingExcluded : []
            }));

            if (!selectedCoinId && coins.length > 0) setSelectedCoinId(coins[0].id);
        };
        load();
        timer = setInterval(load, 5000); // 5s refresh as per user request
        return () => { mounted = false; if (timer) clearInterval(timer); };
    }, [selectedCoinId]);

    const formatHash = (val: number) => {
        if (val === 0) return "0 H/s";
        if (val < 0.0001) return val.toFixed(8) + " H/s";
        return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 2 }).format(val) + " H/s";
    };
    const formatMoney = (val: number) => {
        try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(val); } catch { return `$${val.toFixed(2)}`; }
    };
    const formatCoin = (val: number) => {
        if (!val) return '0';
        if (val < 0.0001) return val.toFixed(8);
        return Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(val);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 relative overflow-hidden">
                    <Users className="absolute right-4 top-4 text-slate-700" size={64} />
                    <h3 className="text-slate-400 text-xs uppercase tracking-widest font-bold">Usuários Cadastrados</h3>
                    <div className="text-4xl font-bold text-white mt-2">{stats.totalUsers}</div>
                    <div className="text-xs text-green-500 mt-2 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        {stats.onlineUsers} Online Agora
                    </div>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 relative overflow-hidden">
                    <Zap className="absolute right-4 top-4 text-yellow-900/50" size={64} />
                    <h3 className="text-slate-400 text-xs uppercase tracking-widest font-bold">Poder de Mineração Global</h3>
                    <div className="text-4xl font-bold text-yellow-500 mt-2">{formatHash(stats.totalHashrate)}</div>
                    <div className="text-xs text-slate-500 mt-2">Soma de todos os jogadores</div>
                </div>


                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 relative overflow-hidden">
                    <DollarSign className="absolute right-4 top-4 text-green-900/50" size={64} />
                    <h3 className="text-slate-400 text-xs uppercase tracking-widest font-bold">USDC Depositado</h3>
                    <div className="text-4xl font-bold text-green-500 mt-2">{formatMoney(stats.totalDeposited)}</div>
                    <div className="text-xs text-slate-500 mt-2">Acumulado por todos os jogadores</div>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 relative overflow-hidden">
                    <Download className="absolute right-4 top-4 text-red-900/50" size={64} />
                    <h3 className="text-slate-400 text-xs uppercase tracking-widest font-bold">Criptos Sacadas</h3>
                    <div className="text-4xl font-bold text-red-500 mt-2">{formatMoney(stats.totalWithdrawn)}</div>
                    <div className="text-xs text-slate-500 mt-2">Soma de saques em todas moedas</div>
                </div>
            </div>

            {/* Tables Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Last 10 Users */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="p-4 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2">
                            <Clock size={18} className="text-blue-500" /> Últimos Registros
                        </h3>
                    </div>
                    <div className="p-0">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-900/30">
                                <tr>
                                    <th className="px-4 py-2">Usuário</th>
                                    <th className="px-4 py-2 text-right">Email</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {stats.last10.map((u, i) => (
                                    <tr key={i} className="hover:bg-slate-700/30">
                                        <td className="px-4 py-2 font-bold text-slate-200">{u.username}</td>
                                        <td className="px-4 py-2 text-right text-slate-400 text-xs font-mono">{u.email}</td>
                                    </tr>
                                ))}
                                {stats.last10.length === 0 && (
                                    <tr><td colSpan={2} className="px-4 py-4 text-center text-slate-500 italic">Sem registros recentes.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Top 10 Miners */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="p-4 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2">
                            <Trophy size={18} className="text-yellow-500" /> Top 10 Mineradores
                        </h3>
                    </div>
                    <div className="p-0">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-900/30">
                                <tr>
                                    <th className="px-4 py-2">Rank</th>
                                    <th className="px-4 py-2">Usuário</th>
                                    <th className="px-4 py-2 text-right">Hashrate de Mineração</th>
                                    <th className="px-4 py-2 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {stats.top10.map((item, i) => (
                                    <tr key={i} className={`hover:bg-slate-700/30 ${i === 0 ? 'bg-yellow-900/10' : ''}`}>
                                        <td className="px-4 py-2">
                                            {i === 0 && <span className="text-yellow-500 font-bold">#1</span>}
                                            {i === 1 && <span className="text-slate-300 font-bold">#2</span>}
                                            {i === 2 && <span className="text-orange-400 font-bold">#3</span>}
                                            {i > 2 && <span className="text-slate-500">#{i + 1}</span>}
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="font-bold text-slate-200">{item.username}</div>
                                        </td>
                                        <td className="px-4 py-2 text-right text-yellow-400 font-mono text-xs">{formatHash(item.power)}</td>
                                        <td className="px-4 py-2 text-right">
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    if (!window.confirm(`Ocultar ${item.username} do ranking público? Podes voltar a mostrar na secção abaixo.`)) return;
                                                    const r = await toggleRankingExclusion(item.email, true);
                                                    if (!r.ok) {
                                                        alert(r.error || 'Falha ao atualizar');
                                                        return;
                                                    }
                                                    const data = await getAdminDashboardStats();
                                                    if (data) {
                                                        setStats(prev => ({
                                                            ...prev,
                                                            totalUsers: data.totalUsers,
                                                            onlineUsers: data.onlineUsers,
                                                            totalHashrate: data.globalPower || 0,
                                                            top10: (data.topMiners || []).map((m: any) => ({
                                                                username: m.username,
                                                                email: m.email,
                                                                power: m.amount
                                                            })),
                                                            rankingExcluded: Array.isArray(data.rankingExcluded) ? data.rankingExcluded : []
                                                        }));
                                                    }
                                                }}
                                                className="text-slate-500 hover:text-red-400"
                                                title="Ocultar do ranking público"
                                            >
                                                <EyeOff size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {stats.top10.length === 0 && (
                                    <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-500 italic">Sem mineradores ativos.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {stats.rankingExcluded.length > 0 && (
                        <div className="border-t border-slate-700 bg-slate-900/40 p-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Ocultos do ranking ({stats.rankingExcluded.length})</h4>
                            <p className="text-xs text-slate-500 mb-3">Estas contas não aparecem no leaderboard público. Clica no olho para voltarem ao ranking.</p>
                            <ul className="space-y-2 max-h-48 overflow-y-auto">
                                {stats.rankingExcluded.map((row) => (
                                    <li key={row.email} className="flex items-center justify-between gap-2 text-sm text-slate-300">
                                        <span className="truncate"><span className="font-semibold text-slate-200">{row.username}</span> <span className="text-slate-500 text-xs">{row.email}</span></span>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (!window.confirm(`Mostrar ${row.username} de novo no ranking?`)) return;
                                                const r = await toggleRankingExclusion(row.email, false);
                                                if (!r.ok) {
                                                    alert(r.error || 'Falha ao atualizar');
                                                    return;
                                                }
                                                const data = await getAdminDashboardStats();
                                                if (data) {
                                                    setStats(prev => ({
                                                        ...prev,
                                                        totalUsers: data.totalUsers,
                                                        onlineUsers: data.onlineUsers,
                                                        totalHashrate: data.globalPower || 0,
                                                        top10: (data.topMiners || []).map((m: any) => ({
                                                            username: m.username,
                                                            email: m.email,
                                                            power: m.amount
                                                        })),
                                                        rankingExcluded: Array.isArray(data.rankingExcluded) ? data.rankingExcluded : []
                                                    }));
                                                }
                                            }}
                                            className="shrink-0 p-1.5 rounded text-slate-500 hover:text-emerald-400 hover:bg-slate-700/50"
                                            title="Voltar a mostrar no ranking"
                                        >
                                            <Eye size={16} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="p-4 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2">
                            <DollarSign size={18} className="text-green-500" /> Top 10 Depósitos USDC
                        </h3>
                    </div>
                    <div className="p-0">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-900/30">
                                <tr>
                                    <th className="px-4 py-2">Rank</th>
                                    <th className="px-4 py-2">Usuário</th>
                                    <th className="px-4 py-2 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {stats.topDeposits.map((item, i) => (
                                    <tr key={i} className={`hover:bg-slate-700/30 ${i === 0 ? 'bg-green-900/10' : ''}`}>
                                        <td className="px-4 py-2">
                                            {i === 0 && <span className="text-green-500 font-bold">#1</span>}
                                            {i === 1 && <span className="text-slate-300 font-bold">#2</span>}
                                            {i === 2 && <span className="text-green-400 font-bold">#3</span>}
                                            {i > 2 && <span className="text-slate-500">#{i + 1}</span>}
                                        </td>
                                        <td className="px-4 py-2 font-bold text-slate-200">{item.username}</td>
                                        <td className="px-4 py-2 text-right text-green-400 font-mono text-xs">{formatMoney(item.amount)}</td>
                                    </tr>
                                ))}
                                {stats.topDeposits.length === 0 && (
                                    <tr><td colSpan={3} className="px-4 py-4 text-center text-slate-500 italic">Sem depósitos registrados.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="p-4 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2">
                            <Download size={18} className="text-red-500" /> Top 10 Saques • {miningCoins.find(c => c.id === selectedCoinId)?.name || '—'}
                        </h3>
                        <div className="flex items-center gap-2">
                            <select
                                value={selectedCoinId}
                                onChange={(e) => setSelectedCoinId(e.target.value)}
                                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1"
                            >
                                {miningCoins.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="p-0">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-900/30">
                                <tr>
                                    <th className="px-4 py-2">Rank</th>
                                    <th className="px-4 py-2">Usuário</th>
                                    <th className="px-4 py-2 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {(stats.topWithdrawalsByCoin.find(c => c.coinId === selectedCoinId)?.top || []).map((item, i) => (
                                    <tr key={i} className={`hover:bg-slate-700/30 ${i === 0 ? 'bg-red-900/10' : ''}`}>
                                        <td className="px-4 py-2">
                                            {i === 0 && <span className="text-red-500 font-bold">#1</span>}
                                            {i === 1 && <span className="text-slate-300 font-bold">#2</span>}
                                            {i === 2 && <span className="text-orange-400 font-bold">#3</span>}
                                            {i > 2 && <span className="text-slate-500">#{i + 1}</span>}
                                        </td>
                                        <td className="px-4 py-2 font-bold text-slate-200">{item.username}</td>
                                        <td className="px-4 py-2 text-right text-red-400 font-mono text-xs">{formatMoney(item.total)}</td>
                                    </tr>
                                ))}
                                {(stats.topWithdrawalsByCoin.find(c => c.coinId === selectedCoinId)?.top || []).length === 0 && (
                                    <tr><td colSpan={3} className="px-4 py-4 text-center text-slate-500 italic">Sem saques registrados.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
