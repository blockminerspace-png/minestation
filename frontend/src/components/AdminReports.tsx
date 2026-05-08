import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { RefreshCw, ExternalLink, Eye, Copy, ArrowRight, Filter, ChevronLeft, ChevronRight, Calendar, User, Mail, Pencil, Download, Search, X as CloseIcon, Calculator, LayoutList, Wallet, Plus, Trash2, Save, Settings } from 'lucide-react';
import { PlayerCalculator } from './PlayerCalculator';
import { User as UserType, MiningCoin, Upgrade } from '../types';
import { getWalletLabels, saveWalletLabel, getMiningCoins, getUpgrades, saveMiningCoin, deleteMiningCoin, getAdminTreasuryTokenTxs, getWeb3Settings } from '../services/api';

import { AdminManualWithdrawals } from './AdminManualWithdrawals';

/** Fallback se `web3_deposit_wallet` estiver vazio nas settings */
const TREASURY_WALLET_FALLBACK = '0x3D9bDA32f0cbA0E84C332Fd0151D434A4840F38a';
const TREASURY_WALLET_LEGACY = '0x2c386Bf962339B497d5EC6A0EdB255D30004F3B6';
/** Carteira antiga — fase lançamento (USDC Polygon). */
const TREASURY_WALLET_LEGACY_LAUNCH = '0x33d2406707e5e4b314d15784e73bb08f0c46db42';

interface Transaction {
    hash: string;
    timeStamp: string;
    from: string;
    to: string;
    value: string;
    tokenSymbol: string;
    functionName: string;
    blockNumber: string;
    methodId: string;
}

interface AdminReportsProps {
    users?: UserType[];
    /** Operador admin (não super): só Transações USDC; sem calculadora nem saques manuais. */
    currentUser?: UserType | null;
}

/** Início do dia local (YYYY-MM-DD) em segundos UNIX */
function ymdStartOfDaySeconds(ymd: string): number | null {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return Math.floor(new Date(y, m - 1, d, 0, 0, 0, 0).getTime() / 1000);
}

/** Fim do dia local (YYYY-MM-DD) em segundos UNIX */
function ymdEndOfDaySeconds(ymd: string): number | null {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return Math.floor(new Date(y, m - 1, d, 23, 59, 59, 999).getTime() / 1000);
}

const EXPORT_PAGE_SIZE = 1000;
const MAX_EXPORT_API_PAGES = 80;
const EXPORT_PAGE_DELAY_MS = 120;

/** Até 8 casas decimais na UI (evita notação científica longa na lista de moedas). */
function formatAdminDecimalMax8(value: unknown): string {
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(n)) return '0';
    const fixed = n.toFixed(8);
    return fixed.replace(/\.?0+$/, '') || '0';
}

function resolveMiningCoinDisplayPrice(coin: Partial<MiningCoin> | null | undefined): number {
    if (!coin) return 0;
    const candidates = [coin.displayPriceUsd, coin.livePriceUsd, coin.priceUSD];
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
            return candidate;
        }
    }
    return 0;
}

export const AdminReports: React.FC<AdminReportsProps> = ({ users = [], currentUser = null }) => {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(false);
    const [csvExportBusy, setCsvExportBusy] = useState<'none' | 'full' | 'filtered'>('none');
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [limit] = useState(20);
    const [filterPeriod, setFilterPeriod] = useState<'all' | 'day' | 'year'>('all');
    const [searchTerm, setSearchTerm] = useState(() => localStorage.getItem('adminReportsSearchTerm') || '');
    const [subtab, setSubtab] = useState<'transactions' | 'calculator' | 'withdrawals'>(() => (localStorage.getItem('adminReportsSubtab') as any) || 'transactions');

    const reportsOperatorRestricted = !!(currentUser?.isAdmin && !currentUser?.isSuperAdmin);

    useEffect(() => {
        if (!reportsOperatorRestricted) return;
        if (subtab === 'calculator' || subtab === 'withdrawals') {
            setSubtab('transactions');
            localStorage.setItem('adminReportsSubtab', 'transactions');
        }
    }, [reportsOperatorRestricted, subtab]);
    const [treasurySource, setTreasurySource] = useState<'registered' | 'legacy' | 'legacy_launch'>(() => {
        const s = localStorage.getItem('adminReportsTreasurySource');
        if (s === 'legacy') return 'legacy';
        if (s === 'legacy_launch') return 'legacy_launch';
        return 'registered';
    });
    /** Carteira de depósito nas settings Web3 (Polygon USDC); fallback só se não houver cadastro válido */
    const [registeredTreasury, setRegisteredTreasury] = useState<string>(TREASURY_WALLET_FALLBACK);
    const treasuryWallet =
        treasurySource === 'legacy'
            ? TREASURY_WALLET_LEGACY
            : treasurySource === 'legacy_launch'
              ? TREASURY_WALLET_LEGACY_LAUNCH
              : registeredTreasury;

    const [miningCoins, setMiningCoins] = useState<MiningCoin[]>([]);
    const [upgrades, setUpgrades] = useState<Upgrade[]>([]);

    // Coin Management States
    const [showCoinManager, setShowCoinManager] = useState(false);
    const [editingCoin, setEditingCoin] = useState<Partial<MiningCoin> | null>(null);
    const [isSavingCoin, setIsSavingCoin] = useState(false);

    const loadCalcData = async () => {
        try {
            const [mc, up] = await Promise.all([getMiningCoins(), getUpgrades()]);
            setMiningCoins(Array.isArray(mc) ? mc : []);
            setUpgrades(Array.isArray(up) ? up : []);
        } catch (e) {
            console.error("Failed to load calc data", e);
        }
    };



    // Filters & Toggles
    const [showEmail, setShowEmail] = useState(false);
    const [startDate, setStartDate] = useState(() => localStorage.getItem('adminReportsStartDate') || '2025-12-16');
    const [endDate, setEndDate] = useState(() => localStorage.getItem('adminReportsEndDate') || '');

    // Wallet Labels
    const [walletLabels, setWalletLabels] = useState<Record<string, string>>({});

    const loadLabels = async () => {
        try {
            const labels = await getWalletLabels();
            const map: Record<string, string> = {};
            labels.forEach(l => map[l.address.toLowerCase()] = l.label);
            setWalletLabels(map);
        } catch (e) {
            console.error("Failed to load labels", e);
        }
    };

    useEffect(() => {
        loadLabels();
        loadCalcData();
        void getWeb3Settings().then((s) => {
            const w = s?.depositWallet?.trim();
            if (w && /^0x[a-fA-F0-9]{40}$/.test(w)) {
                setRegisteredTreasury(w);
            } else {
                setRegisteredTreasury(TREASURY_WALLET_FALLBACK);
            }
        });
    }, []);

    useEffect(() => {
        if (subtab !== 'calculator') return;
        const timer = window.setInterval(() => {
            void loadCalcData();
        }, 60_000);
        return () => window.clearInterval(timer);
    }, [subtab]);

    const handleSaveCoin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (reportsOperatorRestricted) return;
        if (!editingCoin || !editingCoin.name || !editingCoin.symbol) return;

        setIsSavingCoin(true);
        try {
            const res = await saveMiningCoin(editingCoin);
            if (res.ok) {
                await loadCalcData();
                setEditingCoin(null);
                setShowCoinManager(true);
            } else {
                alert("Erro ao salvar: " + (res.error || "Desconhecido"));
            }
        } catch (err: any) {
            alert("Erro de rede: " + err.message);
        } finally {
            setIsSavingCoin(false);
        }
    };

    const handleDeleteCoin = async (id: string) => {
        if (reportsOperatorRestricted) return;
        if (!window.confirm("Tem certeza que deseja excluir esta moeda? Esta ação não pode ser desfeita.")) return;
        try {
            const res = await deleteMiningCoin(id);
            if (res.ok) {
                await loadCalcData();
            } else {
                alert("Erro ao excluir: " + (res.error || "Desconhecido"));
            }
        } catch (err: any) {
            alert("Erro de rede: " + err.message);
        }
    };


    const handleEditLabel = async (address: string) => {
        if (reportsOperatorRestricted) {
            alert('Apenas super administradores podem editar rótulos de carteiras (configuração Web3).');
            return;
        }
        const current = walletLabels[address.toLowerCase()] || '';
        const newLabel = window.prompt(`Nomear carteira ${address}:`, current);
        if (newLabel !== null && newLabel !== current) {
            await saveWalletLabel(address, newLabel);
            await loadLabels();
        }
    };

    const fetchTransactions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const raw = (await getAdminTreasuryTokenTxs(page, limit, treasuryWallet)) as Record<string, unknown>;
            const statusVal = raw?.status != null ? String(raw.status) : '';
            const message = typeof raw?.message === 'string' ? raw.message : '';
            const result = raw?.result;

            if (statusVal === '1' && Array.isArray(result)) {
                setTransactions(result as Transaction[]);
                return;
            }

            const msgLower = message.toLowerCase();
            const emptyList =
                (Array.isArray(result) && result.length === 0) ||
                msgLower.includes('no transaction') ||
                msgLower.includes('no records found');

            if (emptyList) {
                setTransactions([]);
                return;
            }

            if (typeof result === 'string' && result.trim()) {
                setError(`${message ? `${message}: ` : ''}${result}`.trim());
                return;
            }

            console.error('API treasury txs:', message, result);
            setError(message || 'Não foi possível carregar as transações USDC do treasury.');
        } catch (err) {
            console.error('Fetch error:', err);
            const detail = err instanceof Error ? err.message : '';
            setError(detail ? detail : 'Erro de conexão. Verifique a rede ou as permissões de administrador.');
        } finally {
            setLoading(false);
        }
    }, [page, limit, treasuryWallet]);

    useEffect(() => {
        void fetchTransactions();
    }, [fetchTransactions]);

    // Helpers
    const truncateMiddle = (text: string, startChars: number = 6, endChars: number = 4) => {
        if (!text) return '';
        if (text.length <= startChars + endChars) return text;
        return `${text.substring(0, startChars)}...${text.substring(text.length - endChars)}`;
    };

    const formatDate = (timestamp: string) => {
        return new Date(parseInt(timestamp) * 1000).toLocaleString('pt-BR');
    };

    const resolveUser = (address: string) => {
        if (!address) return null;
        const normalizedAddr = address.toLowerCase();
        return users.find(u => u.polygonWallet?.toLowerCase() === normalizedAddr);
    };

    const applyClientTxFilters = useCallback(
        (txs: Transaction[]) => {
            let out = txs;
            const startTs = ymdStartOfDaySeconds(startDate);
            if (startTs != null) {
                out = out.filter(tx => parseInt(tx.timeStamp, 10) >= startTs);
            }
            const endTs = ymdEndOfDaySeconds(endDate);
            if (endTs != null) {
                out = out.filter(tx => parseInt(tx.timeStamp, 10) <= endTs);
            }
            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase().trim();
                out = out.filter(tx => {
                    const isIncoming = tx.to.toLowerCase() === treasuryWallet.toLowerCase();
                    const counterPartyAddr = isIncoming ? tx.from : tx.to;
                    const userMatch = users.find(u => u.polygonWallet?.toLowerCase() === counterPartyAddr.toLowerCase());
                    const label = walletLabels[counterPartyAddr.toLowerCase()] || '';
                    return (
                        (userMatch && userMatch.username.toLowerCase().includes(term)) ||
                        (userMatch && userMatch.email.toLowerCase().includes(term)) ||
                        counterPartyAddr.toLowerCase().includes(term) ||
                        label.toLowerCase().includes(term) ||
                        tx.hash.toLowerCase().includes(term)
                    );
                });
            }
            return out;
        },
        [startDate, endDate, searchTerm, users, walletLabels, treasuryWallet]
    );

    // Derived Data
    const filteredTransactions = useMemo(
        () => applyClientTxFilters(transactions),
        [transactions, applyClientTxFilters]
    );

    const getGroupedTransactions = () => {
        if (filterPeriod === 'all') return { 'Todas as Transações': filteredTransactions };

        const groups: { [key: string]: Transaction[] } = {};
        filteredTransactions.forEach(tx => {
            const date = new Date(parseInt(tx.timeStamp) * 1000);
            let key = '';
            if (filterPeriod === 'day') key = date.toLocaleDateString('pt-BR'); // DD/MM/YYYY
            if (filterPeriod === 'year') key = date.getFullYear().toString();   // YYYY

            if (!groups[key]) groups[key] = [];
            groups[key].push(tx);
        });
        return groups;
    };

    const buildCsvFromTransactions = useCallback(
        (txs: Transaction[]) => {
            const headers = ['Data', 'Hash', 'Usuario', 'Email', 'Carteira', 'Label', 'Tipo', 'Valor (USDC)'];
            const rows = txs.map(tx => {
                const isIncoming = tx.to.toLowerCase() === treasuryWallet.toLowerCase();
                const counterPartyAddr = isIncoming ? tx.from : tx.to;
                const userMatch = users.find(u => u.polygonWallet?.toLowerCase() === counterPartyAddr.toLowerCase());
                const label = walletLabels[counterPartyAddr.toLowerCase()] || '';
                const amount = parseFloat(tx.value) / 1000000;
                return [
                    formatDate(tx.timeStamp),
                    tx.hash,
                    userMatch ? userMatch.username : 'Desconhecido',
                    userMatch ? userMatch.email : '',
                    counterPartyAddr,
                    label,
                    isIncoming ? 'ENTRADA' : 'SAIDA',
                    amount.toFixed(2)
                ];
            });
            return [headers.join(','), ...rows.map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))].join('\n');
        },
        [treasuryWallet, walletLabels, users]
    );

    const triggerCsvDownload = (csvContent: string, filenameBase: string) => {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${filenameBase}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const fetchAllTreasuryPagesForExport = useCallback(async (): Promise<Transaction[]> => {
        const merged: Transaction[] = [];
        const seen = new Set<string>();
        for (let p = 1; p <= MAX_EXPORT_API_PAGES; p++) {
            const raw = (await getAdminTreasuryTokenTxs(p, EXPORT_PAGE_SIZE, treasuryWallet)) as Record<string, unknown>;
            const st = raw?.status != null ? String(raw.status) : '';
            if (st !== '1' || !Array.isArray(raw.result)) break;
            const batch = raw.result as Transaction[];
            for (const tx of batch) {
                const h = (tx.hash || '').toLowerCase();
                if (h && seen.has(h)) continue;
                if (h) seen.add(h);
                merged.push(tx);
            }
            if (batch.length < EXPORT_PAGE_SIZE) break;
            if (p < MAX_EXPORT_API_PAGES) {
                await new Promise(r => setTimeout(r, EXPORT_PAGE_DELAY_MS));
            }
        }
        return merged;
    }, [treasuryWallet]);

    const csvExportLockRef = useRef(false);
    const handleExportCsv = useCallback(
        async (mode: 'full' | 'filtered') => {
            if (csvExportLockRef.current) return;
            csvExportLockRef.current = true;
            setCsvExportBusy(mode);
            try {
                const all = await fetchAllTreasuryPagesForExport();
                const slice = mode === 'full' ? all : applyClientTxFilters(all);
                if (slice.length === 0) {
                    alert(
                        mode === 'full'
                            ? 'Não foi possível obter transações para exportar.'
                            : 'Nenhuma transação corresponde aos filtros (datas / busca) nos dados obtidos.'
                    );
                    return;
                }
                const tag = mode === 'full' ? 'transacoes_usdc_completo' : 'transacoes_usdc_filtrado';
                triggerCsvDownload(buildCsvFromTransactions(slice), tag);
            } catch (e) {
                console.error('Export CSV:', e);
                alert(e instanceof Error ? e.message : 'Erro ao exportar CSV.');
            } finally {
                csvExportLockRef.current = false;
                setCsvExportBusy('none');
            }
        },
        [fetchAllTreasuryPagesForExport, applyClientTxFilters, buildCsvFromTransactions]
    );

    const groupedData = getGroupedTransactions();

    return (
        <div className="space-y-6 flex flex-col h-full">
            {/* SUBTAB NAVIGATION */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 pb-3">
                <button
                    onClick={() => {
                        setSubtab('transactions');
                        localStorage.setItem('adminReportsSubtab', 'transactions');
                    }}
                    className={`px-4 py-2 text-sm font-bold rounded border flex items-center gap-2 transition-all ${subtab === 'transactions' ? 'bg-amber-600/20 text-white border-amber-600/50 shadow-[0_0_10px_rgba(217,119,6,0.1)]' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                >
                    <LayoutList size={16} />
                    Transações USDC
                </button>
                {!reportsOperatorRestricted && (
                    <>
                        <button
                            onClick={() => {
                                setSubtab('calculator');
                                localStorage.setItem('adminReportsSubtab', 'calculator');
                            }}
                            className={`px-4 py-2 text-sm font-bold rounded border flex items-center gap-2 transition-all ${subtab === 'calculator' ? 'bg-amber-600/20 text-white border-amber-600/50 shadow-[0_0_10px_rgba(217,119,6,0.1)]' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                        >
                            <Calculator size={16} />
                            Calculadora Mining
                        </button>
                        <button
                            onClick={() => {
                                setSubtab('withdrawals');
                                localStorage.setItem('adminReportsSubtab', 'withdrawals');
                            }}
                            className={`px-4 py-2 text-sm font-bold rounded border flex items-center gap-2 transition-all ${subtab === 'withdrawals' ? 'bg-amber-600/20 text-white border-amber-600/50 shadow-[0_0_10px_rgba(217,119,6,0.1)]' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                        >
                            <Wallet size={16} />
                            Saques Manuais
                        </button>
                    </>
                )}
                {reportsOperatorRestricted && (
                    <span className="text-[10px] text-slate-500 uppercase font-bold border border-slate-700 rounded px-2 py-1">
                        Operador: apenas transações USDC
                    </span>
                )}
            </div>


            {subtab === 'calculator' && !reportsOperatorRestricted && (
                <div className="flex-1 overflow-auto custom-scrollbar flex flex-col gap-6">
                    <div className="flex items-center justify-between px-6 py-2 bg-slate-800/30 rounded-lg border border-slate-700/50">
                        <div className="flex items-center gap-2">
                            <Calculator size={20} className="text-amber-400" />
                            <h3 className="font-bold text-white">Gestão da Calculadora</h3>
                        </div>
                        <button
                            onClick={() => {
                                setShowCoinManager(!showCoinManager);
                                setEditingCoin(null);
                            }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs transition-all ${showCoinManager ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/20' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                        >
                            <Settings size={14} />
                            {showCoinManager ? 'Ver Calculadora' : 'Configurar Moedas'}
                        </button>
                    </div>

                    {showCoinManager ? (
                        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-top-4 duration-300">
                            {/* Coin List & Form */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Form */}
                                <div className="lg:col-span-1 bg-slate-900 rounded-xl border border-slate-800 p-6">
                                    <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                        {editingCoin?.id ? <Pencil size={14} /> : <Plus size={14} />}
                                        {editingCoin?.id ? 'Editar Moeda' : 'Nova Moeda'}
                                    </h4>
                                    <form onSubmit={handleSaveCoin} className="space-y-4">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-slate-500">Nome</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={editingCoin?.name || ''}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, name: e.target.value }))}
                                                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none"
                                                    placeholder="Bitcoin"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-slate-500">Símbolo</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={editingCoin?.symbol || ''}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, symbol: e.target.value }))}
                                                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none"
                                                    placeholder="BTC"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-slate-500">Descrição</label>
                                            <input
                                                type="text"
                                                value={editingCoin?.description || ''}
                                                onChange={e => setEditingCoin(prev => ({ ...prev, description: e.target.value }))}
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none"
                                                placeholder="Moeda principal..."
                                            />
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-slate-500">Preço USD</label>
                                            <input
                                                type="number"
                                                step="0.00000001"
                                                value={editingCoin?.priceUSD || 0}
                                                onChange={e => setEditingCoin(prev => ({ ...prev, priceUSD: parseFloat(e.target.value) }))}
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none font-mono"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-slate-500">Recompensa Bloco</label>
                                                <input
                                                    type="number"
                                                    step="0.00000001"
                                                    value={editingCoin?.blockReward || 0}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, blockReward: parseFloat(e.target.value) }))}
                                                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none font-mono"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-slate-500">Tempo de bloco</label>
                                                <div className="w-full rounded border border-slate-700 bg-slate-800/70 px-3 py-2 text-sm font-mono text-slate-300">
                                                    600 s (10 min) — fixo na economia
                                                </div>
                                                <p className="text-[10px] text-slate-500 leading-snug mt-1">
                                                    Com 10 min por bloco: <span className="text-amber-500/90 font-mono">144</span> blocos/dia e{' '}
                                                    <span className="text-amber-500/90 font-mono">4464</span> blocos/mês (31 dias). Mudar só preço USD não altera yield por hash nem deve duplicar entradas no histórico.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-slate-500">Hashrate Rede (H/s)</label>
                                            <input
                                                type="number"
                                                value={editingCoin?.networkHashrate || 0}
                                                onChange={e => setEditingCoin(prev => ({ ...prev, networkHashrate: parseFloat(e.target.value) }))}
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none font-mono"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-slate-500">Algoritmo</label>
                                                <input
                                                    type="text"
                                                    value={editingCoin?.algorithm || ''}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, algorithm: e.target.value }))}
                                                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none"
                                                    placeholder="SHA-256"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-slate-500">Dificuldade</label>
                                                <input
                                                    type="number"
                                                    value={editingCoin?.difficulty || 1}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, difficulty: parseFloat(e.target.value) }))}
                                                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none font-mono"
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-slate-500">Multiplicador</label>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    value={editingCoin?.multiplier || 1}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, multiplier: parseFloat(e.target.value) }))}
                                                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none font-mono"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-slate-500">Prop. Mínima</label>
                                                <input
                                                    type="number"
                                                    step="0.000000000001"
                                                    value={editingCoin?.minProportion || 0}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, minProportion: parseFloat(e.target.value) }))}
                                                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none font-mono"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-slate-500">Meta Diária USD (Auto-Ajuste)</label>
                                            <input
                                                type="number"
                                                value={editingCoin?.targetDailyUSD || 0}
                                                onChange={e => setEditingCoin(prev => ({ ...prev, targetDailyUSD: parseFloat(e.target.value) }))}
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-amber-500 outline-none font-mono"
                                            />
                                        </div>

                                        <div className="grid grid-cols-3 gap-3">
                                            <label className="col-span-1 flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={editingCoin?.isActive !== false}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, isActive: e.target.checked }))}
                                                    className="w-4 h-4 rounded border-slate-700 bg-slate-800"
                                                />
                                                <span className="text-xs text-white">Ativa</span>
                                            </label>
                                            <label className="col-span-2 flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={editingCoin?.showInExchange !== false}
                                                    onChange={e => setEditingCoin(prev => ({ ...prev, showInExchange: e.target.checked }))}
                                                    className="w-4 h-4 rounded border-slate-700 bg-slate-800"
                                                />
                                                <span className="text-xs text-white">Mostrar Exchange</span>
                                            </label>
                                        </div>

                                        <div className="flex gap-2 pt-2">
                                            <button
                                                type="submit"
                                                disabled={isSavingCoin}
                                                className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 py-2 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-2 transition-colors"
                                            >
                                                <Save size={16} />
                                                {isSavingCoin ? 'Salvando...' : 'Salvar Moeda'}
                                            </button>
                                            {editingCoin && (
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingCoin(null)}
                                                    className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-400 hover:text-white rounded-lg text-sm font-bold"
                                                >
                                                    Limpar
                                                </button>
                                            )}
                                        </div>
                                    </form>
                                </div>

                                {/* List */}
                                <div className="lg:col-span-2 bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-800/50 text-slate-500 font-bold uppercase tracking-wider">
                                            <tr>
                                                <th className="px-4 py-3 border-b border-slate-800">Moeda</th>
                                                <th className="px-4 py-3 border-b border-slate-800">Preço</th>
                                                <th className="px-4 py-3 border-b border-slate-800">Reward</th>
                                                <th className="px-4 py-3 border-b border-slate-800 text-center">Status</th>
                                                <th className="px-4 py-3 border-b border-slate-800 text-right">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {miningCoins.map(coin => (
                                                <tr key={coin.id} className="hover:bg-slate-800/40 transition-colors group">
                                                    <td className="px-4 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full border border-slate-700 flex items-center justify-center text-xs font-bold" style={{ backgroundColor: coin.color + '22', color: coin.color }}>
                                                                {coin.symbol[0]}
                                                            </div>
                                                            <div>
                                                                <div className="font-bold text-white">{coin.name}</div>
                                                                <div className="text-slate-500 font-mono text-[10px]">{coin.symbol}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4 font-mono text-white">
                                                        ${formatAdminDecimalMax8(resolveMiningCoinDisplayPrice(coin))}
                                                    </td>
                                                    <td className="px-4 py-4 font-mono text-slate-400">
                                                        {formatAdminDecimalMax8(coin.blockReward)} {coin.symbol}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        {coin.isActive ? (
                                                            <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[10px] font-bold border border-green-500/20">ATIVA</span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 text-[10px] font-bold border border-slate-500/20">INATIVA</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                onClick={() => setEditingCoin(coin)}
                                                                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                                                                title="Editar"
                                                            >
                                                                <Pencil size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteCoin(coin.id)}
                                                                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                                                title="Excluir"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <PlayerCalculator
                            gameState={{
                                usdc: 0,
                                startTime: Date.now(),
                                stock: {},
                                unopenedBoxes: {},
                                storedBatteries: [],
                                placedRacks: [],
                                coinBalances: {},
                                dailyActions: {},
                                playerListings: [],
                                claimedReferrals: 0,
                                referralBonusClaimed: false
                            }}
                            upgrades={upgrades}
                            miningCoins={miningCoins}
                            onBack={() => setSubtab('transactions')}
                            isAdmin={true}
                        />
                    )}
                </div>
            )}


            {subtab === 'withdrawals' && !reportsOperatorRestricted && (
                <div className="flex-1 overflow-auto custom-scrollbar">
                    <AdminManualWithdrawals />
                </div>
            )}


            {subtab === 'transactions' && (
                <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 font-sans text-slate-300 h-full flex flex-col">
                    {/* Header */}
                    <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-900 rounded-td-xl rounded-tr-xl flex-wrap gap-4">
                        <div>
                            <h2 className="text-xl font-bold text-white mb-1">Transações de USDC</h2>
                            <div className="flex flex-wrap items-center gap-2 mt-2 mb-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTreasurySource('registered');
                                        localStorage.setItem('adminReportsTreasurySource', 'registered');
                                        setPage(1);
                                    }}
                                    className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${treasurySource === 'registered' ? 'bg-amber-600/25 text-white border-amber-600/60' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
                                >
                                    Carteira cadastrada (recebe depósitos)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTreasurySource('legacy');
                                        localStorage.setItem('adminReportsTreasurySource', 'legacy');
                                        setPage(1);
                                    }}
                                    className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${treasurySource === 'legacy' ? 'bg-amber-600/25 text-white border-amber-600/60' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
                                >
                                    Carteira antiga (depósito)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTreasurySource('legacy_launch');
                                        localStorage.setItem('adminReportsTreasurySource', 'legacy_launch');
                                        setPage(1);
                                    }}
                                    className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${treasurySource === 'legacy_launch' ? 'bg-amber-600/25 text-white border-amber-600/60' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
                                >
                                    Carteira Antiga (Lançamento)
                                </button>
                            </div>
                            <div className="text-xs text-slate-500 font-mono flex items-center gap-2">
                                Carteira: {truncateMiddle(treasuryWallet, 10, 8)}
                                <button
                                    type="button"
                                    className="p-0.5 rounded text-slate-500 hover:text-white"
                                    aria-label="Copiar endereço da carteira"
                                    onClick={() => void navigator.clipboard.writeText(treasuryWallet)}
                                >
                                    <Copy size={12} />
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 flex-wrap">
                            {/* Controls */}
                            <div className="flex items-center gap-2 flex-wrap bg-slate-800 p-1.5 rounded border border-slate-700">
                                <span className="text-xs font-bold text-slate-400 px-1">De:</span>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setStartDate(val);
                                        localStorage.setItem('adminReportsStartDate', val);
                                    }}
                                    className="bg-slate-900 text-white text-xs px-2 py-1 rounded border border-slate-700 outline-none focus:border-amber-500"
                                />
                                <span className="text-xs font-bold text-slate-400 px-1">até</span>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setEndDate(val);
                                        if (val) localStorage.setItem('adminReportsEndDate', val);
                                        else localStorage.removeItem('adminReportsEndDate');
                                    }}
                                    className="bg-slate-900 text-white text-xs px-2 py-1 rounded border border-slate-700 outline-none focus:border-amber-500"
                                />
                                {endDate ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEndDate('');
                                            localStorage.removeItem('adminReportsEndDate');
                                        }}
                                        className="text-[10px] font-bold text-slate-500 hover:text-amber-400 px-1"
                                    >
                                        sem data fim
                                    </button>
                                ) : null}
                            </div>

                            <div className="flex items-center gap-1 flex-wrap">
                                <button
                                    type="button"
                                    disabled={csvExportBusy !== 'none'}
                                    onClick={() => void handleExportCsv('full')}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded border bg-emerald-900/20 text-emerald-400 border-emerald-900/50 hover:bg-emerald-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Todas as transações obtidas da API (ignora datas e busca)"
                                >
                                    <Download size={14} className={csvExportBusy === 'full' ? 'animate-pulse' : ''} />
                                    {csvExportBusy === 'full' ? 'A exportar…' : 'CSV completo'}
                                </button>
                                <button
                                    type="button"
                                    disabled={csvExportBusy !== 'none'}
                                    onClick={() => void handleExportCsv('filtered')}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded border bg-slate-800 text-slate-200 border-slate-600 hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Aplica De/até e a caixa de busca ao conjunto obtido da API"
                                >
                                    <Download size={14} className={csvExportBusy === 'filtered' ? 'animate-pulse' : ''} />
                                    {csvExportBusy === 'filtered' ? 'A exportar…' : 'CSV filtros'}
                                </button>
                            </div>

                            <button
                                onClick={() => setShowEmail(!showEmail)}
                                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded border transition-colors ${showEmail ? 'bg-amber-600/20 text-amber-400 border-amber-600/50' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
                            >
                                {showEmail ? <Mail size={14} /> : <User size={14} />}
                                {showEmail ? 'Mostrar Emails' : 'Mostrar Usuários'}
                            </button>

                            <div className="h-6 w-px bg-slate-700 mx-2 hidden md:block"></div>

                            <div className="flex bg-slate-800 rounded p-1 border border-slate-700">
                                <button onClick={() => setFilterPeriod('all')} className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${filterPeriod === 'all' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>Tudo</button>
                                <button onClick={() => setFilterPeriod('day')} className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${filterPeriod === 'day' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>Por Dia</button>
                            </div>

                            {/* Search Field */}
                            <div className="relative flex items-center bg-slate-800 rounded border border-slate-700 focus-within:border-amber-500 transition-colors">
                                <div className="pl-3 text-slate-500">
                                    <Search size={14} />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Buscar jogador, e-mail ou carteira..."
                                    value={searchTerm}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setSearchTerm(val);
                                        localStorage.setItem('adminReportsSearchTerm', val);
                                    }}
                                    className="bg-transparent text-white text-xs px-2 py-1.5 w-64 outline-none placeholder:text-slate-600"
                                />
                                {searchTerm && (
                                    <button
                                        onClick={() => {
                                            setSearchTerm('');
                                            localStorage.setItem('adminReportsSearchTerm', '');
                                        }}
                                        className="pr-2 text-slate-500 hover:text-white transition-colors"
                                        title="Limpar busca"
                                    >
                                        <CloseIcon size={14} />
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1 || loading}
                                    className="p-2 hover:bg-slate-800 rounded border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <button
                                    onClick={() => setPage(p => p + 1)}
                                    disabled={transactions.length < limit || loading}
                                    className="p-2 hover:bg-slate-800 rounded border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>

                            <button onClick={fetchTransactions} className="p-2 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors border border-slate-700" title="Atualizar">
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto custom-scrollbar p-4 space-y-6">
                        {Object.entries(groupedData).map(([groupTitle, groupTxs]) => (
                            <div key={groupTitle} className="animate-in fade-in slide-in-from-bottom-2">
                                {filterPeriod !== 'all' && (
                                    <h3 className="text-sm font-bold text-slate-400 mb-3 ml-1 flex items-center gap-2">
                                        <Calendar size={14} /> {groupTitle}
                                        <span className="text-xs font-normal text-slate-600 bg-slate-800 px-2 py-0.5 rounded-full">{groupTxs.length} txs</span>
                                    </h3>
                                )}

                                <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-900/50 text-slate-500 font-bold uppercase tracking-wider">
                                            <tr>
                                                <th className="px-4 py-3 border-b border-slate-800 w-12 text-center">#</th>
                                                <th className="px-4 py-3 border-b border-slate-800">Hash</th>
                                                <th className="px-4 py-3 border-b border-slate-800">Data</th>
                                                <th className="px-4 py-3 border-b border-slate-800">Usuário</th>
                                                <th className="px-4 py-3 border-b border-slate-800">Endereço</th>
                                                <th className="px-4 py-3 border-b border-slate-800 text-center">Fluxo</th>
                                                <th className="px-4 py-3 border-b border-slate-800 text-right">Valor (USDC)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {groupTxs.map((tx) => {
                                                const isIncoming = tx.to.toLowerCase() === treasuryWallet.toLowerCase();
                                                // FORMAT: USDC uses 6 decimals
                                                const amount = parseFloat(tx.value) / 1000000;
                                                const counterPartyAddr = isIncoming ? tx.from : tx.to;
                                                const user = resolveUser(counterPartyAddr);

                                                return (
                                                    <tr key={tx.hash} className="hover:bg-slate-800/40 transition-colors group">
                                                        <td className="px-4 py-3 text-center text-slate-600">
                                                            <a href={`https://polygonscan.com/tx/${tx.hash}`} target="_blank" rel="noreferrer" className="hover:text-amber-400">
                                                                <ExternalLink size={12} />
                                                            </a>
                                                        </td>
                                                        <td className="px-4 py-3 font-mono text-amber-400/80 group-hover:text-amber-400">
                                                            {truncateMiddle(tx.hash)}
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                                                            {formatDate(tx.timeStamp)}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {user ? (
                                                                <div className="flex items-center gap-2 text-white font-medium">
                                                                    {showEmail ? <Mail size={12} className="text-slate-500" /> : <User size={12} className="text-slate-500" />}
                                                                    {showEmail ? user.email : user.username}
                                                                    <span className="text-[9px] bg-amber-900/40 text-amber-300 px-1.5 rounded border border-amber-800">PLAYER</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-2 group/edit">
                                                                    {walletLabels[counterPartyAddr.toLowerCase()] ? (
                                                                        <span className="text-yellow-400 font-medium text-xs bg-yellow-900/20 px-1.5 rounded">{walletLabels[counterPartyAddr.toLowerCase()]}</span>
                                                                    ) : (
                                                                        <span className="text-slate-600 italic text-[11px]">-</span>
                                                                    )}
                                                                    {!reportsOperatorRestricted && (
                                                                        <button
                                                                            onClick={() => handleEditLabel(counterPartyAddr)}
                                                                            className="opacity-0 group-hover/edit:opacity-100 text-slate-500 hover:text-white transition-opacity"
                                                                            title="Nomear carteira"
                                                                        >
                                                                            <Pencil size={12} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 font-mono text-slate-300">
                                                            <div className="flex items-center gap-1">
                                                                <span title={counterPartyAddr}>{truncateMiddle(counterPartyAddr)}</span>
                                                                <Copy size={10} className="text-slate-600 opacity-0 group-hover:opacity-100 cursor-pointer" />
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            {isIncoming ? (
                                                                <span className="bg-green-500/10 text-green-500 text-[10px] font-bold px-2 py-1 rounded border border-green-500/20">ENTRADA</span>
                                                            ) : (
                                                                <span className="bg-orange-500/10 text-orange-500 text-[10px] font-bold px-2 py-1 rounded border border-orange-500/20">SAÍDA</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-200">
                                                            {amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}

                        {/* Empty / Loading States handled previously */}
                        {!loading && filteredTransactions.length === 0 && (
                            <div className="text-center py-16 text-slate-500 flex flex-col items-center gap-2">
                                <Filter size={32} className="opacity-20" />
                                <p>Nenhuma transação encontrada no período.</p>
                                {(startDate || endDate) && (
                                    <p className="text-xs">
                                        Filtro:{' '}
                                        {startDate ? `de ${new Date(startDate + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''}
                                        {endDate
                                            ? ` até ${new Date(endDate + 'T12:00:00').toLocaleDateString('pt-BR')}`
                                            : startDate
                                              ? ' (sem limite final)'
                                              : ''}
                                    </p>
                                )}
                            </div>
                        )}

                        {error && (
                            <div className="text-center py-12 text-red-400 bg-red-900/10 rounded-lg border border-red-900/20">
                                {error}
                                <button onClick={fetchTransactions} className="block mx-auto mt-2 text-sm underline hover:text-red-300">Tentar Novamente</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
