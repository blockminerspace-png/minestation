import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  Check,
  X,
  Loader2,
  ExternalLink,
  Trash2,
  ImageIcon,
  Users,
  Clapperboard,
  UserPlus,
  Search
} from 'lucide-react';
import {
  getAdminPartnerYoutubeSubmissions,
  getAdminPartnerYoutubePartners,
  adminApprovePartnerYoutube,
  adminRejectPartnerYoutube,
  adminDeletePartnerYoutube,
  getAdminPartnerYoutubeCreatorProfile,
  putAdminPartnerYoutubeCreatorProfile,
  uploadAdImage,
  getAdminUserMap,
  postAdminPartnerYoutubeAllowlist,
  deleteAdminPartnerYoutubeAllowlist,
  type AdminPartnerYoutubeRow,
  type AdminPartnerYoutubePartnerRow,
} from '../services/api';
import {
  PARTNER_AVATAR_URL_MAX,
  PARTNER_CHANNEL_URL_MAX,
  PARTNER_REJECT_REASON_MAX
} from '../constants/formLimits';

function thumbUrl(videoId: string): string {
  const v = String(videoId || '').trim();
  if (!v) return '';
  return `https://i.ytimg.com/vi/${v}/hqdefault.jpg`;
}

function fmtDate(ms: number): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString('pt-PT');
  } catch {
    return '—';
  }
}

export const AdminPartnerVideos: React.FC = () => {
  const [sectionTab, setSectionTab] = useState<'envios' | 'parceiros'>('envios');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [rows, setRows] = useState<AdminPartnerYoutubeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [partners, setPartners] = useState<AdminPartnerYoutubePartnerRow[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [partnersErr, setPartnersErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [vitrineUserId, setVitrineUserId] = useState<number | null>(null);
  const [vitrineUsername, setVitrineUsername] = useState('');
  const [vitrineChannel, setVitrineChannel] = useState('');
  const [vitrineAvatar, setVitrineAvatar] = useState('');
  const [vitrineLoad, setVitrineLoad] = useState(false);
  const [vitrineSave, setVitrineSave] = useState(false);
  const [vitrineAvatarUpload, setVitrineAvatarUpload] = useState(false);
  const vitrineFileInputRef = useRef<HTMLInputElement>(null);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [userMap, setUserMap] = useState<Array<{ id: number; username: string; email: string }>>([]);
  const [userMapLoad, setUserMapLoad] = useState(false);
  const userMapFetched = useRef(false);
  const [allowlistBusyId, setAllowlistBusyId] = useState<number | null>(null);
  const [allowlistByTextBusy, setAllowlistByTextBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [removeAllowlistBusyId, setRemoveAllowlistBusyId] = useState<number | null>(null);

  const addFiltered = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return userMap.slice(0, 60);
    return userMap
      .filter(
        (u) =>
          String(u.username || '')
            .toLowerCase()
            .includes(q) ||
          String(u.email || '')
            .toLowerCase()
            .includes(q) ||
          String(u.id).includes(q)
      )
      .slice(0, 80);
  }, [userMap, addSearch]);

  const openAddPartnerModal = useCallback(() => {
    setAddModalOpen(true);
    setAddSearch('');
    setAddErr(null);
    if (userMapFetched.current) return;
    setUserMapLoad(true);
    void (async () => {
      try {
        const m = await getAdminUserMap();
        setUserMap(Array.isArray(m) ? m : []);
        userMapFetched.current = true;
      } catch {
        setAddErr('Não foi possível carregar a lista de utilizadores.');
      } finally {
        setUserMapLoad(false);
      }
    })();
  }, []);

  const addPartnerByUserId = async (userId: number) => {
    setAllowlistBusyId(userId);
    setAddErr(null);
    try {
      const r = await postAdminPartnerYoutubeAllowlist({ userId });
      if (!r.ok) {
        setAddErr(r.error || 'Falha ao adicionar.');
        return;
      }
      if (!r.inserted) {
        alert('Este utilizador já estava na lista de parceiros (pode submeter vídeos).');
      }
      setAddModalOpen(false);
      void loadPartners();
    } finally {
      setAllowlistBusyId(null);
    }
  };

  const addPartnerByTypedText = async () => {
    const raw = addSearch.trim();
    if (!raw) {
      setAddErr('Escreve um nome de utilizador ou email.');
      return;
    }
    setAllowlistByTextBusy(true);
    setAddErr(null);
    try {
      const r = await postAdminPartnerYoutubeAllowlist({ username: raw });
      if (!r.ok) {
        setAddErr(r.error || 'Falha ao adicionar.');
        return;
      }
      if (!r.inserted) {
        alert('Este utilizador já estava na lista de parceiros.');
      }
      setAddModalOpen(false);
      void loadPartners();
    } finally {
      setAllowlistByTextBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { submissions } = await getAdminPartnerYoutubeSubmissions(filter);
      setRows(submissions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadPartners = useCallback(async () => {
    setPartnersLoading(true);
    setPartnersErr(null);
    try {
      const { partners: p } = await getAdminPartnerYoutubePartners();
      setPartners(p);
    } catch (e) {
      setPartnersErr(e instanceof Error ? e.message : 'Erro ao carregar parceiros.');
      setPartners([]);
    } finally {
      setPartnersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sectionTab === 'parceiros') void loadPartners();
  }, [sectionTab, loadPartners]);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      const r = await adminApprovePartnerYoutube(id);
      if (!r.ok) {
        alert(r.error || 'Falha ao aprovar.');
        return;
      }
      await load();
      void loadPartners();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejectId) return;
    setBusyId(rejectId);
    try {
      const r = await adminRejectPartnerYoutube(rejectId, rejectReason);
      if (!r.ok) {
        alert(r.error || 'Falha ao recusar.');
        return;
      }
      setRejectId(null);
      setRejectReason('');
      await load();
      void loadPartners();
    } finally {
      setBusyId(null);
    }
  };

  const removeRow = async (id: string, title: string) => {
    if (
      !window.confirm(
        `Apagar permanentemente este envio?\n\n«${title.slice(0, 80)}${title.length > 80 ? '…' : ''}»\n\nIsto remove o registo da base de dados (pendente, aprovado ou recusado).`
      )
    ) {
      return;
    }
    setBusyId(id);
    try {
      const r = await adminDeletePartnerYoutube(id);
      if (!r.ok) {
        alert(r.error || 'Falha ao apagar.');
        return;
      }
      await load();
      void loadPartners();
    } finally {
      setBusyId(null);
    }
  };

  const openVitrine = async (userId: number, username: string) => {
    setVitrineUserId(userId);
    setVitrineUsername(username);
    setVitrineChannel('');
    setVitrineAvatar('');
    setVitrineLoad(true);
    try {
      const p = await getAdminPartnerYoutubeCreatorProfile(userId);
      setVitrineChannel(p.channelUrl);
      setVitrineAvatar(p.avatarUrl);
    } catch {
      setVitrineChannel('');
      setVitrineAvatar('');
    } finally {
      setVitrineLoad(false);
    }
  };

  const onVitrineAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setVitrineAvatarUpload(true);
    try {
      const r = await uploadAdImage(file);
      if (!r.ok || !r.imageUrl) {
        alert(r.error || 'Falha no upload.');
        return;
      }
      setVitrineAvatar(r.imageUrl);
    } finally {
      setVitrineAvatarUpload(false);
    }
  };

  const saveVitrine = async () => {
    if (vitrineUserId == null) return;
    setVitrineSave(true);
    try {
      const r = await putAdminPartnerYoutubeCreatorProfile(vitrineUserId, {
        channelUrl: vitrineChannel,
        avatarUrl: vitrineAvatar
      });
      if (!r.ok) {
        alert(r.error || 'Falha ao guardar.');
        return;
      }
      setVitrineUserId(null);
      void loadPartners();
    } finally {
      setVitrineSave(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black text-white tracking-tight">Parceiros YouTube</h2>
        <p className="text-xs text-slate-400 mt-1">
          <strong className="text-slate-300">Envios</strong>: aprovar, recusar ou apagar.{' '}
          <strong className="text-slate-300">Parceiros</strong>: vídeo aprovado na vitrine ou adicionado manualmente — canal YouTube e foto para «Os nossos parceiros»; quem está só na lista manual pode submeter vídeos antes de ter um aprovado.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setSectionTab('envios')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase border transition-colors ${
            sectionTab === 'envios'
              ? 'bg-amber-600/20 text-white border-amber-600/60'
              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
          }`}
        >
          <Clapperboard size={16} /> Envios
        </button>
        <button
          type="button"
          onClick={() => setSectionTab('parceiros')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase border transition-colors ${
            sectionTab === 'parceiros'
              ? 'bg-amber-600/20 text-white border-amber-600/60'
              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
          }`}
        >
          <Users size={16} /> Parceiros (vitrine)
        </button>
      </div>

      {sectionTab === 'envios' && (
        <>
          <div className="flex flex-wrap gap-2">
            {(['pending', 'all', 'approved', 'rejected'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  filter === f ? 'bg-amber-600/25 text-white border-amber-600/60' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {f === 'pending' ? 'Pendentes' : f === 'all' ? 'Todos' : f === 'approved' ? 'Aprovados' : 'Recusados'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>

          {err && <div className="text-sm text-red-400">{err}</div>}

          {loading ? (
            <div className="flex justify-center py-16 text-amber-500">
              <Loader2 className="animate-spin" size={32} />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-slate-500 text-sm border border-slate-800 rounded-xl p-8 text-center">Sem registos neste filtro.</div>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 flex flex-col sm:flex-row gap-4"
                >
                  <img
                    src={thumbUrl(r.youtubeVideoId)}
                    alt=""
                    className="w-full sm:w-40 aspect-video object-cover rounded-lg border border-slate-700 bg-slate-950 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-bold text-white">{r.title}</div>
                    <div className="text-[11px] text-slate-500">
                      {r.username} · #{r.userId} · {r.email} · {fmtDate(r.createdAt)}
                    </div>
                    <div className="text-[11px] uppercase font-bold text-slate-400">Estado: {r.status}</div>
                    {r.rejectReason ? <div className="text-xs text-red-300/90">Motivo: {r.rejectReason}</div> : null}
                    <a
                      href={r.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 mt-1"
                    >
                      <ExternalLink size={12} /> Abrir no YouTube
                    </a>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0 justify-center">
                    {r.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void approve(r.id)}
                          className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-40"
                        >
                          {busyId === r.id ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                          Aprovar
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => {
                            setRejectId(r.id);
                            setRejectReason('');
                          }}
                          className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-red-900/70 hover:bg-red-800 text-white text-xs font-bold disabled:opacity-40"
                        >
                          <X size={14} /> Recusar
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void removeRow(r.id, r.title)}
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-slate-600 bg-slate-800/80 hover:bg-slate-800 text-slate-200 text-xs font-bold disabled:opacity-40"
                    >
                      {busyId === r.id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                      Apagar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {sectionTab === 'parceiros' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadPartners()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw size={14} /> Atualizar lista
            </button>
            <button
              type="button"
              onClick={() => openAddPartnerModal()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-700/60 bg-amber-950/35 text-amber-100 hover:bg-amber-900/40"
            >
              <UserPlus size={14} /> Adicionar parceiro
            </button>
            <span className="text-[11px] text-slate-500">
              Inclui quem tem vídeo aprovado ou foi adicionado aqui. «Remover da lista» tira só a entrada manual; quem só
              entrou por vídeo aprovado continua na vitrine até gerires os envios.
            </span>
          </div>
          {partnersErr && <div className="text-sm text-red-400">{partnersErr}</div>}
          {partnersLoading ? (
            <div className="flex justify-center py-16 text-amber-500">
              <Loader2 className="animate-spin" size={32} />
            </div>
          ) : partners.length === 0 ? (
            <div className="text-slate-500 text-sm border border-slate-800 rounded-xl p-8 text-center">
              Ainda não há parceiros na vitrine. Usa «Adicionar parceiro» ou aprova um primeiro vídeo.
            </div>
          ) : (
            <ul className="space-y-3">
              {partners.map((p) => (
                <li
                  key={p.userId}
                  className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 flex flex-col sm:flex-row gap-4 items-center"
                >
                  <div className="shrink-0">
                    {p.avatarUrl ? (
                      <img
                        src={p.avatarUrl}
                        alt=""
                        className="h-16 w-16 rounded-full object-cover border border-slate-600 bg-slate-950"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-xl font-black text-amber-500">
                        {String(p.username || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1 w-full">
                    <div className="font-bold text-white">{p.username}</div>
                    <div className="text-[11px] text-slate-500">
                      #{p.userId} · {p.email} · {p.approvedCount} vídeo(s) aprovado(s)
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {p.allowlisted && (p.approvedCount ?? 0) === 0 ? (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-amber-800/60 bg-amber-950/50 text-amber-200">
                          Lista manual — pode submeter
                        </span>
                      ) : null}
                      {p.channelUrl ? (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-emerald-800/60 bg-emerald-950/40 text-emerald-300">
                          Canal definido
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-slate-600 text-slate-500">
                          Sem canal
                        </span>
                      )}
                      {p.avatarUrl ? (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-sky-800/60 bg-sky-950/40 text-sky-300">
                          Foto definida
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-slate-600 text-slate-500">
                          Sem foto
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0 justify-end w-full sm:w-auto">
                    {p.allowlisted ? (
                      <button
                        type="button"
                        title="Remove a autorização extra de parceiro YouTube (lista manual)."
                        disabled={removeAllowlistBusyId === p.userId || vitrineUserId === p.userId}
                        onClick={() => {
                          const extra =
                            (p.approvedCount ?? 0) > 0
                              ? ' Mantém-se na lista se tiver vídeo(s) aprovado(s).'
                              : ' Deixa de poder enviar vídeos de parceiro se não tiver nível Parceiros.';
                          if (
                            !window.confirm(
                              `Remover «${p.username}» da lista manual de parceiros YouTube?${extra}`
                            )
                          ) {
                            return;
                          }
                          void (async () => {
                            setRemoveAllowlistBusyId(p.userId);
                            try {
                              const r = await deleteAdminPartnerYoutubeAllowlist(p.userId);
                              if (!r.ok) {
                                alert(r.error || 'Falha ao remover.');
                                return;
                              }
                              void loadPartners();
                            } finally {
                              setRemoveAllowlistBusyId(null);
                            }
                          })();
                        }}
                        className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-red-900/70 bg-red-950/40 hover:bg-red-900/45 text-red-100 text-xs font-bold disabled:opacity-40"
                      >
                        {removeAllowlistBusyId === p.userId ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : (
                          <Trash2 size={14} />
                        )}
                        Remover da lista
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={vitrineUserId === p.userId}
                      onClick={() => void openVitrine(p.userId, p.username)}
                      className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg border border-amber-700/60 bg-amber-950/40 hover:bg-amber-900/50 text-amber-100 text-xs font-bold"
                    >
                      <ImageIcon size={14} /> Editar vitrine
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-600 rounded-xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] flex flex-col">
            <div className="font-bold text-white flex items-center gap-2">
              <UserPlus size={18} className="text-amber-400" /> Adicionar parceiro (YouTube)
            </div>
            <p className="text-xs text-slate-400">
              Pesquisa por nome, email ou ID e escolhe o utilizador. Fica autorizado a enviar vídeos de parceiro (1 por dia UTC), como quem tem nível Parceiros.
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                placeholder="Pesquisar ou colar email / nome exato…"
                className="w-full rounded-lg bg-slate-950 border border-slate-600 pl-9 pr-3 py-2 text-sm text-white"
              />
            </div>
            {addErr && <div className="text-sm text-red-400">{addErr}</div>}
            {userMapLoad ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
                <Loader2 className="animate-spin" size={18} /> A carregar utilizadores…
              </div>
            ) : (
              <ul className="border border-slate-800 rounded-lg overflow-y-auto max-h-[14rem] divide-y divide-slate-800/80">
                {addFiltered.length === 0 ? (
                  <li className="p-4 text-sm text-slate-500 text-center">Sem resultados. Tenta outro termo ou adiciona por texto abaixo.</li>
                ) : (
                  addFiltered.map((u) => (
                    <li key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-white truncate">{u.username}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          #{u.id} · {u.email}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={allowlistBusyId === u.id}
                        onClick={() => void addPartnerByUserId(u.id)}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40"
                      >
                        {allowlistBusyId === u.id ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
                        Adicionar
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            <div className="pt-1 border-t border-slate-800 space-y-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">Nome ou email exato (servidor)</div>
              <button
                type="button"
                disabled={allowlistByTextBusy || !addSearch.trim()}
                onClick={() => void addPartnerByTypedText()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                {allowlistByTextBusy ? <Loader2 className="animate-spin" size={16} /> : null}
                Adicionar pelo texto na caixa (ex.: email)
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="px-3 py-2 rounded-lg text-sm font-bold bg-slate-700 text-white"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {vitrineUserId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-600 rounded-xl max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="font-bold text-white">Vitrine — {vitrineUsername}</div>
            <div className="text-[11px] text-slate-500">Utilizador #{vitrineUserId}</div>
            <p className="text-xs text-slate-400">
              Canal: <code className="text-amber-200/90">https://www.youtube.com/...</code> (https, domínio YouTube). Foto: cola um URL ou usa{' '}
              <strong className="text-slate-300">Enviar imagem</strong> (PNG/JPG/GIF, máx. 5 MB — mesmo sistema dos anúncios).
            </p>
            {vitrineLoad ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                <Loader2 className="animate-spin" size={16} /> A carregar…
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Canal YouTube</label>
                  <input
                    value={vitrineChannel}
                    onChange={(e) => setVitrineChannel(e.target.value)}
                    placeholder="https://www.youtube.com/@canal ou /channel/…"
                    maxLength={PARTNER_CHANNEL_URL_MAX}
                    className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Foto (URL ou upload)</label>
                  <input
                    value={vitrineAvatar}
                    onChange={(e) => setVitrineAvatar(e.target.value)}
                    placeholder="https://… ou /img/… após enviar"
                    maxLength={PARTNER_AVATAR_URL_MAX}
                    className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-sm text-white"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      ref={vitrineFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/gif"
                      className="hidden"
                      onChange={(ev) => void onVitrineAvatarFile(ev)}
                    />
                    <button
                      type="button"
                      disabled={vitrineAvatarUpload}
                      onClick={() => vitrineFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                    >
                      {vitrineAvatarUpload ? <Loader2 className="animate-spin" size={14} /> : <ImageIcon size={14} />}
                      Enviar imagem
                    </button>
                    {vitrineAvatar ? (
                      <span className="text-[10px] text-slate-500 truncate max-w-[12rem]" title={vitrineAvatar}>
                        {vitrineAvatar}
                      </span>
                    ) : null}
                  </div>
                  {vitrineAvatar.startsWith('/') || vitrineAvatar.startsWith('http') ? (
                    <div className="mt-2 flex justify-center">
                      <img
                        src={vitrineAvatar}
                        alt="Pré-visualização"
                        className="h-16 w-16 rounded-full object-cover border border-slate-600"
                      />
                    </div>
                  ) : null}
                </div>
              </>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setVitrineUserId(null)}
                className="px-3 py-2 rounded-lg text-sm font-bold bg-slate-700 text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={vitrineLoad || vitrineSave}
                onClick={() => void saveVitrine()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold bg-amber-600 text-white disabled:opacity-40"
              >
                {vitrineSave ? <Loader2 className="animate-spin" size={16} /> : null}
                {vitrineSave ? 'A guardar…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-600 rounded-xl max-w-md w-full p-5 space-y-3">
            <div className="font-bold text-white">Recusar vídeo</div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Motivo (opcional)"
              maxLength={PARTNER_REJECT_REASON_MAX}
              rows={3}
              className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-sm text-white"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRejectId(null)}
                className="px-3 py-2 rounded-lg text-sm font-bold bg-slate-700 text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => void reject()}
                className="px-3 py-2 rounded-lg text-sm font-bold bg-red-600 text-white disabled:opacity-40"
              >
                Confirmar recusa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
