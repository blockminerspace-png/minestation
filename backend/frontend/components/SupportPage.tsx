import React, { useState, useCallback, useEffect } from 'react';
import {
  LifeBuoy,
  Send,
  Paperclip,
  X,
  Loader2,
  List,
  ChevronLeft,
  MessageCircle,
  Archive,
  ExternalLink,
} from 'lucide-react';
import {
  submitSupportTicket,
  getMySupportTickets,
  getMySupportTicketDetail,
  postPlayerSupportTicketReply,
  type MySupportTicketSummary,
  type MySupportTicketDetail,
  type SupportTicketAttachment,
} from '../services/api';

type Props = {
  userEmail?: string | null;
  onClose?: () => void;
};

const ACCEPT = 'image/png,image/jpeg,image/jpg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mov';

function isVideoAtt(a: { mime?: string; url?: string }) {
  const m = (a.mime || '').toLowerCase();
  if (m.startsWith('video/')) return true;
  const u = (a.url || '').toLowerCase();
  return /\.(mp4|webm|mov)(\?|$)/.test(u);
}

const AttLinks: React.FC<{ items: SupportTicketAttachment[] }> = ({ items }) => {
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
            className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
          >
            <ExternalLink size={11} />
            {a.originalName || 'Vídeo'}
          </a>
        ) : (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block shrink-0">
            <img src={a.url} alt="" className="max-h-28 rounded border border-slate-700 object-cover" />
          </a>
        )
      )}
    </div>
  );
};

type Tab = 'list' | 'new' | 'detail';

export const SupportPage: React.FC<Props> = ({ userEmail, onClose }) => {
  const [tab, setTab] = useState<Tab>('list');
  const [list, setList] = useState<MySupportTicketSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MySupportTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [followMsg, setFollowMsg] = useState('');
  const [followFiles, setFollowFiles] = useState<File[]>([]);
  const [followSending, setFollowSending] = useState(false);
  const [followErr, setFollowErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const { tickets } = await getMySupportTickets();
      setList(tickets);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'list') loadList();
  }, [tab, loadList]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setTab('detail');
    setDetail(null);
    setFollowMsg('');
    setFollowFiles([]);
    setFollowErr(null);
    setDetailLoading(true);
    try {
      const d = await getMySupportTicketDetail(id);
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  };

  const onPickFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    setFiles((prev) => {
      const next = [...prev];
      for (let i = 0; i < list.length && next.length < 5; i++) {
        const f = list.item(i);
        if (f) next.push(f);
      }
      return next;
    });
    e.target.value = '';
  }, []);

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSending(true);
    try {
      const res = await submitSupportTicket({ subject, message, files });
      if (!res.ok) {
        setErr(res.error || 'Falha ao enviar.');
        return;
      }
      setDone('Pedido enviado. Podes seguir o estado em «Os meus pedidos».');
      setSubject('');
      setMessage('');
      setFiles([]);
      await loadList();
    } finally {
      setSending(false);
    }
  };

  const onPickFollow = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    setFollowFiles((prev) => {
      const next = [...prev];
      for (let i = 0; i < list.length && next.length < 5; i++) {
        const f = list.item(i);
        if (f) next.push(f);
      }
      return next;
    });
    e.target.value = '';
  };

  const sendFollow = async () => {
    if (!detailId) return;
    setFollowErr(null);
    setFollowSending(true);
    try {
      const r = await postPlayerSupportTicketReply({
        ticketId: detailId,
        message: followMsg,
        files: followFiles,
      });
      if (!r.ok) {
        setFollowErr(r.error || 'Não foi possível enviar.');
        return;
      }
      setFollowMsg('');
      setFollowFiles([]);
      await openDetail(detailId);
      await loadList();
    } finally {
      setFollowSending(false);
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

  const buildTimeline = (d: MySupportTicketDetail) => {
    type Entry =
      | { kind: 'open'; at: number; message: string; attachments: SupportTicketAttachment[] }
      | { kind: 'player'; at: number; message: string; attachments: SupportTicketAttachment[] }
      | { kind: 'admin'; at: number; adminUsername: string; message: string; attachments: SupportTicketAttachment[] };
    const out: Entry[] = [
      {
        kind: 'open',
        at: toTime(d.ticket.createdAt),
        message: d.ticket.message,
        attachments: d.ticket.attachments,
      },
    ];
    for (const p of d.playerReplies) {
      out.push({
        kind: 'player',
        at: toTime(p.createdAt),
        message: p.message,
        attachments: p.attachments,
      });
    }
    for (const a of d.adminReplies) {
      out.push({
        kind: 'admin',
        at: toTime(a.createdAt),
        adminUsername: a.adminUsername,
        message: a.message,
        attachments: a.attachments,
      });
    }
    out.sort((x, y) => x.at - y.at);
    return out;
  };

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-2xl mx-auto w-full animate-in fade-in duration-300">
      <div className="rounded-2xl border border-amber-500/30 bg-slate-900/80 backdrop-blur-sm shadow-xl shadow-amber-900/10 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700 bg-slate-950/60">
          <div className="flex items-center gap-2 text-amber-500">
            <LifeBuoy size={22} />
            <h2 className="text-lg font-black tracking-tight text-white">Suporte</h2>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          )}
        </div>

        <div className="flex border-b border-slate-800 bg-slate-950/40">
          <button
            type="button"
            onClick={() => {
              setTab('list');
              setDetailId(null);
              setDetail(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wide ${
              tab === 'list' ? 'text-amber-400 border-b-2 border-amber-500 bg-slate-900/50' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <List size={16} />
            Os meus pedidos
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('new');
              setDetailId(null);
              setDetail(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wide ${
              tab === 'new' ? 'text-amber-400 border-b-2 border-amber-500 bg-slate-900/50' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <MessageCircle size={16} />
            Novo pedido
          </button>
        </div>

        <div className="p-4 sm:p-6">
          {userEmail && (
            <p className="text-xs text-slate-500 mb-4">
              Conta: <span className="text-slate-300 font-mono">{userEmail}</span>
            </p>
          )}

          {tab === 'list' && (
            <div className="space-y-3">
              {listLoading ? (
                <div className="text-slate-500 text-sm py-8 text-center">A carregar…</div>
              ) : list.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">Ainda não tens pedidos. Usa «Novo pedido».</p>
              ) : (
                <ul className="space-y-2">
                  {list.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => openDetail(t.id)}
                        className="w-full text-left rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 hover:border-amber-600/40 transition-colors"
                      >
                        <div className="font-bold text-white text-sm truncate">{t.subject}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500">
                          <span
                            className={`uppercase font-bold px-2 py-0.5 rounded ${
                              t.status === 'archived' ? 'bg-slate-800 text-slate-400' : 'bg-emerald-900/40 text-emerald-300'
                            }`}
                          >
                            {t.status === 'archived' ? 'Arquivado' : 'Aberto'}
                          </span>
                          <span>{fmt(t.createdAt)}</span>
                          {t.adminReplyCount > 0 && (
                            <span className="text-amber-600/90">{t.adminReplyCount} resposta(s) da equipa</span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'detail' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setTab('list');
                  setDetailId(null);
                  setDetail(null);
                }}
                className="inline-flex items-center gap-1 text-xs font-bold text-amber-500 hover:text-amber-400"
              >
                <ChevronLeft size={16} />
                Voltar à lista
              </button>
              {detailLoading && <div className="text-slate-500 text-sm py-6">A carregar…</div>}
              {!detailLoading && !detail && (
                <p className="text-red-400 text-sm">Não foi possível carregar este pedido.</p>
              )}
              {detail && (
                <>
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <h3 className="text-base font-bold text-white pr-2">{detail.ticket.subject}</h3>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-1 rounded shrink-0 ${
                        detail.ticket.status === 'archived' ? 'bg-slate-800 text-slate-400' : 'bg-emerald-900/40 text-emerald-300'
                      }`}
                    >
                      {detail.ticket.status === 'archived' ? 'Arquivado' : 'Aberto'}
                    </span>
                  </div>
                  {detail.ticket.status === 'archived' && (
                    <div className="rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2 text-xs text-slate-400 flex items-start gap-2">
                      <Archive size={16} className="text-slate-500 shrink-0 mt-0.5" />
                      <span>
                        Este pedido foi arquivado pela equipa. Podes ler toda a conversa abaixo, mas já não podes enviar mais
                        mensagens aqui. Para novo assunto, usa «Novo pedido».
                      </span>
                    </div>
                  )}

                  <div className="space-y-4 border-t border-slate-800 pt-4">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Conversa</div>
                    {buildTimeline(detail).map((e, idx) => (
                      <div
                        key={`${e.kind}-${idx}-${e.at}`}
                        className={`rounded-lg p-3 border ${
                          e.kind === 'admin'
                            ? 'border-emerald-900/50 bg-emerald-950/20 ml-0 sm:ml-4'
                            : e.kind === 'player'
                              ? 'border-slate-600 bg-slate-950/60 mr-0 sm:mr-4'
                              : 'border-amber-900/30 bg-amber-950/10'
                        }`}
                      >
                        <div className="text-[10px] text-slate-500 mb-1">
                          {e.kind === 'open' && 'O teu pedido inicial'}
                          {e.kind === 'player' && 'Tu'}
                          {e.kind === 'admin' && (
                            <span className="text-emerald-400 font-semibold">
                              Equipe - {e.adminUsername || 'admin'}
                            </span>
                          )}
                          {' · '}
                          {fmt(e.at)}
                        </div>
                        {e.message ? (
                          <pre className="whitespace-pre-wrap text-sm text-slate-200 font-sans">{e.message}</pre>
                        ) : null}
                        <AttLinks items={e.attachments} />
                      </div>
                    ))}
                  </div>

                  {detail.ticket.status === 'open' && (
                    <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-4 space-y-3">
                      <div className="text-xs font-bold text-amber-500/90 uppercase">Enviar mais informação</div>
                      {followErr && <div className="text-xs text-red-400">{followErr}</div>}
                      <textarea
                        value={followMsg}
                        onChange={(e) => setFollowMsg(e.target.value)}
                        rows={4}
                        maxLength={8000}
                        placeholder="Mensagem para a equipa (mín. 3 caracteres se não anexares ficheiros)"
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y"
                      />
                      <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                        <Paperclip size={14} />
                        Anexos
                        <input type="file" accept={ACCEPT} multiple className="hidden" onChange={onPickFollow} />
                      </label>
                      {followFiles.length > 0 && (
                        <ul className="text-[11px] text-slate-400 space-y-1">
                          {followFiles.map((f, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className="truncate">{f.name}</span>
                              <button type="button" className="text-red-400" onClick={() => setFollowFiles((p) => p.filter((_, j) => j !== i))}>
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        disabled={followSending}
                        onClick={() => sendFollow()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-500 disabled:opacity-50"
                      >
                        {followSending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                        Enviar mensagem
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'new' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {done && (
                <div className="rounded-lg border border-emerald-600/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">{done}</div>
              )}
              {err && <div className="rounded-lg border border-red-600/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">{err}</div>}

              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assunto</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={180}
                  required
                  minLength={3}
                  placeholder="Ex.: Problema ao equipar bateria"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mensagem</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  minLength={10}
                  maxLength={8000}
                  rows={8}
                  placeholder="Descreve o que precisas. Podes anexar até 5 imagens ou vídeos (máx. 12 MB cada)."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y min-h-[140px]"
                />
              </label>

              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Paperclip size={14} /> Anexos (opcional, até 5)
                </span>
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 text-slate-300 text-sm cursor-pointer hover:border-amber-500/50 hover:text-amber-200 transition-colors">
                  <input type="file" accept={ACCEPT} multiple className="hidden" onChange={onPickFiles} disabled={files.length >= 5} />
                  Escolher ficheiros
                </label>
                {files.length > 0 && (
                  <ul className="text-xs text-slate-400 space-y-1 font-mono">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 bg-slate-950/80 rounded px-2 py-1 border border-slate-700">
                        <span className="truncate">{f.name}</span>
                        <button type="button" onClick={() => removeFile(i)} className="text-red-400 hover:text-red-300 shrink-0">
                          remover
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="submit"
                disabled={sending}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm shadow-lg shadow-amber-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                Enviar pedido
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
