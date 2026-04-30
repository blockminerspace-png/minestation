

import React, { useState, useEffect } from 'react';
import { AccessLevel, User } from '../types';
import { getUsers, updateUser, login, requestPasswordReset, resetPasswordSecure } from '../services/api';
import { Lock, Mail, User as UserIcon, ArrowRight, AlertCircle, CreditCard, Wallet, Share2, ShieldCheck, Key } from 'lucide-react';

interface AuthPageProps {
    onLogin: (user: User) => void;
    accessLevels?: AccessLevel[];
}

export const AuthPage: React.FC<AuthPageProps> = ({ onLogin, accessLevels = [] }) => {
    const [activeTab, setActiveTab] = useState<'login' | 'register' | 'special' | 'recovery'>('login');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [referralInput, setReferralInput] = useState('');

    const [error, setError] = useState<string | null>(null);

    // Web3 & Selection State
    const [selectedLevelId, setSelectedLevelId] = useState<string>('');
    const [isWeb3Processing, setIsWeb3Processing] = useState(false);

    // Recovery State (link por email; token na URL /redefinir-senha?token=)
    const [recoveryStep, setRecoveryStep] = useState<'email' | 'sent' | 'reset'>('email');
    const [recoveryToken, setRecoveryToken] = useState<string>('');

    // IP Restriction Modal State
    const [showIpLimitModal, setShowIpLimitModal] = useState(false);
    const [existingAccounts, setExistingAccounts] = useState<any[]>([]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const path = (window.location.pathname || '').toLowerCase();
        const token = params.get('token');
        if (token && path.includes('redefinir-senha')) {
            try {
                setRecoveryToken(decodeURIComponent(token));
            } catch {
                setRecoveryToken(token);
            }
            setActiveTab('recovery');
            setRecoveryStep('reset');
            setError(null);
            return;
        }
        const ref = params.get('ref');
        if (ref) {
            setReferralInput(ref);
            setActiveTab('register');
        }
    }, []);

    const resetForm = () => {
        setEmail(''); setPassword(''); setUsername(''); setConfirmPassword(''); setError(null);
        setRecoveryStep('email'); setRecoveryToken('');
    }

    const handleRequestPasswordResetEmail = async () => {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setError('Indique um email válido.');
            return;
        }
        setError(null);
        setIsWeb3Processing(true);
        const res = await requestPasswordReset(email.trim());
        setIsWeb3Processing(false);
        if (res.ok) {
            setRecoveryStep('sent');
        } else {
            setError(res.error || 'Não foi possível enviar o email.');
        }
    };

    const handleRecoveryReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 4) {
            setError("Senha muito curta.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Senhas não coincidem.");
            return;
        }

        setIsWeb3Processing(true);
        const res = await resetPasswordSecure(recoveryToken, password);
        setIsWeb3Processing(false);

        if (res.ok) {
            try {
                window.history.replaceState({}, '', '/');
            } catch { /* ignore */ }
            alert('Senha redefinida com sucesso! Faça login agora.');
            setActiveTab('login');
            resetForm();
        } else {
            setError(res.error || 'Falha ao redefinir senha.');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (activeTab === 'register' || activeTab === 'special') {
            // 1. VALIDATION
            if (!email || !password || !username) {
                setError("Todos os campos são obrigatórios.");
                return;
            }
            if (password !== confirmPassword) {
                setError("As senhas não coincidem.");
                return;
            }

            // 2. DETERMINE ACCESS LEVEL & PAYMENT
            let accessLevelId = 'normal';

            if (activeTab === 'register') {
                const defaultLevel = accessLevels.find(l => l.isDefault);
                accessLevelId = defaultLevel ? defaultLevel.id : 'normal';
            }
            else if (activeTab === 'special') {
                if (!selectedLevelId) {
                    setError("Selecione um plano.");
                    return;
                }

                const level = accessLevels.find(l => l.id === selectedLevelId);
                if (!level) return;

                // --- WEB3 PAYMENT SIMULATION ---
                setIsWeb3Processing(true);

                // Simulate Network Delay
                await new Promise(resolve => setTimeout(resolve, 2000));

                const confirmed = window.confirm(
                    `METAMASK (SIMULATION)\n\n` +
                    `Rede: Polygon Mainnet\n` +
                    `Contrato: ${level.contractAddress || '0x...'}\n` +
                    `Valor: ${level.priceUsdc} USDC\n\n` +
                    `Aprovar transação para acesso '${level.name}'?`
                );

                setIsWeb3Processing(false);

                if (!confirmed) {
                    setError("Pagamento rejeitado. O cadastro não foi concluído.");
                    return;
                }

                accessLevelId = selectedLevelId;
            }

            // 3. GENERATE REFERRAL CODE
            const newReferralCode = `${username.toLowerCase().replace(/\s/g, '')}-${crypto.randomUUID().slice(0, 4)}`;

            // 5. CREATE USER
            const newUser: User = {
                email,
                password,
                username,
                isBlocked: false,
                accessLevelId,
                referralCode: newReferralCode,
                referredBy: referralInput || undefined, // Send raw input, let server validate
                referrals: []
            };

            const result = await updateUser({ ...newUser, newReferralFor: username });

            if (!result.ok) {
                if (result.code === 'IP_LIMIT_REACHED') {
                    setExistingAccounts(result.accounts || []);
                    setShowIpLimitModal(true);
                } else {
                    setError(result.error || "Falha ao processar cadastro.");
                }
                return;
            }

            // Auto login
            const logged = await login(email, password);
            onLogin({ ...(logged || newUser), isNewRegistration: true } as User);

        } else {
            // LOGIN LOGIC
            const sessionUser = await login(email, password);
            if (sessionUser && !sessionUser.error) {
                if (sessionUser.isBlocked) {
                    setError("Esta conta foi bloqueada pela administração.");
                    return;
                }

                // Check if Access Level is Active
                const level = accessLevels.find(l => l.id === sessionUser.accessLevelId);
                if (level && !level.isActive) {
                    setError(level.inactiveMessage || `O nível de acesso '${level.name}' está temporariamente desativado para login.`);
                    return;
                }

                onLogin(sessionUser);
            } else {
                setError(sessionUser?.error || "Credenciais inválidas.");
            }
        }
    };

    const paidLevels = accessLevels.filter(l => l.priceUsdc && l.priceUsdc > 0 && l.isActive);
    const selectedLevel = accessLevels.find(l => l.id === selectedLevelId);

    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 animate-in fade-in zoom-in-95 duration-300">

            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden relative transition-colors">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-600"></div>

                <div className="p-8">
                    <div className="text-center mb-8">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            {activeTab === 'register' ? 'Criar conta' : activeTab === 'special' ? 'Planos premium' : activeTab === 'recovery' ? 'Recuperar senha' : 'Entrar'}
                        </h2>
                        <p className="text-slate-500 text-sm">
                            {activeTab === 'register' ? 'Abra a sua conta e comece a montar a operação na Polygon.' : activeTab === 'special' ? 'Desbloqueie níveis pagos com USDC na simulação Web3.' : activeTab === 'recovery' ? 'Receba um link seguro no email para criar uma nova senha.' : 'Use email e senha para voltar ao painel.'}
                        </p>
                    </div>

                    {/* TABS (Hidden in recovery mode to focus) */}
                    {activeTab !== 'recovery' && (
                        <div className="flex mb-6 bg-slate-100 dark:bg-slate-950 p-1 rounded-lg">
                            <button onClick={() => { setActiveTab('login'); resetForm(); }} className={`flex-1 py-2 text-xs font-bold uppercase rounded ${activeTab === 'login' ? 'bg-white dark:bg-slate-800 shadow text-amber-600' : 'text-slate-500'}`}>Login</button>
                            <button onClick={() => { setActiveTab('register'); resetForm(); }} className={`flex-1 py-2 text-xs font-bold uppercase rounded ${activeTab === 'register' ? 'bg-white dark:bg-slate-800 shadow text-amber-600' : 'text-slate-500'}`}>Cadastro</button>
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 p-3 rounded-lg mb-6 flex items-center gap-2 text-sm">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    {/* RECOVERY MODE */}
                    {activeTab === 'recovery' && (
                        <div className="space-y-6">
                            {recoveryStep === 'email' && (
                                <div className="space-y-4 font-normal">
                                    <div className="flex justify-center mb-2">
                                        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400">
                                            <ShieldCheck size={32} />
                                        </div>
                                    </div>
                                    <p className="text-center text-xs text-slate-500 mb-4">
                                        Indique o email da sua conta. Se existir registo, enviaremos um link para redefinir a senha (verifique spam).
                                    </p>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email cadastrado</label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type="email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white outline-none"
                                                placeholder="usuario@exemplo.com"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleRequestPasswordResetEmail}
                                        disabled={isWeb3Processing}
                                        className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-60"
                                    >
                                        {isWeb3Processing ? 'A ENVIAR...' : 'ENVIAR LINK POR EMAIL'} <Mail size={16} />
                                    </button>
                                    <button type="button" onClick={() => setActiveTab('login')} className="w-full text-center text-xs text-slate-500 hover:text-amber-500 mt-2">
                                        Voltar para login
                                    </button>
                                </div>
                            )}

                            {recoveryStep === 'sent' && (
                                <div className="space-y-4 text-center">
                                    <div className="flex justify-center mb-2">
                                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center text-green-600">
                                            <Mail size={32} />
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-300">
                                        Se existir uma conta com <strong className="text-slate-900 dark:text-white">{email}</strong>, acabámos de enviar um email com o link para redefinir a senha.
                                    </p>
                                    <p className="text-xs text-slate-500">O link expira em cerca de 1 hora.</p>
                                    <button
                                        type="button"
                                        onClick={() => { setActiveTab('login'); resetForm(); }}
                                        className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-lg"
                                    >
                                        Voltar para login
                                    </button>
                                </div>
                            )}

                            {recoveryStep === 'reset' && (
                                <form onSubmit={handleRecoveryReset} className="space-y-4">
                                    <div className="text-center mb-4">
                                        <div className="inline-flex items-center gap-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-xs font-bold">
                                            <ShieldCheck size={14} /> LINK VÁLIDO
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Nova Senha</label>
                                        <div className="relative">
                                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white outline-none"
                                                placeholder="••••••••"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Confirmar Senha</label>
                                        <div className="relative">
                                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white outline-none"
                                                placeholder="••••••••"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={isWeb3Processing}
                                        className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2"
                                    >
                                        {isWeb3Processing ? 'SALVANDO...' : 'REDEFINIR SENHA'}
                                    </button>
                                </form>
                            )}
                        </div>
                    )}

                    {/* SPECIAL: PLAN SELECTION */}
                    {activeTab === 'special' && !selectedLevelId && (
                        <div className="space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-950/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
                                <h4 className="font-bold text-slate-800 dark:text-white mb-3 text-sm flex items-center gap-2">
                                    <Wallet size={16} className="text-orange-500" /> Escolha seu Plano
                                </h4>
                                <div className="space-y-2">
                                    {paidLevels.map(level => (
                                        <div
                                            key={level.id}
                                            onClick={() => setSelectedLevelId(level.id)}
                                            className={`p-3 rounded border cursor-pointer transition-all bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-orange-500/50 hover:shadow-md`}
                                        >
                                            <div className="flex justify-between items-center">
                                                <span className="font-bold text-slate-700 dark:text-slate-200 text-sm">{level.name}</span>
                                                <span className="font-mono text-green-600 dark:text-green-400 font-bold">${level.priceUsdc} USDC</span>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1">{level.description}</p>
                                        </div>
                                    ))}
                                    {paidLevels.length === 0 && <p className="text-xs text-slate-500 italic text-center">Nenhum plano especial disponível no momento.</p>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* FORM (Login, Register, or Special Selected) */}
                    {(activeTab === 'login' || activeTab === 'register' || (activeTab === 'special' && selectedLevelId)) && (
                        <form onSubmit={handleSubmit} className="space-y-4 animate-in fade-in">

                            {/* Selected Plan Header */}
                            {activeTab === 'special' && selectedLevel && (
                                <div className="bg-orange-100 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 p-3 rounded-lg flex justify-between items-center mb-4">
                                    <div>
                                        <div className="text-xs text-orange-600 dark:text-orange-400 font-bold uppercase">Plano Selecionado</div>
                                        <div className="font-bold text-slate-800 dark:text-white">{selectedLevel.name} <span className="font-mono text-green-600 dark:text-green-400">(${selectedLevel.priceUsdc})</span></div>
                                    </div>
                                    <button type="button" onClick={() => setSelectedLevelId('')} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white underline">
                                        Alterar
                                    </button>
                                </div>
                            )}

                            {activeTab !== 'login' && (
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Nome de Usuário</label>
                                    <div className="relative">
                                        <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                            placeholder="Minerador_X"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                        placeholder="usuario@exemplo.com"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Senha</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                        placeholder="••••••••"
                                    />
                                </div>
                                {activeTab === 'login' && (
                                    <button
                                        type="button"
                                        onClick={() => { setActiveTab('recovery'); resetForm(); }}
                                        className="text-[10px] text-slate-500 hover:text-amber-500 block text-right mt-1"
                                    >
                                        Esqueceu a senha?
                                    </button>
                                )}
                            </div>

                            {activeTab !== 'login' && (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Confirmar Senha</label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                                placeholder="••••••••"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Código de Indicação (Opcional)</label>
                                        <div className="relative">
                                            <Share2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type="text"
                                                value={referralInput}
                                                onChange={(e) => setReferralInput(e.target.value)}
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                                placeholder="código-de-amigo"
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            <button
                                type="submit"
                                disabled={isWeb3Processing}
                                className={`w-full font-bold py-3 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 mt-6 ${activeTab === 'special' ? 'bg-orange-600 hover:bg-orange-500 text-white' : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white'}`}
                            >
                                {isWeb3Processing ? (
                                    <span className="animate-pulse">PROCESSANDO...</span>
                                ) : (
                                    <>
                                        {activeTab === 'login' && 'ENTRAR'}
                                        {activeTab === 'register' && 'FINALIZAR CADASTRO'}
                                        {activeTab === 'special' && (
                                            <>PAGAR E FINALIZAR <CreditCard size={18} /></>
                                        )}
                                        {activeTab !== 'special' && <ArrowRight size={18} />}
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>

                {/* IP LIMIT MODAL */}
                {showIpLimitModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-300">
                            <div className="flex justify-center mb-4">
                                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center text-red-600">
                                    <AlertCircle size={32} />
                                </div>
                            </div>
                            <h3 className="text-xl font-bold text-center text-slate-900 dark:text-white mb-2">Limite de Contas Atingido</h3>
                            <p className="text-center text-sm text-slate-500 mb-6 font-normal">
                                Você já possui o limite máximo de 3 contas vinculadas a este endereço de IP:
                            </p>
                            <div className="bg-slate-50 dark:bg-slate-950 rounded-lg p-3 mb-6 space-y-2 border border-slate-100 dark:border-slate-800">
                                {existingAccounts.map((acc, i) => (
                                    <div key={i} className="flex flex-col border-b border-slate-200 dark:border-slate-800 last:border-0 pb-2 last:pb-0">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{acc.username}</span>
                                        <span className="text-[10px] text-slate-500">{acc.email}</span>
                                    </div>
                                ))}
                            </div>
                            <button
                                onClick={() => setShowIpLimitModal(false)}
                                className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-lg transition-colors"
                            >
                                ENTENDI
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

