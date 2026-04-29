import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Sliders, Info, TrendingUp, Coins, Trash2, Loader2 } from 'lucide-react';
import { UNIT_MULTIPLIERS } from './constants';
import { CoinData, HashUnit, CalculationResult } from './types';
import { getMiningCoins, saveMiningCoin, deleteMiningCoin, getEconomyStats, getAdminRanking } from '../../../services/api';
import { EconomySettings } from '../../../types';

const MiningCalculator: React.FC = () => {
    const [coins, setCoins] = useState<CoinData[]>([]);
    const [selectedCoinId, setSelectedCoinId] = useState<string>('');
    const [hashrate, setHashrate] = useState<number>(100);
    const [unit, setUnit] = useState<HashUnit>(HashUnit.MH_S);
    const [loading, setLoading] = useState<boolean>(true);

    // Modal State para CRUD de Moedas
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCoin, setEditingCoin] = useState<Partial<CoinData> | null>(null);

    // Economy Management State
    const [economyStats, setEconomyStats] = useState<EconomySettings | null>(null);
    const [rankingStats, setRankingStats] = useState<any>(null);
    const [targetDailyUSD, setTargetDailyUSD] = useState<number>(5); // Default $5/day
    const [targetHashrateDef, setTargetHashrateDef] = useState<number>(100); // 100 MH/s Ref

    useEffect(() => {
        loadCoins();
        loadEconomyStats();
    }, []);

    const loadEconomyStats = async () => {
        try {
            const stats = await getEconomyStats();
            // @ts-ignore
            setEconomyStats(stats);
            const ranking = await getAdminRanking();
            setRankingStats(ranking);
        } catch (e) {
            console.error(e);
        }
    };

    const loadCoins = async () => {
        setLoading(true);
        const data = await getMiningCoins();
        // Sort logic or data mapping if necessary
        const mapped: CoinData[] = data.map((c: any) => ({
            id: c.id,
            name: c.name,
            symbol: c.symbol,
            networkHashrate: c.networkHashrate,
            blockReward: c.blockReward,
            blockTime: c.blockTime,
            priceUSD: c.priceUSD,
            algorithm: c.algorithm,
            difficulty: c.difficulty,
            multiplier: c.multiplier,
            color: c.color,
            description: c.description,
            minProportion: c.minProportion,
            isActive: c.isActive,
            usdcRate: c.usdcRate,
            realNetworkHashrate: c.realNetworkHashrate,
            targetDailyUSD: c.targetDailyUSD,
            showInExchange: c.showInExchange
        }));

        if (mapped.length > 0) {
            setCoins(mapped);
            if (!selectedCoinId || !mapped.find(c => c.id === selectedCoinId)) {
                setSelectedCoinId(mapped[0].id);
            }
        } else {
            setCoins([]);
        }
        setLoading(false);
    };

    const selectedCoin = useMemo(() =>
        coins.find(c => c.id === selectedCoinId) || coins[0],
        [coins, selectedCoinId]
    );

    useEffect(() => {
        if (selectedCoin) {
            setTargetDailyUSD(selectedCoin.targetDailyUSD || 5);
        }
    }, [selectedCoin]);

    const results = useMemo((): CalculationResult => {
        if (!selectedCoin) return {
            dailyCrypto: 0, dailyUSD: 0, weeklyUSD: 0, monthlyUSD: 0, yearlyUSD: 0,
            breakdown: { hour: 0, day: 0, week: 0, month: 0 }
        };

        // Cálculo baseado no multiplicador e na unidade de hash selecionada
        const effectiveUserHash = hashrate * (selectedCoin.multiplier || 1) * UNIT_MULTIPLIERS[unit];
        const networkHps = selectedCoin.realNetworkHashrate || selectedCoin.networkHashrate;

        // Evitar divisão por zero
        if (!networkHps) return {
            dailyCrypto: 0, dailyUSD: 0, weeklyUSD: 0, monthlyUSD: 0, yearlyUSD: 0,
            breakdown: { hour: 0, day: 0, week: 0, month: 0 }
        };

        const blocksPerDay = 86400 / selectedCoin.blockTime;
        const dailyReward = (effectiveUserHash / networkHps) * blocksPerDay * selectedCoin.blockReward;
        const dailyUSD = dailyReward * selectedCoin.priceUSD;

        return {
            dailyCrypto: dailyReward,
            dailyUSD: dailyUSD,
            weeklyUSD: dailyUSD * 7,
            monthlyUSD: dailyUSD * 30.44,
            yearlyUSD: dailyUSD * 365,
            breakdown: {
                hour: dailyUSD / 24,
                day: dailyUSD,
                week: dailyUSD * 7,
                month: dailyUSD * 30.44
            }
        };
    }, [selectedCoin, hashrate, unit]);

    const updateCoinProperty = async (id: string, updates: Partial<CoinData>) => {
        // Optimistic update
        setCoins(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));

        // Persist debounce or immediate? Immediate for now but handle with care
        const coin = coins.find(c => c.id === id);
        if (coin) {
            const updated = { ...coin, ...updates };
            await saveMiningCoin(updated);
        }
    };

    const deleteCoin = async (id: string) => {
        if (coins.length <= 1) return alert("Mínimo de 1 moeda necessário.");
        if (!confirm('Tem certeza que deseja excluir esta moeda?')) return;

        const success = await deleteMiningCoin(id);
        if (success.ok) {
            setCoins(prev => {
                const filtered = prev.filter(c => c.id !== id);
                if (selectedCoinId === id) setSelectedCoinId(filtered[0].id);
                return filtered;
            });
        } else {
            alert('Erro ao excluir moeda: ' + (success.error || 'Unknown'));
        }
    };

    const handleSaveCoin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingCoin?.name || !editingCoin?.symbol) return;

        const isNew = !editingCoin.id;
        const newCoinData = {
            ...editingCoin,
            networkHashrate: Number(editingCoin.networkHashrate) || 1000000,
            blockReward: Number(editingCoin.blockReward) || 1,
            blockTime: Number(editingCoin.blockTime) || 60,
            priceUSD: Number(editingCoin.priceUSD) || 1,
            multiplier: Number(editingCoin.multiplier) || 1,
            difficulty: 1,
            color: editingCoin.color || '#ffffff',
            algorithm: editingCoin.algorithm || 'Unknown',
            // defaults
            description: editingCoin.description || '',
            minProportion: Number(editingCoin.minProportion) || 0,
            isActive: editingCoin.isActive ?? 1,
            showInExchange: editingCoin.showInExchange ?? true,
            usdcRate: Number(editingCoin.priceUSD) || 1,
            targetDailyUSD: Number(editingCoin.targetDailyUSD) || 0
        };

        const res = await saveMiningCoin(newCoinData);
        if (res.ok) {
            await loadCoins(); // Reload to get fresh data including ID
            setIsModalOpen(false);
            setEditingCoin(null);
        } else {
            alert('Erro ao salvar: ' + res.error);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12 text-slate-400 gap-2">
                <Loader2 className="animate-spin" /> Carregando Calculadora...
            </div>
        );
    }

    if (!selectedCoin) return <div className="p-8 text-center text-slate-400">Nenhuma moeda configurada.</div>;

    return (
        <div className="space-y-8 w-full">
            {/* Header Interno */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
                <div>
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                        Calculadora de Mineração
                    </h2>
                    <p className="text-slate-400 text-sm">Rentabilidade em Tempo Real (Dados do Servidor)</p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="flex gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
                        {coins.map(coin => (
                            <button
                                key={coin.id}
                                onClick={() => setSelectedCoinId(coin.id)}
                                className={`px-4 py-2 rounded-md transition-all font-bold text-xs ${selectedCoinId === coin.id
                                    ? 'bg-blue-600 text-white shadow-lg'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                    }`}
                            >
                                {coin.symbol}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => { setEditingCoin({}); setIsModalOpen(true); }}
                        className="w-9 h-9 rounded-full bg-slate-900 hover:bg-slate-800 text-cyan-400 flex items-center justify-center transition-colors shadow-lg border border-slate-700"
                        title="Adicionar Moeda"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Painel de Entrada */}
                <section className="lg:col-span-1 space-y-6">
                    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-cyan-400 font-semibold">
                                <Sliders size={18} />
                                <h3>Configuração de {selectedCoin.symbol}</h3>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-2 font-medium">Seu Poder de Mineração</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={hashrate}
                                        onChange={(e) => setHashrate(Number(e.target.value))}
                                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-white text-sm"
                                    />
                                    <select
                                        value={unit}
                                        onChange={(e) => setUnit(e.target.value as HashUnit)}
                                        className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-3 outline-none font-bold text-cyan-400 text-sm"
                                    >
                                        {Object.values(HashUnit).map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-slate-400 mb-2 font-medium">
                                    H/s Multiplicador (Individual)
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={selectedCoin.multiplier}
                                    onChange={(e) => updateCoinProperty(selectedCoin.id, { multiplier: Number(e.target.value) })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 outline-none font-mono text-white text-sm"
                                />
                                <p className="text-[10px] text-slate-500 mt-1 italic">
                                    Afeta apenas o cálculo de {selectedCoin.symbol}.
                                </p>
                            </div>

                            <div className="pt-2 border-t border-slate-800">
                                <label className="block text-[10px] text-purple-400 mb-2 uppercase tracking-widest font-bold">
                                    Valor de 1 {selectedCoin.symbol} em USDC
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                                    <input
                                        type="number"
                                        step="0.000001"
                                        value={selectedCoin.priceUSD}
                                        onChange={(e) => {
                                            const newPrice = Number(e.target.value);
                                            const oldPrice = selectedCoin.priceUSD || 0;
                                            const oldReward = selectedCoin.blockReward || 0;
                                            const currentTotal = oldPrice * oldReward;

                                            let newReward = oldReward;
                                            // Auto-adjust reward to keep Total Daily Emission (USD) constant
                                            if (newPrice > 0 && currentTotal > 0) {
                                                newReward = currentTotal / newPrice;
                                            }

                                            updateCoinProperty(selectedCoin.id, {
                                                priceUSD: newPrice,
                                                blockReward: newReward
                                            });
                                        }}
                                        className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-4 py-3 focus:ring-2 focus:ring-purple-500 outline-none font-mono text-white text-lg font-bold"
                                    />
                                </div>
                                <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
                                    <Info size={12} />
                                    Quanto 1 {selectedCoin.symbol} vale hoje em USDC.
                                </p>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-800">
                            <h4 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Estatísticas da Rede (24h)</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/50">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Blocos / Dia</p>
                                    <p className="text-sm font-mono text-white font-bold">
                                        {(86400 / (selectedCoin.blockTime || 1)).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                                    </p>
                                </div>
                                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/50">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Valor do Bloco</p>
                                    <p className="text-sm font-mono text-green-400 font-bold">
                                        ${((selectedCoin.blockReward || 0) * (selectedCoin.priceUSD || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                    </p>
                                </div>
                                <div className="col-span-2 bg-slate-950 p-3 rounded-lg border border-slate-800/50 flex justify-between items-center">
                                    <div>
                                        <p className="text-[10px] text-slate-500 uppercase font-bold">Valor Total Emitido (24h)</p>
                                        <p className="text-[10px] text-slate-600">Soma de todos os blocos</p>
                                    </div>
                                    <p className="text-lg font-mono text-green-400 font-bold">
                                        ${((86400 / (selectedCoin.blockTime || 1)) * (selectedCoin.blockReward || 0) * (selectedCoin.priceUSD || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border border-red-900/20 bg-red-900/10 rounded-xl flex justify-between items-center gap-2">
                        <span className="text-xs text-red-400">Opções de Ativo</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setEditingCoin(selectedCoin); setIsModalOpen(true); }}
                                className="px-3 py-1 bg-blue-900/40 text-blue-400 rounded-md hover:bg-blue-900/60 text-xs transition-colors flex items-center gap-2"
                            >
                                <Sliders size={12} /> Editar
                            </button>
                            <button
                                onClick={() => deleteCoin(selectedCoin.id)}
                                className="px-3 py-1 bg-red-900/40 text-red-400 rounded-md hover:bg-red-900/60 text-xs transition-colors flex items-center gap-2"
                            >
                                <Trash2 size={12} /> Excluir
                            </button>
                        </div>
                    </div>
                </section>

                {/* Painel de Resultados */}
                <section className="lg:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-900/50 p-8 rounded-2xl border-l-4 border-cyan-400 shadow-xl relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Coins size={64} className="text-cyan-400" />
                            </div>
                            <p className="text-slate-400 text-[10px] mb-2 uppercase tracking-widest font-semibold flex items-center gap-2">
                                Ganhos 24h ({selectedCoin.symbol})
                            </p>
                            <h3 className="text-3xl lg:text-4xl font-bold font-mono text-white overflow-hidden text-ellipsis">
                                ${results.dailyUSD.toFixed(6)}
                            </h3>
                            <p className="text-cyan-400 mt-2 text-sm font-medium">
                                {results.dailyCrypto.toFixed(8)} {selectedCoin.symbol}
                            </p>
                        </div>

                        <div className="bg-slate-900/50 p-8 rounded-2xl border-l-4 border-purple-400 shadow-xl relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <TrendingUp size={64} className="text-purple-400" />
                            </div>
                            <p className="text-slate-400 text-[10px] mb-2 uppercase tracking-widest font-semibold">Projeção 30 Dias</p>
                            <h3 className="text-3xl lg:text-4xl font-bold font-mono text-white overflow-hidden text-ellipsis">
                                ${results.monthlyUSD.toFixed(6)}
                            </h3>
                            <p className="text-purple-400 mt-2 text-xs font-medium italic">
                                Câmbio: 1 {selectedCoin.symbol} = ${selectedCoin.priceUSD.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
                            </p>
                        </div>
                    </div>

                    <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
                        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2 text-slate-300">
                            <TrendingUp size={16} className="text-cyan-400" />
                            Detalhamento Financeiro (Projeções)
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left table-fixed border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-700 text-slate-500 text-[10px] uppercase tracking-wider">
                                        <th className="pb-3 font-bold w-1/3">PERÍODO</th>
                                        <th className="pb-3 font-bold w-1/3">MOEDA ({selectedCoin.symbol})</th>
                                        <th className="pb-3 font-bold w-1/3 text-right">EQUIVALENTE EM USDC</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {[
                                        { label: '1 Hora', val: results.breakdown.hour },
                                        { label: '24 Horas', val: results.breakdown.day },
                                        { label: '7 Dias', val: results.breakdown.week },
                                        { label: '30 Dias', val: results.breakdown.month },
                                        { label: '1 Ano', val: results.yearlyUSD }
                                    ].map((row, idx) => (
                                        <tr key={idx} className="hover:bg-slate-800/40 transition-colors group">
                                            <td className="py-3 text-slate-300 group-hover:text-white text-xs w-1/3">{row.label}</td>
                                            <td className="py-3 font-medium text-slate-100 font-mono text-xs w-1/3">
                                                {(results.dailyCrypto * (row.val / (results.dailyUSD || 1))).toFixed(8)}
                                            </td>
                                            <td className="py-3 text-right font-bold text-green-400 font-mono text-xs w-1/3">
                                                ${row.val.toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </div >

            {/* SEÇÃO DE ESTATÍSTICAS DE RANKING (DADOS OBTIDOS DA PÁGINA DE RANKING) */}
            <div className="mt-8 mb-8 border-t border-slate-800 pt-8">
                <h3 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent mb-6 flex items-center gap-2">
                    <TrendingUp className="text-pink-500" /> Estatísticas Reais da Rede (Via Ranking)
                </h3>

                {rankingStats ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {/* Card 1: Quantidade de Mineradores na Moeda Selecionada */}
                        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                <Plus className="w-12 h-12 text-blue-500" />
                            </div>
                            <p className="text-xs uppercase text-slate-500 font-bold mb-1">Mineradores Ativos ({selectedCoin.symbol})</p>
                            <h4 className="text-3xl font-mono font-bold text-white">
                                {(() => {
                                    const count = rankingStats.ranking.filter(u => (u.coins[selectedCoin.id] || 0) > 0).length;
                                    return count;
                                })()}
                            </h4>
                            <p className="text-[10px] text-slate-500 mt-2">Usuários minerando esta moeda.</p>
                        </div>

                        {/* Card 2: Poder Total de Mineração na Moeda */}
                        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                <TrendingUp className="w-12 h-12 text-cyan-500" />
                            </div>
                            <p className="text-xs uppercase text-slate-500 font-bold mb-1">Hashrate Total ({selectedCoin.symbol})</p>
                            <h4 className="text-3xl font-mono font-bold text-cyan-400">
                                {(() => {
                                    const total = rankingStats.ranking.reduce((acc, u) => acc + (u.coins[selectedCoin.id] || 0), 0);
                                    // Auto format unit
                                    if (total > 1000000000) return (total / 1000000000).toFixed(2) + ' GH/s';
                                    if (total > 1000000) return (total / 1000000).toFixed(2) + ' MH/s';
                                    if (total > 1000) return (total / 1000).toFixed(2) + ' kH/s';
                                    return total.toFixed(0) + ' H/s';
                                })()}
                            </h4>
                            <p className="text-[10px] text-slate-500 mt-2">Soma bruta do poder de todos.</p>
                        </div>

                        {/* Card 3: Média de Hashrate por Jogador */}
                        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
                            <p className="text-xs uppercase text-slate-500 font-bold mb-1">Média / Jogador</p>
                            <h4 className="text-xl font-mono font-bold text-white">
                                {(() => {
                                    const users = rankingStats.ranking.filter(u => (u.coins[selectedCoin.id] || 0) > 0);
                                    const total = users.reduce((acc, u) => acc + (u.coins[selectedCoin.id] || 0), 0);
                                    const avg = users.length > 0 ? total / users.length : 0;
                                    if (avg > 1000000) return (avg / 1000000).toFixed(2) + ' MH/s';
                                    return (avg / 1000).toFixed(2) + ' kH/s';
                                })()}
                            </h4>
                        </div>

                        {/* Card 4: Ranking Top 1 */}
                        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
                            <p className="text-xs uppercase text-slate-500 font-bold mb-1">Top 1 Minerador</p>
                            <h4 className="text-lg font-mono font-bold text-yellow-400 truncate">
                                {(() => {
                                    const sorted = [...rankingStats.ranking]
                                        .map(u => ({ ...u, power: u.coins[selectedCoin.id] || 0 }))
                                        .sort((a, b) => b.power - a.power);

                                    if (sorted.length > 0 && sorted[0].power > 0) {
                                        return sorted[0].username;
                                    }
                                    return '---';
                                })()}
                            </h4>
                            <p className="text-[10px] text-slate-500 mt-1">
                                {(() => {
                                    const sorted = [...rankingStats.ranking]
                                        .map(u => ({ ...u, power: u.coins[selectedCoin.id] || 0 }))
                                        .sort((a, b) => b.power - a.power);
                                    if (sorted.length > 0 && sorted[0].power > 0) return (sorted[0].power / 1000000).toFixed(1) + ' MH/s';
                                    return '';
                                })()}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="text-slate-500 italic text-sm">Carregando dados de ranking...</div>
                )}
            </div>
            <div className="mt-8 border-t border-slate-800 pt-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="bg-red-500/10 p-2 rounded-lg">
                        <TrendingUp className="text-red-500" size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Gestão Econômica Global</h2>
                        <p className="text-slate-400 text-sm">Simulação e Ajuste de Dificuldade de Rede</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* COLUNA 1: DADOS REAIS DA REDE */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-4">Status Real da Rede</h3>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
                                <span className="text-slate-400 text-sm">Mineradores Ativos (Total)</span>
                                <span className="text-white font-mono font-bold">{economyStats?.realActiveMiners || 0}</span>
                            </div>
                            {selectedCoin && (
                                <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
                                    <span className="text-slate-400 text-sm">Mineradores em {selectedCoin.symbol}</span>
                                    <span className="text-cyan-400 font-mono font-bold">{economyStats?.activeMinersByCoin?.[selectedCoin.id] || 0}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
                                <span className="text-slate-400 text-sm">Hashrate Real Total (Soma dos usuários)</span>
                                <span className="text-cyan-400 font-mono font-bold">
                                    {economyStats?.realNetworkHashrates && selectedCoin
                                        ? (Number(economyStats.realNetworkHashrates[selectedCoin.id] || 0) / 1000000).toLocaleString('en-US') + ' MH/s'
                                        : '0 MH/s'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
                                <span className="text-slate-400 text-sm">Hashrate Configurado (Dificuldade Atual)</span>
                                <span className="text-yellow-400 font-mono font-bold">
                                    {(selectedCoin?.networkHashrate ? selectedCoin.networkHashrate / 1000000 : 0).toLocaleString('en-US')} MH/s
                                </span>
                            </div>
                            <div className="p-3 bg-slate-950 rounded-lg text-xs text-slate-500 mt-2">
                                <Info size={12} className="inline mr-1" />
                                O <b>Hashrate Configurado</b> é o valor usado para calcular os ganhos dos jogadores. Se for menor que o Real, os jogadores ganham MUITO pouco. Se for maior, ganham mais.
                            </div>
                        </div>
                    </div>

                    {/* COLUNA 2: SIMULADOR DE POOL (ORÇAMENTO DIÁRIO) */}
                    <div className="bg-slate-900 border border-emerald-900/20 rounded-xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5">
                            <Coins size={100} />
                        </div>
                        <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-widest mb-4">Controle de Emissão (Pool Diária)</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Qual o valor TOTAL em Dólar a ser distribuído hoje?</label>
                                <div className="flex gap-2 items-center">
                                    <span className="text-green-500 font-bold">$</span>
                                    <input
                                        type="number"
                                        value={targetDailyUSD}
                                        onChange={e => setTargetDailyUSD(Number(e.target.value))}
                                        className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-green-400 font-bold w-full font-mono text-lg"
                                        placeholder="Ex: 100.00"
                                    />
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1">Este valor será dividido entre todos os mineradores proporcionalmente.</p>
                            </div>

                            <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800 space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">Novo Reward por Bloco Necessário:</span>
                                    <span className="text-white font-mono font-bold">
                                        {(() => {
                                            if (!selectedCoin || targetDailyUSD <= 0) return '---';
                                            const blocksPerDay = 86400 / selectedCoin.blockTime;
                                            const reqReward = targetDailyUSD / selectedCoin.priceUSD / blocksPerDay;
                                            return reqReward.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 });
                                        })()} {selectedCoin?.symbol}
                                    </span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">Ganho Diário Estimado (100 MH/s):</span>
                                    <span className="text-emerald-400 font-mono font-bold">
                                        {(() => {
                                            if (!selectedCoin || targetDailyUSD <= 0) return '---';
                                            // User Share = 100 MHs / Real Net Hash
                                            const userHps = 100 * 1000000;
                                            const realNet = economyStats?.realNetworkHashrates?.[selectedCoin.id] || 1;
                                            const usedNet = Math.max(realNet, userHps); // Prevent div/0 or infinity
                                            const share = userHps / usedNet;
                                            const dailyEarnings = share * targetDailyUSD;
                                            return '$ ' + dailyEarnings.toLocaleString('en-US', { minimumFractionDigits: 4 });
                                        })()}
                                    </span>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                    <input type="checkbox" id="syncNet" className="rounded bg-slate-800 border-slate-700" defaultChecked />
                                    <label htmlFor="syncNet" className="text-[10px] text-slate-400 cursor-pointer select-none">
                                        Sincronizar Dificuldade com Real
                                    </label>
                                </div>
                                <button
                                    onClick={async () => {
                                        if (!selectedCoin || targetDailyUSD <= 0) return;

                                        // 1. Converter Valor Alvo (USD) para Moeda
                                        const targetDailyCoins = targetDailyUSD / selectedCoin.priceUSD;

                                        // 2. Calcular blocos por dia (86400s / blockTime)
                                        const blocksPerDay = 86400 / selectedCoin.blockTime;

                                        // 3. Definir Reward por Bloco para atingir a meta
                                        const newBlockReward = targetDailyCoins / blocksPerDay;

                                        // 4. Obter Hashrate Real Total (do Ranking) para garantir divisão proporcional exata
                                        // Se NetworkHashrate != RealHashrate, a soma das fatias não dá 100% do bloco.
                                        // Para que o BUDGET seja respeitado, a dificuldade TEM que ser igual ao Real.
                                        const realTotalHashrate = rankingStats?.ranking
                                            .reduce((acc: number, u: any) => acc + (u.coins[selectedCoin.id] || 0), 0)
                                            || economyStats?.realNetworkHashrates?.[selectedCoin.id]
                                            || selectedCoin.networkHashrate;

                                        const updates: any = {
                                            blockReward: Number(newBlockReward.toFixed(12)),
                                            networkHashrate: realTotalHashrate,
                                            targetDailyUSD: targetDailyUSD // Persist the target value
                                        };

                                        if (confirm(`Confirmar Alterações em ${selectedCoin.symbol}?\n\n` +
                                            `Meta Diária: $${targetDailyUSD.toFixed(2)}\n` +
                                            `Preço Atual: $${selectedCoin.priceUSD}\n` +
                                            `Total Moedas/Dia: ${targetDailyCoins.toFixed(8)} ${selectedCoin.symbol}\n` +
                                            `Blocos/Dia: ${blocksPerDay.toLocaleString()}\n` +
                                            `--------------------------------\n` +
                                            `NOVO BLOCK REWARD: ${newBlockReward.toFixed(12)}\n` +
                                            `NOVA DIFICULDADE (Sincronizada): ${realTotalHashrate < 1000 ? realTotalHashrate.toFixed(0) + ' H/s' : (realTotalHashrate / 1000000).toFixed(4) + ' MH/s'}`
                                        )) {
                                            await updateCoinProperty(selectedCoin.id, updates);
                                            alert('Emissão reconfigurada com sucesso! A distribuição agora será proporcional ao poder real da rede.');
                                            // Atualiza dados locais para refletir mudança imediata na UI
                                            setEditingCoin(null); // Force refresh if needed or just let basic state handle it
                                            loadCoins();
                                        }
                                    }}
                                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs transition-colors shadow-lg shadow-emerald-600/20 uppercase tracking-wider"
                                >
                                    Atualizar Emissão (Aplicar Lógica)
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* CRUD Modal */}
            {
                isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
                        <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-lg space-y-4 shadow-2xl my-8">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <Coins className="text-cyan-400" size={24} />
                                {editingCoin?.id ? 'Configurações do Ativo' : 'Adicionar Novo Ativo'}
                            </h2>
                            <form onSubmit={handleSaveCoin} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Nome da Cripto</label>
                                        <input
                                            required
                                            value={editingCoin?.name || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, name: e.target.value })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Símbolo</label>
                                        <input
                                            required
                                            value={editingCoin?.symbol || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, symbol: e.target.value })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Network Hashrate (H/s)</label>
                                        <input
                                            type="number"
                                            value={editingCoin?.networkHashrate || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, networkHashrate: Number(e.target.value) })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Algoritmo</label>
                                        <input
                                            value={editingCoin?.algorithm || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, algorithm: e.target.value })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                </div>

                                {/* New Fields */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Block Reward</label>
                                        <input
                                            type="number"
                                            step="0.00000001"
                                            value={editingCoin?.blockReward || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, blockReward: Number(e.target.value) })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Block Time (segundos)</label>
                                        <input
                                            type="number"
                                            value={editingCoin?.blockTime || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, blockTime: Number(e.target.value) })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Meta Diária (USD)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-sm"
                                            value={editingCoin.targetDailyUSD || 0}
                                            onChange={(e) => setEditingCoin({ ...editingCoin, targetDailyUSD: Number(e.target.value) })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Price USD ($)</label>
                                        <input
                                            type="number"
                                            step="0.00000001"
                                            value={editingCoin?.priceUSD || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, priceUSD: Number(e.target.value) })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Multiplier</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editingCoin?.multiplier || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, multiplier: Number(e.target.value) })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Cor (Hex)</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="color"
                                                value={editingCoin?.color || '#ffffff'}
                                                onChange={e => setEditingCoin({ ...editingCoin, color: e.target.value })}
                                                className="h-9 w-9 bg-transparent border-none cursor-pointer"
                                            />
                                            <input
                                                value={editingCoin?.color || ''}
                                                onChange={e => setEditingCoin({ ...editingCoin, color: e.target.value })}
                                                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Descrição</label>
                                        <input
                                            value={editingCoin?.description || ''}
                                            onChange={e => setEditingCoin({ ...editingCoin, description: e.target.value })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Status de Disponibilidade</label>
                                    <div className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${(editingCoin?.isActive !== 0 && editingCoin?.isActive !== false)
                                        ? 'bg-green-900/20 border-green-900/50'
                                        : 'bg-red-900/20 border-red-900/50'
                                        }`}>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={editingCoin?.isActive !== 0 && editingCoin?.isActive !== false}
                                                onChange={e => setEditingCoin({ ...editingCoin, isActive: e.target.checked ? 1 : 0 })}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                                        </label>
                                        <div className="flex-1">
                                            <p className={`text-sm font-bold ${(editingCoin?.isActive !== 0 && editingCoin?.isActive !== false) ? 'text-green-400' : 'text-red-400'}`}>
                                                {(editingCoin?.isActive !== 0 && editingCoin?.isActive !== false) ? 'ATIVO (Minerável)' : 'INATIVO (Suspenso)'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 leading-tight">
                                                {(editingCoin?.isActive !== 0 && editingCoin?.isActive !== false)
                                                    ? 'Jogadores podem selecionar e minerar esta moeda.'
                                                    : 'Desativar desligará IMEDIATAMENTE todas as rigs minerando esta moeda.'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Visibilidade no Exchange (Carteira)</label>
                                    <div className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${editingCoin?.showInExchange !== false
                                        ? 'bg-cyan-900/20 border-cyan-900/50'
                                        : 'bg-slate-800/50 border-slate-700'
                                        }`}>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={editingCoin?.showInExchange !== false}
                                                onChange={e => setEditingCoin({ ...editingCoin, showInExchange: e.target.checked })}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                                        </label>
                                        <div className="flex-1">
                                            <p className={`text-sm font-bold ${editingCoin?.showInExchange !== false ? 'text-cyan-400' : 'text-slate-400'}`}>
                                                {editingCoin?.showInExchange !== false ? 'EXIBIR NO EXCHANGE' : 'OCULTAR NO EXCHANGE'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 leading-tight">
                                                {editingCoin?.showInExchange !== false
                                                    ? 'Jogadores podem converter esta moeda em USDC na Carteira.'
                                                    : 'Esta moeda não aparecerá como opção de troca para os jogadores.'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-4 pt-4">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 rounded-lg bg-slate-800 text-slate-400 text-sm font-bold">Cancelar</button>
                                    <button type="submit" className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-bold text-sm">Confirmar</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default MiningCalculator;
