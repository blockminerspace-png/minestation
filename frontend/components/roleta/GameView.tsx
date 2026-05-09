import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Wallet } from 'lucide-react';
import Wheel from '../Wheel';
import { WheelItem, Upgrade } from '../../types';
import {
  rollWheel,
  claimWheelPaid,
  getWheelState,
  postWheelSpin,
  newWheelIdempotencyKey
} from '../../services/api';
import { UiNoticeModal, type UiNotice } from '../UiNoticeModal';

interface GameViewProps {
  items: WheelItem[];
  onBack: () => void;
  upgrades?: Upgrade[];
  /** Giro pago (USDC); não combinar com `redeemCode` no mesmo ecrã. */
  paidSpin?: boolean;
  /** Saldo USDC (jogo) para validar preço do giro antes de girar. */
  usdcBalance?: number;
  /** Após cobrar o giro ou resgatar o prémio (atualizar saldo/caixas). */
  onPaidBalanceRefresh?: () => void | Promise<void>;
}

const GameView: React.FC<GameViewProps & { redeemCode?: string; onRedeemComplete?: () => void }> = ({
  items: initialItems,
  onBack,
  redeemCode,
  onRedeemComplete,
  upgrades,
  paidSpin = false,
  usdcBalance = 0,
  onPaidBalanceRefresh
}) => {
  const [items, setItems] = useState<WheelItem[]>(initialItems);
  const [isSpinning, setIsSpinning] = useState(false);
  const [targetWinner, setTargetWinner] = useState<WheelItem | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [configLoading, setConfigLoading] = useState(() => Boolean(redeemCode || paidSpin));
  const [configError, setConfigError] = useState<string | null>(null);
  const [configRetryKey, setConfigRetryKey] = useState(0);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const afterNoticeClose = useRef<(() => void) | null>(null);
  const [spinPriceUsdc, setSpinPriceUsdc] = useState(0.1);
  const [legacyPaidWonItemId, setLegacyPaidWonItemId] = useState<string | null>(null);
  const [paidAlreadyDelivered, setPaidAlreadyDelivered] = useState(false);
  const [paidSpinBusy, setPaidSpinBusy] = useState(false);
  const paidSpinIdemRef = useRef<string | null>(null);

  const saldoFormatado = useMemo(() => {
    if (usdcBalance < 0.01 && usdcBalance > 0) return usdcBalance.toFixed(3);
    return usdcBalance.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }, [usdcBalance]);

  const closeNotice = useCallback(() => {
    setNotice(null);
    const fn = afterNoticeClose.current;
    afterNoticeClose.current = null;
    fn?.();
  }, []);

  // Roleta paga: estado consolidado (preço, prémios, legado pendente).
  React.useEffect(() => {
    if (!paidSpin) return;
    let cancelled = false;
    setConfigLoading(true);
    setConfigError(null);
    setItems([]);
    setLegacyPaidWonItemId(null);
    setPaidAlreadyDelivered(false);
    void (async () => {
      const st = await getWheelState();
      if (cancelled) return;
      if (st.ok === false) {
        setConfigError(st.error || 'Erro ao carregar a roleta.');
        setConfigLoading(false);
        return;
      }
      setSpinPriceUsdc(st.data.spinPriceUsdc > 0 ? st.data.spinPriceUsdc : 0.1);
      setLegacyPaidWonItemId(st.data.legacyPaidPending?.wonItemId ?? null);
      const list = st.data.prizes;
      if (Array.isArray(list) && list.length > 0) {
        const mapped = list.map((item) => {
          if (item.itemId && upgrades) {
            const u = upgrades.find((up) => up.id === item.itemId);
            if (u && u.image) {
              return { ...item, image: u.image };
            }
          }
          return item;
        });
        setItems(mapped);
      } else {
        setConfigError('A roleta ainda não tem prémios configurados.');
      }
      setConfigLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [paidSpin, upgrades, configRetryKey]);

  // Roleta por código: lista pública de prémios.
  React.useEffect(() => {
    if (paidSpin) return;
    if (!redeemCode) {
      setConfigLoading(false);
      setConfigError(null);
      return;
    }
    let cancelled = false;
    setConfigLoading(true);
    setConfigError(null);
    setItems([]);
    fetch('/api/wheel/config')
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(text || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: WheelItem[]) => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          const mapped = data.map((item) => {
            if (item.itemId && upgrades) {
              const u = upgrades.find((up) => up.id === item.itemId);
              if (u && u.image) {
                return { ...item, image: u.image };
              }
            }
            return item;
          });
          setItems(mapped);
        } else {
          setConfigError('A roleta ainda não tem prémios configurados.');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[GameView] Fetch error:', err);
          setConfigError(err instanceof Error ? err.message : 'Erro ao carregar a roleta.');
        }
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [redeemCode, paidSpin, upgrades, configRetryKey]);

  /** Retomar prémio pago legado (fluxo antigo com `wheel_paid_pending`). */
  React.useEffect(() => {
    if (!paidSpin || items.length === 0 || !legacyPaidWonItemId) return;
    const w =
      items.find((i) => (i.itemId && i.itemId === legacyPaidWonItemId) || i.id === legacyPaidWonItemId) || null;
    if (w) {
      setTargetWinner(w);
      setShowResult(true);
      setIsSpinning(false);
      setPaidAlreadyDelivered(false);
    }
  }, [paidSpin, items, legacyPaidWonItemId]);

  const handleStartSpin = async () => {
    if (isSpinning || configLoading || items.length === 0 || paidSpinBusy) return;
    if (paidSpin && legacyPaidWonItemId) {
      setNotice({
        variant: 'info',
        message: 'Tens um giro pago antigo por concluir: usa «Resgatar prémio» abaixo.'
      });
      return;
    }

    let selected: WheelItem | null = null;

    if (paidSpin) {
      if (!paidSpinIdemRef.current) paidSpinIdemRef.current = newWheelIdempotencyKey();
      const idem = paidSpinIdemRef.current;
      setPaidSpinBusy(true);
      let res: Awaited<ReturnType<typeof postWheelSpin>>;
      try {
        res = await postWheelSpin(idem);
      } finally {
        setPaidSpinBusy(false);
      }
      if (res.ok === false) {
        paidSpinIdemRef.current = null;
        const st = res.status;
        if (st === 409 || st === 422) {
          void (async () => {
            const r = await getWheelState();
            if (r.ok === true) setSpinPriceUsdc(r.data.spinPriceUsdc);
            void onPaidBalanceRefresh?.();
          })();
        }
        setNotice({ variant: 'error', message: res.error || 'Erro ao iniciar o sorteio.' });
        return;
      }
      void onPaidBalanceRefresh?.();
      paidSpinIdemRef.current = null;
      setPaidAlreadyDelivered(true);
      setLegacyPaidWonItemId(null);
      selected =
        items.find((i) => (i.itemId && i.itemId === res.wonItemId) || i.id === res.wonItemId) || null;
      if (!selected) {
        console.warn(`[GameView] Paid won item ${res.wonItemId} not found in local list. Falling back.`);
        selected = items[0];
      }
    } else if (redeemCode) {
      // SERVER-SIDE ROLL FOR SECURITY
      const res = await rollWheel(redeemCode);
      if (!res.ok) {
        setNotice({ variant: 'error', message: res.error || 'Erro ao iniciar o sorteio.' });
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
    if ((!redeemCode && !paidSpin) || !targetWinner || claiming) return;
    if (paidSpin && paidAlreadyDelivered) return;
    setClaiming(true);
    try {
      const wonItemId = String(targetWinner.itemId || targetWinner.id || '').trim();
      if (!wonItemId) {
        setNotice({ variant: 'error', message: 'Prémio inválido (sem id). Contacte o suporte.' });
        setClaiming(false);
        return;
      }
      if (paidSpin) {
        const res = await claimWheelPaid(wonItemId);
        if (res.ok) {
          afterNoticeClose.current = () => {
            setShowResult(false);
            setTargetWinner(null);
            void onRedeemComplete?.();
          };
          setNotice({
            variant: 'success',
            title: 'Prémio resgatado',
            message: `Parabéns! Você resgatou: ${targetWinner.label}`
          });
        } else {
          setNotice({ variant: 'error', message: res.error || 'Erro ao resgatar' });
        }
      } else {
        const res = await fetch('/api/roleta/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            code: redeemCode,
            wonItemId
          })
        });
        const data = await res.json();
        if (res.ok) {
          afterNoticeClose.current = () => onRedeemComplete?.();
          setNotice({
            variant: 'success',
            title: 'Prémio resgatado',
            message: `Parabéns! Você resgatou: ${targetWinner.label}`
          });
        } else {
          setNotice({ variant: 'error', message: data.error || 'Erro ao resgatar' });
        }
      }
    } catch (e) {
      setNotice({ variant: 'error', message: 'Erro de conexão' });
    }
    setClaiming(false);
  };

  return (
    <div
      className={`relative z-50 flex w-full min-w-0 max-w-full flex-col items-center font-sans animate-fade-in px-0 sm:px-2 ${redeemCode || paidSpin ? 'gap-3 sm:gap-4' : 'gap-6 sm:gap-8'}`}
    >
      {!redeemCode && !paidSpin && (
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

      {paidSpin && !configLoading && !configError && (
        <div className="w-full text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-500/90">Roleta paga</p>
          <h2 className="mt-1 font-black tracking-tight text-slate-100 text-xl sm:text-2xl">
            Giro US${spinPriceUsdc.toFixed(2)}
          </h2>
          <p className="mt-2 max-w-sm mx-auto text-xs leading-relaxed text-slate-500">
            Cada giro debita{' '}
            <span className="font-bold text-slate-300">
              {spinPriceUsdc.toFixed(2)} USDC
            </span>{' '}
            do teu saldo no jogo. Apenas recompensas básicas de baixo impacto; o sorteio é no servidor.
          </p>
          <div className="mt-3 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/35 bg-slate-950/80 px-3 py-1.5 shadow-[0_0_24px_rgba(16,185,129,0.12)] backdrop-blur-sm sm:px-4 sm:py-2">
              <Wallet className="h-3.5 w-3.5 shrink-0 text-emerald-400/90 sm:h-4 sm:w-4" aria-hidden />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-500/90 sm:text-[11px]">
                Saldo USDC
              </span>
              <span className="font-mono text-sm font-black tabular-nums text-amber-100 sm:text-base">
                ${saldoFormatado}
              </span>
            </div>
          </div>
        </div>
      )}

      {redeemCode && !paidSpin && !configLoading && !configError && (
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
        {(redeemCode || paidSpin) && configLoading && (
          <div className="flex min-h-[min(18rem,calc(100vw-1.5rem))] w-full max-w-sm flex-col items-center justify-center gap-3 rounded-full border border-slate-700/80 bg-slate-900/50 p-6 text-center sm:min-h-[min(22rem,calc(100vw-2.5rem))] sm:p-8">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" aria-hidden />
            <p className="text-sm font-semibold text-slate-300">A carregar prémios…</p>
          </div>
        )}
        {(redeemCode || paidSpin) && configError && !configLoading && (
          <div className="flex min-h-[12rem] w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/40 p-6 text-center">
            <p className="text-sm text-rose-100">{configError}</p>
            <button
              type="button"
              onClick={() => setConfigRetryKey((k) => k + 1)}
              className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-orange-500"
            >
              Tentar outra vez
            </button>
          </div>
        )}
        {!((redeemCode || paidSpin) && configLoading) &&
          !((redeemCode || paidSpin) && configError && !configLoading) && (
          <Wheel items={visualItems} mustSpin={isSpinning} targetWinner={targetWinner} onStopSpinning={handleStopSpinning} />
        )}
      </div>

      {!isSpinning && !showResult && (
        <button
          type="button"
          onClick={handleStartSpin}
          disabled={
            items.length === 0 ||
            configLoading ||
            Boolean(configError) ||
            paidSpinBusy ||
            (paidSpin && Boolean(legacyPaidWonItemId)) ||
            (paidSpin && usdcBalance + 1e-9 < spinPriceUsdc)
          }
          className={`w-full max-w-[min(20rem,calc(100vw-2rem))] rounded-xl px-5 py-3.5 text-sm font-black uppercase tracking-widest text-white shadow-lg transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:max-w-xs sm:px-8 sm:py-4 sm:text-base md:text-lg ${
            paidSpin
              ? 'bg-gradient-to-r from-emerald-700 to-teal-600 shadow-emerald-900/40 hover:from-emerald-600 hover:to-teal-500'
              : 'bg-gradient-to-r from-orange-600 to-amber-600 shadow-orange-900/40 hover:from-orange-500 hover:to-amber-500 hover:shadow-orange-500/25'
          }`}
        >
          {paidSpin
            ? `Girar (US$${spinPriceUsdc.toFixed(2)})`
            : redeemCode
              ? 'Girar agora'
              : 'Girar roleta'}
        </button>
      )}

      {showResult && targetWinner && (
        <div className="mt-2 w-full min-w-0 max-w-[min(24rem,calc(100vw-1.5rem))] animate-fade-in text-center sm:max-w-md">
          <div className="rounded-2xl border border-orange-500/35 bg-slate-800/90 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-6">
            <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Resultado</h3>
            <p className="mb-5 text-xl font-black text-white sm:text-2xl" style={{ color: targetWinner.color }}>
              {targetWinner.label}
            </p>

            {redeemCode || paidSpin ? (
              <button
                type="button"
                onClick={paidSpin && paidAlreadyDelivered ? () => {
                  setShowResult(false);
                  setTargetWinner(null);
                  setPaidAlreadyDelivered(false);
                  void onRedeemComplete?.();
                } : handleClaim}
                disabled={claiming}
                className="w-full rounded-xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:opacity-50 sm:py-3.5 sm:text-sm"
              >
                {paidSpin && paidAlreadyDelivered
                  ? 'OK'
                  : claiming
                    ? 'A resgatar…'
                    : 'Resgatar prémio'}
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

      <UiNoticeModal notice={notice} onClose={closeNotice} />
    </div>
  );
};

export default GameView;
