import React, { useEffect, useState } from 'react';
import { Scale, ExternalLink, Loader2 } from 'lucide-react';
import { TransparencyEntry, TransparencyCategory } from '../types';
import { getTransparency } from '../services/api';

const categoryLabel: Record<TransparencyCategory, string> = {
  pool: 'Pool / tesouraria',
  expense: 'Gasto',
  investment: 'Investimento',
  other: 'Outro'
};

function formatUsdc(n: number | undefined): string | null {
  if (n === undefined || n === null || !Number.isFinite(n)) return null;
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n) + ' USDC';
}

export const TransparencyPage: React.FC = () => {
  const [items, setItems] = useState<TransparencyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await getTransparency();
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) setError('Não foi possível carregar a transparência.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-4 mb-8">
        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
          <Scale size={28} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">Transparência</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
            Informações publicadas pela equipe sobre pools, movimentos relevantes e investimentos do projeto. Apenas leitura.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
          <Loader2 className="animate-spin" size={32} />
          <span className="text-sm">Carregando…</span>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-6 py-12 text-center text-slate-500 dark:text-slate-400 text-sm">
          Ainda não há publicações nesta seção. Volte mais tarde.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-4">
          {items.map((row) => {
            const cat = (['pool', 'expense', 'investment', 'other'] as const).includes(row.category as TransparencyCategory)
              ? (row.category as TransparencyCategory)
              : 'other';
            const amt = formatUsdc(row.amountUsdc);
            return (
              <li
                key={row.id}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                    {categoryLabel[cat]}
                  </span>
                  {amt && (
                    <span className="text-sm font-mono font-bold text-amber-600 dark:text-amber-400">{amt}</span>
                  )}
                </div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">{row.title}</h2>
                {row.body && (
                  <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{row.body}</p>
                )}
                {row.linkUrl && (
                  <a
                    href={row.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    Ver link <ExternalLink size={14} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
