import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Scale,
  ExternalLink,
  Loader2,
  RefreshCw,
  DollarSign,
  TrendingUp,
  Activity,
  Wallet,
  Download,
  Search,
  Copy,
  Calendar,
  Layers
} from 'lucide-react';
import { TransparencyEntry, TransparencyCategory } from '../types';
import { getTransparency, getWeb3Settings } from '../services/api';

const categoryLabel: Record<TransparencyCategory, string> = {
  pool: 'Pool / tesouraria',
  expense: 'Despesas',
  investment: 'Investimentos',
  other: 'Outro'
};

const CATEGORY_ORDER: TransparencyCategory[] = ['pool', 'investment', 'expense', 'other'];

function formatUsdc(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return (
    '$' +
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  );
}

function entryTimeMs(entry: TransparencyEntry): number {
  const t = entry.createdAt;
  if (typeof t !== 'number' || !Number.isFinite(t)) return 0;
  return t < 1e12 ? t * 1000 : t;
}

function ymdStartMs(ymd: string): number | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function ymdEndMs(ymd: string): number | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

function normalizeCategory(c: string): TransparencyCategory {
  return (['pool', 'expense', 'investment', 'other'] as const).includes(c as TransparencyCategory)
    ? (c as TransparencyCategory)
    : 'other';
}

function catBorder(cat: TransparencyCategory): string {
  switch (cat) {
    case 'pool':
      return 'border-emerald-600/35 bg-emerald-950/20';
    case 'investment':
      return 'border-violet-600/35 bg-violet-950/20';
    case 'expense':
      return 'border-orange-600/35 bg-orange-950/20';
    default:
      return 'border-slate-600/50 bg-slate-900/60';
  }
}

function catAccent(cat: TransparencyCategory): string {
  switch (cat) {
    case 'pool':
      return 'text-emerald-300';
    case 'investment':
      return 'text-violet-300';
    case 'expense':
      return 'text-orange-300';
    default:
      return 'text-slate-300';
  }
}

export const TransparencyPage: React.FC = () => {
  const [items, setItems] = useState<TransparencyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depositWallet, setDepositWallet] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => localStorage.getItem('transparencyFilterStart') || '');
  const [endDate, setEndDate] = useState(() => localStorage.getItem('transparencyFilterEnd') || '');
  const [search, setSearch] = useState(() => localStorage.getItem('transparencySearch') || '');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, web3] = await Promise.all([getTransparency(), getWeb3Settings()]);
      setItems(list);
      const w = web3?.depositWallet?.trim();
      setDepositWallet(w && /^0x[a-fA-F0-9]{40}$/i.test(w) ? w : null);
    } catch {
      setError('Não foi possível carregar a transparência.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredItems = useMemo(() => {
    const startMs = ymdStartMs(startDate);
    const endMs = ymdEndMs(endDate);
    const term = search.trim().toLowerCase();
    return items.filter((e) => {
      const ms = entryTimeMs(e);
      if (startMs != null && ms < startMs) return false;
      if (endMs != null && ms > endMs) return false;
      if (term) {
        const blob = `${e.title} ${e.body || ''} ${categoryLabel[normalizeCategory(e.category)]}`.toLowerCase();
        if (!blob.includes(term)) return false;
      }
      return true;
    });
  }, [items, startDate, endDate, search]);

  const stats = useMemo(() => {
    let pool = 0;
    let expense = 0;
    let investment = 0;
    let other = 0;
    let withAmount = 0;
    for (const e of filteredItems) {
      const a = e.amountUsdc;
      if (a == null || !Number.isFinite(a)) continue;
      withAmount += 1;
      const c = normalizeCategory(e.category);
      if (c === 'pool') pool += a;
      else if (c === 'expense') expense += a;
      else if (c === 'investment') investment += a;
      else other += a;
    }
    const totalWeighted = Math.abs(pool) + Math.abs(expense) + Math.abs(investment) + Math.abs(other);
    const informative = pool + investment - expense;
    return { pool, expense, investment, other, withAmount, totalWeighted, informative };
  }, [filteredItems]);

  const weightByCategory = useMemo(() => {
    const rows: { cat: TransparencyCategory; amount: number; label: string }[] = [];
    for (const c of CATEGORY_ORDER) {
      let sum = 0;
      for (const e of filteredItems) {
        if (normalizeCategory(e.category) !== c) continue;
        const a = e.amountUsdc;
        if (a != null && Number.isFinite(a)) sum += a;
      }
      rows.push({ cat: c, amount: sum, label: categoryLabel[c] });
    }
    const denom = stats.totalWeighted > 0 ? stats.totalWeighted : 1;
    return rows.map((r) => ({
      ...r,
      pct: denom > 0 ? Math.min(100, (Math.abs(r.amount) / denom) * 100) : 0
    }));
  }, [filteredItems, stats.totalWeighted]);

  const grouped = useMemo(() => {
    const m = new Map<TransparencyCategory, TransparencyEntry[]>();
    for (const c of CATEGORY_ORDER) m.set(c, []);
    for (const e of filteredItems) {
      const c = normalizeCategory(e.category);
      m.get(c)!.push(e);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id - b.id));
    }
    return m;
  }, [filteredItems]);

  const exportCsv = () => {
    if (filteredItems.length === 0) {
      alert('Nada para exportar com os filtros atuais.');
      return;
    }
    const headers = ['Categoria', 'Titulo', 'Valor_USDC', 'Data_publicacao', 'Link'];
    const lines = filteredItems.map((e) => {
      const ms = entryTimeMs(e);
      const d = ms ? new Date(ms).toLocaleString('pt-BR') : '';
      const cat = categoryLabel[normalizeCategory(e.category)];
      const amt = e.amountUsdc != null && Number.isFinite(e.amountUsdc) ? String(e.amountUsdc) : '';
      const title = String(e.title).replace(/"/g, '""');
      const link = (e.linkUrl || '').replace(/"/g, '""');
      return `"${cat}","${title}","${amt}","${d}","${link}"`;
    });
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transparencia_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyWallet = () => {
    if (depositWallet) void navigator.clipboard.writeText(depositWallet);
  };

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 max-w-6xl mx-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 p-6 md:p-8 mb-6 shadow-xl">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.1),transparent_55%)] pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 shadow-inner shrink-0">
              <Scale size={28} strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Transparência</h1>
              <p className="text-sm text-slate-400 mt-2 max-w-2xl leading-relaxed">
                Painel público com o que a equipa publica sobre pools, despesas e investimentos. Os totais são calculados só a
                partir destes registos (leitura).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-600 bg-slate-800/90 text-sm font-semibold text-slate-200 hover:bg-slate-700 hover:border-slate-500 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>

        <div className="relative mt-6 flex flex-col gap-3 border-t border-slate-700/60 pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-slate-400">
              <Calendar size={16} />
              <span className="text-xs font-bold uppercase tracking-wide">Período</span>
            </div>
            <span className="text-xs text-slate-500">De</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const v = e.target.value;
                setStartDate(v);
                if (v) localStorage.setItem('transparencyFilterStart', v);
                else localStorage.removeItem('transparencyFilterStart');
              }}
              className="bg-slate-950/80 text-white text-xs px-2 py-1.5 rounded-lg border border-slate-600 outline-none focus:border-emerald-500"
            />
            <span className="text-xs text-slate-500">até</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                const v = e.target.value;
                setEndDate(v);
                if (v) localStorage.setItem('transparencyFilterEnd', v);
                else localStorage.removeItem('transparencyFilterEnd');
              }}
              className="bg-slate-950/80 text-white text-xs px-2 py-1.5 rounded-lg border border-slate-600 outline-none focus:border-emerald-500"
            />
            {(startDate || endDate) && (
              <button
                type="button"
                className="text-[10px] font-bold text-slate-500 hover:text-emerald-400 px-2"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  localStorage.removeItem('transparencyFilterStart');
                  localStorage.removeItem('transparencyFilterEnd');
                }}
              >
                Limpar datas
              </button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="flex flex-1 min-w-0 items-center gap-2 rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 focus-within:border-emerald-500/50">
              <Search size={16} className="text-slate-500 shrink-0" />
              <input
                value={search}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearch(v);
                  if (v) localStorage.setItem('transparencySearch', v);
                  else localStorage.removeItem('transparencySearch');
                }}
                placeholder="Buscar por título ou descrição…"
                className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-slate-600 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={exportCsv}
              disabled={loading || filteredItems.length === 0}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-emerald-600/50 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/50 transition-colors disabled:opacity-40 shrink-0"
            >
              <Download size={14} />
              Exportar CSV
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-500 gap-3 rounded-2xl border border-slate-800 bg-slate-950/50">
          <Loader2 className="animate-spin text-emerald-500" size={36} />
          <span className="text-sm">A carregar dados…</span>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 text-red-200 px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-8 py-16 text-center">
          <p className="text-slate-400">Ainda não há publicações nesta secção.</p>
          <p className="text-xs text-slate-600 mt-2">Volte mais tarde.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl border border-slate-700 bg-slate-900/85 p-4 flex flex-col gap-2 min-h-[118px] shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Despesas</span>
                <DollarSign size={18} className="text-slate-500" />
              </div>
              <p className="text-2xl font-bold text-white tabular-nums">{formatUsdc(stats.expense)}</p>
              <p className="text-[11px] text-slate-500">Categoria “despesa” no período filtrado</p>
            </div>
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/15 p-4 flex flex-col gap-2 min-h-[118px] shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">Pools / tesouraria</span>
                <TrendingUp size={18} className="text-emerald-500/70" />
              </div>
              <p className="text-2xl font-bold text-white tabular-nums">{formatUsdc(stats.pool)}</p>
              <p className="text-[11px] text-slate-500">Montantes publicados como pool</p>
            </div>
            <div className="rounded-xl border border-cyan-900/40 bg-cyan-950/10 p-4 flex flex-col gap-2 min-h-[118px] shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400/80">Saldo informativo</span>
                <Activity size={18} className="text-cyan-500/70" />
              </div>
              <p className="text-2xl font-bold text-white tabular-nums">{formatUsdc(stats.informative)}</p>
              <p className="text-[11px] text-slate-500">Pools + investimentos − despesas (só soma das publicações)</p>
            </div>
            <div className="rounded-xl border border-violet-900/40 bg-violet-950/15 p-4 flex flex-col gap-2 min-h-[118px] shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300/80">Investimentos</span>
                <Wallet size={18} className="text-violet-400/70" />
              </div>
              <p className="text-2xl font-bold text-white tabular-nums">{formatUsdc(stats.investment)}</p>
              <p className="text-[11px] text-slate-500">
                {filteredItems.length} registo(s) · {stats.withAmount} com valor USDC
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 md:p-6 mb-6 shadow-inner">
            <div className="flex items-center gap-2 mb-4">
              <Layers size={18} className="text-slate-400" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Peso por categoria</h2>
              <span className="text-[10px] text-slate-600 ml-auto">valores absolutos no período</span>
            </div>
            <div className="space-y-4">
              {weightByCategory.map(({ cat, label, amount, pct }) => (
                <div key={cat} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="w-full sm:w-40 flex items-center justify-between sm:block">
                    <span className={`text-xs font-bold ${catAccent(cat)}`}>{label}</span>
                    <span className="text-xs font-mono text-slate-400 sm:hidden">{formatUsdc(amount)}</span>
                  </div>
                  <div className="flex-1 h-2.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700/80">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        cat === 'pool'
                          ? 'bg-emerald-500'
                          : cat === 'investment'
                            ? 'bg-violet-500'
                            : cat === 'expense'
                              ? 'bg-orange-500'
                              : 'bg-slate-500'
                      }`}
                      style={{ width: `${Number.isFinite(pct) ? pct : 0}%` }}
                    />
                  </div>
                  <span className="hidden sm:block text-xs font-mono text-slate-300 w-28 text-right tabular-nums">
                    {formatUsdc(amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {depositWallet && (
            <div className="rounded-2xl border border-emerald-700/35 bg-gradient-to-br from-emerald-950/40 to-slate-950/80 p-5 md:p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Carteira de depósitos (Polygon)</h2>
                  <p className="text-xs text-slate-500 mt-1">Endereço público usado para depósitos USDC — mesma informação do menu Carteira.</p>
                </div>
              </div>
              <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
                <div className="flex-1 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2.5 font-mono text-xs text-emerald-100/90 break-all">
                  {depositWallet}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={copyWallet}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-xs font-bold text-slate-200 hover:bg-slate-700"
                  >
                    <Copy size={14} />
                    Copiar
                  </button>
                  <a
                    href={`https://debank.com/profile/polygon/${depositWallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-700/50 bg-emerald-950/50 text-xs font-bold text-emerald-200 hover:bg-emerald-900/60"
                  >
                    DeBank
                    <ExternalLink size={12} />
                  </a>
                  <a
                    href={`https://polygonscan.com/address/${depositWallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-xs font-bold text-slate-200 hover:bg-slate-700"
                  >
                    Polygonscan
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 mt-3">Saldo nativo e posições em pools: consulte os exploradores acima.</p>
            </div>
          )}

          <div className="rounded-2xl border border-slate-700 bg-slate-900/50 overflow-hidden mb-8">
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Detalhamento completo</h2>
              <p className="text-[11px] text-slate-600 mt-1">Respeita filtros de data e busca.</p>
            </div>
            <div className="p-4 md:p-6 space-y-8">
              {filteredItems.length === 0 && (
                <div className="rounded-xl border border-amber-900/40 bg-amber-950/25 text-amber-100/95 px-4 py-4 text-sm text-center">
                  Nenhum registo corresponde aos filtros.{' '}
                  <button
                    type="button"
                    className="underline font-bold hover:text-white"
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                      setSearch('');
                      localStorage.removeItem('transparencyFilterStart');
                      localStorage.removeItem('transparencyFilterEnd');
                      localStorage.removeItem('transparencySearch');
                    }}
                  >
                    Limpar filtros
                  </button>
                </div>
              )}
              {CATEGORY_ORDER.map((cat) => {
                const list = grouped.get(cat) || [];
                if (list.length === 0) return null;
                const catSum = list.reduce((acc, e) => {
                  const a = e.amountUsdc;
                  return acc + (a != null && Number.isFinite(a) ? a : 0);
                }, 0);
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800/80">
                      <span className={`text-[11px] font-bold uppercase tracking-widest ${catAccent(cat)}`}>
                        {categoryLabel[cat]}
                      </span>
                      <span className="text-xs font-mono text-slate-500">{formatUsdc(catSum)} no período</span>
                    </div>
                    <ul className="space-y-3">
                      {list.map((row) => {
                        const amt = row.amountUsdc;
                        const hasAmt = amt != null && Number.isFinite(amt);
                        return (
                          <li
                            key={row.id}
                            className={`rounded-xl border p-4 md:p-5 transition-shadow hover:shadow-md ${catBorder(cat)}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                              <h3 className="text-base md:text-lg font-bold text-white pr-4">{row.title}</h3>
                              {hasAmt && (
                                <span className="text-sm font-mono font-bold text-amber-400 shrink-0">{formatUsdc(amt)}</span>
                              )}
                            </div>
                            {row.body && (
                              <p className="text-sm text-slate-400 whitespace-pre-wrap leading-relaxed">{row.body}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-3 mt-3">
                              {row.linkUrl && (
                                <a
                                  href={row.linkUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300"
                                >
                                  Ver link
                                  <ExternalLink size={12} />
                                </a>
                              )}
                              <span className="text-[10px] text-slate-600">
                                {entryTimeMs(row) ? new Date(entryTimeMs(row)).toLocaleString('pt-BR') : ''}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

        </>
      )}
    </div>
  );
};
