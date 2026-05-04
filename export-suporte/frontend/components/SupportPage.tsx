import React, { useState, useCallback } from 'react';
import { LifeBuoy, Send, Paperclip, X, Loader2 } from 'lucide-react';
import { submitSupportTicket } from '../services/api';

type Props = {
  userEmail?: string | null;
  onClose?: () => void;
};

const ACCEPT = 'image/png,image/jpeg,image/jpg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mov';

export const SupportPage: React.FC<Props> = ({ userEmail, onClose }) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onPickFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const next: File[] = [...files];
    for (let i = 0; i < list.length && next.length < 5; i++) {
      const f = list.item(i);
      if (f) next.push(f);
    }
    setFiles(next);
    e.target.value = '';
  }, [files]);

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
      setDone('Pedido enviado. A equipa irá analisar em breve.');
      setSubject('');
      setMessage('');
      setFiles([]);
    } finally {
      setSending(false);
    }
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
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {userEmail && (
            <p className="text-xs text-slate-500">
              Conta: <span className="text-slate-300 font-mono">{userEmail}</span>
            </p>
          )}
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
      </div>
    </div>
  );
};
