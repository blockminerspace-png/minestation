import React, { useCallback, useEffect, useRef, useState } from 'react';
import { User, Upgrade, PlacedRack } from '../types';
import { Users, Zap, Database, Activity, Clock, Trophy, DollarSign, Download, EyeOff, Eye } from 'lucide-react';
import { getGameState, getTopWithdrawalsByCoin, getMiningCoins, getAdminDashboardStats, toggleRankingExclusion, getAdminTreasuryTokenTxs, getWeb3Settings } from '../services/api';

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
        /** Valor mostrado no cartão (cadeia ou BD). */
        totalDeposited: number;
        /** Sempre o agregado da BD (game_states), para comparar quando o cartão mostra on-chain. */
        dbTotalDeposited: number;
        depositDisplayMode: 'chain' | 'db';
        topDeposits: { username: string; email: string; amount: number }[];
        totalWithdrawn: number;
        topWithdrawalsByCoin: Array<{ coinId: string; coinName: string; top: { username: string; email: string; total: number }[] }>;
    }>({
        totalUsers: 0,
        onlineUsers: 0,
        totalHashrate: 0,
        top10: [],
        rankingExcluded: [],
        last10: [],
        totalDeposited: 0,
        dbTotalDeposited: 0,
        depositDisplayMode: 'db',
        topDeposits: [],
        totalWithdrawn: 0,
        topWithdrawalsByCoin: []
    });
    const [selectedCoinId, setSelectedCoinId] = useState<string>('');
    const [miningCoins, setMiningCoins] = useState<{ id: string; name: string }[]>([]);
    const [statsError, setStatsError] = useState<string | null>(null);
    const [wsConnected, setWsConnected] = useState(false);
    const lastEthFetchRef = useRef(0);
    /** Último total on-chain + top depósitos; o WebSocket não pode sobrescrever isto até expirar o TTL. */
    const chainDepositSnapshotRef = useRef<{
        totalDeposited: number;
        topDeposits: { username: string; email: string; amount: number }[];
        fetchedAt: number;
    } | null>(null);
    /** Manter snapshot visível pelo menos até à próxima janela de refresh Etherscan (60s) + margem. */
    const CHAIN_DEPOSIT_SNAPSHOT_TTL_MS = 70_000;

    const applyServerDashboard = useCallback((data: any) => {
        const snap = chainDepositSnapshotRef.current;
        const useChain =
            snap != null && Date.now() - snap.fetchedAt < CHAIN_DEPOSIT_SNAPSHOT_TTL_MS;
        setStats(prev => ({
            ...prev,
            totalUsers: data.totalUsers,
            onlineUsers: data.onlineUsers,
            dbTotalDeposited: data.totalDeposited,
            totalDeposited: useChain ? snap!.totalDeposited : data.totalDeposited,
            depositDisplayMode: useChain ? 'chain' : 'db',
            totalWithdrawn: data.totalWithdrawn,
            last10: data.last10,
            topDeposits: useChain ? snap!.topDeposits : data.topDeposits,
            topWithdrawalsByCoin: data.topWithdrawalsByCoin,
            totalHashrate: data.globalPower || 0,
            top10: (data.topMiners || []).map((m: any) => ({
                username: m.username,
                email: m.email,
                power: m.amount
            })),
            rankingExcluded: Array.isArray(data.rankingExcluded) ? data.rankingExcluded : []
        }));
    }, []);

    const tryApplyEtherscanDeposits = useCallback(async () => {
        const now = Date.now();
        if (now - lastEthFetchRef.current < 60000) return;
        try {
            const savedStartDate = localStorage.getItem('adminReportsStartDate') || '2025-12-16';
            const savedEndDate = localStorage.getItem('adminReportsEndDate') || '';
            const parseYmdStartSec = (ymd: string) => {
                const m = /^\d{4}-\d{2}-\d{2}$/.exec(ymd);
                if (!m) return 0;
                const [y, mo, d] = ymd.split('-').map(Number);
                return Math.floor(new Date(y, mo - 1, d, 0, 0, 0, 0).getTime() / 1000);
            };
            const parseYmdEndSec = (ymd: string) => {
                if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
                const [y, mo, d] = ymd.split('-').map(Number);
                return Math.floor(new Date(y, mo - 1, d, 23, 59, 59, 999).getTime() / 1000);
            };
            const startDateTimestamp = parseYmdStartSec(savedStartDate);
            const endDateTimestamp = parseYmdEndSec(savedEndDate);
            const web3 = await getWeb3Settings();
            const dw = web3?.depositWallet?.trim();
            /** Só totais on-chain para a carteira de depósito cadastrada em Web3 (settings). Sem cadastro válido, não misturar legado/fallback. */
            if (!dw || !/^0x[a-fA-F0-9]{40}$/.test(dw)) {
                if (chainDepositSnapshotRef.current != null) {
                    chainDepositSnapshotRef.current = null;
                    const dash = await getAdminDashboardStats();
                    if (dash) applyServerDashboard(dash);
                }
                lastEthFetchRef.current = now;
                return;
            }
            const depositWalletLower = dw.toLowerCase();
            const apiRes = (await getAdminTreasuryTokenTxs(1, 1000, dw)) as {
                status?: string | number;
                result?: any[] | string;
                message?: string;
            };
            const rows =
                apiRes.status != null && String(apiRes.status) === '1' && Array.isArray(apiRes.result) ? apiRes.result : [];
            const validTxs = rows.filter((tx: any) => {
                if (String(tx.to || '').toLowerCase() !== depositWalletLower) return false;
                const ts = parseInt(tx.timeStamp, 10);
                if (ts < startDateTimestamp) return false;
                if (endDateTimestamp != null && ts > endDateTimestamp) return false;
                return true;
            });
            const totalRaw = validTxs.reduce((acc: number, tx: any) => acc + parseFloat(tx.value), 0);
            const realTotalUSDC = totalRaw / 1000000;
            lastEthFetchRef.current = now;
            const depositMap: Record<string, number> = {};
            validTxs.forEach((tx: any) => {
                const from = tx.from.toLowerCase();
                const val = parseFloat(tx.value) / 1000000;
                depositMap[from] = (depositMap[from] || 0) + val;
            });
            const filteredTopDeposits = Object.entries(depositMap)
                .map(([wallet, amount]) => {
                    const userMatch = users.find(u => u.polygonWallet?.toLowerCase() === wallet);
                    return {
                        username: userMatch ? userMatch.username : (wallet.substring(0, 6) + '...' + wallet.substring(38)),
                        email: userMatch ? userMatch.email : 'External Wallet',
                        amount: amount as number
                    };
                })
                .sort((a, b) => b.amount - a.amount)
                .slice(0, 10);
            const fetchedAt = Date.now();
            chainDepositSnapshotRef.current = {
                totalDeposited: realTotalUSDC,
                topDeposits: filteredTopDeposits,
                fetchedAt
            };
            setStats(prev => ({
                ...prev,
                totalDeposited: realTotalUSDC,
                topDeposits: filteredTopDeposits,
                depositDisplayMode: 'chain'
            }));
        }
        catch (err) {
            console.error('Dashboard USDC Fetch Error:', err);
        }
    }, [users, applyServerDashboard]);

    useEffect(() => {
        let mounted = true;

        const initialLoad = async () => {
            const data = await getAdminDashboardStats();
            if (!mounted) return;
            if (!data) {
                setStatsError('Não foi possível carregar /api/admin/dashboard-stats (resposta vazia ou erro 500). Confira os logs do servidor — por exemplo coluna em falta na tabela sessions.');
                return;
            }
            setStatsError(null);
            const coins = await getMiningCoins();
            if (!mounted) return;
            setMiningCoins(coins.map(c => ({ id: c.id, name: c.name })));
            applyServerDashboard(data);
            await tryApplyEtherscanDeposits();
            if (!mounted) return;
            setSelectedCoinId(prev => prev || (coins.length > 0 ? coins[0].id : ''));
        };

        void initialLoad();

        let ws: WebSocket | null = null;
        let stopped = false;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        const handleWsMessage = (ev: MessageEvent) => {
            let msg: { type?: string; event?: string; data?: any };
            try {
                msg = JSON.parse(String(ev.data)) as typeof msg;
            }
            catch {
                return;
            }
            if (msg.type !== 'admin_dashboard' || msg.event !== 'stats' || !msg.data || !mounted) return;
            applyServerDashboard(msg.data);
        };

        const openWs = () => {
            if (stopped) return;
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const url = `${proto}//${window.location.host}/ws/admin-dashboard`;
            try {
                ws = new WebSocket(url);
            }
            catch {
                reconnectTimer = setTimeout(openWs, 3500);
                return;
            }
            ws.onopen = () => { if (mounted) setWsConnected(true); };
            ws.onmessage = handleWsMessage;
            ws.onclose = () => {
                if (mounted) setWsConnected(false);
                ws = null;
                if (!stopped) {
                    if (reconnectTimer) clearTimeout(reconnectTimer);
                    reconnectTimer = setTimeout(openWs, 3500);
                }
            };
            ws.onerror = () => {
                try {
                    ws?.close();
                }
                catch {
                    /* ignore */
                }
            };
        };
        openWs();

        const ethTimer = window.setInterval(() => { void tryApplyEtherscanDeposits(); }, 60000);

        return () => {
            mounted = false;
            stopped = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            window.clearInterval(ethTimer);
            try {
                ws?.close();
            }
            catch {
                /* ignore */
            }
        };
    }, [applyServerDashboard, tryApplyEtherscanDeposits]);

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
            {statsError && (
                <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
                    <span className="font-bold text-amber-400">Dashboard:</span> {statsError}
                </div>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500" aria-live="polite">
                <span className={`inline-block h-2 w-2 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-600'}`} title={wsConnected ? 'WebSocket ligado' : 'A ligar WebSocket…'} />
                {wsConnected ? 'Métricas em tempo real (WebSocket)' : 'A sincronizar métricas… (HTTP + WS)'}
            </div>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 relative overflow-hidden">
                    <Users className="absolute right-4 top-4 text-slate-700" size={64} />
                    <h3 className="text-slate-400 text-xs uppercase tracking-widest font-bold">Usuários Cadastrados</h3>
                    <div className="text-4xl font-bold text-white mt-2">{stats.totalUsers}</div>
                    <div
                        className="text-xs text-green-500 mt-2 flex items-center gap-1"
                        title="Apenas contas jogador (não-admin). Sessão válida em BD e última atividade na API nos últimos 4 minutos (last_seen_at). Zero é normal se ninguém acabou de usar o site."
                    >
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        {stats.onlineUsers} com sessão ativa
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
                    {stats.depositDisplayMode === 'chain' ? (
                        <p className="text-[11px] text-slate-500 mt-2 leading-snug">
                            <span className="text-emerald-400/90 font-semibold">On-chain</span>
                            {' — '}soma de transferências USDC (Polygon) para a carteira de depósito cadastrada em Web3, filtradas pelas datas em Relatórios.
                            {' '}
                            <span className="text-slate-400">No jogo (BD): {formatMoney(stats.dbTotalDeposited)}</span>
                        </p>
                    ) : (
                        <p className="text-[11px] text-slate-500 mt-2 leading-snug">
                            Soma de <span className="text-slate-400">total_usdc_deposited</span> na base (registo interno do jogo).
                            Com carteira de depósito Web3 válida e Etherscan, mostramos também o total recebido nessa carteira na cadeia.
                        </p>
                    )}
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
                            <Clock size={18} className="text-amber-500" /> Últimos Registros
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
                                                    if (!window.confirm(`Ocultar ${item.username} do ranking público? Você pode voltar a mostrar na seção abaixo.`)) return;
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
