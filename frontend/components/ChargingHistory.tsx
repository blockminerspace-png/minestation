import React, { useEffect, useState } from 'react';
import { X, Battery, ArrowRight, CheckCircle, Clock, AlertTriangle, BatteryCharging, History } from 'lucide-react';

interface ChargingHistoryItem {
    id: number;
    action: string;
    battery_item_id: string;
    battery_instance_id: string;
    timestamp: string;
    stock_confirmed: boolean;
    charge_amount: number;
    details: any;
}

interface ChargingSession {
    id: string;
    batteryName: string;
    batteryItemId: string;
    startTime: string;
    startCharge: number;
    endTime?: string;
    endCharge?: number;
    stockConfirmed?: boolean;
    status: 'charging' | 'completed' | 'orphan_exit';
}

interface ChargingHistoryProps {
    onClose: () => void;
}

export const ChargingHistory: React.FC<ChargingHistoryProps> = ({ onClose }) => {
    const [sessions, setSessions] = useState<ChargingSession[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/charging-history')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    processSessions(data);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const processSessions = (items: ChargingHistoryItem[]) => {
        // Ordenar cronologicamente para processar o fluxo (antigo -> novo)
        const sorted = [...items].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        const activeSessions: { [key: string]: ChargingSession } = {};
        const completedSessions: ChargingSession[] = [];

        sorted.forEach(item => {
            // Usar instance_id para rastrear bateria única, fallback para slot se necessário (mas instance é melhor)
            const key = item.battery_instance_id; 
            
            if (!key) return; // Skip if no ID

            if (item.action === 'inserted') {
                // Se já existe uma sessão ativa para esta bateria, finaliza a anterior como "Incompleta/Desaparecida"
                // ou simplesmente substitui. Vamos assumir que é uma nova inserção.
                if (activeSessions[key]) {
                    completedSessions.push(activeSessions[key]);
                }

                activeSessions[key] = {
                    id: `session-${item.id}`,
                    batteryName: item.details?.batteryName || item.battery_item_id,
                    batteryItemId: item.battery_item_id,
                    startTime: item.timestamp,
                    startCharge: item.charge_amount,
                    status: 'charging'
                };
            } else if (item.action === 'removed_to_stock') {
                if (activeSessions[key]) {
                    const sess = activeSessions[key];
                    sess.endTime = item.timestamp;
                    sess.endCharge = item.charge_amount;
                    sess.stockConfirmed = item.stock_confirmed;
                    sess.status = 'completed';
                    
                    completedSessions.push(sess);
                    delete activeSessions[key];
                } else {
                    // Saída sem entrada correspondente (histórico cortado ou erro)
                    completedSessions.push({
                        id: `orphan-${item.id}`,
                        batteryName: item.details?.batteryName || item.battery_item_id,
                        batteryItemId: item.battery_item_id,
                        startTime: '', // Desconhecido
                        startCharge: 0,
                        endTime: item.timestamp,
                        endCharge: item.charge_amount,
                        stockConfirmed: item.stock_confirmed,
                        status: 'orphan_exit'
                    });
                }
            }
        });

        // Adicionar sessões que ainda estão carregando
        Object.values(activeSessions).forEach(sess => completedSessions.push(sess));

        // Ordenar por data mais recente (considerando saída ou entrada)
        completedSessions.sort((a, b) => {
            const timeA = a.endTime ? new Date(a.endTime).getTime() : new Date(a.startTime).getTime();
            const timeB = b.endTime ? new Date(b.endTime).getTime() : new Date(b.startTime).getTime();
            return timeB - timeA;
        });

        setSessions(completedSessions);
    };

    const formatDate = (isoString?: string) => {
        if (!isoString) return '-';
        const date = new Date(isoString);
        return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR');
    };

    const formatCharge = (val?: number) => {
        if (val === undefined || val === null) return '-';
        return `${Math.round(val)} Wh`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl">
                <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-800/50 rounded-t-xl">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <History className="text-amber-500" /> Histórico de Carregamento
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    {loading ? (
                        <div className="text-center text-slate-400 py-8">Carregando...</div>
                    ) : sessions.length === 0 ? (
                        <div className="text-center text-slate-400 py-8">Nenhum registro encontrado.</div>
                    ) : (
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-slate-800 text-slate-400 uppercase text-xs sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3">Bateria</th>
                                    <th className="px-4 py-3">Entrada (Início)</th>
                                    <th className="px-4 py-3 text-center">Fluxo</th>
                                    <th className="px-4 py-3">Saída (Fim)</th>
                                    <th className="px-4 py-3 text-center">Status no Estoque</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {sessions.map((sess) => (
                                    <tr key={sess.id} className="hover:bg-slate-800/30 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2 font-medium text-white">
                                                <Battery size={18} className="text-yellow-500" />
                                                {sess.batteryName}
                                            </div>
                                            <div className="text-xs text-slate-500 font-mono mt-1 opacity-60">
                                                ID: {sess.batteryItemId}
                                            </div>
                                        </td>
                                        
                                        {/* Entrada */}
                                        <td className="px-4 py-3">
                                            {sess.startTime ? (
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2 text-slate-300">
                                                        <Clock size={14} />
                                                        {formatDate(sess.startTime)}
                                                    </div>
                                                    <span className="text-xs text-slate-500 mt-1">
                                                        Carga: <span className="text-yellow-500/80">{formatCharge(sess.startCharge)}</span>
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-600 italic">Desconhecido</span>
                                            )}
                                        </td>

                                        {/* Seta de Fluxo */}
                                        <td className="px-4 py-3 text-center">
                                            <ArrowRight size={16} className="text-slate-600 inline-block" />
                                        </td>

                                        {/* Saída */}
                                        <td className="px-4 py-3">
                                            {sess.endTime ? (
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2 text-slate-300">
                                                        <Clock size={14} />
                                                        {formatDate(sess.endTime)}
                                                    </div>
                                                    <span className="text-xs text-slate-500 mt-1">
                                                        Carga: <span className="text-green-500">{formatCharge(sess.endCharge)}</span>
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-amber-400 bg-amber-500/10 px-2 py-1 rounded w-fit">
                                                    <BatteryCharging size={14} />
                                                    <span className="text-xs font-bold">Carregando...</span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Status Estoque */}
                                        <td className="px-4 py-3 text-center">
                                            {sess.status === 'charging' ? (
                                                <span className="text-slate-500 text-xs">-</span>
                                            ) : sess.stockConfirmed ? (
                                                <div className="flex flex-col items-center text-green-400">
                                                    <CheckCircle size={20} className="mb-1" />
                                                    <span className="text-[10px] uppercase font-bold tracking-wider">Confirmado</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center text-red-500 animate-pulse">
                                                    <AlertTriangle size={20} className="mb-1" />
                                                    <span className="text-[10px] uppercase font-bold tracking-wider">Não Confirmado</span>
                                                    <span className="text-[9px] opacity-80">(Falha no Registro)</span>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};
