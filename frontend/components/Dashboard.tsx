/**
 * Dashboard principal do Genesis Miner (`/dashboard`).
 *
 * Componente exclusivamente de leitura — agrega o estado do utilizador via
 * `GET /api/dashboard/state` e renderiza-o num layout premium dark/cyber.
 *
 * Princípios respeitados:
 *  - Não introduz lógica de mineração/saque/upgrade (delega aos módulos já existentes).
 *  - Não usa `alert()` nativo, `window.location.reload()`, nem cria rotas paralelas.
 *  - Atalhos rápidos usam `onNavigate(view)` quando possível (SPA) e caem em
 *    `<a href>` quando o atalho aponta para uma view não-padrão.
 *  - Tudo é responsivo (1/2/3 colunas) e tem skeleton + empty + error states.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Award,
  Battery,
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Compass,
  Crown,
  Eye,
  Flame,
  Gift,
  Server as ServerIcon,
  ShoppingCart,
  Skull,
  Sparkles,
  LayoutGrid,
  Leaf,
  Trophy,
  Wallet as WalletIcon,
  Wrench,
  Zap
} from 'lucide-react';
import { getDashboardState } from '../services/api';
import type {
  DashboardEcosystemModule,
  DashboardEvent,
  DashboardMinerState,
  DashboardNotification,
  DashboardQuickAccessItem,
  DashboardRanking,
  DashboardState,
  DashboardWalletState
} from '../types/dashboard';

interface DashboardProps {
  /** Navegação SPA: chama `goToGameView(view)` no `App.tsx`. */
  onNavigate: (viewId: string) => void;
}

// =====================================================================
// Helpers de formatação
// =====================================================================

function formatUsdc(n: number): string {
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAmount(n: number, max = 4): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: max });
}

function formatHash(n: number): { value: string; unit: string } {
  if (!Number.isFinite(n) || n <= 0) return { value: '0', unit: 'H/s' };
  const abs = Math.abs(n);
  if (abs >= 1e15) return { value: (n / 1e15).toFixed(2), unit: 'PH/s' };
  if (abs >= 1e12) return { value: (n / 1e12).toFixed(2), unit: 'TH/s' };
  if (abs >= 1e9) return { value: (n / 1e9).toFixed(2), unit: 'GH/s' };
  if (abs >= 1e6) return { value: (n / 1e6).toFixed(2), unit: 'MH/s' };
  if (abs >= 1e3) return { value: (n / 1e3).toFixed(2), unit: 'KH/s' };
  return { value: n.toFixed(2), unit: 'H/s' };
}

function timeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (!Number.isFinite(diff) || diff < 0) return 'agora';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// =====================================================================
// Subcomponentes primitivos
// =====================================================================

function ProgressBar({
  value,
  max,
  tone = 'amber'
}: {
  value: number;
  max: number;
  tone?: 'amber' | 'cyan' | 'emerald' | 'violet';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const toneClass =
    tone === 'cyan'
      ? 'from-cyan-500 to-sky-400'
      : tone === 'emerald'
        ? 'from-emerald-500 to-green-400'
        : tone === 'violet'
          ? 'from-violet-500 to-fuchsia-400'
          : 'from-amber-500 to-orange-400';
  return (
    <div className="w-full h-2 rounded-full overflow-hidden bg-slate-800/80 border border-slate-700/50">
      <div
        className={`h-full bg-gradient-to-r ${toneClass} transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatPill({
  label,
  value,
  hint,
  tone = 'amber'
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'amber' | 'cyan' | 'emerald';
}) {
  const toneTextClass =
    tone === 'cyan' ? 'text-cyan-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-amber-300';
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 backdrop-blur-sm">
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`text-base font-bold font-mono ${toneTextClass}`}>{value}</div>
      {hint ? <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  icon,
  action,
  children,
  className = ''
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/80 to-slate-950/90 backdrop-blur-sm shadow-lg shadow-black/20 overflow-hidden ${className}`}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/60">
        <div className="flex items-center gap-2 min-w-0">
          {icon ? <span className="shrink-0 text-amber-400">{icon}</span> : null}
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200 truncate">{title}</h3>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// =====================================================================
// Header + Módulos do ecossistema
// =====================================================================

function ecosystemModuleIcon(id: string) {
  switch (id) {
    case 'workerrealm':
      return <Flame size={18} strokeWidth={2.25} />;
    case 'blockminer':
      return <LayoutGrid size={18} strokeWidth={2.25} />;
    case 'minecore':
      return <Leaf size={18} strokeWidth={2.25} />;
    case 'masterleague':
      return <Trophy size={18} strokeWidth={2.25} />;
    case 'reworth':
      return <Skull size={18} strokeWidth={2.25} />;
    default:
      return <Sparkles size={18} />;
  }
}

function ecosystemThemeClasses(id: string): {
  frame: string;
  glow: string;
  iconWrap: string;
  subText: string;
  btn: string;
  placeholder: string;
} {
  switch (id) {
    case 'workerrealm':
      return {
        frame: 'border-orange-500/55 shadow-[0_0_28px_-6px_rgba(249,115,22,0.55)]',
        glow: 'shadow-orange-500/25',
        iconWrap: 'border-orange-400/40 bg-orange-500/15 text-orange-300',
        subText: 'text-orange-200/85',
        btn: 'border-orange-400/70 text-orange-200 hover:bg-orange-500/15',
        placeholder: 'from-orange-950/90 via-slate-950 to-red-950/80'
      };
    case 'blockminer':
      return {
        frame: 'border-violet-500/60 shadow-[0_0_32px_-8px_rgba(167,139,250,0.55)]',
        glow: 'shadow-violet-500/30',
        iconWrap: 'border-violet-400/45 bg-violet-500/15 text-violet-200',
        subText: 'text-violet-200/85',
        btn: 'border-violet-400/70 text-violet-200 hover:bg-violet-500/15',
        placeholder: 'from-violet-950/90 via-slate-950 to-indigo-950/80'
      };
    case 'minecore':
      return {
        frame: 'border-emerald-500/55 shadow-[0_0_28px_-6px_rgba(52,211,153,0.45)]',
        glow: 'shadow-emerald-500/25',
        iconWrap: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
        subText: 'text-emerald-200/85',
        btn: 'border-emerald-400/70 text-emerald-200 hover:bg-emerald-500/15',
        placeholder: 'from-emerald-950/90 via-slate-950 to-lime-950/70'
      };
    case 'masterleague':
      return {
        frame: 'border-sky-500/55 shadow-[0_0_28px_-6px_rgba(56,189,248,0.45)]',
        glow: 'shadow-sky-500/25',
        iconWrap: 'border-sky-400/40 bg-sky-500/15 text-sky-200',
        subText: 'text-sky-200/85',
        btn: 'border-sky-400/70 text-sky-200 hover:bg-sky-500/15',
        placeholder: 'from-sky-950/90 via-slate-950 to-blue-950/80'
      };
    default:
      return {
        frame: 'border-amber-500/50 shadow-[0_0_28px_-6px_rgba(245,158,11,0.4)]',
        glow: 'shadow-amber-500/25',
        iconWrap: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
        subText: 'text-amber-200/85',
        btn: 'border-amber-400/70 text-amber-200 hover:bg-amber-500/15',
        placeholder: 'from-amber-950/90 via-slate-950 to-yellow-950/70'
      };
  }
}

function EcosystemModulesStrip({ modules }: { modules: DashboardEcosystemModule[] }) {
  const stripRef = useRef<HTMLDivElement>(null);

  const scrollStrip = useCallback((dir: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    const w = Math.max(320, Math.floor(el.clientWidth * 0.75));
    el.scrollBy({ left: dir * w, behavior: 'smooth' });
  }, []);

  if (!modules.length) return null;

  return (
    <section className="relative w-full border-y border-slate-800/90 sm:border sm:rounded-xl bg-[radial-gradient(ellipse_at_top,_rgba(251,146,60,0.06),transparent_55%),linear-gradient(to_bottom,#0b1220,#070b12)] py-5 sm:py-6 shadow-xl shadow-black/40">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] bg-[linear-gradient(rgba(148,163,184,0.25)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.2)_1px,transparent_1px)] bg-[size:24px_24px]" />

      <h2 className="relative text-center text-[11px] sm:text-xs font-black uppercase tracking-[0.28em] text-white mb-4 sm:mb-5 px-3">
        Módulos & Parceiros do Ecossistema
      </h2>

      <div className="relative flex items-center gap-1 sm:gap-2 px-2 sm:px-3">
        <button
          type="button"
          onClick={() => scrollStrip(-1)}
          className="hidden sm:inline-flex shrink-0 w-9 h-9 sm:w-10 sm:h-10 items-center justify-center rounded-lg border border-orange-500/50 bg-slate-950/80 text-orange-400 hover:bg-orange-500/10 hover:border-orange-400 transition-colors"
          aria-label="Anterior"
        >
          <ChevronLeft size={22} strokeWidth={2.5} />
        </button>

        <div
          ref={stripRef}
          className="flex min-w-0 flex-1 gap-3 sm:gap-4 overflow-x-auto overflow-y-visible snap-x snap-mandatory pb-3 pt-1 custom-scrollbar scroll-pl-1 sm:scroll-pl-2"
        >
          {modules.map((m) => {
            const th = ecosystemThemeClasses(m.id);
            const canGo = m.status === 'available';
            const imgH = 'h-[76px] sm:h-[84px]';
            return (
              <div
                key={m.id}
                className={`group relative flex snap-start shrink-0 flex-row items-stretch w-[min(92vw,620px)] sm:w-[min(88vw,680px)] max-w-[720px] rounded-lg overflow-visible bg-slate-950/90 backdrop-blur-sm transition-transform duration-300 hover:-translate-y-px ${th.frame} ${
                  canGo ? '' : 'opacity-[0.92]'
                }`}
              >
                <div className="relative z-[1] flex shrink-0 flex-col justify-center gap-1.5 border-r border-white/5 bg-slate-950/95 px-2.5 py-2 sm:px-3 sm:w-[132px] w-[108px]">
                  <span
                    className={`flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full border ${th.iconWrap}`}
                  >
                    {ecosystemModuleIcon(m.id)}
                  </span>
                  <div className="text-[11px] sm:text-xs font-black uppercase tracking-wide text-white leading-tight line-clamp-2">
                    {m.title}
                  </div>
                </div>

                <div className={`relative z-[1] min-w-0 flex-1 ${imgH} self-center my-1 mr-1 sm:mr-1.5 rounded-md overflow-hidden border border-white/10 ${th.glow}`}>
                  {m.imageUrl ? (
                    <img
                      src={m.imageUrl}
                      alt=""
                      className={`h-full w-full object-cover ${m.id === 'blockminer' ? 'object-[50%_12%]' : 'object-center'}`}
                      loading="lazy"
                    />
                  ) : (
                    <div className={`h-full w-full bg-gradient-to-br ${th.placeholder} flex items-center justify-center`}>
                      <span className="text-2xl font-black text-white/10">{m.title.charAt(0)}</span>
                    </div>
                  )}
                  {m.status === 'coming_soon' ? (
                    <span className="absolute top-1.5 right-1.5 text-[8px] font-black uppercase tracking-widest bg-black/70 border border-white/15 text-slate-200 px-1.5 py-0.5 rounded-sm">
                      Em breve
                    </span>
                  ) : null}

                  {canGo ? (
                    <a
                      href={m.href}
                      target={m.external ? '_blank' : undefined}
                      rel={m.external ? 'noopener noreferrer' : undefined}
                      className={`absolute left-1/2 bottom-0 z-20 -translate-x-1/2 translate-y-1/2 flex items-center gap-1 rounded-full border bg-slate-950/95 px-3.5 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] shadow-lg shadow-black/50 backdrop-blur-sm transition-colors hover:brightness-110 ${th.btn}`}
                    >
                      Entrar
                      <ChevronRight size={12} strokeWidth={2.5} className="opacity-90" />
                    </a>
                  ) : (
                    <span
                      className={`absolute left-1/2 bottom-0 z-20 -translate-x-1/2 translate-y-1/2 flex items-center gap-1 rounded-full border border-slate-600/80 bg-slate-950/90 px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 cursor-not-allowed`}
                    >
                      Em breve
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => scrollStrip(1)}
          className="hidden sm:inline-flex shrink-0 w-9 h-9 sm:w-10 sm:h-10 items-center justify-center rounded-lg border border-orange-500/50 bg-slate-950/80 text-orange-400 hover:bg-orange-500/10 hover:border-orange-400 transition-colors"
          aria-label="Seguinte"
        >
          <ChevronRight size={22} strokeWidth={2.5} />
        </button>
      </div>
    </section>
  );
}

// =====================================================================
// Painel central + cards laterais
// =====================================================================

function MinerStatusCard({ miner }: { miner: DashboardMinerState }) {
  const energyLabel = miner.energyPercent != null ? `${miner.energyPercent.toFixed(1)}%` : '—';
  const energyHint =
    miner.energyChargeWh != null && miner.energyCapacityWh != null
      ? `${formatAmount(miner.energyChargeWh, 0)} / ${formatAmount(miner.energyCapacityWh, 0)} Wh`
      : undefined;

  return (
    <SectionCard title="Miner Status" icon={<Activity size={14} />}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Nível</div>
          <div className="text-base font-bold text-amber-300">
            {miner.levelLabel || 'Acesso padrão'}
          </div>
        </div>
        <span
          className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border ${
            miner.status === 'online'
              ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
              : miner.status === 'idle'
                ? 'border-amber-500/40 text-amber-300 bg-amber-500/10'
                : 'border-slate-600 text-slate-300 bg-slate-700/30'
          }`}
        >
          {miner.status === 'online' ? 'Online' : miner.status === 'idle' ? 'Inativo' : 'Offline'}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Battery size={12} /> Energia
            </span>
            <span className="font-mono text-cyan-300">{energyLabel}</span>
          </div>
          <ProgressBar value={miner.energyPercent ?? 0} max={100} tone="cyan" />
          {energyHint ? (
            <div className="text-[10px] text-slate-500 mt-1 text-right font-mono">{energyHint}</div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Rigs online</div>
            <div className="text-sm font-bold font-mono text-emerald-300">
              {miner.rigsOnline} / {miner.rigsTotal}
            </div>
          </div>
          <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Moedas ativas</div>
            <div className="text-sm font-bold font-mono text-amber-300">
              {Object.keys(miner.hashByCoinId || {}).length}
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function WalletSummaryCard({
  wallet,
  onNavigate
}: {
  wallet: DashboardWalletState;
  onNavigate: (v: string) => void;
}) {
  return (
    <SectionCard title="Wallet" icon={<WalletIcon size={14} />}>
      <div className="rounded-lg bg-slate-900/60 border border-slate-700/60 p-3 flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-400">USDC</div>
          <div className="text-2xl font-extrabold text-emerald-300 font-mono">
            ${formatUsdc(wallet.usdc)}
          </div>
        </div>
        <div className="text-emerald-400/30">
          <WalletIcon size={28} />
        </div>
      </div>

      {wallet.tokens.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic py-1">
          Sem saldo de moedas mineradas ainda.
        </div>
      ) : (
        <ul className="space-y-2 mb-3">
          {wallet.tokens.map((t) => (
            <li
              key={t.coinId}
              className="flex items-center justify-between text-xs rounded-md bg-slate-900/40 border border-slate-800/60 px-2.5 py-1.5"
            >
              <span className="text-slate-300 font-mono truncate">{t.symbol || t.name}</span>
              <span className="font-mono font-bold text-amber-300">{formatAmount(t.amount, 4)}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => onNavigate('wallet')}
        className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-bold uppercase tracking-widest py-2 transition-colors flex items-center justify-center gap-2"
      >
        Ir para Carteira <ChevronRight size={14} />
      </button>
    </SectionCard>
  );
}

function GenesisHeroPanel({
  miner,
  onNavigate
}: {
  miner: DashboardMinerState;
  onNavigate: (v: string) => void;
}) {
  const hash = formatHash(miner.hashTotal);
  return (
    <SectionCard
      title="Genesis Miner"
      icon={<Sparkles size={14} />}
      className="relative min-h-[280px]"
    >
      <div className="absolute inset-x-0 -top-0 h-px bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        <div className="md:col-span-2 rounded-xl border border-amber-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-[0.25em] text-amber-300">Hashpower</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-4xl font-extrabold font-mono text-amber-200 tracking-tight">
                {hash.value}
              </span>
              <span className="text-amber-300 text-sm font-bold pb-1">{hash.unit}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <StatPill
                label="Rigs"
                value={`${miner.rigsOnline}/${miner.rigsTotal}`}
                tone="emerald"
              />
              <StatPill
                label="Bateria"
                value={miner.energyPercent != null ? `${miner.energyPercent.toFixed(1)}%` : '—'}
                tone="cyan"
              />
              <StatPill label="Moedas" value={String(Object.keys(miner.hashByCoinId).length)} />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 flex flex-col">
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Próximos passos</div>
          <ul className="mt-2 space-y-2 text-xs text-slate-300 flex-1">
            <li className="flex items-center gap-2">
              <Wrench size={12} className="text-amber-300" /> Otimize as suas rigs na Oficina.
            </li>
            <li className="flex items-center gap-2">
              <Crown size={12} className="text-amber-300" /> Acelere com Upgrades premium.
            </li>
            <li className="flex items-center gap-2">
              <Trophy size={12} className="text-amber-300" /> Suba no ranking global.
            </li>
          </ul>
          <button
            type="button"
            onClick={() => onNavigate('servers')}
            className="mt-3 w-full rounded-lg border border-amber-500/50 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 text-amber-100 text-xs font-bold uppercase tracking-widest py-2 transition-colors flex items-center justify-center gap-2"
          >
            Ir para Servidores <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

function NotificationsCard({ notifications }: { notifications: DashboardNotification[] }) {
  return (
    <SectionCard title="Notificações" icon={<Bell size={14} />}>
      {notifications.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic py-4 text-center">
          Sem notificações por agora.
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100 truncate">{n.title}</span>
                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                  {timeAgo(n.createdAt)}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{n.message}</p>
              {n.link ? (
                <a
                  href={n.link}
                  className="text-[10px] text-amber-300 hover:text-amber-200 underline mt-1 inline-block"
                  target={/^https?:\/\//.test(n.link) ? '_blank' : undefined}
                  rel={/^https?:\/\//.test(n.link) ? 'noopener noreferrer' : undefined}
                >
                  Saber mais
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ActiveEventsCard({ events }: { events: DashboardEvent[] }) {
  return (
    <SectionCard title="Eventos Ativos" icon={<Calendar size={14} />}>
      {events.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic py-4 text-center">
          Nenhum evento ativo no momento.
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2">
              <div className="text-xs font-bold text-amber-300">{e.title}</div>
              <div className="text-[11px] text-slate-400">{e.subtitle}</div>
              {e.endsAt ? (
                <div className="text-[10px] text-slate-500 font-mono mt-1">
                  Termina em {new Date(e.endsAt).toLocaleString('pt-PT')}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function RankingCard({
  ranking,
  onNavigate
}: {
  ranking: DashboardRanking;
  onNavigate: (v: string) => void;
}) {
  return (
    <SectionCard
      title="Ranking Global"
      icon={<Trophy size={14} />}
      action={
        <button
          type="button"
          onClick={() => onNavigate('ranking')}
          className="text-[10px] uppercase tracking-widest text-amber-300 hover:text-amber-200 font-bold"
        >
          Ver top 100
        </button>
      }
    >
      {ranking.top.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic py-4 text-center">
          Ainda sem dados de ranking.
        </div>
      ) : (
        <ol className="space-y-1.5">
          {ranking.top.map((r) => {
            const h = formatHash(r.hash);
            return (
              <li
                key={`${r.position}-${r.username}`}
                className={`flex items-center justify-between text-xs rounded-md px-2.5 py-1.5 border ${
                  r.isMe
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-100'
                    : 'border-slate-800/80 bg-slate-900/40 text-slate-300'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`inline-block w-5 text-center font-mono text-[10px] ${
                      r.position <= 3 ? 'text-amber-300 font-bold' : 'text-slate-500'
                    }`}
                  >
                    {r.position}
                  </span>
                  <span className="truncate font-bold">{r.username || 'jogador'}</span>
                </span>
                <span className="font-mono text-[11px] shrink-0">
                  {h.value} <span className="text-slate-500">{h.unit}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {ranking.myPosition && !ranking.top.some((t) => t.isMe) ? (
        <div className="mt-3 text-[10px] text-center text-slate-400">
          Você está em #{ranking.myPosition} — {formatHash(ranking.myHash).value}{' '}
          {formatHash(ranking.myHash).unit}
        </div>
      ) : null}
    </SectionCard>
  );
}

const QUICK_ACCESS_ICONS: Record<string, React.ReactNode> = {
  wrench: <Wrench size={18} />,
  shop: <ShoppingCart size={18} />,
  mask: <Skull size={18} />,
  gift: <Gift size={18} />,
  compass: <Compass size={18} />,
  rocket: <Award size={18} />,
  eye: <Eye size={18} />,
  wallet: <WalletIcon size={18} />
};

function QuickAccessGrid({
  items,
  onNavigate
}: {
  items: DashboardQuickAccessItem[];
  onNavigate: (v: string) => void;
}) {
  return (
    <SectionCard title="Acesso Rápido" icon={<Compass size={14} />}>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => {
              if (it.viewId) {
                onNavigate(it.viewId);
              } else if (typeof window !== 'undefined') {
                window.location.href = it.href;
              }
            }}
            className="group flex flex-col items-center gap-1.5 rounded-xl border border-slate-700/60 bg-slate-900/40 hover:border-amber-500/40 hover:bg-amber-500/10 px-2 py-3 transition-all"
          >
            <span className="text-amber-300 group-hover:text-amber-200 transition-colors">
              {QUICK_ACCESS_ICONS[it.icon] ?? <Sparkles size={18} />}
            </span>
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-200 text-center uppercase tracking-wider">
              {it.title}
            </span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

// =====================================================================
// Skeleton + Error states
// =====================================================================

function DashboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-44 rounded-2xl bg-slate-900/60 border border-slate-800/60" />
      <div className="h-40 rounded-2xl bg-slate-900/60 border border-slate-800/60" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <div className="h-44 rounded-2xl bg-slate-900/60 border border-slate-800/60" />
          <div className="h-44 rounded-2xl bg-slate-900/60 border border-slate-800/60" />
        </div>
        <div className="lg:col-span-6 h-[28rem] rounded-2xl bg-slate-900/60 border border-slate-800/60" />
        <div className="lg:col-span-3 space-y-4">
          <div className="h-44 rounded-2xl bg-slate-900/60 border border-slate-800/60" />
          <div className="h-44 rounded-2xl bg-slate-900/60 border border-slate-800/60" />
        </div>
      </div>
      <div className="h-28 rounded-2xl bg-slate-900/60 border border-slate-800/60" />
    </div>
  );
}

function DashboardError({
  message,
  onRetry
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 flex flex-col items-center text-center gap-3">
      <AlertCircle size={32} className="text-red-400" />
      <div className="text-base font-bold text-red-200">
        Não foi possível carregar a dashboard agora.
      </div>
      <p className="text-sm text-red-300/80 max-w-md">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-lg border border-red-500/50 bg-red-500/10 hover:bg-red-500/20 text-red-100 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors"
      >
        Tentar novamente
      </button>
    </div>
  );
}

// =====================================================================
// Componente principal
// =====================================================================

export function Dashboard({ onNavigate }: DashboardProps) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await getDashboardState();
    if (r.ok === true && 'data' in r) {
      setState(r.data);
    } else if ('error' in r) {
      setError(r.error);
    } else {
      setError('Não foi possível carregar a dashboard agora.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadNonce]);

  const content = useMemo(() => {
    if (loading && !state) return <DashboardSkeleton />;
    if (error && !state) {
      return <DashboardError message={error} onRetry={() => setReloadNonce((n) => n + 1)} />;
    }
    if (!state) return <DashboardSkeleton />;

    const { miner, wallet, ecosystemModules, notifications, events, ranking, quickAccess } = state;

    return (
      <div className="space-y-4">
        <EcosystemModulesStrip modules={ecosystemModules} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-3 space-y-4 order-2 lg:order-1">
            <MinerStatusCard miner={miner} />
            <WalletSummaryCard wallet={wallet} onNavigate={onNavigate} />
            <SectionCard title="Genesis DAO" icon={<Crown size={14} />}>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Participe da governança e ajude a construir o futuro do ecossistema.
              </p>
              <a
                href="https://genesisdao.tech"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 transition-colors"
              >
                Saber mais <ArrowUpRight size={12} />
              </a>
            </SectionCard>
          </div>

          <div className="lg:col-span-6 order-1 lg:order-2 space-y-4">
            <GenesisHeroPanel miner={miner} onNavigate={onNavigate} />
            <SectionCard title="Resumo da Operação" icon={<ServerIcon size={14} />}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatPill label="Rigs Online" value={`${miner.rigsOnline}`} tone="emerald" />
                <StatPill label="Rigs Totais" value={`${miner.rigsTotal}`} />
                <StatPill
                  label="Bateria"
                  value={miner.energyPercent != null ? `${miner.energyPercent.toFixed(1)}%` : '—'}
                  tone="cyan"
                />
                <StatPill label="Moedas" value={String(Object.keys(miner.hashByCoinId).length)} />
              </div>
            </SectionCard>
          </div>

          <div className="lg:col-span-3 space-y-4 order-3">
            <NotificationsCard notifications={notifications} />
            <ActiveEventsCard events={events} />
            <RankingCard ranking={ranking} onNavigate={onNavigate} />
          </div>
        </div>

        <QuickAccessGrid items={quickAccess} onNavigate={onNavigate} />
      </div>
    );
  }, [loading, error, state, onNavigate]);

  return (
    <div className="min-h-full w-full max-w-none bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-2 sm:px-4 md:px-6 py-4 sm:py-6 text-slate-100">
      <div className="w-full max-w-none mx-auto">
        {content}
        <div className="mt-6 text-center text-[10px] text-slate-600 flex items-center justify-center gap-2">
          <Zap size={10} className="text-amber-400" />
          Dashboard em desenvolvimento — feedback bem-vindo
          <Clapperboard size={10} className="text-amber-400" />
        </div>
      </div>
    </div>
  );
}
