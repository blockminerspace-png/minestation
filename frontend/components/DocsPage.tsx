import React, { useEffect, useMemo, useState } from 'react';
import { Upgrade } from '../types';
import { BookOpen, Cpu, Battery, Zap, Server, Hexagon, Wallet, RefreshCw, AlertTriangle, Globe, MousePointer, LayoutGrid, Terminal, ArrowRightLeft, Lock, ShoppingCart, Skull, Wrench } from 'lucide-react';
import { getMiningCoins, getUpgrades } from '../services/api';

export const DocsPage: React.FC = () => {
    const [upgrades, setUpgrades] = useState<Upgrade[]>([]);
    const [miningCoins, setMiningCoins] = useState<Array<{ id: string; name: string; description: string; minProportion: number; usdcRate: number; isActive: boolean }>>([]);
    useEffect(() => { (async () => { const list = await getMiningCoins(); setMiningCoins(list || []); })(); }, []);
    useEffect(() => { (async () => { const list = await getUpgrades(); setUpgrades(list || []); })(); }, []);

    const docSections = useMemo(() => [
        { title: 'Infraestrutura', filter: (u: Upgrade) => u.type === 'infrastructure' },
        { title: 'Carregador de baterias', filter: (u: Upgrade) => u.type === 'charger' },
        { title: 'GPU Antiga | Gênesis', filter: (u: Upgrade) => u.category === 'GPU Antiga | Gênesis' },
        { title: 'GPU Gamer | Gênesis', filter: (u: Upgrade) => u.category === 'GPU Gamer | Gênesis' },
        { title: 'Farm de Servidores | Gênesis', filter: (u: Upgrade) => u.category === 'Farm de Servidores | Gênesis' },
        { title: 'Energia & Cabeamento', filter: (u: Upgrade) => u.type === 'battery' || u.type === 'wiring' },
        { title: 'Otimização de IA', filter: (u: Upgrade) => u.type === 'multiplier' },
    ], []);
    const rackNameById = useMemo(() => {
        const map: Record<string, string> = {};
        upgrades.filter(u => u.type === 'infrastructure').forEach(r => { map[r.id] = r.name; });
        return map;
    }, [upgrades]);
    const formatCost = (val: number) => {
        if (val === 0) return "0.00";
        if (val < 0.0001) return val.toFixed(8);
        if (val < 1) return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
        return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
    };
    const typeLabel = (t: Upgrade['type']) => {
        if (t === 'machine') return 'GPU';
        if (t === 'infrastructure') return 'Infraestrutura';
        if (t === 'battery') return 'Bateria';
        if (t === 'wiring') return 'Fiação';
        if (t === 'multiplier') return 'Chip IA';
        return String(t);
    };

    return (
        <div className="max-w-5xl mx-auto px-6 py-12 text-slate-700 dark:text-slate-300 animate-in slide-in-from-bottom-4 duration-500">

            <div className="mb-12 text-center">
                <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-4 flex items-center justify-center gap-3">
                    <BookOpen className="text-cyan-600 dark:text-cyan-500" /> Manual do Operador
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-lg">Guia de referência técnica, econômica e operacional do protocolo.</p>
            </div>

            {/* ---------------------------------------------------------------------------------- */}
            {/* SEÇÃO 1: ECONOMIA WEB3 & BLOCKCHAIN */}
            {/* ---------------------------------------------------------------------------------- */}
            <div className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950 dark:to-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl p-8 mb-16 relative overflow-hidden shadow-xl">
                <div className="absolute top-0 right-0 p-8 opacity-10 text-indigo-500 pointer-events-none">
                    <Globe size={200} />
                </div>

                <div className="relative z-10">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-3 border-b border-indigo-200 dark:border-indigo-500/30 pb-4">
                        <Hexagon className="text-purple-600 dark:text-purple-500" /> Economia Web3 & Tokenomics
                    </h2>

                    <div className="bg-indigo-100/50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/50 rounded-xl p-6 mb-8 backdrop-blur-sm">
                        <p className="text-indigo-900 dark:text-white text-lg leading-relaxed font-medium">
                            "Genesis Miner não é apenas um simulador. Este é um jogo <strong>Play-to-Earn</strong> integrado à rede <strong>Polygon</strong>. Todos os ativos que você gerencia possuem valor real e propriedade digital comprovada via Blockchain, permitindo eventuais ganhos financeiros para operadores eficientes."
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        {/* NFT ASSETS */}
                        <div className="bg-white/80 dark:bg-slate-900/80 p-6 rounded-xl border border-purple-200 dark:border-purple-500/20">
                            <h3 className="text-lg font-bold text-purple-600 dark:text-purple-400 mb-3 flex items-center gap-2">
                                <Hexagon size={18} /> Ativos Digitais (NFTs)
                            </h3>
                            <ul className="text-sm space-y-2">
                                <li className="flex gap-2">
                                    <span className="text-green-600 dark:text-green-500 font-bold">MINT (Importar):</span>
                                    <span className="text-slate-600 dark:text-slate-400">Traga itens comprados em marketplaces (como OpenSea) para dentro do jogo instantaneamente.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="text-red-600 dark:text-red-500 font-bold">BURN (Exportar):</span>
                                    <span className="text-slate-600 dark:text-slate-400">Remova itens do jogo e envie-os para sua carteira Web3 para venda no mercado secundário.</span>
                                </li>
                            </ul>
                        </div>

                        {/* LIQUIDITY & EXCHANGE */}
                        <div className="bg-white/80 dark:bg-slate-900/80 p-6 rounded-xl border border-green-200 dark:border-green-500/20">
                            <h3 className="text-lg font-bold text-green-600 dark:text-green-400 mb-3 flex items-center gap-2">
                                <RefreshCw size={18} /> Paridade & Liquidez
                            </h3>
                            <div className="space-y-3">
                                <div className="text-[11px] uppercase tracking-wider text-slate-500">Criptomoedas (Polygon)</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {miningCoins.length === 0 ? (
                                        <div className="text-slate-500 text-xs">Nenhuma criptomoeda configurada.</div>
                                    ) : miningCoins.map(c => (
                                        <div key={c.id} className="bg-slate-50 dark:bg-slate-950 p-3 rounded border border-green-200 dark:border-green-900/30">
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="font-bold text-slate-900 dark:text-white text-sm">{c.name}</div>
                                                <div className={`text-[10px] ${c.isActive ? 'text-green-600 dark:text-green-400' : 'text-slate-500'}`}>{c.isActive ? 'Ativa' : 'Inativa'}</div>
                                            </div>
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400">{c.description}</div>
                                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 mt-2">
                                                <div><span className="font-bold text-slate-700 dark:text-slate-200">USDC/Unidade:</span> {c.usdcRate}</div>
                                                <div><span className="font-bold text-slate-700 dark:text-slate-200">Proporção mínima:</span> {c.minProportion}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ---------------------------------------------------------------------------------- */}
            {/* SEÇÃO 2: GUIA DE MECÂNICAS (HOW TO PLAY) */}
            {/* ---------------------------------------------------------------------------------- */}
            <div className="mb-16">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-8 border-b border-slate-200 dark:border-slate-800 pb-4 flex items-center gap-2">
                    <Cpu className="text-cyan-600 dark:text-cyan-500" /> Mecânicas de Engenharia
                </h2>

                <div className="space-y-8">

                    {/* Rigs de Mineração */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex gap-6 shadow-sm">
                        <div className="shrink-0 bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400">
                            <Server size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">1. Infraestrutura (Rigs de Mineração)</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                                GPUs não funcionam no chão. Você precisa de Rigs de Mineração.
                            </p>
                            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-700 dark:text-slate-300">
                                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span> <strong>Tamanho (U):</strong> Define quantos slots de GPUs o rig possui (4, 6, 8 ou 10), dispostos em 2 colunas.</li>
                                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span> <strong>Slots IA:</strong> Rigs a partir de 6U possuem slots extras dedicados a chips de inteligência artificial.</li>
                            </ul>
                        </div>
                    </div>

                    {/* Electrical */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex gap-6 shadow-sm">
                        <div className="shrink-0 bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-lg flex items-center justify-center text-yellow-600 dark:text-yellow-500">
                            <Zap size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">2. Sistema Elétrico (Fiação & Bateria)</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                                Para um Rig ligar, ele precisa de 3 componentes instalados na base:
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-mono">
                                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded border border-slate-200 dark:border-slate-700">
                                    <strong className="text-orange-500 dark:text-orange-400 block">1. Fiação</strong>
                                    Conduz a energia. Sem fiação, o circuito fica aberto e nada liga.
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded border border-slate-200 dark:border-slate-700">
                                    <strong className="text-yellow-600 dark:text-yellow-400 block">2. Bateria</strong>
                                    Armazena a carga. Cada GPU consome Watts (W). Se a carga (Wh) zerar, o rig desliga.
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded border border-slate-200 dark:border-slate-700">
                                    <strong className="text-green-600 dark:text-green-400 block">3. Power ON</strong>
                                    O botão de energia no painel frontal deve estar ativado.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Mining & AI */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex gap-6 shadow-sm">
                        <div className="shrink-0 bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-lg flex items-center justify-center text-purple-600 dark:text-purple-500">
                            <Cpu size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">3. Mineração & Multiplicadores IA</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                                A produção de criptomoedas é calculada por Rig.
                            </p>
                            <ul className="text-sm space-y-2 mb-4">
                                <li className="text-slate-700 dark:text-slate-300">
                                    <strong>Produção Base:</strong> Soma da produção de todas as GPUs instaladas (CPUs, GPUs, ASICs).
                                </li>
                                <li className="text-purple-700 dark:text-purple-300">
                                    <strong>Boost de IA:</strong> Chips instalados nos slots de IA multiplicam a produção TOTAL do rig.
                                    <br />
                                    <em className="text-slate-500 text-xs">Ex: Um rig com 100 H/s e um chip de +10% passa a 110 H/s. A produção de cada criptomoeda depende do yield configurado pelo administrador.</em>
                                </li>
                            </ul>
                        </div>
                    </div>

                </div>
            </div>

            {/* ---------------------------------------------------------------------------------- */}
            {/* SEÇÃO 3: MANUAL DA INTERFACE (MENU TABS) */}
            {/* ---------------------------------------------------------------------------------- */}
            <div className="mb-16">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-8 border-b border-slate-200 dark:border-slate-800 pb-4 flex items-center gap-2">
                    <MousePointer className="text-green-600 dark:text-green-500" /> Manual Operacional (Interface)
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* TAB 1: SERVER ROOM */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-cyan-600 dark:text-cyan-400 font-bold mb-2 flex items-center gap-2">
                            <LayoutGrid size={18} /> 1. Sala de Rigs
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            É o coração da sua operação. Aqui você monta e gerencia seus Rigs.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li><strong>Instalar Rig:</strong> Se tiver rigs no estoque, clique nos cartões "fantasmas" no final da lista.</li>
                            <li><strong>Equipar Máquinas:</strong> Clique em um slot vazio (linha preta) para abrir o inventário e escolher uma GPU.</li>
                            <li><strong>Equipar Elétrica:</strong> Na base do rig, clique nos slots pontilhados para instalar Fiação e Bateria.</li>
                            <li><strong>Recarregar:</strong> Quando a bateria acabar, clique no botão "RECARREGAR" (texto azul).</li>
                            <li><strong>Desmontar:</strong> O ícone "X" no topo do rig remove o equipamento e envia TODOS os itens dentro dele de volta para o Estoque.</li>
                        </ul>
                    </div>

                    {/* TAB 2: INVENTORY */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-yellow-600 dark:text-yellow-500 font-bold mb-2 flex items-center gap-2">
                            <Terminal size={18} /> 2. Estoque
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Visão geral de tudo que você comprou mas não está usando.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li>Itens comprados no Mercado vêm para cá.</li>
                            <li><strong>Baterias Usadas:</strong> O jogo salva a carga das suas baterias. Se você remover uma bateria com 50% de carga de um rack, ela aparecerá aqui na seção "Usadas". Você pode reinstalá-la depois sem perder a carga.</li>
                        </ul>
                    </div>

                    {/* TAB 3: OFICINA */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-orange-600 dark:text-orange-500 font-bold mb-2 flex items-center gap-2">
                            <Wrench size={18} /> 3. Oficina
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Espaço dedicado à manutenção de equipamentos e recarga de baterias.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li><strong>Carregador de Baterias:</strong> Já em operação. Permite recarregar de <strong>Baterias</strong> para manter as <strong>Rigs </strong>em operação.</li>
                            <li><strong>Tipos de Carga:</strong> Existem carregadores que recuperam energia da <strong>Capacidade Interna </strong>através de anúncios (Reward Ad) e outros através de carga diária (Daily Boost).</li>
                            <li><strong>Manutenção (Em Breve):</strong> Espaço reservado para a Mesa de Manutenção de GPUs e Mesa de Manutenção de Rigs de mineração.</li>
                        </ul>
                    </div>

                    {/* TAB 4: HARDWARE MARKET */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-blue-600 dark:text-blue-500 font-bold mb-2 flex items-center gap-2">
                            <ShoppingCart size={18} /> 4. Mercado de Hardware
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Loja oficial de equipamentos novos.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li>Use o <strong>Carrinho</strong> para comprar múltiplos itens de uma vez.</li>
                            <li>O preço dos itens aumenta progressivamente (inflação de demanda). O carrinho calcula esse custo extra automaticamente.</li>
                            <li>Observe o Consumo (W) antes de comprar.</li>
                        </ul>
                    </div>

                    {/* TAB 5: BLACK MARKET (P2P) */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-red-600 dark:text-red-500 font-bold mb-2 flex items-center gap-2">
                            <Skull size={18} /> 5. Mercado Negro (P2P) - Em desenvolvimento.
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Compra e venda entre jogadores anonimizados.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li>As ofertas expiram rapidamente.</li>
                            <li>Você pode encontrar itens abaixo do preço de mercado (usados) ou raridades superfaturadas.</li>
                        </ul>
                    </div>

                    {/* TAB 6: WALLET */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-purple-600 dark:text-purple-500 font-bold mb-2 flex items-center gap-2">
                            <Wallet size={18} /> 6. Carteira
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Centro financeiro. Gerencie Cripto, Fiat e NFTs.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li><strong>Cripto Exchange:</strong> Converta moedas mineradas em USDC para comprar upgrades.</li>
                            <li><strong>Depósitos:</strong> Injete capital (Depósito USDC fictício para teste) ou Saque tokens.</li>
                            <li><strong>Gerenciador de NFTs:</strong> Mint/Burn de ativos.</li>
                        </ul>
                    </div>

                </div>
            </div>

            {/* ---------------------------------------------------------------------------------- */}
            {/* SEÇÃO 4: CATÁLOGO (EXISTENTE) */}
            {/* ---------------------------------------------------------------------------------- */}
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-8 border-b border-slate-200 dark:border-slate-800 pb-4">
                Catálogo Técnico de Hardware
            </h2>

            <div className="space-y-12">
                {docSections.map(section => {
                    const sectionItems = upgrades.filter(u => section.filter(u) && (u.sellInHardwareMarket !== false || u.sellInBlackMarket !== false));
                    if (sectionItems.length === 0) return null;

                    return (
                        <div key={section.title}>
                            <h3 className="text-lg font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-cyan-600"></span> {section.title}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {sectionItems.map(item => (
                                    <div key={item.id} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-lg flex items-start gap-4 hover:border-slate-400 dark:hover:border-slate-700 transition-colors shadow-sm">
                                        <div className="text-3xl bg-slate-100 dark:bg-slate-900 w-12 h-12 flex items-center justify-center rounded border border-slate-200 dark:border-slate-800 shrink-0 overflow-hidden">
                                            {item.image ? (<img src={item.image} className="w-full h-full object-cover" />) : item.icon}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start">
                                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">{item.name}</h4>
                                                <span className="text-xs font-mono text-green-600 dark:text-green-500">${formatCost(item.baseCost)}</span>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1 mb-2">{item.description}</p>

                                            <div className="flex gap-3 text-[10px] font-mono uppercase bg-slate-50 dark:bg-slate-900/50 p-2 rounded">
                                                {item.baseProduction > 0 && (
                                                    <span className="text-cyan-600 dark:text-cyan-400">Hash: {item.baseProduction < 0.001 ? item.baseProduction.toFixed(8) : item.baseProduction} H/s</span>
                                                )}
                                                {item.powerConsumption && (
                                                    <span className="text-red-500 dark:text-red-400">Power: -{item.powerConsumption}W</span>
                                                )}
                                                {item.powerCapacity && (
                                                    <span className="text-yellow-600 dark:text-yellow-400">Cap: {item.powerCapacity}Wh</span>
                                                )}
                                                {item.multiplier && (
                                                    <span className="text-purple-600 dark:text-purple-400">Boost: +{(item.multiplier * 100).toFixed(1)}%</span>
                                                )}
                                                {item.slotsCapacity && (
                                                    <span className="text-blue-500 dark:text-blue-400">Slots: {item.slotsCapacity}</span>
                                                )}
                                                <span className="text-slate-600 dark:text-slate-300">Tipo: {typeLabel(item.type)}</span>
                                                <span className="text-slate-600 dark:text-slate-300">Status: {item.status}</span>
                                            </div>
                                            <div className="text-[10px] text-slate-500 mt-2">
                                                Compatibilidade: {item.compatibleRacks && item.compatibleRacks.length > 0 ? item.compatibleRacks.map(id => rackNameById[id] || id).join(', ') : 'Todos'}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

        </div>
    );
};
