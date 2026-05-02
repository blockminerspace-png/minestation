import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Save, Scale } from 'lucide-react';
import { TransparencyCategory, TransparencyEntry } from '../types';
import {
  adminCreateTransparencyEntry,
  adminDeleteTransparencyEntry,
  adminUpdateTransparencyEntry,
  getTransparency
} from '../services/api';

const CATS: { id: TransparencyCategory; label: string }[] = [
  { id: 'pool', label: 'Pool / tesouraria' },
  { id: 'expense', label: 'Gasto' },
  { id: 'investment', label: 'Investimento' },
  { id: 'other', label: 'Outro' }
];

const emptyForm = () => ({
  category: 'pool' as TransparencyCategory,
  title: '',
  body: '',
  amountUsdc: '',
  linkUrl: '',
  sortOrder: '0'
});

export const AdminTransparency: React.FC = () => {
  const [rows, setRows] = useState<TransparencyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ReturnType<typeof emptyForm> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await getTransparency();
    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    const title = form.title.trim();
    if (!title) {
      alert('Indique um título.');
      return;
    }
    let amount: number | null | undefined = undefined;
    if (form.amountUsdc.trim() !== '') {
      const n = Number(form.amountUsdc.replace(',', '.'));
      if (!Number.isFinite(n)) {
        alert('Valor USDC inválido.');
        return;
      }
      amount = n;
    }
    setSaving(true);
    const res = await adminCreateTransparencyEntry({
      category: form.category,
      title,
      body: form.body.trim() || undefined,
      amountUsdc: amount,
      linkUrl: form.linkUrl.trim() || undefined,
      sortOrder: parseInt(form.sortOrder, 10) || 0
    });
    setSaving(false);
    if (res.ok === false) {
      alert(res.error || 'Erro ao criar.');
      return;
    }
    setForm(emptyForm());
    await load();
  };

  const startEdit = (r: TransparencyEntry) => {
    setEditingId(r.id);
    setEditDraft({
      category: r.category,
      title: r.title,
      body: r.body || '',
      amountUsdc: r.amountUsdc != null && Number.isFinite(r.amountUsdc) ? String(r.amountUsdc) : '',
      linkUrl: r.linkUrl || '',
      sortOrder: String(r.sortOrder ?? 0)
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (editingId == null || !editDraft) return;
    const title = editDraft.title.trim();
    if (!title) {
      alert('Indique um título.');
      return;
    }
    let amount: number | null | undefined = undefined;
    if (editDraft.amountUsdc.trim() === '') amount = null;
    else {
      const n = Number(editDraft.amountUsdc.replace(',', '.'));
      if (!Number.isFinite(n)) {
        alert('Valor USDC inválido.');
        return;
      }
      amount = n;
    }
    setSaving(true);
    const res = await adminUpdateTransparencyEntry(editingId, {
      category: editDraft.category,
      title,
      body: editDraft.body.trim() || null,
      amountUsdc: amount,
      linkUrl: editDraft.linkUrl.trim() || null,
      sortOrder: parseInt(editDraft.sortOrder, 10) || 0
    });
    setSaving(false);
    if (res.ok === false) {
      alert(res.error || 'Erro ao salvar.');
      return;
    }
    cancelEdit();
    await load();
  };

  const remove = async (id: number) => {
    if (!confirm('Remover este registro?')) return;
    setSaving(true);
    const res = await adminDeleteTransparencyEntry(id);
    setSaving(false);
    if (res.ok === false) {
      alert(res.error || 'Erro ao remover.');
      return;
    }
    if (editingId === id) cancelEdit();
    await load();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 border-b border-slate-700 pb-4">
        <Scale className="text-amber-500" size={28} />
        <div>
          <h2 className="text-xl font-bold text-white">Transparência (jogadores)</h2>
          <p className="text-xs text-slate-500">Os registros aparecem na aba Transparência do jogo. Só administradores podem editar aqui.</p>
        </div>
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-amber-500 uppercase tracking-wider">Novo registro</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-xs text-slate-400">
            Categoria
            <select
              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as TransparencyCategory })}
            >
              {CATS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-400">
            Ordem (menor = primeiro)
            <input
              type="number"
              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            />
          </label>
          <label className="block text-xs text-slate-400 md:col-span-2">
            Título
            <input
              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={300}
            />
          </label>
          <label className="block text-xs text-slate-400 md:col-span-2">
            Descrição (opcional)
            <textarea
              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white min-h-[100px]"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              maxLength={8000}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Valor USDC (opcional)
            <input
              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
              value={form.amountUsdc}
              onChange={(e) => setForm({ ...form, amountUsdc: e.target.value })}
              placeholder="ex: 1500 ou vazio"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Link https (opcional)
            <input
              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
              value={form.linkUrl}
              onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
              placeholder="https://…"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={handleCreate}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
          Adicionar
        </button>
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-6">
        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">Registros publicados</h3>
        {loading ? (
          <div className="flex justify-center py-12 text-slate-500"><Loader2 className="animate-spin" size={28} /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 italic">Nenhum registro ainda.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="border border-slate-700 rounded-lg p-4 bg-slate-900/50">
                {editingId === r.id && editDraft ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <select
                        className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
                        value={editDraft.category}
                        onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value as TransparencyCategory })}
                      >
                        {CATS.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
                        value={editDraft.sortOrder}
                        onChange={(e) => setEditDraft({ ...editDraft, sortOrder: e.target.value })}
                      />
                      <input
                        className="md:col-span-2 bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
                        value={editDraft.title}
                        onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                      />
                      <textarea
                        className="md:col-span-2 bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white min-h-[80px]"
                        value={editDraft.body}
                        onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })}
                      />
                      <input
                        className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
                        value={editDraft.amountUsdc}
                        onChange={(e) => setEditDraft({ ...editDraft, amountUsdc: e.target.value })}
                        placeholder="USDC"
                      />
                      <input
                        className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
                        value={editDraft.linkUrl}
                        onChange={(e) => setEditDraft({ ...editDraft, linkUrl: e.target.value })}
                        placeholder="https://"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={saveEdit}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 text-white text-xs font-bold"
                      >
                        <Save size={14} /> Salvar
                      </button>
                      <button type="button" onClick={cancelEdit} className="px-3 py-1.5 rounded bg-slate-700 text-xs text-white">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase text-amber-500 font-bold mb-1">
                        {CATS.find((c) => c.id === r.category)?.label || r.category} · ordem {r.sortOrder}
                      </div>
                      <div className="text-white font-bold">{r.title}</div>
                      {r.body && <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap max-h-24 overflow-y-auto">{r.body}</p>}
                      <div className="text-xs text-slate-500 mt-2 font-mono">
                        {r.amountUsdc != null && Number.isFinite(r.amountUsdc) ? `${r.amountUsdc} USDC` : '—'}
                        {r.linkUrl ? ` · ${r.linkUrl}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        className="px-3 py-1.5 rounded border border-slate-600 text-xs text-slate-200 hover:bg-slate-800"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        className="p-2 rounded border border-red-900/50 text-red-400 hover:bg-red-950/40"
                        title="Remover"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
