
import React, { useState, useEffect, useRef } from 'react';
import { User, SeasonPass, SeasonPurchase, AccessLevel, GameState } from '@/types';
import { AUTH_PASSWORD_MAX, AUTH_REFERRAL_MAX, AUTH_USERNAME_MAX, AUTH_USERNAME_MIN } from '../constants/authLimits';
import { PLAYER_NEWS_LINK_MAX, PLAYER_NEWS_TEXT_MAX } from '../constants/formLimits';
import { User as UserIcon, Lock, Mail, Save, AlertCircle, CheckCircle2, Wallet, ShieldCheck, Share2, Copy, Newspaper, Unplug } from 'lucide-react';
import {
  getSeasonPasses,
  getSeasonPurchases,
  getAccessLevels,
  claimReferralCode,
  getNewsFee,
  submitPlayerNews,
  getGameState,
  getProfilePageBundle,
  clearMyPolygonWallet,
  getProfileState,
  patchProfileIdentity,
  postProfilePasswordChange,
  postProfileWalletChallenge,
  postProfileWalletVerify,
  getSession,
  type ProfileApiState
} from '@/services/api';

function utf8MessageToHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

export type ProfileUpdateOptions = { skipApi?: boolean };

interface ProfilePageProps {
  user: User;
  onUpdateProfile: (
    updatedUser: User,
    opts?: ProfileUpdateOptions
  ) => void | Promise<{ ok: boolean; error?: string; code?: string; accounts?: unknown[] }>;
  onUpdateGameState?: (next: GameState) => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ user, onUpdateProfile, onUpdateGameState }) => {
  const [username, setUsername] = useState(user.username);
  const [polygonWallet, setPolygonWallet] = useState(user.polygonWallet || '');
  const [seasonPasses, setSeasonPasses] = useState<SeasonPass[]>([]);
  const [seasonPurchases, setSeasonPurchases] = useState<SeasonPurchase[]>([]);
  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [invitedCount, setInvitedCount] = useState(0);
  const [referralInviteUrl, setReferralInviteUrl] = useState('');
  const [profileBadges, setProfileBadges] = useState<ProfileApiState['badges']>([]);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [referralClaimLoading, setReferralClaimLoading] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const identityLock = useRef(false);
  const passwordLock = useRef(false);
  const walletLock = useRef(false);

  // Password Change State
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');



  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [newsText, setNewsText] = useState('');
  const [newsLink, setNewsLink] = useState('');
  const [newsFee, setNewsFeeState] = useState<number>(0);
  const [usdcBal, setUsdcBal] = useState<number>(0);

  useEffect(() => {
    setPolygonWallet(user.polygonWallet || '');
  }, [user.polygonWallet]);

  useEffect(() => {
    setUsername(user.username);
  }, [user.username]);

  const refreshSessionUser = async () => {
    const fresh = await getSession();
    if (fresh) await onUpdateProfile(fresh, { skipApi: true });
  };

  const reloadProfileState = async () => {
    const st = await getProfileState();
    if (st?.bundle) {
      setSeasonPasses(st.bundle.seasonPasses);
      setSeasonPurchases(st.bundle.seasonPurchases);
      setAccessLevels(st.bundle.accessLevels);
      setNewsFeeState(st.bundle.newsFee);
      setUsdcBal(st.bundle.profileGame.usdc);
    }
    if (st) {
      setInvitedCount(st.referral.invitedCount);
      setReferralInviteUrl(st.referral.inviteUrl || '');
      setProfileBadges(Array.isArray(st.badges) ? st.badges : []);
      setPolygonWallet(st.wallet.address || '');
    }
  };

  const handleConnectWallet = async () => {
    if (walletLock.current || walletBusy) return;
    walletLock.current = true;
    setWalletBusy(true);
    try {
      const eth = (window as any).ethereum;
      if (!eth) {
        setMessage({ type: 'error', text: 'Instale uma carteira compatível (ex: MetaMask).' });
        return;
      }
      const ch = await postProfileWalletChallenge();
      if (!ch.ok || !ch.message || !ch.challengeId) {
        setMessage({ type: 'error', text: ch.error || 'Não foi possível iniciar a ligação da carteira.' });
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
              await eth.request({
                method: 'wallet_addEthereumChain',
                params: [
                  {
                    chainId: '0x89',
                    chainName: 'Polygon Mainnet',
                    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
                    rpcUrls: ['https://polygon-rpc.com'],
                    blockExplorerUrls: ['https://polygonscan.com']
                  }
                ]
              });
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* ignore */
      }
      const msgHex = utf8MessageToHex(ch.message);
      let signature: string;
      try {
        signature = await eth.request({
          method: 'personal_sign',
          params: [msgHex, addr]
        });
      } catch {
        setMessage({ type: 'error', text: 'Assinatura cancelada ou falhou.' });
        return;
      }
      const verify = await postProfileWalletVerify({
        challengeId: ch.challengeId,
        address: addr,
        signature,
        chainId: ch.chainId ?? 137
      });
      if (!verify.ok) {
        if (verify.code === 'CHALLENGE_EXPIRED' || verify.code === 'NONCE_USED') {
          await reloadProfileState();
        }
        setMessage({ type: 'error', text: verify.error || 'Verificação da carteira falhou.' });
        return;
      }
      await refreshSessionUser();
      await reloadProfileState();
      setMessage({ type: 'success', text: 'Carteira verificada e guardada no perfil.' });
    } catch {
      setMessage({ type: 'error', text: 'Autenticação cancelada ou falhou.' });
    } finally {
      setWalletBusy(false);
      walletLock.current = false;
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
    let pwd: string | undefined;
    let cleared = await clearMyPolygonWallet();
    if (!cleared.ok && cleared.code === 'PASSWORD_CURRENT_WRONG') {
      pwd = window.prompt('Introduza a palavra-passe atual para remover a carteira:') || '';
      cleared = await clearMyPolygonWallet(pwd);
    }
    if (!cleared.ok) {
      setMessage({
        type: 'error',
        text: cleared.error || 'Não foi possível remover a carteira. Tente novamente.'
      });
      return;
    }
    setPolygonWallet('');
    await refreshSessionUser();
    await reloadProfileState();
    setMessage({ type: 'success', text: 'Carteira removida do perfil.' });
  };

  const handleUpdateBasicInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (identityLock.current || identitySaving) return;
    const u = username.trim();
    if (!u) {
      setMessage({ type: 'error', text: 'Nome de usuário não pode estar vazio.' });
      return;
    }
    if (u.length < AUTH_USERNAME_MIN || u.length > AUTH_USERNAME_MAX) {
      setMessage({
        type: 'error',
        text: `O nome de utilizador deve ter entre ${AUTH_USERNAME_MIN} e ${AUTH_USERNAME_MAX} caracteres.`
      });
      return;
    }
    identityLock.current = true;
    setIdentitySaving(true);
    try {
      const out = await patchProfileIdentity(u);
      if (!out.ok) {
        await reloadProfileState();
        setMessage({ type: 'error', text: out.error || 'Falha ao atualizar o perfil.' });
        return;
      }
      await refreshSessionUser();
      await reloadProfileState();
      setMessage({ type: 'success', text: 'Informações básicas atualizadas.' });
    } finally {
      setIdentitySaving(false);
      identityLock.current = false;
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordLock.current || passwordSaving) return;
    if (!newPass.length) {
      setMessage({ type: 'error', text: 'Indique a nova palavra-passe.' });
      return;
    }
    if (newPass.length > AUTH_PASSWORD_MAX) {
      setMessage({ type: 'error', text: `A nova senha pode ter no máximo ${AUTH_PASSWORD_MAX} caracteres.` });
      return;
    }
    if (newPass !== confirmPass) {
      setMessage({ type: 'error', text: 'As novas senhas não coincidem.' });
      return;
    }
    passwordLock.current = true;
    setPasswordSaving(true);
    try {
      const out = await postProfilePasswordChange({
        currentPassword: currentPass,
        newPassword: newPass,
        confirmPassword: confirmPass
      });
      if (!out.ok) {
        if (out.code === 'PASSWORD_CURRENT_WRONG' || out.code === 'PASSWORD_WEAK') {
          await reloadProfileState();
        }
        setMessage({ type: 'error', text: out.error || 'Falha ao alterar a palavra-passe.' });
        return;
      }
      await refreshSessionUser();
      await reloadProfileState();
      setMessage({ type: 'success', text: out.message || 'Senha alterada com sucesso.' });
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
    } finally {
      setPasswordSaving(false);
      passwordLock.current = false;
    }
  };



  const copyReferralLink = () => {
    const link =
      referralInviteUrl.trim() ||
      (user.referralCode ? `${window.location.origin}?ref=${encodeURIComponent(user.referralCode)}` : '');
    if (!link) return;
    void navigator.clipboard.writeText(link);
    alert('Link de indicação copiado!');
  };
  useEffect(() => {
    const load = async () => {
      const st = await getProfileState();
      if (st?.bundle) {
        setSeasonPasses(st.bundle.seasonPasses);
        setSeasonPurchases(st.bundle.seasonPurchases);
        setAccessLevels(st.bundle.accessLevels);
        setNewsFeeState(st.bundle.newsFee);
        setUsdcBal(st.bundle.profileGame.usdc);
        setInvitedCount(st.referral.invitedCount);
        setReferralInviteUrl(st.referral.inviteUrl || '');
        setProfileBadges(Array.isArray(st.badges) ? st.badges : []);
        setPolygonWallet(st.wallet.address || '');
        return;
      }
      const bundle = await getProfilePageBundle();
      if (bundle) {
        setSeasonPasses(bundle.seasonPasses);
        setSeasonPurchases(bundle.seasonPurchases);
        setAccessLevels(bundle.accessLevels);
        setInvitedCount(Array.isArray(bundle.referrals) ? bundle.referrals.length : 0);
        setReferralInviteUrl(
          user.referralCode ? `${window.location.origin}?ref=${encodeURIComponent(user.referralCode)}` : ''
        );
        setProfileBadges([]);
        setNewsFeeState(bundle.newsFee);
        setUsdcBal(bundle.profileGame.usdc);
        return;
      }
      const [passes, purchases, levels] = await Promise.all([
        getSeasonPasses(),
        getSeasonPurchases(user.email),
        getAccessLevels()
      ]);
      setSeasonPasses(passes);
      setSeasonPurchases(purchases);
      setAccessLevels(levels);
      setInvitedCount(0);
      setReferralInviteUrl(
        user.referralCode ? `${window.location.origin}?ref=${encodeURIComponent(user.referralCode)}` : ''
      );
      setProfileBadges([]);
      const fee = await getNewsFee();
      setNewsFeeState(fee);
      const gsRes = await getGameState(user.email);
      const gs = gsRes.data;
      setUsdcBal(gs?.usdc || 0);
    };
    void load();
  }, [user.email, user.username, user.referralCode]);

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
              <button
                type="submit"
                disabled={identitySaving}
                className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={16} /> {identitySaving ? 'A gravar…' : 'Salvar alterações'}
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
                    {referralInviteUrl.trim() || (user.referralCode ? `?ref=${user.referralCode}` : 'Código não gerado')}
                  </div>
                  <button
                    type="button"
                    onClick={copyReferralLink}
                    disabled={!referralInviteUrl.trim() && !user.referralCode}
                    className="bg-amber-600 hover:bg-amber-500 text-white p-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Copiar Link"
                  >
                    <Copy size={18} />
                  </button>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-950 rounded-lg p-3 border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase">Operadores convidados</span>
                  <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{invitedCount}</span>
                </div>

                <div className="text-xs text-slate-400 italic">
                  {invitedCount > 0 ? (
                    <>
                      Total de <span className="font-semibold text-amber-700 dark:text-amber-400">{invitedCount}</span>{' '}
                      operador(es) na sua rede de indicações. A comissão é creditada pelo servidor quando há depósito
                      USDC elegível do indicado.
                    </>
                  ) : (
                    <>
                      Nenhum indicado ainda. Quando um indicado depositar USDC na conta dele, você recebe automaticamente{' '}
                      <span className="font-semibold text-amber-700 dark:text-amber-400">5%</span> do valor creditado em
                      USDC no seu saldo.
                    </>
                  )}
                </div>
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
                      type="button"
                      onClick={async () => {
                        if (!referralCodeInput.trim() || referralClaimLoading) return;
                        setReferralClaimLoading(true);
                        const res = await claimReferralCode(user.email, referralCodeInput.trim());
                        setReferralClaimLoading(false);
                        if (res && res.ok) {
                          setReferralCodeInput('');
                          await refreshSessionUser();
                          await reloadProfileState();
                          alert(
                            'Código vinculado com sucesso. A comissão em USDC é calculada e creditada pelo servidor quando houver depósito elegível do indicado.'
                          );
                        } else {
                          await reloadProfileState();
                          alert(
                            res?.error ||
                              'Falha ao vincular código. Os dados da conta podem ter sido atualizados — verifique e tente novamente.'
                          );
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
            {profileBadges.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">Nenhum emblema adquirido.</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {profileBadges.map((b, idx) => (
                  <div key={`${b.passId}-${idx}`} className="flex flex-col items-center gap-2">
                    {b.imageUrl ? (
                      <img
                        src={b.imageUrl}
                        alt={b.name}
                        className="w-16 h-16 object-cover rounded border border-slate-200 dark:border-slate-700"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400">
                        🏅
                      </div>
                    )}
                    <div className="text-[10px] text-slate-600 dark:text-slate-400 text-center truncate w-16">{b.name}</div>
                  </div>
                ))}
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
              <button
                type="submit"
                disabled={passwordSaving}
                className="bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={16} /> {passwordSaving ? 'A atualizar…' : 'ATUALIZAR SENHA'}
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
              <button
                type="button"
                onClick={handleConnectWallet}
                disabled={!!polygonWallet || walletBusy}
                className="bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50 border border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-400 text-xs font-bold px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {walletBusy ? 'A ligar…' : 'Conectar carteira do navegador'}
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
              Ligação segura na Polygon (assinatura no navegador). O servidor valida o desafio e nunca pede seed phrase.
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
