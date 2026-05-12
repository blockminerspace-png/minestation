
import React, { useState } from 'react';
import { Upgrade } from '../types';
import { List, Cpu, Server, Battery, Plug, Zap, PlusCircle, Hexagon } from 'lucide-react';

interface AdminEditorProps {
    gameUpgrades: Upgrade[];
    onUpdateGameUpgrades?: (upgrades: Upgrade[]) => Promise<void> | void;
}

const IMG_UPLOAD_FOLDERS = [
    { id: '', label: 'uploads (dinâmico)' },
    { id: 'miner', label: 'miner' },
    { id: 'moedas', label: 'moedas' },
    { id: 'carregadores', label: 'carregadores' },
    { id: 'baterias', label: 'baterias' },
    { id: 'favicon', label: 'favicon' }
] as const;

export const AdminEditor: React.FC<AdminEditorProps> = ({ gameUpgrades, onUpdateGameUpgrades }) => {
    const [imageUploadFolder, setImageUploadFolder] = useState<string>('');
    const [editItemMode, setEditItemMode] = useState<boolean>(false);
    const [editorFilter, setEditorFilter] = useState<string>('all');
    const [itemForm, setItemForm] = useState<Partial<Upgrade>>({
        id: '', name: '', category: '', type: 'machine', baseCost: 0, baseProduction: 0, description: '', status: 'normal', compatibleRacks: [], image: '', icon: '🧩',
        sellInHardwareMarket: true, sellInBlackMarket: true, isActive: true
    });

    const [isUploadingImage, setIsUploadingImage] = useState(false);

    /**
     * Upload via `multipart/form-data` em `/api/admin/upload-image` — evita o
     * tecto de 5 MB do body parser JSON e mostra erros reais do backend.
     */
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const file = input.files?.[0];
        if (!file) return;
        const okMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
        if (!okMime.includes(file.type)) {
            alert('Formato de imagem inválido. Usa PNG, JPG, WEBP ou GIF.');
            input.value = '';
            return;
        }
        const fd = new FormData();
        fd.append('image', file, file.name);
        if (imageUploadFolder) fd.append('assetFolder', imageUploadFolder);
        setIsUploadingImage(true);
        try {
            const res = await fetch('/api/admin/upload-image', {
                method: 'POST',
                credentials: 'include',
                body: fd
            });
            let payload: { ok?: boolean; path?: string; url?: string; error?: string } | null = null;
            try { payload = await res.json(); } catch { /* sem JSON */ }
            const url = payload?.path || payload?.url;
            if (res.ok && payload?.ok && url) {
                setItemForm(prev => ({ ...prev, image: url }));
            } else {
                alert(payload?.error || `Falha ao enviar imagem (HTTP ${res.status}).`);
            }
        } catch {
            alert('Falha de rede ao enviar imagem. Verifica a ligação e tenta novamente.');
        } finally {
            setIsUploadingImage(false);
            input.value = '';
        }
    };

    const handleNewItem = () => {
        setEditItemMode(true);
        const nftTab = editorFilter === 'nft';
        const defaultType = editorFilter === 'all' || nftTab ? 'machine' : editorFilter;
        setItemForm({
            id: '', name: '', category: 'Nova Categoria',
            type: defaultType as Upgrade['type'],
            baseCost: 0.001, baseProduction: 0, description: '',
            status: 'normal', compatibleRacks: [], image: '', icon: '🧩',
            sellInHardwareMarket: true, sellInBlackMarket: true, isActive: true,
            isNft: nftTab
        });
    }

    const handleEditItem = (item: Upgrade) => {
        setItemForm({ ...item, compatibleRacks: item.compatibleRacks || [] });
        setEditItemMode(true);
    };

    const [isSaving, setIsSaving] = useState(false);

    const handleSaveItem = async () => {
        if (!onUpdateGameUpgrades || !itemForm.id || !itemForm.name) return;
        setIsSaving(true);
        try {
            const existingIndex = gameUpgrades.findIndex(u => u.id === itemForm.id);
            const newItem = itemForm as Upgrade;
            if (existingIndex >= 0) {
                const updated = [...gameUpgrades];
                updated[existingIndex] = newItem;
                await onUpdateGameUpgrades(updated);
            } else {
                await onUpdateGameUpgrades([...gameUpgrades, newItem]);
            }
            setEditItemMode(false);
            setItemForm({});
        } catch (e: any) {
            alert('DEBUG_ERROR: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const toggleCompatibleRack = (rackId: string) => {
        const current = itemForm.compatibleRacks || [];
        if (current.includes(rackId)) {
            setItemForm({ ...itemForm, compatibleRacks: current.filter(id => id !== rackId) });
        } else {
            setItemForm({ ...itemForm, compatibleRacks: [...current, rackId] });
        }
    };

    const filteredItems = gameUpgrades.filter((u) => {
        if (editorFilter === 'all') return true;
        if (editorFilter === 'nft') return !!u.isNft;
        return u.type === editorFilter;
    });

    const infrastructureItems = gameUpgrades.filter(u => u.type === 'infrastructure');

    return (
        <div className="animate-in fade-in slide-in-from-right-4">
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2 border-b border-slate-700">
                <button onClick={() => setEditorFilter('all')} className={`px-3 py-2 rounded text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors ${editorFilter === 'all' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}><List size={14} /> Todos</button>
                <button onClick={() => setEditorFilter('machine')} className={`px-3 py-2 rounded text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors ${editorFilter === 'machine' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}><Cpu size={14} /> GPUs</button>
                <button onClick={() => setEditorFilter('infrastructure')} className={`px-3 py-2 rounded text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors ${editorFilter === 'infrastructure' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}><Server size={14} /> Rigs</button>
                <button onClick={() => setEditorFilter('battery')} className={`px-3 py-2 rounded text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors ${editorFilter === 'battery' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}><Battery size={14} /> Baterias</button>
                <button onClick={() => setEditorFilter('wiring')} className={`px-3 py-2 rounded text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors ${editorFilter === 'wiring' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}><Plug size={14} /> Circuito</button>
                <button onClick={() => setEditorFilter('multiplier')} className={`px-3 py-2 rounded text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors ${editorFilter === 'multiplier' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}><Zap size={14} /> Chips IA</button>
                <button onClick={() => setEditorFilter('nft')} className={`px-3 py-2 rounded text-xs font-bold uppercase flex items-center gap-2 whitespace-nowrap transition-colors ${editorFilter === 'nft' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}><Hexagon size={14} /> NFT</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col h-[70vh]">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-white">
                            {editorFilter === 'all'
                                ? 'Catálogo Completo'
                                : editorFilter === 'nft'
                                  ? 'Itens NFT'
                                  : `Editando: ${editorFilter.toUpperCase()}`}
                        </h3>
                        <button onClick={handleNewItem} className="bg-green-600 hover:bg-green-500 text-white text-xs px-2 py-1 rounded flex items-center gap-1"><PlusCircle size={12} /> NOVO</button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                        {filteredItems.map(u => (
                            <div key={u.id} className="bg-slate-900 p-2 rounded border border-slate-700 hover:border-amber-500 cursor-pointer" onClick={() => handleEditItem(u)}>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <span className="font-bold text-sm text-white">{u.name}</span>
                                        <div className="flex gap-2 mt-1 items-center flex-wrap">
                                            <span className="text-xs text-slate-500">{u.id}</span>
                                            {u.isNft && (
                                                <span className="text-[9px] uppercase font-bold text-orange-400 border border-orange-700/60 rounded px-1 py-0.5 flex items-center gap-0.5">
                                                    <Hexagon size={8} /> NFT
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {u.image && <div className={`w-8 ${u.type === 'infrastructure' ? 'h-10' : 'h-8'} rounded bg-slate-800 overflow-hidden shrink-0`}><img src={u.image} className={`w-full h-full ${u.type === 'infrastructure' ? 'object-contain' : 'object-cover'}`} /></div>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-xl p-6 h-[70vh] overflow-y-auto custom-scrollbar">
                    {editItemMode ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center border-b border-slate-700 pb-2 mb-4">
                                <h3 className="text-xl font-bold text-white">{itemForm.id ? `Editando: ${itemForm.name}` : 'Criar Novo Item'}</h3>

                                <div className="flex flex-wrap items-center gap-2">
                                    {itemForm.image && (
                                        <div className={`w-12 ${itemForm.type === 'infrastructure' ? 'h-16' : 'h-12'} rounded overflow-hidden border border-slate-600 bg-black shrink-0`}>
                                            <img src={itemForm.image} alt="Preview" className={`w-full h-full ${itemForm.type === 'infrastructure' ? 'object-contain' : 'object-cover'}`} />
                                        </div>
                                    )}
                                    <select
                                        value={imageUploadFolder}
                                        onChange={(e) => setImageUploadFolder(e.target.value)}
                                        className="text-xs bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white max-w-[11rem]"
                                        title="Destino no servidor (só admin grava em subpastas canónicas)"
                                    >
                                        {IMG_UPLOAD_FOLDERS.map((o) => (
                                            <option key={o.id || 'uploads'} value={o.id}>{o.label}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp,image/gif"
                                        onChange={handleImageUpload}
                                        disabled={isUploadingImage}
                                        className="text-xs text-white disabled:opacity-50"
                                    />
                                    {isUploadingImage && (
                                        <span className="text-xs font-bold uppercase tracking-wide text-amber-400">
                                            Enviando…
                                        </span>
                                    )}
                                    <button
                                        onClick={() => setItemForm(prev => ({ ...prev, image: '' }))}
                                        disabled={isUploadingImage}
                                        className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 py-2 rounded font-bold disabled:opacity-50"
                                    >
                                        Remover imagem
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">ID Único</label><input type="text" value={itemForm.id} onChange={e => setItemForm({ ...itemForm, id: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">Nome</label><input type="text" value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">Categoria</label><input type="text" value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">Tipo</label><select value={itemForm.type} onChange={e => setItemForm({ ...itemForm, type: e.target.value as any })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm"><option value="machine">GPU</option><option value="infrastructure">Rig</option><option value="battery">Bateria</option><option value="wiring">Circuito</option><option value="multiplier">Chip IA</option></select></div>
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">Ícone (emoji)</label><input type="text" value={itemForm.icon || ''} onChange={e => setItemForm({ ...itemForm, icon: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                            </div>
                            <div className="mt-4">
                                <label className="text-xs font-bold text-slate-500 block mb-1">Descrição</label>
                                <textarea value={itemForm.description} onChange={e => setItemForm({ ...itemForm, description: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm h-24" />
                            </div>

                            {/* Detailed Fields based on type */}
                            <div className="border-t border-slate-700 pt-4 mt-2">
                                <h4 className="font-bold text-slate-400 text-sm mb-2">Especificações</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="text-xs font-bold text-slate-500 block mb-1">Custo Base ($)</label><input type="number" value={itemForm.baseCost} onChange={e => setItemForm({ ...itemForm, baseCost: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                    <div><label className="text-xs font-bold text-slate-500 block mb-1">Status</label><select value={itemForm.status} onChange={e => setItemForm({ ...itemForm, status: e.target.value as any })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm"><option value="normal">Normal</option><option value="legacy">Legado (Visível em Doc)</option><option value="exclusive">Exclusivo</option><option value="limited">Edição Limitada</option></select></div>
                                </div>

                                {itemForm.status === 'limited' && (
                                    <div className="grid grid-cols-2 gap-4 mt-2 bg-yellow-500/10 p-2 rounded border border-yellow-500/30">
                                        <div>
                                            <label className="text-xs font-bold text-yellow-500 block mb-1">Estoque Total (Unidades)</label>
                                            <input
                                                type="number"
                                                value={itemForm.maxGlobalStock || 0}
                                                onChange={e => setItemForm({ ...itemForm, maxGlobalStock: parseInt(e.target.value) })}
                                                className="w-full bg-slate-900 border border-yellow-500/50 rounded p-2 text-white text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 block mb-1">Total Vendido (Apenas Leitura)</label>
                                            <div className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-slate-400 text-sm font-mono">
                                                {itemForm.totalSold || 0}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="mt-3 flex flex-wrap items-center gap-6">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-bold text-slate-500">Exibir no Hardware Market</label>
                                        <input type="checkbox" checked={itemForm.sellInHardwareMarket !== false} onChange={e => setItemForm({ ...itemForm, sellInHardwareMarket: e.target.checked })} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-bold text-slate-500">Exibir no Black Market</label>
                                        <input type="checkbox" checked={itemForm.sellInBlackMarket !== false} onChange={e => setItemForm({ ...itemForm, sellInBlackMarket: e.target.checked })} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-bold text-green-500">ATIVO</label>
                                        <input type="checkbox" checked={itemForm.isActive !== false} onChange={e => setItemForm({ ...itemForm, isActive: e.target.checked })} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-bold text-orange-400 flex items-center gap-1">
                                            <Hexagon size={12} /> Item NFT (on-chain)
                                        </label>
                                        <input
                                            type="checkbox"
                                            checked={!!itemForm.isNft}
                                            onChange={(e) => setItemForm({ ...itemForm, isNft: e.target.checked })}
                                        />
                                    </div>
                                </div>


                                {itemForm.type === 'machine' && (
                                    <div className="grid grid-cols-2 gap-4 mt-2">
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Hashrate (H/s)</label><input type="number" value={itemForm.baseProduction} onChange={e => setItemForm({ ...itemForm, baseProduction: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Consumo (W)</label><input type="number" value={itemForm.powerConsumption} onChange={e => setItemForm({ ...itemForm, powerConsumption: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                    </div>
                                )}

                                {itemForm.type === 'battery' && (
                                    <div className="mt-2">
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Capacidade (Wh)</label><input type="number" value={itemForm.powerCapacity} onChange={e => setItemForm({ ...itemForm, powerCapacity: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                    </div>
                                )}

                                {itemForm.type === 'infrastructure' && (
                                    <div className="grid grid-cols-2 gap-4 mt-2">
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Slots GPUs</label><input type="number" value={itemForm.slotsCapacity} onChange={e => setItemForm({ ...itemForm, slotsCapacity: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Slots IA</label><input type="number" value={itemForm.aiSlotsCapacity} onChange={e => setItemForm({ ...itemForm, aiSlotsCapacity: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                    </div>
                                )}

                                {itemForm.type === 'multiplier' && (
                                    <div className="grid grid-cols-2 gap-4 mt-2">
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Multiplicador (0.1 = 10%)</label><input type="number" value={itemForm.multiplier} onChange={e => setItemForm({ ...itemForm, multiplier: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Consumo Extra (W)</label><input type="number" value={itemForm.powerConsumption} onChange={e => setItemForm({ ...itemForm, powerConsumption: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                    </div>
                                )}

                            </div>

                            {itemForm.type === 'wiring' && (
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                    <div><label className="text-xs font-bold text-slate-500 block mb-1">Redução de Consumo (0.1 = 10%)</label><input type="number" value={itemForm.energyConsumptionReduction || 0} onChange={e => setItemForm({ ...itemForm, energyConsumptionReduction: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" /></div>
                                </div>
                            )}

                            {/* COMPATIBILITY SELECTION */}
                            {(itemForm.type === 'battery' || itemForm.type === 'wiring' || itemForm.type === 'multiplier' || itemForm.type === 'machine') && (
                                <div className="border-t border-slate-700 pt-4 mt-2">
                                    <h4 className="font-bold text-slate-400 text-sm mb-2">Compatibilidade de Rigs (Vazio = Todos)</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {infrastructureItems.map(rack => (
                                            <label key={rack.id} className="flex items-center gap-2 cursor-pointer bg-slate-900 p-2 rounded border border-slate-700">
                                                <input
                                                    type="checkbox"
                                                    checked={itemForm.compatibleRacks?.includes(rack.id)}
                                                    onChange={() => toggleCompatibleRack(rack.id)}
                                                />
                                                <span className="text-sm text-slate-300">{rack.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-4 pt-4 border-t border-slate-700 mt-4">
                                <button onClick={() => setEditItemMode(false)} className="bg-slate-700 text-white px-4 py-2 rounded font-bold">CANCELAR</button>
                                <button onClick={handleSaveItem} className="bg-amber-600 text-white px-4 py-2 rounded font-bold flex-1">SALVAR ITEM</button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-500">Selecione um item para editar.</div>
                    )}
                </div>
            </div>
        </div>
    );
};
