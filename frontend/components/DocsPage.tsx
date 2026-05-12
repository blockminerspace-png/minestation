import React, { useEffect, useMemo, useState } from 'react';
import { Upgrade } from '../types';
import { BookOpen, Cpu, Battery, Zap, Server, Hexagon, Wallet, RefreshCw, AlertTriangle, Globe, MousePointer, LayoutGrid, Terminal, ArrowRightLeft, Lock, ShoppingCart, Skull } from 'lucide-react';
import { getMiningCoins, getUpgrades } from '../services/api';

export const DocsPage: React.FC = () => {
    const [upgrades, setUpgrades] = useState<Upgrade[]>([]);
    const [miningCoins, setMiningCoins] = useState<Array<{ id: string; name: string; description: string; minProportion: number; usdcRate: number; isActive: boolean }>>([]);
    useEffect(() => { (async () => { const list = await getMiningCoins(); setMiningCoins(list || []); })(); }, []);
    useEffect(() => { (async () => { const list = await getUpgrades(); setUpgrades(list || []); })(); }, []);

    const docSections = useMemo(() => [
        { title: 'Infraestrutura', filter: (u: Upgrade) => u.type === 'infrastructure' },
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
                    <BookOpen className="text-amber-600 dark:text-amber-500" /> Manual Genesis Miner
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-lg">Referência técnica e econômica do Genesis Miner — peças, salas e regras de mercado.</p>
            </div>

            {/* ---------------------------------------------------------------------------------- */}
            {/* SEÇÃO 1: ECONOMIA WEB3 & BLOCKCHAIN */}
            {/* ---------------------------------------------------------------------------------- */}
            <div className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-950 dark:to-slate-900 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-8 mb-16 relative overflow-hidden shadow-xl">
                <div className="absolute top-0 right-0 p-8 opacity-10 text-amber-500 pointer-events-none">
                    <Globe size={200} />
                </div>

                <div className="relative z-10">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-3 border-b border-amber-200 dark:border-amber-500/30 pb-4">
                        <Hexagon className="text-orange-600 dark:text-orange-500" /> Tokenomics & economia on-chain
                    </h2>

                    <div className="bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/50 rounded-xl p-6 mb-8 backdrop-blur-sm">
                        <p className="text-amber-900 dark:text-white text-lg leading-relaxed font-medium">
                            O Genesis Miner mistura <strong>simulação profunda</strong> com camada <strong>Web3 na Polygon</strong>: o que você mexe no inventário pode existir on-chain, com regras claras de mint, burn e saques — e recompensas para quem opera com disciplina.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        {/* NFT ASSETS */}
                        <div className="bg-white/80 dark:bg-slate-900/80 p-6 rounded-xl border border-orange-200 dark:border-orange-500/20">
                            <h3 className="text-lg font-bold text-orange-600 dark:text-orange-400 mb-3 flex items-center gap-2">
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
                    <Cpu className="text-amber-600 dark:text-amber-500" /> Mecânicas Genesis (engenharia)
                </h2>

                <div className="space-y-8">

                    {/* Rigs de Mineração */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex gap-6 shadow-sm">
                        <div className="shrink-0 bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400">
                            <Server size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">1. Infraestrutura — racks de mineração</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                                Nenhuma GPU opera solta: tudo passa por racks com energia, fiação e bateria dimensionados.
                            </p>
                            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-700 dark:text-slate-300">
                                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span> <strong>Tamanho (U):</strong> Define quantos slots de GPUs o rig possui (4, 6, 8 ou 10), dispostos em 2 colunas.</li>
                                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span> <strong>Slots IA:</strong> Rigs a partir de 6U possuem slots extras dedicados a chips de inteligência artificial.</li>
                            </ul>
                        </div>
                    </div>

                    {/* Electrical */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex gap-6 shadow-sm">
                        <div className="shrink-0 bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-lg flex items-center justify-center text-yellow-600 dark:text-yellow-500">
                            <Zap size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">2. Malha elétrica (fiação e bateria)</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                                Cada rack só entra em produção quando a base tem três peças encaixadas:
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
                                    O interruptor frontal precisa permanecer ligado para liberar o hashrate.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Mining & AI */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex gap-6 shadow-sm">
                        <div className="shrink-0 bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-lg flex items-center justify-center text-orange-600 dark:text-orange-500">
                            <Cpu size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">3. Mineração e boosters de IA</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                                O rendimento é contabilizado rack a rack, somando GPUs e multiplicadores ativos.
                            </p>
                            <ul className="text-sm space-y-2 mb-4">
                                <li className="text-slate-700 dark:text-slate-300">
                                    <strong>Produção Base:</strong> Soma da produção de todas as GPUs instaladas (CPUs, GPUs, ASICs).
                                </li>
                                <li className="text-orange-700 dark:text-orange-300">
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
                    <MousePointer className="text-green-600 dark:text-green-500" /> Manual operacional (interface)
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* TAB 1: SERVER ROOM */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-amber-600 dark:text-amber-400 font-bold mb-2 flex items-center gap-2">
                            <LayoutGrid size={18} /> 1. Sala de Rigs
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Centro nervoso da mina: instala racks, encaixa GPUs e controla energia em tempo real.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li><strong>Instalar Rig:</strong> Se tiver rigs no estoque, clique nos cartões "fantasmas" no final da lista.</li>
                            <li><strong>Equipar Máquinas:</strong> Clique em um slot vazio (linha preta) para abrir o inventário e escolher uma GPU.</li>
                            <li><strong>Equipar Elétrica:</strong> Na base do rig, clique nos slots pontilhados para instalar Fiação e Bateria.</li>
                            <li><strong>Recarregar:</strong> Quando a bateria acabar, clique no botão "RECARREGAR" (texto azul).</li>
                            <li><strong>Desmontar:</strong> O ícone &quot;X&quot; no topo do rack devolve toda a carga útil ao depósito de peças.</li>
                        </ul>
                    </div>

                    {/* TAB 2: INVENTORY */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-yellow-600 dark:text-yellow-500 font-bold mb-2 flex items-center gap-2">
                            <Terminal size={18} /> 2. Estoque
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Inventário vivo: compras do Genesis Supply e retiradas de rack aparecem aqui.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li>Peças recém-adquiridas no Genesis Supply caem direto neste depósito.</li>
                            <li><strong>Baterias UUID:</strong> Cada bateria possui um identificador único e fornecimento infinito de energia — pode entrar e sair de qualquer rack sem perder atributos.</li>
                        </ul>
                    </div>

                    {/* TAB 4: LOJINHA / GENESIS SUPPLY */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-amber-600 dark:text-amber-500 font-bold mb-2 flex items-center gap-2">
                            <ShoppingCart size={18} /> 4. Lojinha Miner (Genesis Supply)
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Canal oficial para SKUs novos, com carrinho e precificação dinâmica.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li>Use o <strong>carrinho Genesis</strong> para fechar pedidos com várias linhas.</li>
                            <li>Os preços reagem à demanda agregada; o carrinho já projeta o impacto antes do checkout.</li>
                            <li>Confira o consumo em watts antes de comprometer a malha elétrica.</li>
                        </ul>
                    </div>

                    {/* TAB 5: BLACK MARKET (P2P) */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-red-600 dark:text-red-500 font-bold mb-2 flex items-center gap-2">
                            <Skull size={18} /> 5. Mercado paralelo (P2P) — beta contínuo
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Liquidez peer-to-peer com custódia automática até o match final.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li>As reservas expiram rápido para evitar bloqueio de capital ocioso.</li>
                            <li>Boas oportunidades aparecem abaixo da referência oficial; raridades podem carregar prêmio.</li>
                        </ul>
                    </div>

                    {/* TAB 6: WALLET */}
                    <div className="bg-white dark:bg-slate-950 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-orange-600 dark:text-orange-500 font-bold mb-2 flex items-center gap-2">
                            <Wallet size={18} /> 6. Carteira on-chain
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-justify">
                            Hub financeiro: USDC, ativos minerados e NFTs do ecossistema.
                        </p>
                        <ul className="text-xs space-y-2 text-slate-700 dark:text-slate-300 list-disc pl-4">
                            <li><strong>Desk de câmbio:</strong> zere posições em cripto minerada e receba USDC para novos upgrades.</li>
                            <li><strong>Entradas e saídas:</strong> injete USDC nas redes suportadas ou levante tokens elegíveis.</li>
                            <li><strong>NFT manager:</strong> emissão e queima controladas de ativos on-chain.</li>
                        </ul>
                    </div>

                </div>
            </div>

            {/* ---------------------------------------------------------------------------------- */}
            {/* SEÇÃO 4: CATÁLOGO (EXISTENTE) */}
            {/* ---------------------------------------------------------------------------------- */}
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-8 border-b border-slate-200 dark:border-slate-800 pb-4">
                Catálogo técnico Genesis
            </h2>

            <div className="space-y-12">
                {docSections.map(section => {
                    const sectionItems = upgrades.filter(u => section.filter(u) && (u.sellInHardwareMarket !== false || u.sellInBlackMarket !== false));
                    if (sectionItems.length === 0) return null;

                    return (
                        <div key={section.title}>
                            <h3 className="text-lg font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-amber-600"></span> {section.title}
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
                                                    <span className="text-amber-600 dark:text-amber-400">Hash: {item.baseProduction < 0.001 ? item.baseProduction.toFixed(8) : item.baseProduction} H/s</span>
                                                )}
                                                {item.powerConsumption && (
                                                    <span className="text-red-500 dark:text-red-400">Power: -{item.powerConsumption}W</span>
                                                )}
                                                {item.powerCapacity && (
                                                    <span className="text-yellow-600 dark:text-yellow-400">Cap: {item.powerCapacity}Wh</span>
                                                )}
                                                {item.multiplier && (
                                                    <span className="text-orange-600 dark:text-orange-400">Boost: +{(item.multiplier * 100).toFixed(1)}%</span>
                                                )}
                                                {item.slotsCapacity && (
                                                    <span className="text-amber-500 dark:text-amber-400">Slots: {item.slotsCapacity}</span>
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
