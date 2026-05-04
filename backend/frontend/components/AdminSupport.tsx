import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Archive,
  Inbox,
  ExternalLink,
  Paperclip,
  Send,
  Loader2,
  X,
  History,
  Copy,
  UserCog,
} from 'lucide-react';
import {
  getAdminSupportTickets,
  updateAdminSupportTicketStatus,
  postAdminSupportTicketReply,
  getAdminUserActivity,
  type SupportTicketRow,
  type SupportTicketReplyRow,
  type SupportTicketAttachment,
} from '../services/api';
import type { GameUserActivityEntry } from '@/types';
import { formatUserActivityMeta, ACTIVITY_LOG_FILTER_GROUPS, filterUserActivityLogs } from '../utils/adminUserActivityLog';

export type AdminSupportOpenPlayerPayload = { userId: number; email: string; username: string };

type AdminSupportProps = {
    /** Se o admin tem permissão do separador Utilizadores, mostra o atalho para o editor. */
    canOpenPlayerProfile?: boolean;
    onOpenPlayerProfile?: (p: AdminSupportOpenPlayerPayload) => void;
};

const ACCEPT = 'image/png,image/jpeg,image/jpg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mov';

function isVideoAtt(a: { mime?: string; url?: string }) {
  const m = (a.mime || '').toLowerCase();
  if (m.startsWith('video/')) return true;
  const u = (a.url || '').toLowerCase();
  return /\.(mp4|webm|mov)(\?|$)/.test(u);
}

/** userId vindo da API pode ser número ou string; o salto para Utilizadores precisa de número ≥ 0. */
function ticketUserNumericId(t: SupportTicketRow): number {
  const v = t.userId as unknown;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const ReplyAttachments: React.FC<{ items: SupportTicketReplyRow['attachments'] }> = ({ items }) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((a, i) =>
        isVideoAtt(a) ? (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 border border-sky-900/50 rounded px-2 py-1"
          >
            <ExternalLink size={11} />
            Vídeo: {a.originalName || a.url}
          </a>
        ) : (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block shrink-0">
            <img
              src={a.url}
              alt={a.originalName || ''}
              className="max-h-24 rounded border border-slate-700 object-cover hover:opacity-90"
            />
          </a>
        )
      )}
    </div>
  );
};

export const AdminSupport: React.FC<AdminSupportProps> = ({
    canOpenPlayerProfile = false,
    onOpenPlayerProfile,
}) => {
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [replying, setReplying] = useState(false);
  const [replyErr, setReplyErr] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'thread' | 'activity'>('thread');
  const [activityLogs, setActivityLogs] = useState<GameUserActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityFilterId, setActivityFilterId] = useState('all');
  const [activitySearch, setActivitySearch] = useState('');
  const [copiedTicketId, setCopiedTicketId] = useState<string | null>(null);
  const [listTab, setListTab] = useState<'open' | 'archived'>('open');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { tickets: t } = await getAdminSupportTickets();
      setTickets(t);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setReplyMessage('');
    setReplyFiles([]);
    setReplyErr(null);
  }, [openId]);

  useEffect(() => {
    setDetailTab('thread');
  }, [openId]);

  useEffect(() => {
    setOpenId(null);
  }, [listTab]);

  const openTicketCount = useMemo(() => tickets.filter((x) => x.status !== 'archived').length, [tickets]);
  const archivedTicketCount = useMemo(() => tickets.filter((x) => x.status === 'archived').length, [tickets]);
  const filteredTickets = useMemo(
    () =>
      listTab === 'archived'
        ? tickets.filter((x) => x.status === 'archived')
        : tickets.filter((x) => x.status !== 'archived'),
    [tickets, listTab]
  );

  useEffect(() => {
    if (!openId) return;
    setActivityFilterId('all');
    setActivitySearch('');
    setActivityLogs([]);
    setActivityError(null);
  }, [openId]);

  useEffect(() => {
    if (detailTab !== 'activity' || !openId) return;
    const t = tickets.find((x) => x.id === openId);
    if (!t) return;
    const uid = typeof t.userId === 'number' && Number.isFinite(t.userId) && t.userId > 0 ? Math.floor(t.userId) : undefined;
    if (!t.email?.trim() && !uid) return;
    let cancelled = false;
    (async () => {
      setActivityLoading(true);
      setActivityError(null);
      const { logs, error } = await getAdminUserActivity(t.email || '', { userId: uid, limit: 150 });
      if (cancelled) return;
      setActivityLoading(false);
      if (error) {
        setActivityError(error);
        setActivityLogs([]);
      } else {
        setActivityLogs(logs);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailTab, openId, tickets]);

  const filteredActivityLogs = useMemo(
    () => filterUserActivityLogs(activityLogs, activityFilterId, activitySearch),
    [activityLogs, activityFilterId, activitySearch]
  );

  const copyPlayerEmail = async (email: string, ticketId: string) => {
    const em = email.trim();
    if (!em) return;
    const done = () => {
      setCopiedTicketId(ticketId);
      window.setTimeout(() => {
        setCopiedTicketId((v) => (v === ticketId ? null : v));
      }, 2000);
    };
    try {
      await navigator.clipboard.writeText(em);
      done();
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = em;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch {
        alert('Não foi possível copiar o email.');
      }
    }
  };

  const refreshTicketActivity = async (t: SupportTicketRow) => {
    const uid = typeof t.userId === 'number' && Number.isFinite(t.userId) && t.userId > 0 ? Math.floor(t.userId) : undefined;
    if (!t.email?.trim() && !uid) return;
    setActivityLoading(true);
    setActivityError(null);
    const { logs, error } = await getAdminUserActivity(t.email || '', { userId: uid, limit: 150 });
    setActivityLoading(false);
    if (error) {
      setActivityError(error);
      setActivityLogs([]);
    } else {
      setActivityLogs(logs);
    }
  };

  const archive = async (id: string) => {
    const r = await updateAdminSupportTicketStatus(id, 'archived');
    if (!r.ok) {
      alert(r.error || 'Erro');
      return;
    }
    await load();
  };

  const reopen = async (id: string) => {
    const r = await updateAdminSupportTicketStatus(id, 'open');
    if (!r.ok) {
      alert(r.error || 'Erro');
      return;
    }
    await load();
  };

  const onPickReplyFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    setReplyFiles((prev) => {
      const next = [...prev];
      for (let i = 0; i < list.length && next.length < 5; i++) {
        const f = list.item(i);
        if (f) next.push(f);
      }
      return next;
    });
    e.target.value = '';
  };

  const removeReplyFile = (idx: number) => {
    setReplyFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const sendReply = async (ticketId: string) => {
    setReplyErr(null);
    setReplying(true);
    try {
      const r = await postAdminSupportTicketReply({
        ticketId,
        message: replyMessage,
        files: replyFiles,
      });
      if (!r.ok) {
        setReplyErr(r.error || 'Falha ao enviar.');
        return;
      }
      setReplyMessage('');
      setReplyFiles([]);
      await load();
    } finally {
      setReplying(false);
    }
  };

  const fmt = (ts: unknown) => {
    if (ts == null) return '—';
    const n = typeof ts === 'string' ? Number(ts) : typeof ts === 'number' ? ts : NaN;
    if (!Number.isFinite(n) || n <= 0) return '—';
    const d = new Date(Math.trunc(n));
    if (Number.isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleString('pt-PT');
    } catch {
      return '—';
    }
  };

  const toTime = (ts: unknown): number => {
    if (ts == null) return 0;
    const n = typeof ts === 'string' ? Number(ts) : typeof ts === 'number' ? ts : NaN;
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  };

  const buildAdminTimeline = (t: SupportTicketRow) => {
    type E =
      | { k: 'open'; at: number; message: string; attachments: SupportTicketAttachment[] }
      | { k: 'player'; at: number; message: string; attachments: SupportTicketAttachment[] }
      | { k: 'admin'; at: number; adminUsername: string; message: string; attachments: SupportTicketAttachment[] };
    const out: E[] = [
      {
        k: 'open',
        at: toTime(t.createdAt),
        message: t.message,
        attachments: Array.isArray(t.attachments) ? t.attachments : [],
      },
    ];
    for (const p of t.playerReplies || []) {
      out.push({
        k: 'player',
        at: toTime(p.createdAt),
        message: p.message,
        attachments: Array.isArray(p.attachments) ? p.attachments : [],
      });
    }
    for (const r of t.replies || []) {
      out.push({
        k: 'admin',
        at: toTime(r.createdAt),
        adminUsername: r.adminUsername,
        message: r.message,
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
      });
    }
    out.sort((a, b) => a.at - b.at);
    return out;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Inbox size={22} className="text-amber-500" />
            Pedidos de suporte
          </h2>
          <p className="text-xs text-slate-500 mt-1">Mensagens e anexos dos jogadores; pode responder por texto e anexar foto ou vídeo.</p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 text-xs font-bold flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>
      {!loading || tickets.length > 0 ? (
        <div className="inline-flex rounded-lg border border-slate-600 overflow-hidden text-[11px] font-bold">
          <button
            type="button"
            onClick={() => setListTab('open')}
            className={`px-3 py-2 inline-flex items-center gap-1.5 ${
              listTab === 'open'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Inbox size={14} />
            Abertos ({openTicketCount})
          </button>
          <button
            type="button"
            onClick={() => setListTab('archived')}
            className={`px-3 py-2 inline-flex items-center gap-1.5 ${
              listTab === 'archived'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Archive size={14} />
            Arquivados ({archivedTicketCount})
          </button>
        </div>
      ) : null}
      {err && <div className="text-red-400 text-sm">{err}</div>}
      {loading && tickets.length === 0 ? (
        <div className="text-slate-500 text-sm py-12 text-center">A carregar…</div>
      ) : tickets.length === 0 ? (
        <div className="text-slate-500 text-sm py-12 text-center">Nenhum pedido ainda.</div>
      ) : filteredTickets.length === 0 ? (
        <div className="text-slate-500 text-sm py-12 text-center">
          {listTab === 'archived' ? 'Nenhum ticket arquivado.' : 'Nenhum ticket aberto.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTickets.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenId((v) => (v === t.id ? null : t.id))}
                className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-800/50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-bold text-white truncate">{t.subject}</div>
                  <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                    <span className="font-mono truncate max-w-[min(100%,14rem)]" title={t.email}>
                      {t.email}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyPlayerEmail(t.email, t.id);
                      }}
                      className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-bold uppercase text-amber-500/95 hover:bg-amber-950/40 hover:text-amber-400"
                      title="Copiar email do jogador"
                    >
                      <Copy size={11} />
                      {copiedTicketId === t.id ? 'Copiado' : 'Copiar email'}
                    </button>
                    {onOpenPlayerProfile && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenPlayerProfile({
                            userId: ticketUserNumericId(t),
                            email: t.email,
                            username: t.username,
                          });
                        }}
                        className={`shrink-0 inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase border-amber-600/70 text-amber-500 hover:bg-amber-950/35 hover:text-amber-400 ${
                          !canOpenPlayerProfile ? 'opacity-50' : ''
                        }`}
                        title={
                          canOpenPlayerProfile
                            ? 'Abrir editor de perfil, estoque e dados do jogador (separador Utilizadores)'
                            : 'Precisa da permissão Utilizadores para abrir o editor de perfil'
                        }
                      >
                        <UserCog size={11} />
                        Gerir perfil
                      </button>
                    )}
                    <span className="text-slate-600">·</span>
                    <span className="truncate">{t.username}</span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono shrink-0">{fmt(t.createdAt)}</span>
                    {Array.isArray(t.replies) && t.replies.length > 0 && (
                      <span className="text-amber-600/90">· {t.replies.length} resposta(s)</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                      t.status === 'archived' ? 'bg-slate-700 text-slate-400' : 'bg-amber-900/50 text-amber-300'
                    }`}
                  >
                    {t.status === 'archived' ? 'Arquivado' : 'Aberto'}
                  </span>
                </div>
              </button>
              {openId === t.id && (
                <div className="px-4 pb-4 pt-2 border-t border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex rounded-lg border border-slate-600 overflow-hidden text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() => setDetailTab('thread')}
                          className={`px-3 py-1.5 inline-flex items-center gap-1 ${
                            detailTab === 'thread'
                              ? 'bg-amber-600 text-white'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Conversa
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailTab('activity')}
                          className={`px-3 py-1.5 inline-flex items-center gap-1 ${
                            detailTab === 'activity'
                              ? 'bg-amber-600 text-white'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <History size={12} /> Atividade
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => void copyPlayerEmail(t.email, t.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-[10px] font-bold uppercase text-amber-500/95 hover:bg-slate-800"
                        title="Copiar email do jogador"
                      >
                        <Copy size={12} />
                        {copiedTicketId === t.id ? 'Copiado' : 'Copiar email'}
                      </button>
                      {onOpenPlayerProfile && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenPlayerProfile({
                              userId: ticketUserNumericId(t),
                              email: t.email,
                              username: t.username,
                            })
                          }
                          className={`inline-flex items-center gap-1 rounded-lg border border-amber-600/70 px-2 py-1 text-[10px] font-bold uppercase text-amber-500 hover:bg-amber-950/30 hover:bg-slate-800/80 ${
                            !canOpenPlayerProfile ? 'opacity-50' : ''
                          }`}
                          title={
                            canOpenPlayerProfile
                              ? 'Abrir editor de perfil, estoque e dados do jogador'
                              : 'Precisa da permissão Utilizadores'
                          }
                        >
                          <UserCog size={12} />
                          Gerir perfil
                        </button>
                      )}
                    </div>
                  </div>

                  {detailTab === 'thread' ? (
                    <>
                      <div className="text-[10px] font-bold text-slate-500 uppercase">Conversa (ordem cronológica)</div>
                      <ul className="space-y-3">
                        {buildAdminTimeline(t).map((e, idx) => (
                          <li
                            key={`${e.k}-${idx}-${e.at}`}
                            className={`text-sm rounded-lg p-3 border ${
                              e.k === 'admin'
                                ? 'border-emerald-900/50 bg-emerald-950/15'
                                : e.k === 'player'
                                  ? 'border-slate-600 bg-slate-950/60'
                                  : 'border-amber-900/30 bg-amber-950/10'
                            }`}
                          >
                            <div className="text-[10px] text-slate-500 mb-1">
                              {e.k === 'open' && <span className="text-amber-200/90 font-semibold">Pedido inicial</span>}
                              {e.k === 'player' && <span className="text-slate-300 font-semibold">Jogador (seguimento)</span>}
                              {e.k === 'admin' && (
                                <span className="text-emerald-400 font-semibold">
                                  Equipe - {e.adminUsername || 'admin'}
                                </span>
                              )}
                              {' · '}
                              {fmt(e.at)}
                            </div>
                            {e.message ? (
                              <pre className="whitespace-pre-wrap text-slate-300 font-sans text-[13px]">{e.message}</pre>
                            ) : null}
                            <ReplyAttachments items={e.attachments} />
                          </li>
                        ))}
                      </ul>

                      <div className="rounded-lg border border-amber-900/30 bg-slate-950/50 p-3 space-y-2">
                        <div className="text-xs font-bold text-amber-500/90 uppercase">Responder ao jogador</div>
                        {replyErr && <div className="text-xs text-red-400">{replyErr}</div>}
                        <textarea
                          value={replyMessage}
                          onChange={(e) => setReplyMessage(e.target.value)}
                          rows={4}
                          maxLength={8000}
                          placeholder="Texto da resposta (mín. 3 caracteres se não enviar anexos)"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs cursor-pointer hover:bg-slate-800">
                            <Paperclip size={14} />
                            Anexar foto/vídeo
                            <input type="file" accept={ACCEPT} multiple className="hidden" onChange={onPickReplyFiles} />
                          </label>
                          {replyFiles.length > 0 && (
                            <span className="text-[11px] text-slate-500">{replyFiles.length}/5 ficheiros</span>
                          )}
                        </div>
                        {replyFiles.length > 0 && (
                          <ul className="flex flex-wrap gap-2">
                            {replyFiles.map((f, i) => (
                              <li
                                key={`${f.name}-${i}`}
                                className="flex items-center gap-1 text-[11px] bg-slate-800 rounded px-2 py-1 text-slate-300 max-w-full"
                              >
                                <span className="truncate">{f.name}</span>
                                <button
                                  type="button"
                                  onClick={() => removeReplyFile(i)}
                                  className="p-0.5 text-slate-500 hover:text-white shrink-0"
                                  aria-label="Remover"
                                >
                                  <X size={12} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          disabled={replying}
                          onClick={() => sendReply(t.id)}
                          className="px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold flex items-center gap-2 hover:bg-amber-500 disabled:opacity-50"
                        >
                          {replying ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                          Enviar resposta
                        </button>
                      </div>

                      <div className="flex gap-2">
                        {t.status !== 'archived' ? (
                          <button
                            type="button"
                            onClick={() => archive(t.id)}
                            className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-bold flex items-center gap-1 hover:bg-slate-600"
                          >
                            <Archive size={14} /> Arquivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => reopen(t.id)}
                            className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-bold hover:bg-slate-600"
                          >
                            Reabrir
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[11px] text-slate-500">
                        Linhas da tabela <span className="font-mono text-slate-400">game_activity_logs</span> para{' '}
                        <span className="font-mono text-slate-300">{t.email}</span>
                        {typeof t.userId === 'number' && t.userId > 0 ? (
                          <span className="text-slate-500"> (user #{t.userId})</span>
                        ) : null}
                        : caixas, roleta, resgate de códigos, depósitos quando o servidor regista o evento.
                      </p>
                      <div className="flex flex-col gap-2 rounded-lg border border-slate-700/80 bg-slate-950/50 p-2 sm:flex-row sm:flex-wrap sm:items-end">
                        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-[14rem]">
                          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500" htmlFor={`activity-filter-${t.id}`}>
                            Tipo de evento
                          </label>
                          <select
                            id={`activity-filter-${t.id}`}
                            value={activityFilterId}
                            onChange={(e) => setActivityFilterId(e.target.value)}
                            className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                          >
                            {ACTIVITY_LOG_FILTER_GROUPS.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0 flex-1 flex-col gap-1 sm:min-w-[12rem] sm:flex-[2]">
                          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500" htmlFor={`activity-search-${t.id}`}>
                            Pesquisar (ação ou JSON)
                          </label>
                          <input
                            id={`activity-search-${t.id}`}
                            type="search"
                            value={activitySearch}
                            onChange={(e) => setActivitySearch(e.target.value)}
                            placeholder="ex: deposit, rackId, mining_rack…"
                            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                        <p className="w-full text-[10px] text-slate-600 sm:order-last">
                          {activityLogs.length > 0
                            ? `A mostrar ${filteredActivityLogs.length} de ${activityLogs.length} evento(s) carregados.`
                            : null}
                        </p>
                      </div>
                      {activityLoading && (
                        <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-sm">
                          <Loader2 className="animate-spin" size={18} /> A carregar…
                        </div>
                      )}
                      {!activityLoading && activityError && (
                        <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{activityError}</div>
                      )}
                      {!activityLoading && !activityError && (
                        <div className="rounded-lg border border-slate-700 overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-950 text-slate-500 uppercase text-[10px] tracking-wider font-bold">
                              <tr>
                                <th className="px-2 py-2">Data</th>
                                <th className="px-2 py-2">Ação</th>
                                <th className="px-2 py-2">Detalhes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                              {activityLogs.length > 0 ? (
                                filteredActivityLogs.length > 0 ? (
                                  filteredActivityLogs.map((row) => (
                                    <tr key={row.id} className="hover:bg-slate-800/40">
                                      <td className="px-2 py-2 text-[10px] text-slate-400 font-mono whitespace-nowrap align-top">
                                        {new Date(row.createdAt).toLocaleString('pt-PT')}
                                      </td>
                                      <td className="px-2 py-2 font-mono text-emerald-400 align-top">{row.action}</td>
                                      <td
                                        className="px-2 py-2 text-[10px] text-slate-400 font-mono break-all max-w-md align-top"
                                        title={formatUserActivityMeta(row.meta)}
                                      >
                                        {formatUserActivityMeta(row.meta)}
                                      </td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500 italic">
                                      Nenhum evento corresponde ao filtro ou à pesquisa. Ajuste o tipo ou limpe a pesquisa.
                                    </td>
                                  </tr>
                                )
                              ) : (
                                <tr>
                                  <td colSpan={3} className="px-4 py-8 text-center text-slate-500 italic">
                                    Nenhum evento registado para esta conta (ou a tabela de logs ainda não recebeu dados).
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {!activityLoading && !activityError && (
                        <button
                          type="button"
                          onClick={() => void refreshTicketActivity(t)}
                          className="text-xs font-bold text-amber-500 hover:text-amber-400 uppercase"
                        >
                          Atualizar lista
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
