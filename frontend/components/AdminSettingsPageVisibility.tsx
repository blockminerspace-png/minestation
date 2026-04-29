import React, { useState, useEffect } from 'react';
import { AccessLevel } from '../types';
import { Save, CheckCircle2 } from 'lucide-react';

interface Props {
  accessLevels: AccessLevel[];
  onUpdateAccessLevels?: (levels: AccessLevel[]) => void;
}

export const AdminSettingsPageVisibility: React.FC<Props> = ({ accessLevels, onUpdateAccessLevels }) => {
  const [localLevels, setLocalLevels] = useState<AccessLevel[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    setLocalLevels(JSON.parse(JSON.stringify(accessLevels)));
    setHasChanges(false);
  }, [accessLevels]);

  const allPages = ['servers', 'oficina', 'arcade', 'inventory', 'hardware_store', 'black_market', 'lucky_store', 'wallet', 'upgrade', 'profile'];
  const pageLabels: Record<string, string> = {
    servers: 'Servidores',
    oficina: 'Oficina',
    arcade: 'Arcade',
    inventory: 'Estoque',
    hardware_store: 'Loja Hardware',
    black_market: 'P2P (Mercado)',
    lucky_store: 'Caixas Sorte',
    wallet: 'Carteira',
    upgrade: 'Nível Acesso',
    profile: 'Perfil'
  };

  const toggle = (lvlId: string, page: string) => {
    const updated = localLevels.map(l => {
      if (l.id !== lvlId) return l;
      const cur = Array.isArray(l.allowedPages) ? l.allowedPages : allPages;
      const set = new Set(cur);
      if (set.has(page)) set.delete(page); else set.add(page);
      return { ...l, allowedPages: Array.from(set) };
    });
    setLocalLevels(updated);
    setHasChanges(true);
    setSaveStatus('idle');
  };

  const handleSave = async () => {
    if (!onUpdateAccessLevels) return;
    setSaveStatus('saving');
    try {
      await onUpdateAccessLevels(localLevels);
      setSaveStatus('saved');
      setHasChanges(false);
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      setSaveStatus('idle');
      alert('Erro ao salvar alterações.');
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 relative">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-white font-bold">Visibilidade de Páginas por Nível</h3>
          <p className="text-xs text-slate-400">Selecione quais páginas do menu do jogador cada nível pode visualizar.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saveStatus === 'saving'}
          className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all shadow-lg active:scale-95 ${!hasChanges
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : saveStatus === 'saved'
                ? 'bg-green-600 text-white'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-500/20'
            }`}
        >
          {saveStatus === 'saving' ? (
            'Salvando...'
          ) : saveStatus === 'saved' ? (
            <><CheckCircle2 size={14} /> Salvo!</>
          ) : (
            <><Save size={14} /> Salvar Alterações</>
          )}
        </button>
      </div>

      {localLevels.map((lvl) => {
        const cur = Array.isArray(lvl.allowedPages) ? lvl.allowedPages : allPages;
        return (
          <div key={lvl.id} className="mb-4 border border-slate-700 rounded-lg p-3 bg-slate-900/50">
            <div className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
              {lvl.name}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {allPages.map(pg => (
                <label key={pg} className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer hover:bg-slate-700/50 p-1.5 rounded transition-colors group">
                  <input
                    type="checkbox"
                    checked={cur.includes(pg)}
                    onChange={() => toggle(lvl.id, pg)}
                    className="accent-cyan-500 w-3 h-3 rounded border-slate-600"
                  />
                  <span className="group-hover:text-white transition-colors">{pageLabels[pg] || pg}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
      {accessLevels.length === 0 && <div className="text-xs text-slate-500 py-10 text-center italic">Nenhum nível cadastrado.</div>}
    </div>
  );
}
