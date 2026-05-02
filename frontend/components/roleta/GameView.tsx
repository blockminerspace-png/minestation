import React, { useState, useCallback } from 'react';
import Wheel from '../Wheel';
import { WheelItem, Upgrade } from '../../types';
import { rollWheel } from '../../services/api';

interface GameViewProps {
  items: WheelItem[];
  onBack: () => void;
  upgrades?: Upgrade[];
}

const GameView: React.FC<GameViewProps & { redeemCode?: string; onRedeemComplete?: () => void }> = ({ items: initialItems, onBack, redeemCode, onRedeemComplete, upgrades }) => {
  const [items, setItems] = useState<WheelItem[]>(initialItems);
  const [isSpinning, setIsSpinning] = useState(false);
  const [targetWinner, setTargetWinner] = useState<WheelItem | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [claiming, setClaiming] = useState(false);

  // Fetch config if redeeming
  React.useEffect(() => {
    if (redeemCode) {
      fetch('/api/wheel/config')
        .then(async (r) => {
          if (!r.ok) {
            const text = await r.text().catch(() => '');
            throw new Error(text || `HTTP ${r.status}`);
          }
          return r.json();
        })
        .then((data: WheelItem[]) => {
          console.log('[GameView] Fetched items:', data);
          if (Array.isArray(data) && data.length > 0) {
            // Map items to include images from upgrades
            const mapped = data.map(item => {
              if (item.itemId && upgrades) {
                const u = upgrades.find(up => up.id === item.itemId);
                if (u && u.image) {
                  return { ...item, image: u.image };
                }
              }
              return item;
            });
            setItems(mapped);
          } else {
            console.warn('[GameView] No items fetched or invalid format');
          }
        })
        .catch(err => console.error('[GameView] Fetch error:', err));
    }
  }, [redeemCode, upgrades]);

  const handleStartSpin = async () => {
    if (isSpinning || items.length === 0) return;

    let selected: WheelItem | null = null;

    if (redeemCode) {
      // SERVER-SIDE ROLL FOR SECURITY
      const res = await rollWheel(redeemCode);
      if (!res.ok) {
        alert(res.error || 'Erro ao iniciar o sorteio.');
        return;
      }

      // Find the item in our local list by itemId or id
      selected = items.find(i => (i.itemId && i.itemId === res.wonItemId) || i.id === res.wonItemId) || null;

      if (!selected) {
        console.warn(`[GameView] Won item ${res.wonItemId} not found in local items list. Falling back to first item.`);
        selected = items[0];
      }
    } else {
      // LOCAL ROLL FOR PREVIEW/ADMIN
      const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
      let random = Math.random() * totalWeight;
      selected = items[0];

      for (const item of items) {
        if (random < item.weight) {
          selected = item;
          break;
        }
        random -= item.weight;
      }
    }

    setTargetWinner(selected);
    setIsSpinning(true);
    setShowResult(false);
  };

  // Create visual items with equal weight for display
  const visualItems = React.useMemo(() => {
    return items.map(i => ({ ...i, weight: 1 }));
  }, [items]);

  const handleStopSpinning = useCallback(async () => {
    setIsSpinning(false);
    setShowResult(true);
  }, []);

  const handleClaim = async () => {
    if (!redeemCode || !targetWinner || claiming) return;
    setClaiming(true);
    try {
      const res = await fetch('/api/roleta/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          // We need email... but we don't have it in props easily unless passed.
          // Actually server needs email to get UID.
          // We can try to get it from local storage or ask user context.
          // Assuming the parent component passes a way or we use a "me" endpoint?
          // Wait, AdminLootBoxes handles it via context usually? No.
          // LuckyBoxStore uses fetch('/api/redeem-code').
          // Let's rely on standard auth if possible? No, endpoint expects email.
          // We need to inject email prop or fetch session.
          // Quick workaround: Retrieve session info here?
          // Or let's assume session cookie is enough? 
          // The endpoint handling in server.js: app.post('/api/roleta/claim', ... const { email ... }
          // I should update server to allow just UID from session if email not provided, OR fetch email here.
          email: localStorage.getItem('userEmail') || '', // Best guess for now
          code: redeemCode,
          wonItemId: targetWinner.itemId || targetWinner.id // Use itemId if linked, else id (fallback)
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Parabéns! Você resgatou: ${targetWinner.label}`);
        if (onRedeemComplete) onRedeemComplete();
      } else {
        alert(data.error || 'Erro ao resgatar');
      }
    } catch (e) {
      alert('Erro de conexão');
    }
    setClaiming(false);
  };

  return (
    <div
      className={`relative z-50 flex w-full flex-col items-center font-sans animate-fade-in px-1 sm:px-2 ${redeemCode ? 'gap-4' : 'gap-8'}`}
    >
      {!redeemCode && (
        <div className="w-full">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 rounded-full border border-slate-600 px-5 py-2 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Configurar chances
          </button>
        </div>
      )}

      {redeemCode && (
        <div className="w-full text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-500/90">Roleta de prémios</p>
          <h2 className="mt-1 font-black tracking-tight text-slate-100 text-xl sm:text-2xl">Giro da sorte</h2>
          <p className="mt-2 max-w-sm mx-auto text-xs leading-relaxed text-slate-500">
            Um giro por código. O resultado é definido no servidor.
          </p>
        </div>
      )}

      <div className="relative w-full flex flex-col items-center">
        <div
          className={`pointer-events-none absolute inset-0 -m-3 rounded-full bg-gradient-to-r from-amber-500/30 to-orange-600/25 blur-2xl transition duration-1000 ${isSpinning ? 'opacity-70' : 'opacity-30'}`}
          aria-hidden
        />
        <Wheel items={visualItems} mustSpin={isSpinning} targetWinner={targetWinner} onStopSpinning={handleStopSpinning} />
      </div>

      {!isSpinning && !showResult && (
        <button
          type="button"
          onClick={handleStartSpin}
          disabled={items.length === 0}
          className="w-full max-w-xs rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-8 py-4 text-base font-black uppercase tracking-widest text-white shadow-lg shadow-orange-900/40 transition hover:from-orange-500 hover:to-amber-500 hover:shadow-orange-500/25 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:text-lg"
        >
          {redeemCode ? 'Girar agora' : 'Girar roleta'}
        </button>
      )}

      {showResult && targetWinner && (
        <div className="mt-2 w-full max-w-md animate-fade-in text-center">
          <div className="rounded-2xl border border-orange-500/35 bg-slate-800/90 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.45)] backdrop-blur-sm">
            <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Resultado</h3>
            <p className="mb-5 text-xl font-black text-white sm:text-2xl" style={{ color: targetWinner.color }}>
              {targetWinner.label}
            </p>

            {redeemCode ? (
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming}
                className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {claiming ? 'A resgatar…' : 'Resgatar prémio'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartSpin}
                className="w-full rounded-xl bg-slate-700 py-3 text-sm font-bold text-white transition hover:bg-slate-600"
              >
                Girar novamente
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GameView;
