import React from 'react';
import { Activity, Server, Zap, Database } from 'lucide-react';

interface SystemMonitorProps {
  productionRate: number;
}

export const SystemMonitor: React.FC<SystemMonitorProps> = ({ productionRate }) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-slate-900 rounded-xl shadow-2xl border border-slate-800 relative overflow-hidden">
      {/* Background Texture */}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 pointer-events-none"></div>
      
      {/* Animated Scanline */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-amber-500/5 to-transparent h-full w-full pointer-events-none animate-[scanline_3s_linear_infinite] opacity-30"></div>

      <div className="relative z-10 w-full flex flex-col items-center gap-6">
        
        {/* Central Core Animation */}
        <div className="relative">
            <div className="w-56 h-56 rounded-full border-4 border-slate-700/50 flex items-center justify-center bg-slate-950 shadow-[inset_0_0_40px_rgba(0,0,0,0.8)] relative overflow-hidden">
                {/* Rotating Ring */}
                <div className="absolute inset-0 border-2 border-dashed border-amber-500/30 rounded-full animate-[spin_10s_linear_infinite]"></div>
                <div className="absolute inset-2 border border-amber-800/20 rounded-full animate-[spin_5s_linear_infinite_reverse]"></div>
                
                {/* Core Pulse */}
                <div className={`w-32 h-32 rounded-full bg-amber-500/10 blur-xl absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-1000 ${productionRate > 0 ? 'animate-pulse' : ''}`}></div>

                {/* Center Icon */}
                <div className="relative z-10 flex flex-col items-center text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.45)]">
                    <Server size={48} className={productionRate > 0 ? "text-amber-400" : "text-slate-600"} />
                    <span className="mt-2 text-xs font-mono tracking-widest uppercase text-amber-500/70">
                        {productionRate > 0 ? 'Mining' : 'Offline'}
                    </span>
                </div>
            </div>

            {/* Orbiting particles (CSS only) */}
            <div className="absolute top-1/2 left-1/2 w-64 h-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-800/50 animate-[spin_20s_linear_infinite]">
                 <div className="absolute top-0 left-1/2 w-2 h-2 bg-amber-500 rounded-full shadow-[0_0_10px_#f59e0b]"></div>
            </div>
        </div>

        {/* Data Readout Panel */}
        <div className="w-full bg-slate-950/80 border border-slate-800 rounded-lg p-4 font-mono text-sm shadow-inner grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
                <span className="text-slate-500 text-xs uppercase flex items-center gap-1">
                    <Activity size={10} /> Status do Hash
                </span>
                <span className="text-green-400 font-bold tracking-wider">
                    {productionRate > 0 ? 'OTIMIZADO' : 'AGUARDANDO'}
                </span>
            </div>
            
            <div className="flex flex-col gap-1 items-end">
                <span className="text-slate-500 text-xs uppercase flex items-center gap-1">
                    <Database size={10} /> Hashrate
                </span>
                <span className="text-amber-300 font-bold">
                    {productionRate.toFixed(1)} H/s
                </span>
            </div>

            <div className="col-span-2 border-t border-slate-800 pt-2 mt-1">
                <div className="flex justify-between items-center text-xs text-slate-500 mb-1">
                    <span>Carga do Sistema</span>
                    <span>{(Math.min(100, productionRate)).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div 
                        className="h-full bg-gradient-to-r from-amber-600 to-green-500 transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(100, Math.max(5, productionRate))}%` }}
                    ></div>
                </div>
            </div>
        </div>

      </div>
    </div>
  );
};
