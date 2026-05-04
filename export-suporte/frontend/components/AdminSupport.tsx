import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Archive, Inbox, ExternalLink, MessageSquare, Paperclip, Send, Loader2, X } from 'lucide-react';
import {
  getAdminSupportTickets,
  updateAdminSupportTicketStatus,
  postAdminSupportTicketReply,
  type SupportTicketRow,
  type SupportTicketReplyRow,
} from '../services/api';

const ACCEPT = 'image/png,image/jpeg,image/jpg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mov';

function isVideoAtt(a: { mime?: string; url?: string }) {
  const m = (a.mime || '').toLowerCase();
  if (m.startsWith('video/')) return true;
  const u = (a.url || '').toLowerCase();
  return /\.(mp4|webm|mov)(\?|$)/.test(u);
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

export const AdminSupport: React.FC = () => {
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [replying, setReplying] = useState(false);
  const [replyErr, setReplyErr] = useState<string | null>(null);

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

  const fmt = (ts: number) => {
    try {
      return new Date(ts).toLocaleString('pt-PT');
    } catch {
      return String(ts);
    }
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
      {err && <div className="text-red-400 text-sm">{err}</div>}
      {loading && tickets.length === 0 ? (
        <div className="text-slate-500 text-sm py-12 text-center">A carregar…</div>
      ) : tickets.length === 0 ? (
        <div className="text-slate-500 text-sm py-12 text-center">Nenhum pedido ainda.</div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenId((v) => (v === t.id ? null : t.id))}
                className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-800/50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-bold text-white truncate">{t.subject}</div>
                  <div className="text-[11px] text-slate-500 font-mono truncate">
                    {t.email} · {t.username} · {fmt(t.createdAt)}
                    {Array.isArray(t.replies) && t.replies.length > 0 && (
                      <span className="text-amber-600/90 ml-1">· {t.replies.length} resposta(s)</span>
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
                <div className="px-4 pb-4 pt-0 border-t border-slate-800 space-y-3">
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Mensagem do jogador</div>
                    <pre className="whitespace-pre-wrap text-sm text-slate-300 bg-slate-950/80 rounded-lg p-3 border border-slate-800 font-sans">{t.message}</pre>
                  </div>
                  {Array.isArray(t.attachments) && t.attachments.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-500 uppercase">Anexos do jogador</div>
                      <div className="flex flex-wrap gap-2">
                        {t.attachments.map((a, i) => (
                          <a
                            key={i}
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 border border-amber-900/40 rounded px-2 py-1"
                          >
                            <ExternalLink size={12} />
                            {a.originalName || a.url}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 space-y-2">
                    <div className="text-xs font-bold text-emerald-500/90 uppercase flex items-center gap-1">
                      <MessageSquare size={14} />
                      Respostas da equipa
                    </div>
                    {!t.replies?.length ? (
                      <p className="text-xs text-slate-500">Ainda sem respostas registadas.</p>
                    ) : (
                      <ul className="space-y-3">
                        {t.replies.map((r) => (
                          <li key={r.id} className="text-sm border-l-2 border-emerald-700/60 pl-3">
                            <div className="text-[10px] text-slate-500">
                              <span className="text-emerald-400 font-semibold">{r.adminUsername || 'Admin'}</span>
                              {' · '}
                              {fmt(r.createdAt)}
                            </div>
                            {r.message ? (
                              <pre className="whitespace-pre-wrap text-slate-300 mt-1 font-sans text-[13px]">{r.message}</pre>
                            ) : null}
                            <ReplyAttachments items={r.attachments} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

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
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
