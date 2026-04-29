
import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Gift, CheckCircle2, Play, Cpu, Shield, Globe, Zap } from 'lucide-react';

interface RewardSummary {
    id: string;
    name: string;
    count: number;
}

interface OfflineEarnings {
    [coinId: string]: number;
}

interface RewardLoadingScreenProps {
    onComplete: () => void;
    rewards: RewardSummary[];
    isReturningUser?: boolean;
    offlineEarnings?: OfflineEarnings;
    coinNames?: Record<string, string>;
}

export const RewardLoadingScreen: React.FC<RewardLoadingScreenProps> = ({ onComplete, rewards, isReturningUser, offlineEarnings, coinNames }) => {
    const [stage, setStage] = useState<'terminal' | 'summary'>('terminal');
    const [terminalText, setTerminalText] = useState<string[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    const terminalLines = React.useMemo(() => isReturningUser ? [
        "> CONNECTING TO MINE STATION GÊNESIS v1.3..",
        "> AUTHENTICATING COMMANDER IDENTITY...",
        "> SYNCING OFFLINE PROGRESS WITH SERVER NODES...",
        "> CALCULATING PASSIVE INCOME GENERATED...",
        "> UPDATING ACCOUNT LEDGER...",
        "> [OK] AUTHENTICATION VERIFIED",
        "> [OK] OFFLINE_SYNC_COMPLETE",
        "> PREPARING DAILY SUMMARY REPORT...",
        "> LOADING USER DASHBOARD..."
    ] : [
        "> CONNECTING TO MINE STATION GÊNESIS v1.3..",
        "> AUTHENTICATING NEW IDENTITY...",
        "> INITIALIZING SECURE PROTOCOLS [AES-256]...",
        "> FETCHING USER METADATA FROM DECENTRALIZED DB...",
        "> CHECKING ELIGIBILITY FOR REGISTRATION PERKS...",
        "> SCANNING REFERRAL NETWORK FOR PENDING BONUSES...",
        "> SYNCHRONIZING INVENTORY WITH SERVER STATE...",
        "> [OK] CONNECTION ESTABLISHED",
        "> [OK] REGISTRATION_REWARD_FOUND",
        "> [OK] REFERRAL_BONUS_VERIFIED",
        "> ALLOCATING ASSETS TO STORAGE NODES...",
        "> BOOTSTRAP COMPLETE. WELCOME COMMANDER."
    ], [isReturningUser]);

    useEffect(() => {
        if (stage === 'terminal') {
            let lineIdx = 0;
            const interval = setInterval(() => {
                if (lineIdx < terminalLines.length) {
                    setTerminalText(prev => [...prev, terminalLines[lineIdx]]);
                    lineIdx++;
                } else {
                    clearInterval(interval);
                    setTimeout(() => setStage('summary'), 1200);
                }
            }, 120); // Slower, more rhythmic typing
            return () => clearInterval(interval);
        }
    }, [stage, terminalLines]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [terminalText]);

    if (stage === 'terminal') {
        return (
            <div className="fixed inset-0 z-[1000] bg-black flex items-center justify-center font-mono">
                <div className="w-full max-w-2xl bg-black border border-cyan-900/50 shadow-[0_0_50px_rgba(6,182,212,0.1)] p-6 rounded-lg">
                    <div className="flex items-center gap-2 mb-4 border-b border-cyan-900/30 pb-2">
                        <div className="flex gap-1.5">
                            <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
                            <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
                        </div>
                        <span className="text-cyan-800 text-[10px] uppercase tracking-widest ml-4 flex items-center gap-2">
                            <Terminal size={12} /> System Terminal - Mine Station OS
                        </span>
                    </div>
                    <div
                        ref={scrollRef}
                        className="h-64 overflow-y-auto custom-scrollbar text-cyan-400 text-xs md:text-sm space-y-1.5"
                    >
                        {terminalText.map((line, i) => (
                            <div key={i} className="flex gap-2 animate-in fade-in slide-in-from-left-2 duration-100">
                                <span className="opacity-50">[{new Date().toLocaleTimeString('pt-BR', { hour12: false })}]</span>
                                <span>{line}</span>
                            </div>
                        ))}
                        <div className="w-2 h-4 bg-cyan-400 animate-pulse inline-block ml-1"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (isReturningUser) {
        const hasEarnings = offlineEarnings && Object.keys(offlineEarnings).length > 0;

        return (
            <div className="fixed inset-0 z-[1000] bg-slate-950 flex items-center justify-center p-6">
                <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-500">
                    <div className="absolute -top-24 -right-24 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl"></div>
                    <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl"></div>

                    <div className="relative text-center mb-10">
                        <div className="w-24 h-24 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-cyan-500/20 animate-pulse">
                            <Zap className="text-white" size={48} />
                        </div>
                        <h2 className="text-3xl font-black text-white tracking-tighter uppercase mb-2 italic">
                            Ativos Identificados
                        </h2>
                        <p className="text-slate-400">
                            Sua conta foi verificada e identificados que {hasEarnings ? Object.entries(offlineEarnings || {}).filter(([_, a]) => (a as number) > 0).map(([c, a]) => {
                                const name = coinNames?.[c] || c;
                                return `${(a as number) < 0.01 ? (a as number).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 10 }) : (a as number).toFixed(2)} ${name}`;
                            }).join(', ') : 'nenhum recurso'} foram liberados para o seu perfil.
                        </p>
                    </div>

                    <div className="space-y-4 mb-10">
                        {hasEarnings ? (
                            <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800">
                                <h3 className="text-cyan-400 text-xs uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                                    <Cpu size={14} /> Mineração Offline
                                </h3>
                                <div className="space-y-2">
                                    {Object.entries(offlineEarnings || {}).map(([coin, amount]) => {
                                        const displayName = coinNames?.[coin] || coin;
                                        return (
                                            <div key={coin} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/50">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center text-yellow-500 font-bold text-xs">
                                                        {displayName.substring(0, 1)}
                                                    </div>
                                                    <div className="text-left">
                                                        <div className="text-white font-bold">{displayName}</div>
                                                        <div className="text-xs text-slate-500">Crypto Asset</div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-green-400 font-mono font-bold">
                                                        +{(amount as number) < 0.000001 ? (amount as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 12 }) : (amount as number).toFixed(6)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800 text-center py-8">
                                <p className="text-slate-500 text-sm">Nenhuma atividade de mineração registrada durante a ausência.</p>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={onComplete}
                        className="w-full py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-black uppercase tracking-widest rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 group"
                    >
                        <Play size={20} className="group-hover:fill-current" />
                        Acessar Dashboard
                    </button>

                    <div className="text-center mt-6">
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest">
                            Secure Connection • End-to-End Encrypted
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[1000] bg-slate-950 flex items-center justify-center p-6">
            <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-500">
                <div className="absolute -top-24 -right-24 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl"></div>
                <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl"></div>

                <div className="relative text-center mb-10">
                    <div className="w-24 h-24 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-cyan-500/20 animate-bounce">
                        <Gift className="text-white" size={48} />
                    </div>
                    <h2 className="text-3xl font-black text-white tracking-tighter uppercase mb-2 italic">
                        Ativos Identificados
                    </h2>
                    <p className="text-slate-400">
                        Sua conta foi verificada e novos pacotes de recompensas foram liberados para o seu perfil.
                    </p>
                </div>

                <div className="space-y-4 mb-10">
                    {rewards.length > 0 ? (
                        rewards.map((reward) => (
                            <div key={reward.id} className="bg-slate-950/50 rounded-xl p-4 border border-slate-800 flex items-center justify-between group hover:border-cyan-500/30 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                                        <CheckCircle2 className="text-cyan-400" size={24} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-white font-bold text-lg">{reward.name}</div>
                                        <div className="text-slate-500 text-sm">Item Raro</div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-cyan-400 font-bold text-xl">x{reward.count}</div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800 text-center">
                            <p className="text-slate-500">Sistemas online. Nenhum pacote pendente.</p>
                        </div>
                    )}
                </div>

                <button
                    onClick={onComplete}
                    className="w-full py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-black uppercase tracking-widest rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 group"
                >
                    <Play size={20} className="group-hover:fill-current" />
                    Iniciar Mineração
                </button>
            </div>
        </div>
    );
};
