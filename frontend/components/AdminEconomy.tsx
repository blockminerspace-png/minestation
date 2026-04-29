
import React, { useEffect, useState } from 'react';
import { getEconomyStats, updateEconomySettings } from '../services/api';
import { RefreshCw, Save, DollarSign, Activity, Cpu } from 'lucide-react';

interface EconomyCoin {
    id: string;
    name: string;
    symbol: string;
    price_usd: number;
    network_hashrate: number;
    block_reward: number;
    block_time: number;
    realActiveMiners: number;
    realTotalHashrate: number;
}

export const AdminEconomy: React.FC = () => {
    const [coins, setCoins] = useState<EconomyCoin[]>([]);
    const [loading, setLoading] = useState(true);
    const [targets, setTargets] = useState<Record<string, number>>({});
    const [simulated, setSimulated] = useState<Record<string, { reward: number, hashrate: number }>>({});

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await getEconomyStats();
            setCoins(data);
            // Initialize targets with current daily emission USD
            const initTargets: Record<string, number> = {};
            data.forEach((c: EconomyCoin) => {
                const dailyBlocks = 86400 / c.block_time;
                const dailyEmission = dailyBlocks * c.block_reward * c.price_usd;
                initTargets[c.id] = parseFloat(dailyEmission.toFixed(2));
            });
            setTargets(initTargets);
        } catch (e) {
            console.error(e);
            alert('Falha ao carregar dados da economia.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const handleSimulate = (coin: EconomyCoin) => {
        const targetUsd = targets[coin.id] || 0;
        const price = coin.price_usd || 0.1; // fallback
        if (price <= 0) return;

        // Formula: Reward = (TargetUSD / Price) / (86400 / BlockTime)
        const dailyBlocks = 86400 / coin.block_time;
        const dailyTokens = targetUsd / price;
        const newReward = dailyTokens / dailyBlocks;

        // For Network Hashrate, we suggest setting it to Real Total Hashrate for fairness
        const newHashrate = coin.realTotalHashrate > 0 ? coin.realTotalHashrate : coin.network_hashrate;

        setSimulated(prev => ({
            ...prev,
            [coin.id]: { reward: newReward, hashrate: newHashrate }
        }));
    };

    const handleApply = async (coinId: string) => {
        const sim = simulated[coinId];
        if (!sim) return;

        if (!window.confirm(`Aplicar ajustes para esta moeda?\n\nNovo Hashrate: ${sim.hashrate}\nNova Reward: ${sim.reward.toFixed(8)}`)) return;

        try {
            const res = await updateEconomySettings(coinId, sim.hashrate, sim.reward);
            if (res.ok) {
                alert('Ajuste aplicado com sucesso!');
                loadData();
                setSimulated(prev => {
                    const next = { ...prev };
                    delete next[coinId];
                    return next;
                });
            } else {
                alert('Erro ao aplicar: ' + res.error);
            }
        } catch (e) {
            alert('Erro de rede.');
        }
    };

    if (loading) return <div className="p-8 text-white">Carregando economia...</div>;

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <DollarSign className="text-green-400" /> Gestor Econômico
                    </h2>
                    <p className="text-slate-400 text-sm">Controle a emissão de tokens baseado em metas de Dólar (USD).</p>
                </div>
                <button onClick={loadData} className="p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700">
                    <RefreshCw size={18} />
                </button>
            </div>

            <div className="grid gap-6">
                {coins.map(coin => {
                    const dailyBlocks = 86400 / coin.block_time;
                    const currentDailyEmission = dailyBlocks * coin.block_reward * coin.price_usd;
                    const sim = simulated[coin.id];

                    return (
                        <div key={coin.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
                            <div className="flex justify-between items-start mb-4 relative z-10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-lg font-bold">
                                        {coin.symbol[0]}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-white">{coin.name} <span className="text-slate-500 text-sm">({coin.symbol})</span></h3>
                                        <div className="text-xs text-green-400 font-mono">Price: ${coin.price_usd}</div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs text-slate-500 uppercase font-bold">Emissão Atual (Dia)</div>
                                    <div className="text-xl font-mono text-white">${currentDailyEmission.toFixed(2)}</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 relative z-10">
                                {/* Stats Real */}
                                <div className="bg-slate-950/50 p-3 rounded border border-slate-800/50">
                                    <div className="text-xs text-blue-400 font-bold mb-2 flex items-center gap-1"><Activity size={12} /> Rede Real</div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-slate-500">Mineradores:</span>
                                        <span className="text-white">{coin.realActiveMiners}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Hashrate:</span>
                                        <span className="text-white">{coin.realTotalHashrate.toLocaleString()} H/s</span>
                                    </div>
                                </div>

                                {/* Config Atual */}
                                <div className="bg-slate-950/50 p-3 rounded border border-slate-800/50">
                                    <div className="text-xs text-purple-400 font-bold mb-2 flex items-center gap-1"><Cpu size={12} /> Config Atual</div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-slate-500">Reward:</span>
                                        <span className="text-white font-mono">{coin.block_reward.toFixed(6)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Diff (Network):</span>
                                        <span className="text-white">{coin.network_hashrate.toLocaleString()}</span>
                                    </div>
                                </div>

                                {/* Calculadora */}
                                <div className="bg-green-900/10 p-3 rounded border border-green-900/30">
                                    <div className="text-xs text-green-400 font-bold mb-2 flex items-center gap-1"><DollarSign size={12} /> Meta Diária (USD)</div>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            value={targets[coin.id] || ''}
                                            onChange={(e) => setTargets({ ...targets, [coin.id]: parseFloat(e.target.value) })}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-sm focus:border-green-500 outline-none"
                                            placeholder="0.00"
                                        />
                                        <button
                                            onClick={() => handleSimulate(coin)}
                                            className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs font-bold uppercase"
                                        >
                                            Calc
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Simulation Result */}
                            {sim && (
                                <div className="bg-slate-800 p-4 rounded-lg flex items-center justify-between border border-green-500/30 animate-in fade-in slide-in-from-top-2">
                                    <div className="text-sm">
                                        <div className="text-slate-400 text-xs uppercase mb-1">Sugestão de Ajuste</div>
                                        <div className="flex gap-4">
                                            <div>
                                                <span className="text-slate-500 mr-2">Reward:</span>
                                                <span className="text-green-400 font-mono font-bold">{sim.reward.toFixed(8)}</span>
                                            </div>
                                            <div>
                                                <span className="text-slate-500 mr-2">Network:</span>
                                                <span className="text-green-400 font-mono font-bold">{sim.hashrate.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleApply(coin.id)}
                                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-bold shadow-lg shadow-blue-600/20"
                                    >
                                        <Save size={16} /> Aplicar
                                    </button>
                                </div>
                            )}

                        </div>
                    );
                })}
            </div>
        </div>
    );
};
