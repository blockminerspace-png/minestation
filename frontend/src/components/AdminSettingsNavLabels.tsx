import React, { useEffect, useState } from 'react';
import { Save, CheckCircle2, RotateCcw } from 'lucide-react';
import { getGameNavLabels, saveGameNavLabels } from '../services/api';
import { DEFAULT_GAME_NAV_LABELS, GAME_NAV_LABEL_KEYS, type GameNavLabelKey } from '../constants/gameNavLabels';

const fieldHint: Partial<Record<GameNavLabelKey, string>> = {
  lucky_store: 'Mesma permissão da Roleta no menu.',
  roleta: 'Visível quando o nível tem acesso a Caixas da Sorte.',
  partners: 'Vitrine de vídeos; envio só para níveis Parceiros/Partners.',
};

export const AdminSettingsNavLabels: React.FC = () => {
  const [draft, setDraft] = useState<Record<GameNavLabelKey, string>>(() => ({ ...DEFAULT_GAME_NAV_LABELS }));
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await getGameNavLabels();
        if (cancelled) return;
        setDraft({ ...DEFAULT_GAME_NAV_LABELS, ...remote });
        setLoaded(true);
        setError(null);
      } catch {
        if (!cancelled) {
          setLoaded(true);
          setError('Não foi possível carregar os rótulos salvos.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setField = (key: GameNavLabelKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaveStatus('idle');
    setError(null);
  };

  const resetDefaults = () => {
    setDraft({ ...DEFAULT_GAME_NAV_LABELS });
    setSaveStatus('idle');
    setError(null);
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    setError(null);
    try {
      const merged = await saveGameNavLabels(draft);
      setDraft({ ...DEFAULT_GAME_NAV_LABELS, ...merged });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (e) {
      setSaveStatus('idle');
      setError(e instanceof Error ? e.message : 'Erro ao salvar.');
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 relative space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="text-white font-bold">Nomes das abas do menu (jogador)</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Textos exibidos na barra superior do jogo. Valores vazios voltam ao padrão ao salvar (o servidor mescla com os padrões).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={resetDefaults}
            className="px-3 py-2 rounded-lg font-bold text-xs flex items-center gap-2 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            <RotateCcw size={14} /> Restaurar padrões (edição)
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!loaded || saveStatus === 'saving'}
            className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all shadow-lg active:scale-95 ${
              saveStatus === 'saved'
                ? 'bg-green-600 text-white'
                : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {saveStatus === 'saving' ? (
              'Salvando...'
            ) : saveStatus === 'saved' ? (
              <><CheckCircle2 size={14} /> Salvo!</>
            ) : (
              <><Save size={14} /> Salvar no servidor</>
            )}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-400 font-mono">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {GAME_NAV_LABEL_KEYS.map((key) => (
          <label key={key} className="block space-y-1">
            <span className="text-[10px] font-mono uppercase text-slate-500">{key}</span>
            <input
              type="text"
              value={draft[key] ?? ''}
              onChange={(e) => setField(key, e.target.value)}
              maxLength={48}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              placeholder={DEFAULT_GAME_NAV_LABELS[key]}
            />
            {fieldHint[key] && <p className="text-[10px] text-slate-500">{fieldHint[key]}</p>}
          </label>
        ))}
      </div>
    </div>
  );
};
