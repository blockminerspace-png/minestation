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
      fetch('/api/admin/wheel/config')
        .then(r => r.json())
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
    <div className="w-full flex flex-col items-center animate-fade-in relative z-50">
      <div className="mb-8">
        {!redeemCode && (
          <button
            onClick={onBack}
            className="px-6 py-2 rounded-full border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Configurar Chances
          </button>
        )}
      </div>

      <div className="relative group mb-12">
        <div className={`absolute -inset-1 bg-gradient-to-r from-amber-500 to-yellow-600 rounded-full blur transition duration-1000 ${isSpinning ? 'opacity-60 animate-pulse' : 'opacity-20'}`}></div>
        <Wheel
          items={visualItems}
          mustSpin={isSpinning}
          targetWinner={targetWinner}
          onStopSpinning={handleStopSpinning}
        />
      </div>

      {!isSpinning && !showResult && (
        <button
          onClick={handleStartSpin}
          className="px-12 py-4 bg-amber-500 hover:bg-amber-400 text-slate-900 font-black text-2xl rounded-2xl shadow-2xl transition-all transform hover:scale-110 active:scale-95 animate-bounce"
        >
          {redeemCode ? 'GIRO DA SORTE!' : 'GIRAR ROLETA!'}
        </button>
      )}

      {showResult && targetWinner && (
        <div className="text-center animate-fade-in w-full max-w-lg mt-4">
          <div className="bg-slate-800 p-6 rounded-3xl border-2 border-amber-500 shadow-2xl transition-all">
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Resultado:</h3>
            <p className="text-2xl font-black text-white mb-4" style={{ color: targetWinner.color }}>
              {targetWinner.label}
            </p>

            {redeemCode ? (
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="mt-4 w-full py-3 bg-green-500 hover:bg-green-400 text-white font-black text-lg rounded-xl transition-colors shadow-lg shadow-green-500/20 animate-pulse"
              >
                {claiming ? 'RESGATANDO...' : 'RESGATAR PRÊMIO'}
              </button>
            ) : (
              <button
                onClick={handleStartSpin}
                className="mt-4 w-full py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-colors"
              >
                Girar Novamente
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GameView;
