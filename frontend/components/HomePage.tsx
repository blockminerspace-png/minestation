import React from 'react';
import { Cpu, TrendingUp, ShieldCheck, Zap, ArrowRight, Server, Box, Gift, Lock, Info, Rocket, Crown, CheckCircle2 } from 'lucide-react';

interface HomePageProps {
    onNavigate: (view: 'auth' | 'docs') => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
    return (
        <div className="flex flex-col min-h-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 animate-in fade-in duration-500 transition-colors">

            {/* Hero Section */}
            <div className="relative overflow-hidden py-20 lg:py-32">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 dark:opacity-20 pointer-events-none"></div>
                <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>

                <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-100 dark:bg-cyan-900/30 border border-cyan-200 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 text-xs font-bold uppercase tracking-widest mb-6">
                        <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
                        Protocolo Ativo v1.4
                    </div>

                    <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight text-slate-900 dark:text-white">
                        DOMINE A ECONOMIA <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-purple-600 dark:from-cyan-400 dark:to-purple-500">DIGITAL DE MINERAÇÃO</span>
                    </h1>

                    <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
                        Genesis Miner é um <strong>Simulador de Mineração Web3</strong>. Construa seu império, gerencie energia realista e prepare-se para o lançamento da tokenomics na rede Polygon.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            onClick={() => onNavigate('auth')}
                            className="group bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-4 px-8 rounded-lg shadow-[0_0_20px_rgba(8,145,178,0.3)] transition-all active:scale-95 flex items-center gap-2"
                        >
                            INICIAR OPERAÇÃO <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                        <button
                            onClick={() => onNavigate('docs')}
                            className="bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold py-4 px-8 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 transition-all shadow-sm"
                        >
                            LER DOCUMENTAÇÃO
                        </button>
                    </div>
                </div>
            </div>

            {/* Features Grid */}
            <div className="bg-slate-100 dark:bg-slate-900/50 py-20 border-y border-slate-200 dark:border-slate-800">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div className="bg-white dark:bg-slate-950 p-8 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-cyan-500/30 transition-colors group shadow-sm">
                            <div className="w-14 h-14 bg-slate-50 dark:bg-slate-900 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <Server className="text-cyan-600 dark:text-cyan-400" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Infraestrutura Realista</h3>
                            <p className="text-slate-600 dark:text-slate-400">Monte racks, gerencie cabos, instale baterias e lide com o consumo elétrico real das suas máquinas.</p>
                        </div>

                        <div className="bg-white dark:bg-slate-950 p-8 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-purple-500/30 transition-colors group shadow-sm">
                            <div className="w-14 h-14 bg-slate-50 dark:bg-slate-900 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <Zap className="text-purple-600 dark:text-purple-400" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Otimização via IA</h3>
                            <p className="text-slate-600 dark:text-slate-400">Utilize chips de inteligência artificial para multiplicar a eficiência dos seus servidores em até 20%.</p>
                        </div>

                        <div className="bg-white dark:bg-slate-950 p-8 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-green-500/30 transition-colors group shadow-sm">
                            <div className="w-14 h-14 bg-slate-50 dark:bg-slate-900 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <TrendingUp className="text-green-600 dark:text-green-400" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Economia Viva</h3>
                            <p className="text-slate-600 dark:text-slate-400">Acompanhe notícias geradas por IA que afetam o mercado e venda seus ativos na hora certa.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* INFO SECTION: SIMULATOR & LIQUIDITY */}
            <div className="py-20 bg-white dark:bg-slate-950 relative overflow-hidden">
                <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

                    {/* Simulator Info */}
                    <div className="space-y-6">
                        <div className="inline-flex items-center gap-2 text-cyan-600 dark:text-cyan-500 font-bold uppercase tracking-widest text-sm">
                            <Info size={16} /> Sobre a Aplicação
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">Simulação de Alta Fidelidade</h2>
                        <div className="space-y-4 text-slate-600 dark:text-slate-400 leading-relaxed">
                            <p>
                                Esta aplicação é um <strong>Jogo Simulador</strong> (Idle Tycoon) projetado para replicar as dificuldades e recompensas da mineração de criptoativos em um ambiente gamificado.
                            </p>
                            <p>
                                Diferente de protocolos DeFi tradicionais, aqui você não apenas "aposta" tokens. Você deve gerenciar <strong>Hardware, Eletricidade, Calor e Espaço</strong>. O sucesso depende da sua capacidade de escalar sua infraestrutura de forma eficiente.
                            </p>
                        </div>
                    </div>

                    {/* Parity & Liquidity Info */}
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 relative shadow-lg">
                        <div className="absolute top-0 right-0 p-4 opacity-10 dark:opacity-20">
                            <Lock size={64} className="text-green-500" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                            <ShieldCheck className="text-green-600 dark:text-green-500" /> Paridade & Liquidez
                        </h3>
                        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
                            <p>
                                Para garantir a sustentabilidade econômica durante a fase Beta, o jogo opera com uma <strong>Paridade Interna Fixa</strong>.
                            </p>
                            <div className="bg-white dark:bg-slate-950 p-4 rounded-lg border border-green-500/30 text-center shadow-inner">
                                <span className="text-xs uppercase text-slate-500">Paridade Interna</span>
                                <div className="text-2xl font-mono font-bold text-slate-800 dark:text-white my-1">
                                    Ativos de referência: <span className="text-green-600 dark:text-green-400"><br />POL • WETH • WBTC</span>
                                </div>
                            </div>
                            <p>
                                Podendo <strong>Sofrer alterações</strong> para garantir a sustentabilidade a <strong>longo prazo</strong> do projeto.
                            </p>
                        </div>
                    </div>

                </div>
            </div>

            {/* LAUNCH REWARDS SECTION */}
            <div className="py-20 bg-gradient-to-b from-slate-100 to-white dark:from-slate-900 dark:to-slate-950 border-t border-slate-200 dark:border-slate-800">
                <div className="max-w-5xl mx-auto px-6 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-500/30 text-yellow-700 dark:text-yellow-400 text-xs font-bold uppercase tracking-widest mb-6 animate-bounce">
                        <Rocket size={14} /> Evento de Lançamento (Gênesis)
                    </div>
                    <h2 className="text-3xl md:text-5xl font-black text-slate-900 dark:text-white mb-12">RECOMPENSAS PIONEIRAS</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">

                        {/* FREE TIER */}
                        <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 hover:border-cyan-500/50 transition-all relative overflow-hidden group shadow-lg">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all"></div>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Passe de temporada Náutilos</h3>
                            <p className="text-slate-500 text-sm mb-6 uppercase tracking-wider">Acelere sua jornada de mineração</p>

                            <div className="space-y-3">
                                <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                                    <Gift className="text-yellow-500 shrink-0" size={16} /> <strong>Caixa Náutilos</strong>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">

                                </div>

                                <div className="my-4 border-t border-slate-200 dark:border-slate-700/50"></div>
                                <div className="text-xs font-bold text-slate-500 uppercase mb-2">Hardware Incluso na Caixa Náutilos:</div>

                                <div className="grid grid-cols-1 gap-2">
                                    <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                        <CheckCircle2 size={14} className="text-green-500" />
                                        <span>2x Rig <strong className="text-slate-900 dark:text-white">A 6.3</strong></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                        <CheckCircle2 size={14} className="text-green-500" />
                                        <span>2x Fiação Básica <strong className="text-slate-900 dark:text-white"></strong></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                        <CheckCircle2 size={14} className="text-green-500" />
                                        <span>4x Baterias <strong className="text-slate-900 dark:text-white">'Baterias de carros elétricos reutilizadas'</strong></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                        <CheckCircle2 size={14} className="text-green-500" />
                                        <span>4x GPUs <strong className="text-slate-900 dark:text-white">'Mobdiq'</strong></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                        <CheckCircle2 size={14} className="text-green-500" />
                                        <span>1x GPU <strong className="text-slate-900 dark:text-white">'Game Shark'</strong> Exclusiva</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* FOUNDER TIER */}
                        <div className="bg-gradient-to-br from-slate-50 to-purple-50 dark:from-slate-900 dark:to-purple-950/30 border border-yellow-500/30 rounded-2xl p-8 hover:border-yellow-500 transition-all relative overflow-hidden shadow-2xl">
                            <div className="absolute top-0 right-0 p-4">
                                <Crown className="text-yellow-500" size={32} />
                            </div>
                            <h3 className="text-2xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 to-yellow-700 dark:from-yellow-200 dark:to-yellow-600">Pacote Full Baleia</h3>
                            <p className="text-yellow-600 dark:text-yellow-500/70 text-sm mb-6 uppercase tracking-wider">Potencia acima de tudo</p>
                            <br />
                            <div className="my-4 border-t border-slate-200 dark:border-slate-700/50"></div>
                            <div className="text-xs font-bold text-slate-500 uppercase mb-2">Hardware Incluso:</div>

                            <div className="grid grid-cols-1 gap-2">
                                <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                    <CheckCircle2 size={14} className="text-green-500" />
                                    <span>33 Rig <strong className="text-slate-900 dark:text-white">A 6.3</strong></span>
                                </div>
                                <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                    <CheckCircle2 size={14} className="text-green-500" />
                                    <span>33 Fiação Avançados <strong className="text-slate-900 dark:text-white"></strong></span>
                                </div>
                                <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                    <CheckCircle2 size={14} className="text-green-500" />
                                    <span>33 Baterias <strong className="text-slate-900 dark:text-white">'Baterias de carros elétricos reutilizadas'</strong></span>
                                </div>
                                <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                    <CheckCircle2 size={14} className="text-green-500" />
                                    <span>198 GPUs <strong className="text-slate-900 dark:text-white">'Gamer Bee'</strong></span>
                                </div>
                                <div className="flex items-center gap-2 text-xs bg-white dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                    <CheckCircle2 size={14} className="text-green-500" />
                                    <span>1x GPU <strong className="text-slate-900 dark:text-white">'Singularidade Digital'</strong> Exclusiva</span>
                                </div>
                            </div>
                        </div>


                    </div>

                </div>
            </div>
        </div>


    );
};
