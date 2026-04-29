
import React, { useEffect, useState } from 'react';
import { X, Trophy, Medal } from 'lucide-react';
import { getLeaderboard } from '../services/api';

interface LeaderboardModalProps {
    onClose: () => void;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({ onClose }) => {
    const [miners, setMiners] = useState<{ username: string; power: number }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getLeaderboard().then(data => {
            setMiners(data);
            setLoading(false);
        });
    }, []);

    const formatHash = (val: number) => {
        if (val >= 1e12) return (val / 1e12).toFixed(2) + ' TH/s';
        if (val >= 1e9) return (val / 1e9).toFixed(2) + ' GH/s';
        if (val >= 1e6) return (val / 1e6).toFixed(2) + ' MH/s';
        if (val >= 1e3) return (val / 1e3).toFixed(2) + ' kH/s';
        return val.toFixed(0) + ' H/s';
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-yellow-500/30 rounded-lg w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh] animate-in fade-in zoom-in duration-300">
                <div className="p-4 border-b border-yellow-500/20 flex items-center justify-between bg-yellow-900/10">
                    <div className="flex items-center gap-2 text-yellow-500">
                        <Trophy size={20} className="text-yellow-400" />
                        <h2 className="font-bold text-lg uppercase tracking-wider">Top Mineradores</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
                    {loading ? (
                        <div className="p-8 text-center text-slate-500 animate-pulse">Carregando ranking...</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-slate-800/50 text-slate-400 sticky top-0 backdrop-blur-md">
                                <tr>
                                    <th className="px-4 py-3 text-left w-16">Rank</th>
                                    <th className="px-4 py-3 text-left">Minerador</th>
                                    <th className="px-4 py-3 text-right">Poder</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {miners.map((m, i) => (
                                    <tr key={i} className={`hover:bg-white/5 transition-colors ${i < 3 ? 'bg-yellow-500/5' : ''}`}>
                                        <td className="px-4 py-3 font-mono">
                                            {i === 0 && <span className="flex items-center gap-1 text-yellow-400 font-bold"><Medal size={14} /> #1</span>}
                                            {i === 1 && <span className="flex items-center gap-1 text-slate-300 font-bold"><Medal size={14} /> #2</span>}
                                            {i === 2 && <span className="flex items-center gap-1 text-orange-400 font-bold"><Medal size={14} /> #3</span>}
                                            {i > 2 && <span className="text-slate-500">#{i + 1}</span>}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-slate-200">
                                            {m.username}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-yellow-500/80">
                                            {formatHash(m.power)}
                                        </td>
                                    </tr>
                                ))}
                                {miners.length === 0 && (
                                    <tr><td colSpan={3} className="p-8 text-center text-slate-500">Nenhum minerador encontrado.</td></tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="p-3 border-t border-slate-800 bg-slate-950/50 text-center">
                    <p className="text-xs text-slate-500">O ranking é atualizado em tempo real.</p>
                </div>
            </div>
        </div>
    );
};
