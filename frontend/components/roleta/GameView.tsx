import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Wallet, RotateCcw, PackageOpen, Loader2, Gift } from 'lucide-react';
import Wheel from '../Wheel';
import { WheelItem, Upgrade } from '../../types';
import { normalizePublicAssetUrl } from '../../utils/publicUrl';
import {
  rollWheel,
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
  /** Navegação para "Caixas da Sorte" — exibe botão no modal de resultado. */
  onGoToLuckyBoxes?: () => void;
}

/**
 * Combina prémios do servidor com o catálogo local de upgrades para garantir imagem real
 * quando existe — evita depender só do nome textual do prémio na BD.
 */
function mergePrizeImages(items: WheelItem[], upgrades?: Upgrade[]): WheelItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (item.image && String(item.image).trim()) return item;
    if (!item.itemId || !upgrades) return item;
    const u = upgrades.find((up) => up.id === item.itemId);
    if (u?.image) return { ...item, image: u.image };
    return item;
  });
}

/** Imagem grande do prémio no modal de resultado, com fallback bonito quando falta. */
const ResultPrizeImage: React.FC<{ src?: string | null; alt: string }> = ({ src, alt }) => {
  const [broken, setBroken] = useState(false);
  const url = useMemo(() => (src ? normalizePublicAssetUrl(src) || src : undefined), [src]);
  if (!url || broken) {
    return (
      <div className="flex h-32 w-32 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/25 to-orange-700/15 ring-1 ring-amber-400/40 sm:h-36 sm:w-36">
        <Gift className="h-16 w-16 text-amber-300 sm:h-20 sm:w-20" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      onError={() => setBroken(true)}
      className="h-32 w-32 select-none rounded-2xl object-contain ring-1 ring-amber-400/30 sm:h-36 sm:w-36"
      draggable={false}
    />
  );
};

const GameView: React.FC<GameViewProps & { redeemCode?: string; onRedeemComplete?: () => void }> = ({
  items: initialItems,
  onBack,
  redeemCode,
  onRedeemComplete,
  upgrades,
  paidSpin = false,
  usdcBalance = 0,
  onPaidBalanceRefresh,
  onGoToLuckyBoxes
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
  const [spinPriceUsdc, setSpinPriceUsdc] = useState(1);
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

  /**
   * Roleta paga: estado consolidado (preço, prémios).
   * Não tratamos mais `legacyPaidPending` aqui — o backend auto-cura na próxima chamada a
   * `/api/wheel/spin` (drena a linha legada e concede a caixa antes de cobrar o novo giro),
   * por isso a UX antiga «Resgatar prémio» com erro «Não há prémio pendente» foi removida.
   */
  React.useEffect(() => {
    if (!paidSpin) return;
    let cancelled = false;
    setConfigLoading(true);
    setConfigError(null);
    setItems([]);
    void (async () => {
      const st = await getWheelState();
      if (cancelled) return;
      if (st.ok === false) {
        setConfigError(st.error || 'Erro ao carregar a roleta.');
        setConfigLoading(false);
        return;
      }
      setSpinPriceUsdc(st.data.spinPriceUsdc > 0 ? st.data.spinPriceUsdc : 1);
      const list = st.data.prizes;
      if (Array.isArray(list) && list.length > 0) {
        setItems(mergePrizeImages(list, upgrades));
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
          setItems(mergePrizeImages(data, upgrades));
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

  const resetForNewSpin = useCallback(() => {
    setShowResult(false);
    setTargetWinner(null);
  }, []);

  const handleStartSpin = async () => {
    if (isSpinning || configLoading || items.length === 0 || paidSpinBusy) return;

    let selected: WheelItem | null = null;

    if (paidSpin) {
      if (!paidSpinIdemRef.current) paidSpinIdemRef.current = newWheelIdempotencyKey();
      const idem = paidSpinIdemRef.current;
      setPaidSpinBusy(true);
      const res = await (async () => {
        try {
          return await postWheelSpin(idem);
        } finally {
          setPaidSpinBusy(false);
        }
      })();
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
      const wonId = res.wonItemId;
      selected = items.find((i) => (i.itemId && i.itemId === wonId) || i.id === wonId) || null;
      if (!selected) {
        console.warn(`[GameView] Paid won item ${wonId} not found in local list. Falling back.`);
        selected = items[0];
      }
    } else if (redeemCode) {
      const res = await rollWheel(redeemCode);
      if (!res.ok) {
        setNotice({ variant: 'error', message: res.error || 'Erro ao iniciar o sorteio.' });
        return;
      }
      selected = items.find(i => (i.itemId && i.itemId === res.wonItemId) || i.id === res.wonItemId) || null;
      if (!selected) {
        console.warn(`[GameView] Won item ${res.wonItemId} not found in local items list. Falling back.`);
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

  const visualItems = React.useMemo(() => items.map(i => ({ ...i, weight: 1 })), [items]);

  const handleStopSpinning = useCallback(async () => {
    setIsSpinning(false);
    setShowResult(true);
  }, []);

  /** Botão «Girar novamente» — fecha resultado e mantém na página da roleta. */
  const handleSpinAgain = useCallback(() => {
    resetForNewSpin();
  }, [resetForNewSpin]);

  /** Botão «Ir para Caixas da Sorte» — navega via callback do App. */
  const handleGoToBoxes = useCallback(() => {
    resetForNewSpin();
    void onRedeemComplete?.();
    onGoToLuckyBoxes?.();
  }, [resetForNewSpin, onRedeemComplete, onGoToLuckyBoxes]);

  const handleClaimByCode = useCallback(async () => {
    if (!redeemCode || !targetWinner || claiming) return;
    setClaiming(true);
    try {
      const wonItemId = String(targetWinner.itemId || targetWinner.id || '').trim();
      if (!wonItemId) {
        setNotice({ variant: 'error', message: 'Prémio inválido (sem id). Contacte o suporte.' });
        setClaiming(false);
        return;
      }
      const res = await fetch('/api/roleta/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: redeemCode, wonItemId })
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
    } catch {
      setNotice({ variant: 'error', message: 'Erro de conexão' });
    }
    setClaiming(false);
  }, [redeemCode, targetWinner, claiming, onRedeemComplete]);

  const resultImage = targetWinner?.image ?? null;
  const resultLabel = targetWinner?.label ?? '';

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
            do teu saldo no jogo. O prémio vai direto para{' '}
            <span className="font-semibold text-orange-300">Caixas da Sorte</span>.
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
        {(redeemCode || paidSpin) && configLoading && (
          <div className="flex min-h-[min(20rem,calc(100vw-1.5rem))] w-full max-w-sm flex-col items-center justify-center gap-3 rounded-full border border-slate-700/80 bg-slate-900/50 p-6 text-center sm:min-h-[min(24rem,calc(100vw-2.5rem))] sm:p-8">
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
            (paidSpin && usdcBalance + 1e-9 < spinPriceUsdc)
          }
          className={`w-full max-w-[min(22rem,calc(100vw-2rem))] rounded-2xl px-5 py-3.5 text-sm font-black uppercase tracking-widest text-white shadow-lg transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:max-w-sm sm:px-8 sm:py-4 sm:text-base md:text-lg ${
            paidSpin
              ? 'bg-gradient-to-r from-emerald-700 to-teal-600 shadow-emerald-900/40 hover:from-emerald-600 hover:to-teal-500'
              : 'bg-gradient-to-r from-orange-600 to-amber-600 shadow-orange-900/40 hover:from-orange-500 hover:to-amber-500'
          }`}
        >
          {paidSpinBusy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> A iniciar…
            </span>
          ) : paidSpin
            ? `Girar por US$${spinPriceUsdc.toFixed(2)}`
            : redeemCode
              ? 'Girar agora'
              : 'Girar roleta'}
        </button>
      )}
      {paidSpin && !isSpinning && !showResult && usdcBalance + 1e-9 < spinPriceUsdc && (
        <p className="text-center text-xs font-semibold text-rose-300">
          Saldo USDC insuficiente para girar.
        </p>
      )}
      {isSpinning && (
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 px-4 py-2 text-xs font-bold uppercase tracking-widest text-orange-200 ring-1 ring-orange-500/40">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Girando…
        </div>
      )}

      {showResult && targetWinner && (
        <div className="mt-2 w-full min-w-0 max-w-[min(28rem,calc(100vw-1.5rem))] animate-fade-in text-center sm:max-w-md">
          <div className="rounded-3xl border border-amber-400/40 bg-gradient-to-b from-slate-900/95 to-slate-950 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.55),0_0_60px_rgba(251,191,36,0.18)] backdrop-blur-sm sm:p-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-300">
              Você ganhou
            </p>
            <div className="mt-3 flex flex-col items-center gap-3">
              <ResultPrizeImage src={resultImage} alt={resultLabel} />
              <p
                className="text-xl font-black leading-tight tracking-tight text-white sm:text-2xl"
                style={targetWinner.color ? { color: targetWinner.color } : undefined}
              >
                {resultLabel}
              </p>
            </div>
            {(redeemCode || paidSpin) ? (
              <>
                <p className="mt-3 text-xs text-slate-300 sm:text-sm">
                  Seu prémio foi enviado para{' '}
                  <span className="font-bold text-orange-300">Caixas da Sorte</span>.
                </p>

                {redeemCode ? (
                  <div className="mt-5 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleClaimByCode}
                      disabled={claiming}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:opacity-50 sm:py-3.5 sm:text-sm"
                    >
                      {claiming ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> A resgatar…
                        </>
                      ) : (
                        'Resgatar prémio'
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={handleSpinAgain}
                      disabled={usdcBalance + 1e-9 < spinPriceUsdc}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:pointer-events-none disabled:opacity-40 sm:py-3.5 sm:text-sm"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Girar novamente
                    </button>
                    <button
                      type="button"
                      onClick={handleGoToBoxes}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-orange-900/30 transition hover:from-orange-500 hover:to-amber-500 sm:py-3.5 sm:text-sm"
                    >
                      <PackageOpen className="h-3.5 w-3.5" aria-hidden /> Ir para Caixas
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={handleStartSpin}
                className="mt-5 w-full rounded-xl bg-slate-700 py-3 text-sm font-bold text-white transition hover:bg-slate-600"
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
