import React from 'react';
import { Construction, RefreshCw } from 'lucide-react';

type Props = {
  message: string | null;
  onRetry: () => void | Promise<void>;
};

/**
 * Ecrã in-app quando `maintenance_mode` está ativo (complementa a página estática do Nginx).
 */
export const PublicMaintenanceScreen: React.FC<Props> = ({ message, onRetry }) => {
  const [busy, setBusy] = React.useState(false);
  const handleRetry = async () => {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-[#0f0c08] text-slate-100 px-6 py-12">
      <div className="max-w-md w-full rounded-2xl border border-amber-600/40 bg-slate-900/80 shadow-2xl shadow-amber-900/20 p-8 text-center backdrop-blur-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-amber-400 ring-2 ring-amber-500/30">
          <Construction size={36} aria-hidden />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-amber-400">Manutenção</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          O site está temporariamente indisponível. Estamos a trabalhar para voltar em breve.
        </p>
        {message ? (
          <p className="mt-4 rounded-lg border border-slate-700/80 bg-slate-950/60 p-3 text-left text-xs text-slate-300 whitespace-pre-wrap break-words">
            {message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleRetry()}
          disabled={busy}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-stone-950 transition hover:bg-amber-500 disabled:opacity-60"
        >
          <RefreshCw size={16} className={busy ? 'animate-spin' : ''} aria-hidden />
          Verificar de novo
        </button>
      </div>
    </div>
  );
};
