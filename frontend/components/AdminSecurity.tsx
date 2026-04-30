import React, { useState, useEffect } from 'react';
import { SecurityStats } from '../types';
import { getSecurityStats, addToBlacklist, removeFromBlacklist } from '../services/api';
import { Shield, AlertTriangle, Users, Globe, RefreshCw, Lock, Terminal, Ban, CheckCircle, Trash2 } from 'lucide-react';

export const AdminSecurity: React.FC = () => {
    const [stats, setStats] = useState<SecurityStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [activeTab, setActiveTab] = useState<'multi' | 'logs' | 'blacklist'>('multi');
    const [banningIp, setBanningIp] = useState<string | null>(null);

    const loadData = async () => {
        setLoading(true);
        const data = await getSecurityStats();
        setStats(data);
        setLoading(false);
        setLastRefresh(new Date());
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleBanIp = async (ip: string) => {
        const reason = window.prompt(`Motivo do banimento para o IP ${ip}:`, 'Multi-contas ou acesso não autorizado');
        if (reason === null) return;

        setBanningIp(ip);
        const res = await addToBlacklist(ip, reason);
        if (res.ok) {
            await loadData();
        } else {
            alert('Erro ao banir IP: ' + res.error);
        }
        setBanningIp(null);
    };

    const handleUnbanIp = async (ip: string) => {
        if (!window.confirm(`Deseja remover o IP ${ip} da lista negra?`)) return;

        const res = await removeFromBlacklist(ip);
        if (res.ok) {
            await loadData();
        } else {
            alert('Erro ao remover IP: ' + res.error);
        }
    };

    if (loading && !stats) {
        return (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
                <RefreshCw className="text-red-600 animate-spin" size={48} />
                <p className="text-slate-400 font-bold tracking-widest animate-pulse">ANALISANDO SEGURANÇA...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-red-900/30 pb-4">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <Shield className="text-red-600" />
                        SEGURANÇA E AUDITORIA
                    </h2>
                    <p className="text-xs text-slate-500 uppercase tracking-tighter">Proteção Avançada contra Multi-contas e Invasões</p>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[10px] text-slate-500">ÚLTIMA SCAN: {lastRefresh.toLocaleTimeString()}</span>
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="p-2 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:border-red-600 transition-all disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 p-1 bg-slate-950/50 rounded-lg border border-slate-800 w-fit">
                <button
                    onClick={() => setActiveTab('multi')}
                    className={`px-4 py-2 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${activeTab === 'multi' ? 'bg-red-600 text-white shadow-lg shadow-red-900/40' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Users size={14} /> MULTI-CONTAS
                </button>
                <button
                    onClick={() => setActiveTab('logs')}
                    className={`px-4 py-2 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${activeTab === 'logs' ? 'bg-red-600 text-white shadow-lg shadow-red-900/40' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Terminal size={14} /> ACESSOS SUSPEITOS
                </button>
                <button
                    onClick={() => setActiveTab('blacklist')}
                    className={`px-4 py-2 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${activeTab === 'blacklist' ? 'bg-red-600 text-white shadow-lg shadow-red-900/40' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Lock size={14} /> LISTA NEGRA
                </button>
            </div>

            {activeTab === 'multi' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                    {/* Suspected Auto-Referrals */}
                    <div className="bg-slate-900/50 border border-red-900/20 rounded-xl overflow-hidden shadow-2xl">
                        <div className="bg-red-600/10 p-4 border-b border-red-900/30 flex items-center gap-3">
                            <AlertTriangle className="text-red-500" size={20} />
                            <h3 className="text-lg font-bold text-red-100 italic">Suspeita de Auto-Indicação</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-950 text-slate-500 uppercase text-[10px] tracking-widest font-bold">
                                    <tr>
                                        <th className="px-4 py-3">Indicador</th>
                                        <th className="px-4 py-3">Indicado</th>
                                        <th className="px-4 py-3">IP (Evidência)</th>
                                        <th className="px-4 py-3">Ação</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {stats?.suspectedAutoReferrals && stats.suspectedAutoReferrals.length > 0 ? (
                                        stats.suspectedAutoReferrals.map((ref, idx) => (
                                            <tr key={idx} className="hover:bg-red-600/5 transition-colors group">
                                                <td className="px-4 py-4">
                                                    <div className="text-white font-bold">{ref.referrer_username}</div>
                                                    <div className="text-[10px] text-slate-500">ID: {ref.referrer_id}</div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="text-red-400 font-bold">{ref.referred_username}</div>
                                                    <div className="text-[10px] text-slate-500">ID: {ref.referred_id}</div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="font-mono text-xs p-1 bg-slate-800 rounded text-slate-300 border border-slate-700">
                                                            {ref.referrer_ip}
                                                        </div>
                                                        <span className="text-[10px] font-bold text-red-500 animate-pulse">MATCH</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <button
                                                        onClick={() => handleBanIp(ref.referrer_ip)}
                                                        className="bg-red-900/20 hover:bg-red-600 text-red-500 hover:text-white border border-red-900/50 p-2 rounded transition-all flex items-center gap-2 text-[10px] font-bold"
                                                    >
                                                        <Ban size={12} /> BANIR IP
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={4} className="px-4 py-8 text-center text-slate-600 italic">Nenhum caso óbvio de auto-indicação detectado.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Multi-Accounts (IP de Registro) */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                            <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center gap-3">
                                <Users className="text-amber-500" size={20} />
                                <h3 className="text-lg font-bold text-slate-100 italic font-serif">Multi-contas (Registro)</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-950 text-slate-500 uppercase text-[10px] tracking-widest font-bold">
                                        <tr>
                                            <th className="px-4 py-3">Endereço IP</th>
                                            <th className="px-4 py-3 text-center">Contas</th>
                                            <th className="px-4 py-3">Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {stats?.multiAccounts && stats.multiAccounts.length > 0 ? (
                                            stats.multiAccounts.map((acc, idx) => (
                                                <tr key={idx} className="hover:bg-slate-800/50 transition-colors group">
                                                    <td className="px-4 py-4">
                                                        <div className="font-mono text-xs text-amber-400">{acc.registration_ip}</div>
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {acc.usernames.slice(0, 3).map((u, i) => (
                                                                <span key={i} className="text-[9px] bg-slate-800 px-1 py-0.2 rounded text-slate-500">
                                                                    {u}
                                                                </span>
                                                            ))}
                                                            {acc.usernames.length > 3 && <span className="text-[9px] text-slate-600">+{acc.usernames.length - 3}</span>}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <span className="bg-amber-900/20 text-amber-400 px-2 py-1 rounded text-xs font-bold ring-1 ring-amber-500/30">
                                                            {acc.account_count}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-4">
                                                        <button
                                                            onClick={() => handleBanIp(acc.registration_ip)}
                                                            className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-all"
                                                        >
                                                            <Ban size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={3} className="px-4 py-8 text-center text-slate-600 italic">Nenhum IP compartilhado detectado.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Multi-Accounts (Dynamic History IP) */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                            <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center gap-3">
                                <Globe className="text-emerald-500" size={20} />
                                <h3 className="text-lg font-bold text-slate-100 italic">Cruzamento Histórico</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-950 text-slate-500 uppercase text-[10px] tracking-widest font-bold">
                                        <tr>
                                            <th className="px-4 py-3">IP Ativo</th>
                                            <th className="px-4 py-3 text-center">Membros</th>
                                            <th className="px-4 py-3">Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {stats?.historyMultiAccounts && stats.historyMultiAccounts.length > 0 ? (
                                            stats.historyMultiAccounts.map((acc, idx) => (
                                                <tr key={idx} className="hover:bg-slate-800/50 transition-colors group">
                                                    <td className="px-4 py-4">
                                                        <div className="font-mono text-xs text-emerald-400">{acc.ip}</div>
                                                        <div className="text-[10px] text-slate-500 italic mt-1 truncate max-w-[150px]">
                                                            {acc.usernames.join(', ')}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <span className="bg-emerald-900/20 text-emerald-400 px-2 py-1 rounded text-xs font-bold ring-1 ring-emerald-500/30">
                                                            {acc.user_count}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-4">
                                                        <button
                                                            onClick={() => handleBanIp(acc.ip)}
                                                            className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-all"
                                                        >
                                                            <Ban size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={3} className="px-4 py-8 text-center text-slate-600 italic">Nenhum cruzamento histórico detectado.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'logs' && (
                <div className="animate-in fade-in duration-300">
                    <div className="bg-slate-900 border border-red-900/30 rounded-xl overflow-hidden shadow-2xl">
                        <div className="bg-slate-950 p-4 border-b border-red-900/30 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Terminal className="text-red-600" size={20} />
                                <h3 className="text-lg font-bold text-white italic underline decoration-red-600/30">Logs de Tentativas Frustradas (Admin)</h3>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-950 text-slate-500 uppercase text-[10px] tracking-widest font-bold">
                                    <tr>
                                        <th className="px-4 py-3">Data / Hora</th>
                                        <th className="px-4 py-3">Endereço IP</th>
                                        <th className="px-4 py-3">URL Tentada</th>
                                        <th className="px-4 py-3">Detalhes</th>
                                        <th className="px-4 py-3">Ação</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {stats?.accessLogs && stats.accessLogs.length > 0 ? (
                                        stats.accessLogs.map((log, idx) => (
                                            <tr key={idx} className="hover:bg-red-600/5 transition-colors group">
                                                <td className="px-4 py-4 text-[10px] text-slate-400 font-mono">
                                                    {new Date(Number(log.created_at)).toLocaleString()}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="font-mono text-xs text-red-400 font-bold">{log.ip}</div>
                                                </td>
                                                <td className="px-4 py-4 font-mono text-[10px] text-slate-300">
                                                    {log.attempted_url}
                                                </td>
                                                <td className="px-4 py-4 text-[10px] text-slate-500 max-w-xs truncate" title={log.details || log.user_agent}>
                                                    {log.details || 'Sem detalhes adicionais'}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <button
                                                        onClick={() => handleBanIp(log.ip)}
                                                        className="bg-red-600 hover:bg-red-700 text-white p-1.5 rounded transition-all shadow-lg shadow-red-900/20"
                                                        title="Banir IP Permanentemente"
                                                    >
                                                        <Ban size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-slate-600 italic font-bold tracking-widest">SISTEMA INTACTO. NENHUMA TENTATIVA SUSPEITA REGISTRADA.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'blacklist' && (
                <div className="animate-in fade-in duration-300">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                        <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Lock className="text-yellow-500" size={20} />
                                <h3 className="text-lg font-bold text-white">Lista Negra de IPs (Banimentos Ativos)</h3>
                            </div>
                        </div>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {stats?.blacklist && stats.blacklist.length > 0 ? (
                                stats.blacklist.map((entry, idx) => (
                                    <div key={idx} className="bg-slate-950 border border-slate-800 p-4 rounded-lg relative group overflow-hidden">
                                        <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-all">
                                            <button
                                                onClick={() => handleUnbanIp(entry.ip)}
                                                className="text-slate-500 hover:text-emerald-500"
                                                title="Remover Banimento"
                                            >
                                                <CheckCircle size={18} />
                                            </button>
                                        </div>
                                        <div className="font-mono text-sm text-red-500 font-bold mb-1">{entry.ip}</div>
                                        <div className="text-[10px] text-slate-500 mb-2 italic">"{entry.reason || 'Sem motivo especificado'}"</div>
                                        <div className="flex items-center justify-between mt-4 pt-2 border-t border-slate-900">
                                            <span className="text-[9px] text-slate-600">BANIDO EM: {new Date(Number(entry.added_at)).toLocaleDateString()}</span>
                                            <button
                                                onClick={() => handleUnbanIp(entry.ip)}
                                                className="text-[9px] text-red-900 hover:text-red-500 font-bold uppercase transition-colors"
                                            >
                                                REVOGAR
                                            </button>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="col-span-full py-12 text-center">
                                    <Shield className="text-slate-800 mx-auto mb-4" size={48} />
                                    <p className="text-slate-600 font-bold uppercase tracking-tighter">NENHUM IP BANIDO NO MOMENTO</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
