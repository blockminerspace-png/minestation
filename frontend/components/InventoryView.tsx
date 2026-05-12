
import React from 'react';
import { Upgrade, StoredBattery } from '../types';
import type { InventoryStackableCategoryApi } from '../services/api';
import { Package, Zap, Battery, Activity, Save, Hexagon } from 'lucide-react';
import { normalizePublicAssetUrl } from '../utils/publicUrl';

interface InventoryViewProps {
    stock: Record<string, number>;
    storedBatteries?: StoredBattery[];
    /** Quando definido (após GET `/api/inventory/me`), separa UI em cheias vs parciais conforme o servidor. */
    inventoryBatterySplit?: { full: StoredBattery[]; partial: StoredBattery[] } | null;
    upgrades: Upgrade[];
    /** Quando definido (GET `/api/inventory/state`), categorias e linhas vêm do servidor — sem recalcular stock no cliente. */
    inventoryStackableCategories?: InventoryStackableCategoryApi[] | null;
}

/** Placeholder legacy-temp: mostrar o item real se o id original existir na lista de upgrades. */
function resolveStockDisplayUpgrade(
    stockItemId: string,
    upgrade: Upgrade | undefined,
    allUpgrades: Upgrade[]
): Upgrade | undefined {
    if (!upgrade?.name) return upgrade;
    const isLegacy =
        upgrade.category === 'legacy-temp' &&
        (upgrade.type as string) === 'legacy-temp';
    if (!isLegacy || !upgrade.description) return upgrade;
    const m = upgrade.description.match(/original=([^\s]+)\s+email=/);
    const origId = m?.[1];
    if (!origId) return upgrade;
    const real = allUpgrades.find((u) => u.id === origId);
    if (!real?.name) return upgrade;
    return { ...real, description: real.description, id: stockItemId };
}

function groupBatteriesByItemId(bats: StoredBattery[]): Record<string, StoredBattery[]> {
    return bats.reduce((acc, bat) => {
        if (!acc[bat.itemId]) acc[bat.itemId] = [];
        acc[bat.itemId].push(bat);
        return acc;
    }, {} as Record<string, StoredBattery[]>);
}

export const InventoryView: React.FC<InventoryViewProps> = ({
    stock,
    storedBatteries = [],
    inventoryBatterySplit = null,
    upgrades,
    inventoryStackableCategories = null
}) => {
    // Filter items that we actually have in stock
    const ownedItems = (Object.entries(stock) as [string, number][])
        .filter(([_, count]) => count > 0)
        .map(([id, count]) => {
            const upgrade = upgrades.find(u => u.id === id);
            const display = resolveStockDisplayUpgrade(id, upgrade, upgrades);
            return { ...display, count, id }; // id = chave no save (pode ser temp_legacy_*)
        })
        .filter(item => item.name); // Ensure upgrade exists in constants

    // Group by category
    const itemsByCategory = ownedItems.reduce((acc, item) => {
        const cat = item.category || 'Outros';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(item);
        return acc;
    }, {} as Record<string, typeof ownedItems>);

    const sortedCategories = Object.keys(itemsByCategory).sort((a, b) => {
        if (a === 'Infraestrutura') return -1;
        if (b === 'Infraestrutura') return 1;
        if (a === 'Energia & Cabeamento') return -1;
        if (b === 'Energia & Cabeamento') return 1;
        return 0;
    });

    const formatProduction = (val: number) => {
        if (val < 0.0001) return val.toFixed(8);
        return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(val);
    }

    return (
        <div className="flex flex-col p-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="bg-slate-200 dark:bg-slate-800 p-2 rounded-lg text-amber-600 dark:text-amber-400">
                    <Package size={24} />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">Depósito de peças</h2>
                    <p className="text-sm text-slate-500">Tudo que já comprou e ainda não está em rack ou oficina.</p>
                </div>
            </div>

            {(() => {
                const useSplit = inventoryBatterySplit != null;
                const partialList = inventoryBatterySplit != null ? inventoryBatterySplit.partial : storedBatteries;
                const fullList = inventoryBatterySplit != null ? inventoryBatterySplit.full : [];
                const renderBatteryCards = (bats: StoredBattery[], sectionLabel: string) => {
                    if (bats.length === 0) return null;
                    return (
                        <div className="mb-8">
                            <h3 className="text-sm font-bold text-yellow-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-yellow-600"></span>
                                {sectionLabel}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {Object.entries(groupBatteriesByItemId(bats)).map(([itemId, groupBats]) => {
                                    const def = upgrades.find((u) => u.id === itemId);
                                    if (!def) return null;
                                    return (
                                        <div
                                            key={`${sectionLabel}-${itemId}`}
                                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 relative overflow-hidden group hover:border-yellow-500/50 transition-all shadow-sm flex flex-col"
                                        >
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="w-10 h-10 bg-slate-50 dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800 flex items-center justify-center text-xl text-yellow-500 overflow-hidden">
                                                    {def.image ? (
                                                        <img
                                                            src={normalizePublicAssetUrl(def.image) || def.image}
                                                            alt={def.name}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        def.icon
                                                    )}
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                                                        <Save size={10} /> Salvo
                                                    </span>
                                                    <span className="text-lg font-mono font-bold text-slate-700 dark:text-white">x{groupBats.length}</span>
                                                </div>
                                            </div>
                                            <h4 className="font-bold text-slate-800 dark:text-slate-200 truncate text-sm mb-2">{def.name}</h4>
                                            <div className="flex-1 overflow-y-auto custom-scrollbar max-h-32 pr-1 space-y-2">
                                                {groupBats.map((battery) => {
                                                    // Sistema de baterias é infinito por design: armazém mostra sempre ∞.
                                                    const isInf = true;
                                                    const chargePct = 100;
                                                    const refLabel =
                                                        battery.publicRef && battery.publicRef.trim()
                                                            ? battery.publicRef
                                                            : battery.id.slice(0, 6);
                                                    return (
                                                        <div
                                                            key={battery.id}
                                                            className="bg-slate-50 dark:bg-slate-950/50 p-2 rounded border border-slate-100 dark:border-slate-800/50 text-xs"
                                                        >
                                                            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                                                <span className="font-mono text-[9px]">{refLabel}</span>
                                                                <span className="text-yellow-600 dark:text-yellow-400 font-mono">
                                                                    {isInf ? '∞' : `${chargePct.toFixed(1)}%`}
                                                                </span>
                                                            </div>
                                                            <div className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                                                <div
                                                                    className="h-full bg-yellow-500 dark:bg-yellow-600"
                                                                    style={{ width: `${isInf ? 100 : Math.min(100, chargePct)}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                };

                if (useSplit) {
                    return (
                        <>
                            {renderBatteryCards(partialList, 'Baterias fora de rack — carga parcial')}
                            {renderBatteryCards(fullList, 'Baterias fora de rack — carga cheia (≥99,9% ou infinito)')}
                        </>
                    );
                }

                return storedBatteries.length > 0
                    ? renderBatteryCards(storedBatteries, 'Baterias fora de rack (carga preservada)')
                    : null;
            })()}

            {sortedCategories.length === 0 &&
            storedBatteries.length === 0 &&
            !(inventoryBatterySplit && (inventoryBatterySplit.partial.length > 0 || inventoryBatterySplit.full.length > 0)) &&
            !(inventoryStackableCategories && inventoryStackableCategories.length > 0) ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 gap-4">
                    <Package size={64} className="opacity-20" />
                    <p className="text-lg">Seu estoque está vazio.</p>
                    <p className="text-sm">Visite o Mercado para comprar equipamentos.</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {(inventoryStackableCategories != null
                        ? inventoryStackableCategories
                        : sortedCategories.map((category) => ({
                              category,
                              items: itemsByCategory[category].map((item) => ({
                                  stockKey: item.id,
                                  catalogItemId: item.id,
                                  displayQuantity: item.count,
                                  availableQuantity: item.count,
                                  name: item.name || item.id,
                                  description: item.description || '',
                                  category: item.category || 'Outros',
                                  type: item.type || 'other',
                                  image: item.image != null ? String(item.image) : null,
                                  icon: item.icon || '',
                                  baseProduction: item.baseProduction || 0,
                                  powerConsumption: item.powerConsumption || 0,
                                  powerCapacity: item.powerCapacity || 0,
                                  slotsCapacity: item.slotsCapacity || 0,
                                  aiSlotsCapacity: item.aiSlotsCapacity || 0,
                                  isNft: !!item.isNft
                              }))
                          }))
                    ).map((block) => (
                        <div key={block.category}>
                            <h3 className="text-sm font-bold text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-amber-600"></span>
                                {block.category}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {block.items.map((row) => {
                                    const hasImage = normalizePublicAssetUrl(row.image) || row.image;
                                    const isRack = row.type === 'infrastructure';
                                    const isMachine = row.type === 'machine';
                                    const qty =
                                        row.displayQuantity !== row.availableQuantity
                                            ? `${row.availableQuantity}/${row.displayQuantity}`
                                            : String(row.displayQuantity);

                                    const containerAspectRatio = isRack
                                        ? 'aspect-[5/6]'
                                        : isMachine
                                            ? 'aspect-video'
                                            : 'aspect-square';

                                    return (
                                        <div
                                            key={row.stockKey}
                                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 relative overflow-hidden group hover:border-slate-400 dark:hover:border-slate-700 transition-all shadow-sm flex flex-col"
                                        >
                                            {row.isNft && (
                                                <div className="absolute top-2 right-2 bg-orange-600 text-white text-[9px] px-1.5 py-0.5 rounded shadow-lg z-10 flex items-center gap-1">
                                                    <Hexagon size={8} /> NFT
                                                </div>
                                            )}

                                            <div className="flex justify-between items-start mb-3">
                                                <div
                                                    className={`${containerAspectRatio} w-20 bg-slate-50 dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800 flex items-center justify-center text-3xl shadow-inner overflow-hidden`}
                                                >
                                                    {hasImage ? (
                                                        <img
                                                            src={hasImage}
                                                            className={`w-full h-full ${isRack ? 'object-contain' : 'object-cover'}`}
                                                            alt=""
                                                        />
                                                    ) : (
                                                        row.icon
                                                    )}
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[10px] text-slate-500 uppercase">Quantidade</span>
                                                    <span className="text-2xl font-mono font-bold text-slate-900 dark:text-white">{qty}</span>
                                                </div>
                                            </div>

                                            <div className="mb-4">
                                                <h4 className="font-bold text-slate-800 dark:text-slate-200 truncate">{row.name}</h4>
                                                <p className="text-xs text-slate-500 line-clamp-2 mt-1 min-h-[2.5em]">{row.description}</p>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-50 dark:bg-slate-950/50 p-2 rounded border border-slate-100 dark:border-slate-800/50 mt-auto">
                                                {row.type === 'machine' && (
                                                    <>
                                                        <div className="flex flex-col">
                                                            <span className="text-slate-500 flex items-center gap-1">
                                                                <Activity size={10} /> Hash
                                                            </span>
                                                            <span className="text-green-600 dark:text-green-400">
                                                                +{formatProduction(row.baseProduction)} H/s
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-slate-500 flex items-center gap-1">
                                                                <Zap size={10} /> Consumo
                                                            </span>
                                                            <span className="text-red-500 dark:text-red-400">{row.powerConsumption} W</span>
                                                        </div>
                                                    </>
                                                )}
                                                {row.type === 'battery' && (
                                                    <div className="col-span-2 flex justify-between">
                                                        <span className="text-slate-500 flex items-center gap-1">
                                                            <Battery size={10} /> Capacidade
                                                        </span>
                                                        <span className="text-yellow-600 dark:text-yellow-400">{row.powerCapacity} Wh</span>
                                                    </div>
                                                )}
                                                {row.type === 'infrastructure' && (
                                                    <div className="col-span-2 text-center text-slate-400 text-[10px]">
                                                        {row.slotsCapacity} Slots • {row.aiSlotsCapacity} IA Slots
                                                    </div>
                                                )}
                                                {row.type === 'wiring' && (
                                                    <div className="col-span-2 text-center text-slate-400">Condutor Elétrico</div>
                                                )}
                                                {row.type === 'charger' && (
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-500 flex items-center gap-1">
                                                            <Zap size={10} /> Potência
                                                        </span>
                                                        <span className="text-yellow-600 dark:text-yellow-400">{row.baseProduction || 0.5} W</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
