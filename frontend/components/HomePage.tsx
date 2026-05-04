import React from 'react';
import { Cpu, TrendingUp, ShieldCheck, Zap, ArrowRight, Server, Box, Gift, Lock, Info, Rocket, Crown, CheckCircle2 } from 'lucide-react';

interface HomePageProps {
    onNavigate: (view: 'auth' | 'docs') => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
    return (
        <div className="flex flex-col min-h-full bg-slate-50 dark:bg-[#120e09] text-slate-800 dark:text-slate-200 animate-in fade-in duration-500 transition-colors">

            {/* Hero — ouro / âmbar Genesis DAO */}
            <div className="relative overflow-hidden py-20 lg:py-32 bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-[#120e09] dark:via-[#1c140c] dark:to-[#0a0805]">
                {/* Textura local (evita pedido HTTP a terceiros no caminho crítico / LCP) */}
                <div
                    className="absolute inset-0 opacity-[0.07] dark:opacity-[0.12] pointer-events-none"
                    style={{
                        backgroundImage:
                            'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px)'
                    }}
                    aria-hidden
                />
                <div className="absolute top-1/4 left-0 w-1 h-48 md:h-64 bg-gradient-to-b from-amber-400 via-amber-500 to-orange-600 rounded-r-full opacity-90 hidden sm:block" aria-hidden />
                <div className="absolute top-0 right-0 -mr-24 -mt-24 w-[28rem] h-[28rem] bg-amber-500/[0.12] dark:bg-amber-400/15 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 -ml-24 -mb-24 w-[28rem] h-[28rem] bg-orange-600/[0.1] dark:bg-orange-500/15 rounded-full blur-3xl" />

                <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 dark:bg-amber-500/15 border border-amber-400/40 dark:border-amber-400/30 text-amber-700 dark:text-amber-300 text-[11px] font-black uppercase tracking-[0.2em] mb-8 shadow-[0_0_24px_rgba(251,191,36,0.2)]">
                        <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_10px_#fbbf24] animate-pulse" />
                        Ecossistema online V0.5 · Genesis DAO
                    </div>

                    <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight text-slate-900 dark:text-white leading-[1.05]">
                        OPERE COM ESTRATÉGIA <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-500 dark:from-amber-200 dark:via-amber-300 dark:to-orange-400 drop-shadow-[0_0_40px_rgba(251,191,36,0.35)]">A MINERAÇÃO DIGITAL</span>
                    </h1>

                    <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
                        No <strong className="text-amber-700 dark:text-amber-300">Genesis Miner</strong> você comanda um simulador Web3 de mineração: racks, energia e decisões que importam — evoluindo junto com o projeto rumo à <strong className="text-amber-700 dark:text-amber-300">tokenomics na rede Polygon</strong>.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            type="button"
                            onClick={() => onNavigate('auth')}
                            aria-label="Entrar na operação — abrir login"
                            className="group w-full sm:w-auto bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-stone-950 font-bold py-4 px-10 rounded-xl shadow-[0_0_32px_rgba(245,158,11,0.45)] border border-amber-300/50 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                        >
                            ENTRAR NA OPERAÇÃO <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" aria-hidden />
                        </button>
                        <button
                            type="button"
                            onClick={() => onNavigate('docs')}
                            aria-label="Abrir manual e documentação"
                            className="w-full sm:w-auto bg-white/90 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-900 text-slate-800 dark:text-slate-100 font-bold py-4 px-10 rounded-xl border-2 border-amber-500/25 dark:border-amber-400/30 hover:border-orange-500/40 dark:hover:border-orange-400/40 transition-all shadow-md backdrop-blur-sm"
                        >
                            ABRIR MANUAL
                        </button>
                    </div>
                </div>
            </div>

            {/* Features Grid */}
            <div className="bg-slate-100 dark:bg-[#15100a] py-20 border-y border-slate-200 dark:border-amber-950/50">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div className="bg-white dark:bg-slate-950/80 p-8 rounded-xl border border-slate-200 dark:border-amber-900/40 hover:border-amber-500/50 dark:hover:border-amber-400/40 transition-colors group shadow-sm dark:shadow-[0_0_24px_rgba(245,158,11,0.06)]">
                            <div className="w-14 h-14 bg-slate-50 dark:bg-amber-950/50 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ring-1 ring-amber-500/20">
                                <Server className="text-amber-600 dark:text-amber-400" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Data center no detalhe</h3>
                            <p className="text-slate-600 dark:text-slate-400">Organize racks, trace fiação, dimensione baterias e sinta o peso do consumo em cada máquina ligada.</p>
                        </div>

                        <div className="bg-white dark:bg-slate-950/80 p-8 rounded-xl border border-slate-200 dark:border-orange-900/40 hover:border-orange-500/50 dark:hover:border-orange-400/40 transition-colors group shadow-sm dark:shadow-[0_0_24px_rgba(194,65,12,0.08)]">
                            <div className="w-14 h-14 bg-slate-50 dark:bg-orange-950/40 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ring-1 ring-orange-500/25">
                                <Zap className="text-orange-600 dark:text-orange-400" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Chips que escala hashrate</h3>
                            <p className="text-slate-600 dark:text-slate-400">Encaixe módulos de IA nos rigs certos e empurre a produção do salão inteiro com bônus cumulativos.</p>
                        </div>

                        <div className="bg-white dark:bg-slate-950 p-8 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-green-500/30 transition-colors group shadow-sm">
                            <div className="w-14 h-14 bg-slate-50 dark:bg-slate-900 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <TrendingUp className="text-green-600 dark:text-green-400" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Preço que reage ao mundo</h3>
                            <p className="text-slate-600 dark:text-slate-400">Notícias dinâmicas mexem com o sentimento do mercado: compre barato, venda forte e saia na frente do ciclo.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* INFO SECTION: SIMULATOR & LIQUIDITY */}
            <div className="py-20 bg-white dark:bg-[#120e09] relative overflow-hidden border-b border-slate-200 dark:border-amber-950/30">
                <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

                    {/* Simulator Info */}
                    <div className="space-y-6">
                        <div className="inline-flex items-center gap-2 text-amber-600 dark:text-amber-500 font-bold uppercase tracking-widest text-sm">
                            <Info size={16} /> Sobre o Genesis Miner
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">Tycoon com alma de operador</h2>
                        <div className="space-y-4 text-slate-600 dark:text-slate-400 leading-relaxed">
                            <p>
                                O Genesis Miner é um <strong>idle tycoon Web3</strong>: cada decisão mexe em hashrate, conta de luz e espaço físico — longe de um clique infinito sem consequência.
                            </p>
                            <p>
                                Não é só “farmar” token na tela: você equilibra <strong>hardware, energia, arrefecimento e layout</strong>. Quem planeja a sala inteira leva vantagem quando a economia do jogo aperta ou solta.
                            </p>
                        </div>
                    </div>

                    {/* Parity & Liquidity Info */}
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 relative shadow-lg">
                        <div className="absolute top-0 right-0 p-4 opacity-10 dark:opacity-20">
                            <Lock size={64} className="text-green-500" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                            <ShieldCheck className="text-green-600 dark:text-green-500" /> Câmbio interno & liquidez
                        </h3>
                        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
                            <p>
                                Na fase beta usamos uma <strong>paridade interna estável</strong> para manter a economia previsível enquanto testamos fluxos reais de depósito e saque.
                            </p>
                            <div className="bg-white dark:bg-slate-950 p-4 rounded-lg border border-green-500/30 text-center shadow-inner">
                                <span className="text-xs uppercase text-slate-500">Paridade Interna</span>
                                <div className="text-2xl font-mono font-bold text-slate-800 dark:text-white my-1">
                                    Ativos de referência: <span className="text-green-600 dark:text-green-400"><br />POL • WETH • WBTC</span>
                                </div>
                            </div>
                            <p>
                                Os parâmetros podem <strong>ser ajustados</strong> pela equipe para preservar o projeto a <strong>médio e longo prazo</strong>, sempre com transparência nas notas de versão.
                            </p>
                        </div>
                    </div>

                </div>
            </div>

            {/* LAUNCH REWARDS SECTION */}
            <div className="py-20 bg-gradient-to-b from-slate-100 to-white dark:from-[#15100a] dark:to-[#0a0805] border-t border-slate-200 dark:border-orange-950/30">
                <div className="max-w-5xl mx-auto px-6 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 dark:bg-gradient-to-r dark:from-amber-500/20 dark:to-orange-600/20 border border-amber-400/35 dark:border-amber-400/25 text-amber-800 dark:text-amber-200 text-[11px] font-black uppercase tracking-[0.18em] mb-6 shadow-[0_0_20px_rgba(251,191,36,0.15)]">
                        <Rocket size={14} className="text-orange-500 dark:text-orange-400" /> Campanha Genesis DAO
                    </div>
                    <h2 className="text-3xl md:text-5xl font-black text-slate-900 dark:text-white mb-3">QUEM ENTRA CEDO, LEVA MAIS</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-12 max-w-xl mx-auto">Pacotes e passes pensados para quem apoia o arranque do simulador junto da <span className="text-amber-600 dark:text-amber-400 font-semibold">Genesis DAO</span>.</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">

                        {/* FREE TIER */}
                        <div className="bg-white dark:bg-slate-950/90 border border-slate-200 dark:border-amber-500/25 rounded-2xl p-8 hover:border-amber-400/50 dark:hover:border-amber-400/45 transition-all relative overflow-hidden group shadow-lg dark:shadow-[0_0_40px_rgba(245,158,11,0.08)]">
                            <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-amber-500/15 to-orange-600/15 rounded-full blur-2xl group-hover:opacity-100 transition-opacity" />
                            <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-400 mb-2">Passe de temporada Genesis DAO</h3>
                            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 uppercase tracking-wider">Loot e progressão de lançamento</p>

                            <div className="space-y-3">
                                <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                                    <Gift className="text-amber-500 dark:text-amber-400 shrink-0" size={16} /> <strong>Caixa Genesis DAO</strong>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">

                                </div>

                                <div className="my-4 border-t border-slate-200 dark:border-slate-700/50"></div>
                                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Hardware incluso na Caixa Genesis DAO:</div>

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
                        <div className="bg-gradient-to-br from-slate-50 to-orange-50 dark:from-slate-900 dark:to-orange-950/40 border border-orange-500/25 dark:border-orange-400/30 rounded-2xl p-8 hover:border-orange-400/50 transition-all relative overflow-hidden shadow-2xl dark:shadow-[0_0_48px_rgba(245,158,11,0.12)]">
                            <div className="absolute top-0 right-0 p-4">
                                <Crown className="text-orange-500 dark:text-orange-400" size={32} />
                            </div>
                            <h3 className="text-2xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-amber-500 dark:from-orange-300 dark:to-amber-400">Pacote Full Baleia</h3>
                            <p className="text-orange-700 dark:text-orange-300/80 text-sm mb-6 uppercase tracking-wider">Kit máximo para fundadores</p>
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
