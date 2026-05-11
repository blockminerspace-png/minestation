import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Download,
  Users,
  Sparkles,
  TrendingUp,
  Filter,
  ChevronLeft,
  ChevronRight,
  X as CloseIcon
} from 'lucide-react';
import {
  getAdminReferralSummary,
  getAdminReferralCommissions,
  getAdminReferralLinks,
  buildAdminReferralCsvUrl,
  type AdminReferralSummary,
  type AdminReferralCommissionRow,
  type AdminReferralLinkRow
} from '../services/api';

function formatUsdc(n: number): string {
  if (!Number.isFinite(n)) return '0.00';
  if (Math.abs(n) >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n === 0) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function ymdToMs(ymd: string, endOfDay = false): number | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
  return date.getTime();
}

/**
 * Tela admin de Relatório de Referral.
 *
 * Backend: `/api/admin/referrals/{summary,commissions,links,export.csv}`.
 * Apenas leitura (operadores admin podem inspecionar; ajustes manuais
 * deliberadamente ficam fora desta versão).
 */
export const AdminReferral: React.FC = () => {
  const [summary, setSummary] = useState<AdminReferralSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    referrer: '',
    referred: '',
    q: '',
    minCommission: '',
    maxCommission: ''
  });

  const [commissions, setCommissions] = useState<AdminReferralCommissionRow[]>([]);
  const [commissionsTotal, setCommissionsTotal] = useState(0);
  const [commissionsPage, setCommissionsPage] = useState(1);
  const [commissionsLimit] = useState(50);
  const [commissionsLoading, setCommissionsLoading] = useState(false);

  const [links, setLinks] = useState<AdminReferralLinkRow[]>([]);
  const [linksTotal, setLinksTotal] = useState(0);
  const [linksPage, setLinksPage] = useState(1);
  const [linksLimit] = useState(50);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksQuery, setLinksQuery] = useState('');

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const r = await getAdminReferralSummary();
      if (!r) {
        setSummaryError('Falha ao carregar resumo. Verifique permissões admin.');
        setSummary(null);
      } else {
        setSummary(r);
      }
    } catch {
      setSummaryError('Erro de rede ao carregar o resumo.');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadCommissions = useCallback(
    async (page: number) => {
      setCommissionsLoading(true);
      try {
        const r = await getAdminReferralCommissions({
          page,
          limit: commissionsLimit,
          startDate: ymdToMs(filters.startDate),
          endDate: ymdToMs(filters.endDate, true),
          referrer: filters.referrer.trim() || undefined,
          referred: filters.referred.trim() || undefined,
          q: filters.q.trim() || undefined,
          minCommission: filters.minCommission.trim() ? Number(filters.minCommission) : null,
          maxCommission: filters.maxCommission.trim() ? Number(filters.maxCommission) : null
        });
        if (r) {
          setCommissions(r.rows);
          setCommissionsTotal(r.total);
          setCommissionsPage(r.page);
        } else {
          setCommissions([]);
          setCommissionsTotal(0);
        }
      } finally {
        setCommissionsLoading(false);
      }
    },
    [filters, commissionsLimit]
  );

  const loadLinks = useCallback(
    async (page: number) => {
      setLinksLoading(true);
      try {
        const r = await getAdminReferralLinks({ page, limit: linksLimit, q: linksQuery.trim() || undefined });
        if (r) {
          setLinks(r.rows);
          setLinksTotal(r.total);
          setLinksPage(r.page);
        } else {
          setLinks([]);
          setLinksTotal(0);
        }
      } finally {
        setLinksLoading(false);
      }
    },
    [linksQuery, linksLimit]
  );

  useEffect(() => {
    void loadSummary();
    void loadCommissions(1);
    void loadLinks(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onApplyFilters = useCallback(() => {
    setCommissionsPage(1);
    void loadCommissions(1);
  }, [loadCommissions]);

  const onClearFilters = useCallback(() => {
    setFilters({
      startDate: '',
      endDate: '',
      referrer: '',
      referred: '',
      q: '',
      minCommission: '',
      maxCommission: ''
    });
    setTimeout(() => {
      void loadCommissions(1);
    }, 0);
  }, [loadCommissions]);

  const csvUrl = useMemo(
    () =>
      buildAdminReferralCsvUrl({
        startDate: ymdToMs(filters.startDate),
        endDate: ymdToMs(filters.endDate, true),
        referrer: filters.referrer.trim() || undefined,
        referred: filters.referred.trim() || undefined,
        q: filters.q.trim() || undefined
      }),
    [filters]
  );

  const totalCommissionsPages = Math.max(1, Math.ceil(commissionsTotal / commissionsLimit));
  const totalLinksPages = Math.max(1, Math.ceil(linksTotal / linksLimit));

  return (
    <div className="space-y-6">
      {/* Resumo */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-bold text-sm uppercase flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" /> Resumo do Programa
          </h3>
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={summaryLoading}
            className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white border border-slate-700 hover:border-slate-500 rounded px-2 py-1 disabled:opacity-50"
          >
            <RefreshCw size={12} className={summaryLoading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
        {summaryError && (
          <div className="text-rose-400 text-xs mb-2">{summaryError}</div>
        )}
        {summary ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
              <SummaryCard label="Indicadores" value={summary.stats.uniqueReferrers.toLocaleString('pt-BR')} icon={<Users size={14} />} />
              <SummaryCard label="Vínculos" value={summary.stats.totalLinks.toLocaleString('pt-BR')} icon={<TrendingUp size={14} />} />
              <SummaryCard label="Indicados" value={summary.stats.referredDistinct.toLocaleString('pt-BR')} icon={<Users size={14} />} />
              <SummaryCard label="Comissões pagas" value={summary.stats.commissionsCount.toLocaleString('pt-BR')} icon={<Sparkles size={14} />} />
              <SummaryCard label="Depositado p/ indicados" value={`$${formatUsdc(summary.stats.totalReferredDepositsUsdc)}`} icon={<TrendingUp size={14} />} />
              <SummaryCard label={`Comissão paga (${summary.commissionPercent}%)`} value={`$${formatUsdc(summary.stats.totalCommissionPaidUsdc)}`} icon={<Sparkles size={14} />} />
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">
                Top indicadores por comissão recebida
              </div>
              {summary.topReferrers.length === 0 ? (
                <div className="text-xs text-slate-500">Sem indicadores activos por enquanto.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase text-slate-500 border-b border-slate-800">
                        <th className="py-2 pr-3 font-bold">#</th>
                        <th className="py-2 pr-3 font-bold">Indicador</th>
                        <th className="py-2 pr-3 font-bold text-right">Convidados</th>
                        <th className="py-2 pr-3 font-bold text-right">Comissão total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topReferrers.map((row, idx) => (
                        <tr key={row.id} className="border-b border-slate-800/60 text-slate-300">
                          <td className="py-2 pr-3 font-mono text-slate-500">{idx + 1}</td>
                          <td className="py-2 pr-3">
                            <div className="font-bold">{row.username || row.email || `#${row.id}`}</div>
                            {row.email && <div className="text-[10px] text-slate-500">{row.email}</div>}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">{row.invitedCount}</td>
                          <td className="py-2 pr-3 text-right font-mono text-amber-400">${formatUsdc(row.commissionTotalUsdc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : summaryLoading ? (
          <div className="text-xs text-slate-500 animate-pulse">A carregar…</div>
        ) : null}
      </div>

      {/* Comissões com filtros */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-white font-bold text-sm uppercase flex items-center gap-2">
            <Filter size={16} className="text-amber-400" /> Comissões
          </h3>
          <div className="flex items-center gap-2">
            <a
              href={csvUrl}
              className="inline-flex items-center gap-1.5 text-xs bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-700 text-emerald-200 rounded px-3 py-1.5"
            >
              <Download size={12} /> Exportar CSV
            </a>
            <button
              type="button"
              onClick={() => void loadCommissions(commissionsPage)}
              disabled={commissionsLoading}
              className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white border border-slate-700 hover:border-slate-500 rounded px-2 py-1 disabled:opacity-50"
            >
              <RefreshCw size={12} className={commissionsLoading ? 'animate-spin' : ''} /> Atualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
          <Field label="De" type="date" value={filters.startDate} onChange={(v) => setFilters((f) => ({ ...f, startDate: v }))} />
          <Field label="Até" type="date" value={filters.endDate} onChange={(v) => setFilters((f) => ({ ...f, endDate: v }))} />
          <Field label="Indicador" placeholder="username/email/id" value={filters.referrer} onChange={(v) => setFilters((f) => ({ ...f, referrer: v }))} />
          <Field label="Indicado" placeholder="username/email/id" value={filters.referred} onChange={(v) => setFilters((f) => ({ ...f, referred: v }))} />
          <Field label="Min comissão" placeholder="USDC" value={filters.minCommission} onChange={(v) => setFilters((f) => ({ ...f, minCommission: v }))} />
          <Field label="Max comissão" placeholder="USDC" value={filters.maxCommission} onChange={(v) => setFilters((f) => ({ ...f, maxCommission: v }))} />
          <Field label="Buscar" placeholder="texto livre" value={filters.q} onChange={(v) => setFilters((f) => ({ ...f, q: v }))} />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={onApplyFilters}
            className="inline-flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white font-bold px-3 py-1.5 rounded"
          >
            <Filter size={12} /> Aplicar
          </button>
          <button
            type="button"
            onClick={onClearFilters}
            className="inline-flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded"
          >
            <CloseIcon size={12} /> Limpar
          </button>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <th className="py-2 px-2 text-left font-bold">Data</th>
                <th className="py-2 px-2 text-left font-bold">Indicador</th>
                <th className="py-2 px-2 text-left font-bold">Indicado</th>
                <th className="py-2 px-2 text-right font-bold">Depósito</th>
                <th className="py-2 px-2 text-right font-bold">Taxa</th>
                <th className="py-2 px-2 text-right font-bold">Comissão</th>
                <th className="py-2 px-2 text-left font-bold">Status</th>
                <th className="py-2 px-2 text-left font-bold">Source/Tx</th>
              </tr>
            </thead>
            <tbody>
              {commissions.length === 0 && !commissionsLoading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">Sem registos para os filtros aplicados.</td>
                </tr>
              ) : (
                commissions.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/60 text-slate-200">
                    <td className="py-2 px-2 whitespace-nowrap font-mono text-slate-400">{formatDate(r.createdAt)}</td>
                    <td className="py-2 px-2">
                      <div className="font-bold">{r.referrer.username || r.referrer.email || `#${r.referrer.id}`}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[14rem]">{r.referrer.email || '—'}</div>
                    </td>
                    <td className="py-2 px-2">
                      <div className="font-bold">{r.referred.username || r.referred.email || `#${r.referred.id}`}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[14rem]">{r.referred.email || '—'}</div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-emerald-400">${formatUsdc(r.depositAmountUsdc)}</td>
                    <td className="py-2 px-2 text-right font-mono text-slate-400">{r.commissionPercent}%</td>
                    <td className="py-2 px-2 text-right font-mono text-amber-400">${formatUsdc(r.commissionAmountUsdc)}</td>
                    <td className="py-2 px-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Pago</span>
                    </td>
                    <td className="py-2 px-2 text-[10px] font-mono text-slate-500 truncate max-w-[18rem]" title={r.sourceTransactionId}>
                      {r.sourceType}/{r.sourceTransactionId.slice(0, 24)}…
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={commissionsPage}
          totalPages={totalCommissionsPages}
          total={commissionsTotal}
          loading={commissionsLoading}
          onChange={(p) => void loadCommissions(p)}
        />
      </div>

      {/* Vínculos */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-white font-bold text-sm uppercase flex items-center gap-2">
            <Users size={16} className="text-amber-400" /> Vínculos indicador → indicado
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={linksQuery}
              onChange={(e) => setLinksQuery(e.target.value)}
              placeholder="Buscar nome/email…"
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => void loadLinks(1)}
              disabled={linksLoading}
              className="inline-flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded"
            >
              <Filter size={12} /> Aplicar
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <th className="py-2 px-2 text-left font-bold">#</th>
                <th className="py-2 px-2 text-left font-bold">Indicador</th>
                <th className="py-2 px-2 text-left font-bold">Indicado</th>
                <th className="py-2 px-2 text-left font-bold">1ª comissão</th>
                <th className="py-2 px-2 text-right font-bold">Total depositado</th>
                <th className="py-2 px-2 text-right font-bold">Total comissionado</th>
              </tr>
            </thead>
            <tbody>
              {links.length === 0 && !linksLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">Sem vínculos.</td>
                </tr>
              ) : (
                links.map((r) => (
                  <tr key={r.linkId} className="border-b border-slate-800/60 text-slate-200">
                    <td className="py-2 px-2 font-mono text-slate-500">{r.linkId}</td>
                    <td className="py-2 px-2">
                      <div className="font-bold">{r.referrer.username || r.referrer.email || `#${r.referrer.id}`}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[14rem]">{r.referrer.email || '—'}</div>
                    </td>
                    <td className="py-2 px-2">
                      <div className="font-bold">{r.referred.username || `#${r.referred.id ?? '?'}`}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[14rem]">{r.referred.email || '—'}</div>
                    </td>
                    <td className="py-2 px-2 font-mono text-slate-400">{r.firstCommissionAt > 0 ? formatDate(r.firstCommissionAt) : '—'}</td>
                    <td className="py-2 px-2 text-right font-mono text-emerald-400">${formatUsdc(r.totalDepositedUsdc)}</td>
                    <td className="py-2 px-2 text-right font-mono text-amber-400">${formatUsdc(r.totalCommissionUsdc)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={linksPage}
          totalPages={totalLinksPages}
          total={linksTotal}
          loading={linksLoading}
          onChange={(p) => void loadLinks(p)}
        />
      </div>
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: string; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
    <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-slate-500">
      {icon} <span>{label}</span>
    </div>
    <div className="mt-1 text-lg font-bold font-mono text-white truncate">{value}</div>
  </div>
);

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}> = ({ label, value, onChange, type = 'text', placeholder }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
    />
  </label>
);

const Pagination: React.FC<{
  page: number;
  totalPages: number;
  total: number;
  loading: boolean;
  onChange: (p: number) => void;
}> = ({ page, totalPages, total, loading, onChange }) => (
  <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
    <span>{loading ? 'Carregando…' : `${total} registo(s)`}</span>
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={page <= 1 || loading}
        onClick={() => onChange(page - 1)}
        className="inline-flex items-center gap-1 border border-slate-700 hover:border-slate-500 rounded px-2 py-1 disabled:opacity-40"
      >
        <ChevronLeft size={12} /> Anterior
      </button>
      <span className="font-mono">
        Pág. {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages || loading}
        onClick={() => onChange(page + 1)}
        className="inline-flex items-center gap-1 border border-slate-700 hover:border-slate-500 rounded px-2 py-1 disabled:opacity-40"
      >
        Próxima <ChevronRight size={12} />
      </button>
    </div>
  </div>
);

export default AdminReferral;
