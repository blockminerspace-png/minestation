import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clapperboard,
  Loader2,
  Rocket,
  ChevronDown,
  ChevronUp,
  Calendar,
  User,
  ThumbsUp,
  Youtube,
  Play,
  ExternalLink
} from 'lucide-react';
import {
  getPartnersState,
  submitPartnerYoutubeVideo,
  type PartnerYoutubeMySubmission,
  type PartnersShowcaseVideoDto,
  type PartnersStatePayload,
} from '../services/api';
import {
  PARTNER_VIDEO_DESCRIPTION_MAX,
  PARTNER_VIDEO_TITLE_MAX,
  PARTNER_VIDEO_YOUTUBE_URL_MAX
} from '../constants/formLimits';

/** URL canónica do site do parceiro (iframe + link externo). Alinhar com `dashboard.service` / cartão do dashboard. */
const BLOCKMINER_EMBED_URL = 'https://blockminer.io/';

function thumbUrl(videoId: string): string {
  const v = String(videoId || '').trim();
  if (!v) return '';
  return `https://i.ytimg.com/vi/${v}/hqdefault.jpg`;
}

function fmtDate(ms: number): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '—';
  }
}

function statusLabel(st: string): string {
  if (st === 'approved') return 'Aprovado';
  if (st === 'rejected') return 'Recusado';
  if (st === 'pending') return 'Pendente';
  return st;
}

function statusClass(st: string): string {
  if (st === 'approved') return 'bg-emerald-900/60 text-emerald-200 border-emerald-700/50';
  if (st === 'rejected') return 'bg-red-950/50 text-red-200 border-red-800/50';
  return 'bg-amber-900/40 text-amber-100 border-amber-700/50';
}

type ShowcaseCreator = {
  key: string;
  username: string;
  channelUrl: string;
  avatarUrl: string;
};

function PartnerShowcaseAvatar({ name, imageUrl }: { name: string; imageUrl: string }) {
  const [broken, setBroken] = useState(false);
  const letter = String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
  const showImg = Boolean(imageUrl) && !broken;
  return (
    <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border border-slate-600 text-lg font-black text-amber-400">
      {showImg ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        letter
      )}
    </span>
  );
}

export const PartnersPage: React.FC = () => {
  const [videos, setVideos] = useState<PartnersShowcaseVideoDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [ctxLoading, setCtxLoading] = useState(true);
  const [isPartner, setIsPartner] = useState(false);
  const [canSubmitToday, setCanSubmitToday] = useState(false);
  const [mySubs, setMySubs] = useState<PartnerYoutubeMySubmission[]>([]);
  const submitBusyRef = React.useRef(false);

  const [formOpen, setFormOpen] = useState(true);
  const [title, setTitle] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const mapStateToUi = useCallback((st: PartnersStatePayload) => {
    const raw = Array.isArray(st.showcase?.videos) ? st.showcase!.videos : [];
    setVideos(raw);
    const auth = st.auth || {};
    setIsPartner(!!auth.isPartner);
    setCanSubmitToday(!!auth.canSubmitToday);
    const ms = Array.isArray(st.mySubmissions) ? st.mySubmissions : [];
    setMySubs(
      ms.map((s) => ({
        id: s.publicId,
        title: s.title,
        youtubeUrl: s.youtubeUrl,
        youtubeVideoId: s.youtubeVideoId,
        description: s.description,
        status: s.status,
        createdAt: s.createdAt,
        reviewedAt: s.reviewedAt,
        rejectReason: s.rejectReasonPublic
      }))
    );
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setCtxLoading(true);
    setErr(null);
    try {
      const st = await getPartnersState({ limit: 48 });
      if (!st?.ok) {
        setErr('Não foi possível carregar os vídeos.');
        setVideos([]);
        setIsPartner(false);
        setCanSubmitToday(false);
        setMySubs([]);
        return;
      }
      mapStateToUi(st);
    } catch {
      setErr('Não foi possível carregar os vídeos.');
      setVideos([]);
      setIsPartner(false);
      setCanSubmitToday(false);
      setMySubs([]);
    } finally {
      setLoading(false);
      setCtxLoading(false);
    }
  }, [mapStateToUi]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** Criadores únicos na vitrine (links/fotos definidos pelo admin). */
  const showcaseCreators = useMemo((): ShowcaseCreator[] => {
    const m = new Map<string, ShowcaseCreator>();
    for (const v of videos) {
      const username = String(v.creator?.displayName || '').trim() || 'Parceiro';
      const channelUrl = String(v.creator?.channelUrl || '').trim();
      const key = `${username}|${channelUrl}`;
      if (m.has(key)) continue;
      m.set(key, {
        key,
        username,
        channelUrl,
        avatarUrl: String(v.creator?.avatarUrl || '').trim()
      });
    }
    return [...m.values()].slice(0, 32);
  }, [videos]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitBusyRef.current) return;
    setSubmitErr(null);
    submitBusyRef.current = true;
    setSubmitting(true);
    try {
      const r = await submitPartnerYoutubeVideo({ title, youtubeUrl, description });
      if (!r.ok) {
        setSubmitErr(r.error || 'Falha ao enviar.');
        return;
      }
      setTitle('');
      setYoutubeUrl('');
      setDescription('');
      await loadAll();
    } finally {
      submitBusyRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-8 text-slate-100 pb-8">
      <section aria-label="BlockMiner" className="w-full px-2 sm:px-4 pt-1 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-violet-500/35 bg-gradient-to-r from-slate-900/95 via-violet-950/25 to-slate-900/90 px-4 py-3.5 ring-1 ring-violet-500/10">
          <div className="min-w-0 space-y-0.5">
            <div className="text-[10px] uppercase tracking-widest text-violet-300/90 font-bold">Parceiro oficial</div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">BlockMiner</h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
              Usa o site do parceiro aqui dentro. Se não carregar (bloqueio do browser ou do parceiro), abre numa nova janela.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href={BLOCKMINER_EMBED_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/40 bg-violet-600/20 px-3 py-2 text-xs font-bold text-violet-100 hover:bg-violet-600/35 transition-colors"
            >
              <ExternalLink size={14} className="shrink-0" />
              Abrir em nova janela
            </a>
            <a
              href="#parceiros-youtube"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Vitrine YouTube
            </a>
          </div>
        </div>
        <div className="relative w-full min-h-[min(78dvh,820px)] h-[min(78dvh,820px)] rounded-2xl border border-slate-700/90 bg-black overflow-hidden shadow-2xl shadow-black/40">
          <iframe
            title="BlockMiner"
            src={BLOCKMINER_EMBED_URL}
            className="absolute inset-0 h-full w-full border-0 bg-slate-950"
            allow="fullscreen; clipboard-read; clipboard-write; payment"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </section>

      <div id="parceiros-youtube" className="scroll-mt-6 max-w-7xl mx-auto w-full px-3 sm:px-4 space-y-8">
      <div className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-amber-950/20 px-4 sm:px-6 py-5 sm:py-6 space-y-2">
        <div className="text-[11px] uppercase tracking-widest text-amber-500/90 font-bold">Painel / Parceiros</div>
        <h1 className="text-2xl sm:text-4xl font-black tracking-tight flex flex-wrap items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-red-600/90 text-white shadow-lg shadow-red-900/30">
            <Clapperboard className="shrink-0" size={26} />
          </span>
          <span className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Parceiros YouTube</span>
        </h1>
        <p className="text-sm text-slate-400 max-w-3xl">
          Vídeos aprovados pela equipe — vitrine ao estilo comunidade. Parceiros podem enviar até 1 vídeo por dia (UTC).
        </p>
      </div>

      {isPartner && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-800/80 hover:bg-slate-800 text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Clapperboard size={18} className="text-amber-400 shrink-0" />
              <span className="font-bold truncate">Submeter novo vídeo</span>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-emerald-700/60 bg-emerald-950/40 text-emerald-300 shrink-0">
                Parceiro
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-slate-400 text-xs font-bold">
              {formOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              {formOpen ? 'Ocultar' : 'Mostrar'}
            </div>
          </button>
          {formOpen && (
            <div className="p-4 sm:p-5 border-t border-slate-800 space-y-4">
              {ctxLoading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 className="animate-spin" size={16} /> A carregar…
                </div>
              ) : !canSubmitToday ? (
                <div className="text-sm text-amber-200/90 bg-amber-950/25 border border-amber-900/40 rounded-lg px-3 py-2">
                  Limite de 1 envio por dia (UTC) atingido. Volta amanhã para submeter outro vídeo.
                </div>
              ) : null}
              <form onSubmit={onSubmit} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Título do vídeo</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={PARTNER_VIDEO_TITLE_MAX}
                    placeholder="O meu vídeo sobre Mine Station"
                    className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    required
                    minLength={3}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">URL do YouTube</label>
                  <input
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    maxLength={PARTNER_VIDEO_YOUTUBE_URL_MAX}
                    placeholder="https://www.youtube.com/watch?v=…"
                    className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Descrição (opcional)</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={PARTNER_VIDEO_DESCRIPTION_MAX}
                    rows={3}
                    placeholder="Breve descrição…"
                    className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y"
                  />
                </div>
                {submitErr && <div className="text-sm text-red-400">{submitErr}</div>}
                <button
                  type="submit"
                  disabled={submitting || !canSubmitToday || ctxLoading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-black uppercase tracking-wide"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : <Rocket size={18} />}
                  Submeter vídeo
                </button>
              </form>
            </div>
          )}
        </section>
      )}

      {isPartner && mySubs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white">Os meus envios</h2>
          <ul className="space-y-2">
            {mySubs.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2"
              >
                <img
                  src={thumbUrl(s.youtubeVideoId)}
                  alt=""
                  className="w-20 h-12 object-cover rounded border border-slate-700 shrink-0 bg-slate-800"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-white truncate">{s.title}</div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1">
                    <Calendar size={12} /> {fmtDate(s.createdAt)}
                  </div>
                  {s.rejectReason ? (
                    <div className="text-[11px] text-red-300/90 mt-0.5 truncate" title={s.rejectReason}>
                      {s.rejectReason}
                    </div>
                  ) : null}
                </div>
                <span className={`text-[10px] font-black uppercase px-2 py-1 rounded border shrink-0 ${statusClass(s.status)}`}>
                  {statusLabel(s.status)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">Últimos vídeos</h2>
            <p className="text-xs text-slate-500 font-semibold mt-0.5">
              {!loading && !err && videos.length > 0
                ? `${videos.length} mais recentes na vitrine`
                : '🔥 Os mais recentes em destaque'}
            </p>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-16 text-amber-500">
            <Loader2 className="animate-spin" size={32} />
          </div>
        ) : err ? (
          <div className="text-red-400 text-sm">{err}</div>
        ) : videos.length === 0 ? (
          <div className="text-slate-500 text-sm border border-slate-800 rounded-xl p-8 text-center">
            Ainda não há vídeos aprovados. Volta mais tarde!
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {videos.map((v) => {
              const displayName = String(v.creator?.displayName || '').trim() || 'Parceiro';
              const creatorSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${displayName} channel`)}`;
              const customChannel = String(v.creator?.channelUrl || '').trim();
              const channelHref = customChannel || creatorSearch;
              const channelLabel = customChannel ? 'Ver canal' : 'Procurar canal';
              const thumb = v.thumbnailUrl || thumbUrl(v.youtubeVideoId);
              return (
                <article
                  key={v.publicId}
                  className="rounded-xl border border-slate-600/80 bg-slate-950/60 overflow-hidden flex flex-col shadow-xl shadow-black/30 ring-1 ring-white/5 hover:ring-amber-500/20 transition-all"
                >
                  <a
                    href={v.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative block aspect-video bg-slate-950 group"
                  >
                    <img
                      src={thumb}
                      alt=""
                      className="w-full h-full object-cover opacity-95 group-hover:opacity-100 group-hover:scale-[1.02] transition-transform duration-300"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/30 transition-colors">
                      <div className="rounded-full bg-red-600 text-white p-3 shadow-lg shadow-red-900/50 scale-95 group-hover:scale-100 transition-transform">
                        <Play size={24} className="fill-white translate-x-0.5" />
                      </div>
                    </div>
                  </a>
                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <h3 className="font-bold text-sm text-white leading-snug line-clamp-2 min-h-[2.5rem]">{v.title}</h3>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <User size={12} /> {displayName}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={12} /> {fmtDate(v.publishedAt)}
                      </span>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
                      <a
                        href={v.youtubeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 text-center text-[10px] sm:text-[11px] font-black uppercase py-2.5 rounded-lg bg-gradient-to-b from-orange-500 to-orange-700 hover:from-orange-400 hover:to-orange-600 text-white shadow-md shadow-orange-900/30 border border-orange-400/30"
                      >
                        <ThumbsUp size={14} className="shrink-0" />
                        Curtir no YouTube
                      </a>
                      <a
                        href={channelHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 text-center text-[10px] sm:text-[11px] font-black uppercase py-2.5 rounded-lg bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white shadow-md shadow-red-900/40 border border-red-500/30"
                      >
                        <Youtube size={14} className="shrink-0" />
                        {channelLabel}
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showcaseCreators.length > 0 && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900/40 px-4 py-5 space-y-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Os nossos parceiros</h2>
          <p className="text-xs text-slate-500">
            Fotos e links de canal podem ser definidos pelo admin (aba Parceiros → Vitrine por utilizador).
          </p>
          <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
            {showcaseCreators.map((c) => {
              const fallbackSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${c.username} channel`)}`;
              const href = c.channelUrl || fallbackSearch;
              return (
                <a
                  key={c.key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col items-center gap-1.5 w-[4.5rem]"
                >
                  <span className="transition-transform group-hover:scale-105 group-hover:ring-2 group-hover:ring-amber-500/40 rounded-full">
                    <PartnerShowcaseAvatar name={c.username} imageUrl={c.avatarUrl} />
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 text-center line-clamp-2 leading-tight group-hover:text-amber-200/90">
                    {c.username}
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      )}
      </div>
    </div>
  );
};
