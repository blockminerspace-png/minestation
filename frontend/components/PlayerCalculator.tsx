import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, TrendingUp, Box, Server } from 'lucide-react';
import { getPlayerCalculatorMe, type PlayerCalculatorMeOk } from '../services/api';
import { AdminEconomy } from './AdminEconomy';

interface PlayerCalculatorProps {
    onBack: () => void;
    isAdmin?: boolean;
}

export const PlayerCalculator: React.FC<PlayerCalculatorProps> = ({ onBack, isAdmin }) => {
    const [scope, setScope] = useState<string>('total');
    const [payload, setPayload] = useState<PlayerCalculatorMeOk | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedCoinId, setSelectedCoinId] = useState<string | null>(null);
    const fetchGenRef = useRef(0);

    useEffect(() => {
        const ac = new AbortController();
        const gen = ++fetchGenRef.current;
        setLoading(true);
        setLoadError(null);
        void (async () => {
            const r = await getPlayerCalculatorMe(scope, ac.signal);
            if (gen !== fetchGenRef.current) return;
            if (r.ok !== true) {
                if (r.status === 0 && r.code === 'ABORTED') return;
                setPayload(null);
                setLoadError(r.error || `Erro ${r.status}`);
                setLoading(false);
                return;
            }
            setPayload(r);
            setSelectedCoinId((prev) => {
                if (prev && r.coins.some((c) => c.id === prev)) return prev;
                return r.coins[0]?.id ?? null;
            });
            setLoading(false);
        })();
        return () => ac.abort();
    }, [scope]);

    const selectedCoin = payload?.coins.find((c) => c.id === selectedCoinId) ?? null;
    const scopesUi = payload?.scopesUi ?? [{ id: 'total', name: 'Poder Total' }];

    return (
        <div className="flex-1 overflow-hidden bg-slate-950 text-slate-200 flex">
            <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col p-4 shrink-0">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 p-2 rounded hover:bg-slate-800 transition-colors"
                >
                    <ArrowLeft size={18} />
                    <span className="font-bold text-sm">Voltar</span>
                </button>

                <div className="text-xs font-bold uppercase text-slate-500 tracking-widest mb-3 px-2">Escopo de Análise</div>

                <div className="space-y-1">
                    {scopesUi.map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            disabled={loading}
                            onClick={() => setScope(opt.id)}
                            className={`w-full flex items-center justify-between p-3 rounded-lg text-sm font-medium transition-all ${
                                scope === opt.id
                                    ? 'bg-amber-600/10 text-amber-400 border border-amber-500/50'
                                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                            } ${loading ? 'opacity-60 cursor-wait' : ''}`}
                        >
                            <span className="flex items-center gap-2">
                                {opt.id === 'total' ? <Box size={16} /> : <Server size={16} />}
                                {opt.name}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="mt-auto p-4 bg-slate-950/50 rounded-xl border border-slate-800">
                    <div className="text-xs text-slate-500 mb-1">Hashrate Selecionado</div>
                    <div className="text-xl font-mono font-bold text-white">
                        {selectedCoin
                            ? `${selectedCoin.userPowerHps.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s`
                            : '—'}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col items-center">
                <div className="max-w-5xl w-full flex flex-col gap-6">
                    {loadError && (
                        <div className="rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                            {loadError}
                        </div>
                    )}

                    {loading && !payload && (
                        <div className="text-center text-slate-500 text-sm py-16">A carregar calculadora…</div>
                    )}

                    {!loading && payload && payload.coins.length === 0 && (
                        <div className="text-center text-slate-500 text-sm py-16">Nenhuma moeda ativa na economia.</div>
                    )}

                    {payload && payload.coins.length > 0 && (
                        <>
                            <div className="flex justify-center items-center">
                                <div className="flex flex-wrap justify-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-800">
                                    {payload.coins.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setSelectedCoinId(c.id)}
                                            className={`px-4 py-2 rounded-md text-sm font-bold uppercase tracking-wider transition-all sm:px-6 ${
                                                selectedCoinId === c.id
                                                    ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/50'
                                                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                            }`}
                                        >
                                            {c.symbol || c.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {selectedCoin && (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 p-8 flex flex-col justify-between group h-48">
                                            <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-amber-400 to-orange-500 rounded-sm"></div>
                                            <div className="z-10">
                                                <div className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-1">
                                                    Ganhos 24h ({selectedCoin.symbol})
                                                </div>
                                                <div className="text-4xl font-black text-white tracking-tight flex items-end gap-2">
                                                    $
                                                    {selectedCoin.dailyUsd.toLocaleString('en-US', {
                                                        minimumFractionDigits: 6,
                                                        maximumFractionDigits: 6
                                                    })}
                                                </div>
                                                <div className="text-amber-400 font-mono text-sm mt-2 font-bold">
                                                    {selectedCoin.dailyCoins.toFixed(8)} {selectedCoin.symbol}
                                                </div>
                                            </div>
                                            <div className="absolute right-[-20px] top-[20px] opacity-5 rotate-12 pointer-events-none">
                                                <TrendingUp size={140} />
                                            </div>
                                        </div>

                                        <div className="relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 p-8 flex flex-col justify-between group h-48">
                                            <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-amber-400 to-orange-600 rounded-sm"></div>
                                            <div className="z-10">
                                                <div className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-1">Projeção 30 Dias</div>
                                                <div className="text-4xl font-black text-white tracking-tight">
                                                    $
                                                    {selectedCoin.projection30Usd.toLocaleString('en-US', {
                                                        minimumFractionDigits: 6,
                                                        maximumFractionDigits: 6
                                                    })}
                                                </div>
                                                <div className="text-orange-400 font-mono text-xs mt-3 italic">
                                                    Câmbio: 1 {selectedCoin.symbol} = $
                                                    {(selectedCoin.priceUSD || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC
                                                </div>
                                            </div>
                                            <div className="absolute right-8 top-8 opacity-20 text-orange-500">
                                                <ArrowUpRight size={48} />
                                            </div>
                                        </div>
                                    </div>

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
                                                {selectedCoin.rows.map((period) => (
                                                    <div
                                                        key={period.label}
                                                        className="grid grid-cols-3 py-4 border-b border-slate-800/50 hover:bg-white/5 transition-colors px-4 items-center"
                                                    >
                                                        <div className="text-sm font-medium text-slate-300">{period.label}</div>
                                                        <div className="text-sm font-mono text-slate-300">{period.coins.toFixed(8)}</div>
                                                        <div className="text-right font-mono font-bold text-green-400">
                                                            $
                                                            {period.usd.toLocaleString('en-US', {
                                                                minimumFractionDigits: 6,
                                                                maximumFractionDigits: 6
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {isAdmin && (
                        <div className="mt-12 pt-8 border-t border-slate-800 animate-in slide-in-from-bottom-5 fade-in duration-500">
                            <div className="bg-slate-900 overflow-hidden border border-slate-700/50 rounded-3xl p-6 shadow-2xl">
                                <AdminEconomy />
                            </div>
                        </div>
                    )}

                    <div className="text-center text-[10px] text-slate-600 mt-4 max-w-2xl mx-auto">
                        * Estimativas calculadas no servidor com base na dificuldade de rede e no teu hashrate. Valores reais podem
                        variar.
                    </div>
                </div>
            </div>
        </div>
    );
};
