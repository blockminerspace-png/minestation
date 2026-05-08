
import React, { useState, useEffect } from 'react';
import { User, SeasonPass, SeasonPurchase, AccessLevel, LootBox, GameState } from '@/types';
import { AUTH_PASSWORD_MAX, AUTH_REFERRAL_MAX, AUTH_USERNAME_MAX, AUTH_USERNAME_MIN } from '../constants/authLimits';
import { PLAYER_NEWS_LINK_MAX, PLAYER_NEWS_TEXT_MAX } from '../constants/formLimits';
import { User as UserIcon, Lock, Mail, Save, AlertCircle, CheckCircle2, Wallet, ShieldCheck, Share2, Copy, Newspaper, Unplug } from 'lucide-react';
import { getSeasonPasses, getSeasonPurchases, getAccessLevels, getReferrals, claimReferralCode, claimReferralReward, getNewsFee, submitPlayerNews, getGameState, getLootBoxes, saveGameState, getProfilePageBundle } from '@/services/api';

export type ProfileUpdateResult = { ok: boolean; error?: string };

interface ProfilePageProps {
    user: User;
    onUpdateProfile: (updatedUser: User & { currentPassword?: string }) => void | Promise<ProfileUpdateResult>;
  onUpdateGameState?: (next: GameState) => void;
  /** URL canónica do SPA (FRONTEND_URL no servidor); se vazio, usa o host da página. */
  referralBaseUrl?: string | null;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  user,
  onUpdateProfile,
  onUpdateGameState,
  referralBaseUrl
}) => {
  const [username, setUsername] = useState(user.username);
  const [polygonWallet, setPolygonWallet] = useState(user.polygonWallet || '');

  useEffect(() => {
    setPolygonWallet(user.polygonWallet || '');
  }, [user.polygonWallet]);
  const [seasonPasses, setSeasonPasses] = useState<SeasonPass[]>([]);
  const [seasonPurchases, setSeasonPurchases] = useState<SeasonPurchase[]>([]);
  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [referrals, setReferrals] = useState<string[]>([]);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [referralClaimLoading, setReferralClaimLoading] = useState(false);

  // Password Change State
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');



  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [newsText, setNewsText] = useState('');
  const [newsLink, setNewsLink] = useState('');
  const [newsFee, setNewsFeeState] = useState<number>(0);
  const [usdcBal, setUsdcBal] = useState<number>(0);
  const [claimedReferralsCount, setClaimedReferralsCount] = useState<number>(0);
  const [lootBoxes, setLootBoxesState] = useState<LootBox[]>([]);
  const [gameSave, setGameSave] = useState<any>(null);

  const referralOrigin =
    (referralBaseUrl && String(referralBaseUrl).trim().replace(/\/+$/, '')) || window.location.origin;

  const handleConnectWallet = async () => {
    try {
      const eth = (window as any).ethereum;
      if (!eth) {
        setMessage({ type: 'error', text: 'Instale uma carteira compatível (ex: MetaMask).' });
        return;
      }
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      const addr = accounts && accounts[0];
      if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        setMessage({ type: 'error', text: 'Falha ao obter endereço da carteira.' });
        return;
      }
      try {
        const chainId = await eth.request({ method: 'eth_chainId' });
        if (chainId !== '0x89') {
          try {
            await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
          } catch {
            try {
              await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x89', chainName: 'Polygon Mainnet', nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'] }] });
            } catch { }
          }
        }
      } catch { }
      const prev = user.polygonWallet || '';
      setPolygonWallet(addr);
      const r = await Promise.resolve(onUpdateProfile({ ...user, polygonWallet: addr }));
      if (r && typeof r === 'object' && 'ok' in r && !r.ok) {
        setPolygonWallet(prev);
        setMessage({ type: 'error', text: r.error || 'Não foi possível guardar a carteira no servidor.' });
        return;
      }
      setMessage({ type: 'success', text: 'Carteira conectada e salva no seu perfil.' });

    } catch {
      setMessage({ type: 'error', text: 'Autenticação cancelada ou falhou.' });
    }
  };

  const handleRemoveConnectedWallet = async () => {
    if (!polygonWallet) return;
    if (
      !confirm(
        'Remover o endereço de saque do perfil? Depósitos e levantamentos em cripto ficarão indisponíveis até conectar outra carteira.'
      )
    ) {
      return;
    }
    const prev = polygonWallet;
    setPolygonWallet('');
    const r = await Promise.resolve(onUpdateProfile({ ...user, polygonWallet: null }));
    if (r && typeof r === 'object' && 'ok' in r && !r.ok) {
      setPolygonWallet(prev);
      setMessage({ type: 'error', text: r.error || 'Não foi possível remover a carteira no servidor.' });
      return;
    }
    setMessage({ type: 'success', text: 'Carteira removida do perfil.' });
  };

  const handleUpdateBasicInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u) {
      setMessage({ type: 'error', text: "Nome de usuário não pode estar vazio." });
      return;
    }
    if (u.length < AUTH_USERNAME_MIN || u.length > AUTH_USERNAME_MAX) {
      setMessage({
        type: 'error',
        text: `O nome de utilizador deve ter entre ${AUTH_USERNAME_MIN} e ${AUTH_USERNAME_MAX} caracteres.`
      });
      return;
    }
    const r = await Promise.resolve(onUpdateProfile({ ...user, username: u }));
    if (r && typeof r === 'object' && 'ok' in r && !r.ok) {
      setMessage({ type: 'error', text: r.error || 'Falha ao guardar.' });
      return;
    }
    setMessage({ type: 'success', text: "Informações básicas atualizadas." });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPass.trim()) {
      setMessage({ type: 'error', text: 'Indique a palavra-passe atual.' });
      return;
    }
    if (!newPass.length) {
      setMessage({ type: 'error', text: 'Indique a nova palavra-passe.' });
      return;
    }
    if (newPass.length > AUTH_PASSWORD_MAX) {
      setMessage({ type: 'error', text: `A nova senha pode ter no máximo ${AUTH_PASSWORD_MAX} caracteres.` });
      return;
    }
    if (newPass !== confirmPass) {
      setMessage({ type: 'error', text: "As novas senhas não coincidem." });
      return;
    }

    const r = await Promise.resolve(onUpdateProfile({ ...user, password: newPass, currentPassword: currentPass }));
    if (r && typeof r === 'object' && 'ok' in r && !r.ok) {
      setMessage({ type: 'error', text: r.error || 'Falha ao alterar a palavra-passe.' });
      return;
    }
    setMessage({ type: 'success', text: "Senha alterada com sucesso." });
    setCurrentPass('');
    setNewPass('');
    setConfirmPass('');
  };



  const copyReferralLink = () => {
    if (!user.referralCode) return;
    const url = `${referralOrigin}?ref=${user.referralCode}`;
    navigator.clipboard.writeText(url);
    alert("Link de indicação copiado!");
  }
  const handleClaimReferral = async () => {
    try {
      setReferralClaimLoading(true);
      const res = await claimReferralReward(user.email);
      if (res && res.ok) {
        // Refresh game state to see the new box and updated count
        const gsRes = await getGameState(user.email);
        if (gsRes.data) {
          setGameSave(gsRes.data);
          setClaimedReferralsCount(gsRes.data.claimedReferrals || 0);
          setUsdcBal(gsRes.data.usdc || 0);
          onUpdateGameState && onUpdateGameState(gsRes.data);
          alert('Prêmio de indicação resgatado com sucesso! Verifique seu inventário.');
        }
      } else {
        alert(res?.error || 'Falha ao resgatar prêmio.');
      }
    } catch (e) {
      alert('Erro ao processar resgate.');
    } finally {
      setReferralClaimLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      const bundle = await getProfilePageBundle();
      if (bundle) {
        setSeasonPasses(bundle.seasonPasses);
        setSeasonPurchases(bundle.seasonPurchases);
        setAccessLevels(bundle.accessLevels);
        setReferrals((bundle.referrals || []).filter((r) => r !== user.username));
        setLootBoxesState(bundle.lootBoxes);
        setNewsFeeState(bundle.newsFee);
        setUsdcBal(bundle.profileGame.usdc);
        setClaimedReferralsCount(bundle.profileGame.claimedReferrals);
        setGameSave({ claimedReferrals: bundle.profileGame.claimedReferrals });
        return;
      }
      const [passes, purchases, levels, refs, boxes] = await Promise.all([
        getSeasonPasses(),
        getSeasonPurchases(user.email),
        getAccessLevels(),
        getReferrals(user.email),
        getLootBoxes()
      ]);
      setSeasonPasses(passes);
      setSeasonPurchases(purchases);
      setAccessLevels(levels);
      setReferrals((refs || []).filter((r) => r !== user.username));
      setLootBoxesState(boxes);
      const fee = await getNewsFee();
      setNewsFeeState(fee);
      const gsRes = await getGameState(user.email);
      const gs = gsRes.data;
      setUsdcBal(gs?.usdc || 0);
      if (gs) {
        setClaimedReferralsCount(gs.claimedReferrals || 0);
        setGameSave(gs);
      }
    };
    void load();
  }, [user.email, user.username]);

  const currentLevelName = (() => {
    const lvl = accessLevels.find(l => l.id === user.accessLevelId);
    return lvl ? lvl.name : (user.accessLevelId || 'Desconhecido');
  })();

  return (
    <div className="flex flex-col p-6 animate-in fade-in slide-in-from-bottom-4 duration-300">

      <div className="flex items-center gap-3 mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="bg-slate-200 dark:bg-slate-800 p-2 rounded-lg text-amber-600 dark:text-amber-400">
          <UserIcon size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">Console do operador Genesis</h2>
          <p className="text-sm text-slate-500">Identidade on-chain, segurança da conta e rede de indicações.</p>
        </div>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 text-sm font-bold ${message.type === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'}`}>
          {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-8">

        {/* IDENTIDADE */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <UserIcon size={18} className="text-amber-500" /> Identidade na rede
            </h3>
            <form onSubmit={handleUpdateBasicInfo} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs uppercase font-bold text-slate-500">E-mail (ID do cadastro)</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    value={user.email}
                    disabled
                    className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg py-2 pl-10 pr-4 text-slate-500 dark:text-slate-400 cursor-not-allowed"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase font-bold text-slate-500">Nome de Usuário</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    maxLength={AUTH_USERNAME_MAX}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg py-2 pl-10 pr-4 text-slate-900 dark:text-white focus:border-amber-500 outline-none transition-colors"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase font-bold text-slate-500">Nível de acesso</label>
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg py-2 px-3 text-slate-700 dark:text-slate-300">
                  <ShieldCheck size={16} className="text-green-600 dark:text-green-400" />
                  <span className="text-sm font-bold">{currentLevelName}</span>
                </div>
              </div>
              <button type="submit" className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2">
                <Save size={16} /> Salvar alterações
              </button>
            </form>
          </div>

          {/* REFERRAL SYSTEM */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <Share2 size={18} className="text-amber-500" /> Programa Genesis Referral
            </h3>

            <div className="space-y-4">
              <div>
                <label className="text-xs uppercase font-bold text-slate-500">Seu link de convite</label>
                <div className="flex gap-2 mt-1">
                  <div className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg py-2 px-3 text-slate-600 dark:text-slate-400 text-sm font-mono truncate flex-1">
                    {user.referralCode ? `${referralOrigin}?ref=${user.referralCode}` : 'Código não gerado'}
                  </div>
                  <button
                    onClick={copyReferralLink}
                    className="bg-amber-600 hover:bg-amber-500 text-white p-2 rounded-lg"
                    title="Copiar Link"
                  >
                    <Copy size={18} />
                  </button>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-950 rounded-lg p-3 border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase">Operadores convidados</span>
                  <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{referrals.length}</span>
                </div>

                {referrals.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                    {[...referrals].reverse().map((refName, displayIdx) => {
                      const originalIdx = referrals.length - 1 - displayIdx;
                      const claimed = originalIdx < (gameSave?.claimedReferrals || 0);
                      const claimable = !claimed && originalIdx === (gameSave?.claimedReferrals || 0);
                      return (
                        <div key={originalIdx} className="text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${claimed ? 'bg-green-500' : 'bg-slate-400'}`}></div>
                            <span>{refName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {claimed ? (
                              <span className="text-[10px] bg-green-700/20 text-green-500 px-2 py-0.5 rounded border border-green-700/40">Resgatado</span>
                            ) : (
                              <button
                                onClick={handleClaimReferral}
                                disabled={!claimable}
                                className={`text-[10px] px-2 py-1 rounded font-bold ${claimable ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-50'}`}
                              >
                                {claimable ? 'Resgatar' : 'Pendente'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic">Nenhum indicado ainda. Convide amigos para ganhar recompensas!</div>
                )}
              </div>

              {!user.referredBy && (
                <div className="bg-white dark:bg-slate-950 rounded-lg p-3 border border-slate-200 dark:border-slate-800 mt-3">
                  <div className="text-xs font-bold text-slate-500 uppercase mb-2">Quem te indicou?</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={referralCodeInput}
                      onChange={(e) => setReferralCodeInput(e.target.value.slice(0, AUTH_REFERRAL_MAX))}
                      maxLength={AUTH_REFERRAL_MAX}
                      placeholder="Código de indicação"
                      className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg py-2 px-3 text-sm"
                    />
                    <button
                      onClick={async () => {
                        if (!referralCodeInput.trim() || referralClaimLoading) return;
                        setReferralClaimLoading(true);
                        const res = await claimReferralCode(user.email, referralCodeInput.trim());
                        setReferralClaimLoading(false);
                        if (res && res.ok) {
                          const pr = await Promise.resolve(
                            onUpdateProfile({ ...user, referredBy: referralCodeInput.trim() })
                          );
                          if (pr && typeof pr === 'object' && 'ok' in pr && !pr.ok) {
                            alert(pr.error || 'Código vinculado mas falhou ao sincronizar o perfil.');
                            return;
                          }
                          alert('Código vinculado com sucesso. Recompensas de indicação ativadas.');
                        } else {
                          alert(res?.error || 'Falha ao vincular código');
                        }
                      }}
                      className="bg-green-600 hover:bg-green-500 text-white px-4 rounded-lg text-sm font-bold"
                    >
                      {referralClaimLoading ? 'Processando...' : 'VINCULAR CÓDIGO'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {(() => {
            const userLvlIds = user.accessLevelIds || (user.accessLevelId ? [user.accessLevelId] : []);
            const canPost = accessLevels.some(l => userLvlIds.includes(l.id) && l.isActive && l.newsPostingEnabled);
            if (!canPost) return null;
            return (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                  <Newspaper size={18} className="text-orange-500" /> Publicar notícia
                </h3>
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Taxa: ${newsFee} USDC • Saldo: ${usdcBal.toFixed(2)} USDC</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs uppercase font-bold text-slate-500">Texto</label>
                    <input
                      type="text"
                      value={newsText}
                      onChange={e => setNewsText(e.target.value)}
                      maxLength={PLAYER_NEWS_TEXT_MAX}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg py-2 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase font-bold text-slate-500">Link (Opcional)</label>
                    <input
                      type="text"
                      value={newsLink}
                      onChange={e => setNewsLink(e.target.value)}
                      maxLength={PLAYER_NEWS_LINK_MAX}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg py-2 px-3 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => {
                      if (!newsText.trim()) return;
                      if (!window.confirm(`Confirmar envio? Taxa de $${newsFee} USDC será debitada.`)) return;
                      const res = await submitPlayerNews(user.email, newsText.trim(), newsLink.trim() || undefined);
                      if (res && res.ok) {
                        setNewsText('');
                        setNewsLink('');
                        setUsdcBal(typeof res.newUsdc === 'number' ? res.newUsdc : usdcBal);
                        alert('Sua notícia foi enviada para aprovação.');
                      } else if (res && res.missing !== undefined) {
                        alert(`Saldo insuficiente. Faltam $${res.missing.toFixed(2)} USDC.`);
                      } else if (res && res.error) {
                        alert(res.error);
                      }
                    }} className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors">ENVIAR</button>
                    <button onClick={() => { setNewsText(''); setNewsLink(''); }} className="bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors">CANCELAR</button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Emblemas de Temporada</h3>
            {seasonPurchases.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">Nenhum emblema adquirido.</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {seasonPurchases.map((p, idx) => {
                  const pass = seasonPasses.find(sp => sp.id === p.passId);
                  return (
                    <div key={idx} className="flex flex-col items-center gap-2">
                      {pass?.emblemUrl ? (
                        <img src={pass.emblemUrl} alt={pass.name} className="w-16 h-16 object-cover rounded border border-slate-200 dark:border-slate-700" />
                      ) : (
                        <div className="w-16 h-16 rounded bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400">🏅</div>
                      )}
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 text-center truncate w-16">{pass?.name || p.passId}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SEGURANÇA */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <Lock size={18} className="text-red-500" /> Alterar Senha
            </h3>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs uppercase font-bold text-slate-500">Senha Atual</label>
                <input
                  type="password"
                  value={currentPass}
                  onChange={(e) => setCurrentPass(e.target.value)}
                  maxLength={AUTH_PASSWORD_MAX}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg py-2 px-4 text-slate-900 dark:text-white focus:border-red-500 outline-none transition-colors"
                />
              </div>
              <div className="border-t border-slate-200 dark:border-slate-800 my-2"></div>
              <div className="space-y-1">
                <label className="text-xs uppercase font-bold text-slate-500">Nova Senha</label>
                <input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  maxLength={AUTH_PASSWORD_MAX}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg py-2 px-4 text-slate-900 dark:text-white focus:border-amber-500 outline-none transition-colors"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase font-bold text-slate-500">Confirmar Nova Senha</label>
                <input
                  type="password"
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  maxLength={AUTH_PASSWORD_MAX}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg py-2 px-4 text-slate-900 dark:text-white focus:border-amber-500 outline-none transition-colors"
                />
              </div>
              <button type="submit" className="bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2">
                <Save size={16} /> ATUALIZAR SENHA
              </button>
            </form>
          </div>

          {/* CARTEIRA WEB3 */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 text-orange-500 pointer-events-none">
              <Wallet size={100} />
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2 relative z-10">
              <Wallet size={18} className="text-orange-500" /> Carteira de Saque (Polygon)
            </h3>
            <div className="flex flex-wrap items-center gap-2 mb-4 relative z-10">
              <button onClick={handleConnectWallet} disabled={!!polygonWallet} className="bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50 border border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-400 text-xs font-bold px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                Conectar carteira do navegador
              </button>
              {polygonWallet ? (
                <button
                  type="button"
                  onClick={handleRemoveConnectedWallet}
                  className="bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs font-bold px-4 py-2 rounded transition-colors flex items-center gap-1.5"
                >
                  <Unplug size={14} className="shrink-0 opacity-80" />
                  Remover carteira conectada
                </button>
              ) : null}
              {polygonWallet && (
                <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 truncate max-w-full sm:max-w-[min(100%,18rem)]">
                  {polygonWallet}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mb-4 relative z-10">
              Endereço pré-cadastrado para futuros saques de tokens e ativos NFT.
            </p>

            <div className="space-y-2 relative z-10">
              <label className="text-xs uppercase font-bold text-slate-500">Endereço Público (0x...)</label>
              <div className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg py-2 px-4 text-slate-700 dark:text-slate-300 font-mono text-sm">
                {polygonWallet || 'Nenhuma carteira conectada'}
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
