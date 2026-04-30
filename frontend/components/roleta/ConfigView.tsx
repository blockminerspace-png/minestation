import React, { useState, useMemo, useEffect } from 'react';
import { WheelItem, Upgrade } from '../../types';
// import { PRESET_COLORS } from '../constants';
const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
];
import { Trash2, UserPlus, Users } from 'lucide-react';

interface ConfigViewProps {
  items: WheelItem[];
  setItems: (items: WheelItem[]) => void;
  onSave: () => void;
  gameUpgrades: Upgrade[];
  loading?: boolean;
}

interface Player {
  username: string;
  added_at: number;
}

const ConfigView: React.FC<ConfigViewProps> = ({ items, setItems, onSave, gameUpgrades, loading }) => {
  const [selectedItemId, setSelectedItemId] = useState('');
  const [newItemWeight, setNewItemWeight] = useState(10);

  // Player List State
  const [players, setPlayers] = useState<Player[]>([]);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [loadingPlayers, setLoadingPlayers] = useState(false);

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    try {
      const res = await fetch('/api/admin/wheel/players');
      if (res.ok) {
        const data = await res.json();
        setPlayers(data);
      }
    } catch (e) {
      console.error('Failed to fetch players', e);
    }
  };

  const totalWeight = useMemo(() => {
    return items.reduce((sum, item) => sum + item.weight, 0);
  }, [items]);

  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;

    const upgrade = gameUpgrades.find(u => u.id === selectedItemId);
    const label = upgrade ? upgrade.name : 'Unknown';

    // Pick random color
    const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];

    const newItem: WheelItem = {
      id: Math.random().toString(36).substring(7),
      label: label,
      weight: newItemWeight || 1,
      color: randomColor,
      itemId: selectedItemId
    };

    setItems([...items, newItem]);
    setSelectedItemId('');
    setNewItemWeight(10);
  };

  const removeItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const updateWeight = (id: string, weight: number) => {
    const val = isNaN(weight) ? 0 : Math.max(0, weight);
    setItems(items.map(item => item.id === id ? { ...item, weight: val } : item));
  };

  const normalizeTo100 = () => {
    if (totalWeight === 0) return;
    const newItems = items.map(item => ({
      ...item,
      weight: Math.round((item.weight / totalWeight) * 100)
    }));
    const currentSum = newItems.reduce((sum, item) => sum + item.weight, 0);
    if (currentSum !== 100 && newItems.length > 0) {
      newItems[0].weight += (100 - currentSum);
    }
    setItems(newItems);
  };

  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    setLoadingPlayers(true);
    try {
      const res = await fetch('/api/admin/wheel/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newPlayerName })
      });
      if (res.ok) {
        setNewPlayerName('');
        fetchPlayers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPlayers(false);
    }
  };

  const handleDeletePlayer = async (username: string) => {
    if (!confirm(`Remover jogador ${username}?`)) return;
    try {
      await fetch(`/api/admin/wheel/players/${username}`, { method: 'DELETE' });
      fetchPlayers();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 animate-fade-in">
      {/* Coluna 1: Configuração da Roleta */}
      <div className="bg-slate-800 p-8 rounded-3xl shadow-2xl border border-slate-700">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h2 className="text-3xl font-black text-white leading-tight">Configurações</h2>
            <p className="text-amber-500 text-xs uppercase tracking-widest font-bold">Itens e Probabilidades</p>
          </div>
          <button
            onClick={normalizeTo100}
            className="text-[10px] bg-amber-500 hover:bg-amber-600 text-slate-900 px-4 py-2 rounded-xl transition-all font-bold uppercase shadow-lg"
          >
            Fixar 100%
          </button>
        </div>

        <form onSubmit={addItem} className="flex flex-col gap-3 mb-8 bg-slate-900 p-5 rounded-2xl border border-slate-700 shadow-inner">
          <div className="flex-1">
            <label className="block text-[10px] font-black text-slate-500 mb-2 ml-1 uppercase tracking-widest">Selecionar Item</label>
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 text-white transition-all appearance-none"
            >
              <option value="">Selecione um prêmio...</option>
              {gameUpgrades.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} (ID: {u.id})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[10px] font-black text-slate-500 mb-2 ml-1 uppercase tracking-widest">Peso / Chance</label>
              <input
                type="number"
                value={newItemWeight}
                onChange={(e) => setNewItemWeight(parseInt(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-bold"
              />
            </div>
            <button
              type="submit"
              disabled={!selectedItemId}
              className="self-end bg-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-black px-6 py-3 rounded-xl transition-all h-[50px] uppercase text-sm mt-auto"
            >
              Add
            </button>
          </div>
        </form>

        <div className="space-y-3 max-h-[400px] overflow-y-auto mb-8 pr-2 custom-scrollbar">
          {items.map((item) => {
            const chance = totalWeight > 0 ? ((item.weight / totalWeight) * 100).toFixed(1) : "0";
            return (
              <div key={item.id} className="flex items-center gap-4 bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                <div className="w-6 h-6 rounded-lg shadow-lg shrink-0" style={{ backgroundColor: item.color }} />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-slate-100 block truncate text-lg">{item.label}</span>
                  <span className="text-xs font-black font-mono text-amber-500">{chance}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={item.weight}
                    onChange={(e) => updateWeight(item.id, parseInt(e.target.value))}
                    className="w-16 bg-slate-800 border border-slate-700 rounded-lg py-1.5 text-center text-sm font-black text-white"
                  />
                  <button onClick={() => removeItem(item.id)} className="text-slate-600 hover:text-red-500 p-2 transition-colors">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="text-center text-slate-600 italic py-8">Nenhum prêmio configurado na roleta.</p>
          )}
        </div>

        <button
          onClick={onSave}
          disabled={loading || items.length < 2 || totalWeight === 0}
          className="w-full py-5 rounded-2xl font-black text-2xl shadow-2xl transition-all transform active:scale-95 bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-900 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'SALVANDO...' : 'SALVAR'}
        </button>
      </div>

      {/* Coluna 2: Lista de Jogadores */}
      <div className="bg-slate-800 p-8 rounded-3xl shadow-2xl border border-slate-700 h-fit">
        <div className="flex items-center gap-4 mb-8">
          <div className="bg-amber-500/20 p-3 rounded-xl text-amber-400">
            <Users size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-white leading-tight">Jogadores</h2>
            <p className="text-amber-400 text-xs uppercase tracking-widest font-bold">Quem participou</p>
          </div>
        </div>

        <form onSubmit={handleAddPlayer} className="flex gap-3 mb-6">
          <input
            type="text"
            placeholder="Nome de usuário..."
            value={newPlayerName}
            onChange={(e) => setNewPlayerName(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 text-white"
          />
          <button
            type="submit"
            disabled={loadingPlayers}
            className="bg-amber-600 hover:bg-amber-500 text-white px-4 rounded-xl transition-colors font-bold disabled:opacity-50"
          >
            <UserPlus size={20} />
          </button>
        </form>

        <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
          {players.map((p) => (
            <div key={p.username} className="flex items-center justify-between bg-slate-900/50 p-4 rounded-xl border border-slate-700/30 group hover:border-amber-500/30 transition-all">
              <span className="font-bold text-slate-200">{p.username}</span>
              <button
                onClick={() => handleDeletePlayer(p.username)}
                className="text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-2"
                title="Remover jogador"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {players.length === 0 && (
            <p className="text-center text-slate-600 italic py-8">Nenhum jogador na lista.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConfigView;
