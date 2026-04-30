import React, { useState, useEffect } from 'react';
import { RefreshCcw, Coins, AlertCircle } from 'lucide-react';
import { getExchangeSettings } from '../services/api';

interface ExchangeProps {
  coinBalances: Record<string, number>;
  miningCoins: { id: string; name: string; usdcRate: number }[];
  onSellCoin: (coinId: string, percentage: number) => void;
}

export const Exchange: React.FC<ExchangeProps> = ({ coinBalances, miningCoins, onSellCoin }) => {
  const [settings, setSettings] = useState<{ minExchangeAmount: number; exchangeFeePercent: number } | null>(null);

  useEffect(() => {
    loadSettings();
    const interval = setInterval(loadSettings, 10000); // Atualiza a cada 10 segundos
    return () => clearInterval(interval);
  }, []);

  const loadSettings = async () => {
    try {
      const s = await getExchangeSettings();
      setSettings(s);
    } catch (err) {
      console.error("Failed to load exchange settings", err);
    }
  };

  const formatMoney = (val: number) => {
    if (val === 0) return "0.00";
    if (val < 0.01) return val.toFixed(8);
    return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-lg relative overflow-hidden group transition-colors">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 p-4 opacity-5 dark:opacity-10 pointer-events-none">
        <RefreshCcw size={100} />
      </div>

      <div className="relative z-10">
        <div className="flex flex-col gap-4 mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex justify-between items-center">
            <h3 className="text-amber-600 dark:text-amber-500 font-black text-xl flex items-center gap-2 tracking-tight">
              <Coins size={24} className="stroke-[3]" /> EXCHANGE
            </h3>
          </div>

          {settings && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 dark:from-amber-900/40 dark:to-orange-900/40 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 flex flex-col items-center justify-center text-center shadow-sm">
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-1 font-sans">MÍNIMO DE TROCA</span>
                <span className="text-2xl font-black text-slate-800 dark:text-white leading-none font-mono">
                  ${settings.minExchangeAmount.toFixed(2)} <span className="text-xs font-bold text-slate-500">USDC</span>
                </span>
              </div>

              <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 dark:from-amber-900/40 dark:to-orange-900/40 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 flex flex-col items-center justify-center text-center shadow-sm">
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-1 font-sans">TAXA DE SERVIÇO</span>
                <span className="text-2xl font-black text-slate-800 dark:text-white leading-none font-mono">
                  {settings.exchangeFeePercent}<span className="text-sm font-bold text-slate-500">%</span>
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="mt-1">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Criptomoedas Disponíveis</div>
            <div className="space-y-2">
              {miningCoins.filter(c => (c as any).showInExchange !== false).length === 0 ? (
                <div className="text-[12px] text-slate-500">Nenhuma criptomoeda disponível para troca.</div>
              ) : miningCoins.filter(c => (c as any).showInExchange !== false).map(c => {
                const bal = coinBalances[c.id] || 0;
                const est = bal * c.usdcRate;
                const fee = settings ? est * (settings.exchangeFeePercent / 100) : 0;
                const net = est - fee;
                const isBelowMin = settings ? est < settings.minExchangeAmount : false;

                return (
                  <div key={c.id} className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded p-2 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[12px] font-mono text-slate-700 dark:text-slate-200 font-bold">{c.name}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Saldo: {bal < 1 && bal > 0 ? bal.toFixed(8) : bal.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-[12px] text-green-600 dark:text-green-400 font-mono font-bold">${formatMoney(net)}</div>
                        <div className="text-[10px] text-slate-400">Bruto: ${formatMoney(est)}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                      <button onClick={() => onSellCoin(c.id, 0.1)} disabled={bal <= 0 || isBelowMin} className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 text-[10px] py-1 px-2 rounded border border-slate-200 dark:border-slate-700 transition-colors">10%</button>
                      <button onClick={() => onSellCoin(c.id, 0.5)} disabled={bal <= 0 || isBelowMin} className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 text-[10px] py-1 px-2 rounded border border-slate-200 dark:border-slate-700 transition-colors">50%</button>
                      <button onClick={() => onSellCoin(c.id, 1)} disabled={bal <= 0 || isBelowMin} className="bg-green-100 dark:bg-green-900/40 hover:bg-green-200 dark:hover:bg-green-800/60 disabled:opacity-50 disabled:cursor-not-allowed text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/50 text-[10px] py-1 px-2 rounded font-bold transition-colors">VENDER TUDO</button>
                    </div>
                    {isBelowMin && (
                      <div className="text-[9px] text-red-500 text-center">Mínimo não atingido</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

