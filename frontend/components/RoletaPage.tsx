import React, { useState, useCallback, useEffect } from 'react';
import { Sparkles, Ticket, DollarSign, Loader2 } from 'lucide-react';
import type { Upgrade } from '../types';
import GameView from './roleta/GameView';
import { getPendingRoletaCode, getWheelState, postWheelRedeemCode, newWheelIdempotencyKey } from '../services/api';
import { UiNoticeModal, type UiNotice } from './UiNoticeModal';

export type RoletaPageProps = {
  upgrades: Upgrade[];
  onRedeemSuccess?: (unopenedBoxes: Record<string, number>) => void;
  /** Resgate iniciado em Caixas: o App injeta o código uma vez. */
  bootstrap?: { v: number; code: string } | null;
  onBootstrapConsumed?: () => void;
  /** Saldo USDC (`game_states`) para a roleta paga. */
  usdcBalance: number;
  /** Atualizar saldo/caixas após giro ou resgate pago. */
  onReloadGameState?: () => void | Promise<void>;
};

/**
 * Único ecrã público da roleta: resgate + giro + reclamar prémio (sem duplicar em Caixas da Sorte).
 */
type RoletaTab = 'code' | 'paid';

export const RoletaPage: React.FC<RoletaPageProps> = ({
  upgrades,
  onRedeemSuccess,
  bootstrap,
  onBootstrapConsumed,
  usdcBalance,
  onReloadGameState
}) => {
  const [tab, setTab] = useState<RoletaTab>('code');
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [roletaCode, setRoletaCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [paidTabSpinLabel, setPaidTabSpinLabel] = useState('Giro US$0.10');

  /** Preço do giro pago vindo do servidor (cabeçalho / separador). */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await getWheelState();
      if (cancelled || !s.ok) return;
      setPaidTabSpinLabel(`Giro US$${s.data.spinPriceUsdc.toFixed(2)}`);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Código pendente no servidor (resgatou mas ainda não concluiu o fluxo). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const code = await getPendingRoletaCode();
        if (cancelled || !code) return;
        setRoletaCode((prev) => (prev && prev.length > 0 ? prev : code));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bootstrap?.code) return;
    const t = String(bootstrap.code).trim();
    if (!t) {
      onBootstrapConsumed?.();
      return;
    }
    setRoletaCode(t);
    setTab('code');
    onBootstrapConsumed?.();
  }, [bootstrap?.v, bootstrap?.code, onBootstrapConsumed]);

  const handleRedeem = useCallback(async () => {
    if (!promoCode.trim()) return;
    setRedeeming(true);
    try {
      const idem = newWheelIdempotencyKey();
      const wrapped = await postWheelRedeemCode(promoCode.trim(), idem);
      if (!wrapped.ok) {
        const st = wrapped.status;
        if (st === 409 || st === 422) {
          const s = await getWheelState();
          if (s.ok) setPaidTabSpinLabel(`Giro US$${s.data.spinPriceUsdc.toFixed(2)}`);
        }
        setNotice({ variant: 'error', message: wrapped.error || 'Erro ao resgatar código' });
        return;
      }
      const data = wrapped.data as Record<string, unknown>;
      if (data.type === 'roleta') {
        const c = typeof data.code === 'string' ? data.code.trim() : '';
        setRoletaCode(c || null);
        setPromoCode('');
      } else {
        setNotice({
          variant: 'info',
          title: 'Código de caixa',
          message:
            'Este código não é da roleta. Resgate-o em Caixas da Sorte — o campo «Código promocional» está no topo dessa página.'
        });
        setPromoCode('');
        const ub = data.unopenedBoxes as Record<string, number> | undefined;
        if (onRedeemSuccess && ub) {
          onRedeemSuccess(ub);
        } else if (onRedeemSuccess) {
          onRedeemSuccess({});
        }
      }
    } catch {
      setNotice({ variant: 'error', message: 'Falha na comunicação com o servidor' });
    } finally {
      setRedeeming(false);
    }
  }, [promoCode, onRedeemSuccess]);

  const clearRoletaSession = useCallback(() => {
    setRoletaCode(null);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden animate-in fade-in slide-in-from-bottom-3 duration-300">
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-3 px-3 py-4 sm:gap-4 sm:px-6 sm:py-7">
        <header className="flex min-w-0 flex-col gap-1 border-b border-orange-500/25 pb-3 sm:flex-row sm:items-end sm:justify-between sm:pb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-600/30 sm:h-14 sm:w-14">
              <Sparkles className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.2} aria-hidden />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-orange-500/90">Prémios</p>
              <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                Roleta da sorte
              </h1>
              <p className="mt-0.5 max-w-xl text-xs text-slate-600 dark:text-slate-400 sm:text-sm">
                Por código promocional ou giro pago com saldo USDC no jogo (preço definido no servidor, atualmente
                US$0,10 por giro). Códigos de caixa comuns resgate em Caixas da Sorte.
              </p>
            </div>
          </div>
        </header>

        <div
          className="flex gap-1 rounded-xl border border-slate-700/80 bg-slate-900/40 p-1 sm:max-w-md"
          role="tablist"
          aria-label="Modo da roleta"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'code'}
            onClick={() => setTab('code')}
            className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold uppercase tracking-wide transition sm:text-sm ${
              tab === 'code'
                ? 'bg-orange-600 text-white shadow-md'
                : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
            }`}
          >
            <Ticket className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            Por código
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'paid'}
            onClick={() => setTab('paid')}
            className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold uppercase tracking-wide transition sm:text-sm ${
              tab === 'paid'
                ? 'bg-emerald-700 text-white shadow-md'
                : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
            }`}
          >
            <DollarSign className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            {paidTabSpinLabel}
          </button>
        </div>

        {tab === 'code' ? (
          <section
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-orange-500/25 bg-gradient-to-b from-slate-900 via-slate-950 to-black shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:rounded-2xl"
            aria-label="Roleta e resgate por código"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(251,146,60,0.12),transparent_55%)]" aria-hidden />

            <div className="relative z-10 border-b border-orange-500/20 bg-slate-900/80 px-3 py-3 sm:px-6 sm:py-5">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-200 sm:text-sm">
                <Ticket className="h-4 w-4 text-orange-400" aria-hidden />
                Código da roleta
              </h2>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !redeeming && handleRedeem()}
                  placeholder="Cole o código e resgate"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={Boolean(roletaCode)}
                  className="min-h-[44px] flex-1 rounded-xl border border-slate-600 bg-slate-950/90 px-3 font-mono text-sm uppercase tracking-wide text-slate-100 shadow-inner outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[48px] sm:px-4"
                />
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <button
                    type="button"
                    onClick={handleRedeem}
                    disabled={redeeming || !promoCode.trim() || Boolean(roletaCode)}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-6 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-orange-900/25 transition hover:from-orange-500 hover:to-amber-500 disabled:pointer-events-none disabled:opacity-40 sm:min-h-[48px] sm:flex-none sm:px-8 sm:text-sm"
                  >
                    {redeeming ? (
                      <>
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                        A resgatar
                      </>
                    ) : (
                      'Resgatar'
                    )}
                  </button>
                  {roletaCode ? (
                    <button
                      type="button"
                      onClick={clearRoletaSession}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-500 bg-slate-800/90 px-4 text-xs font-bold uppercase tracking-wide text-slate-200 transition hover:border-slate-400 hover:bg-slate-700 sm:min-h-[48px]"
                    >
                      Trocar código
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="relative z-10 flex min-h-[min(48vh,22rem)] flex-1 flex-col items-center justify-center px-2 py-4 sm:min-h-[min(60vh,32rem)] sm:px-6 sm:py-8 md:min-h-[min(68vh,40rem)]">
              {roletaCode ? (
                <div className="flex w-full min-w-0 max-w-3xl flex-1 flex-col items-center justify-center">
                  <div className="w-full max-w-full origin-center scale-[0.88] sm:scale-[1.02] md:scale-105 lg:scale-110">
                    <GameView
                      items={[]}
                      onBack={clearRoletaSession}
                      redeemCode={roletaCode}
                      upgrades={upgrades}
                      onRedeemComplete={() => {
                        setRoletaCode(null);
                        setPromoCode('');
                        onRedeemSuccess?.({});
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex max-w-md flex-col items-center gap-2 px-2 text-center sm:gap-3 sm:px-4">
                  <Sparkles className="h-10 w-10 text-orange-400/40" strokeWidth={1.5} aria-hidden />
                  <p className="text-sm font-semibold text-slate-400">
                    Cole um código de roleta acima ou abra esta página com um sorteio pendente — a roda aparece aqui
                    depois do resgate.
                  </p>
                  <p className="text-xs text-slate-600">
                    O sorteio é validado no servidor; um giro por código conforme as regras do código.
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-emerald-600/30 bg-gradient-to-b from-slate-900 via-slate-950 to-black shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:rounded-2xl"
            aria-label="Roleta paga"
          >
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.1),transparent_55%)]"
              aria-hidden
            />
            <div className="relative z-10 flex min-h-[min(52vh,24rem)] flex-1 flex-col items-center justify-center px-2 py-5 sm:min-h-[min(62vh,34rem)] sm:px-6 sm:py-10 md:min-h-[min(70vh,42rem)]">
              <div className="flex w-full min-w-0 max-w-3xl flex-1 flex-col items-center justify-center">
                <div className="w-full max-w-full origin-center scale-[0.88] sm:scale-[1.02] md:scale-105 lg:scale-110">
                  <GameView
                    items={[]}
                    onBack={() => setTab('code')}
                    paidSpin
                    usdcBalance={usdcBalance}
                    upgrades={upgrades}
                    onPaidBalanceRefresh={onReloadGameState}
                    onRedeemComplete={() => {
                      void onReloadGameState?.();
                      onRedeemSuccess?.({});
                    }}
                  />
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
      <UiNoticeModal notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
};
