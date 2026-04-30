import React, { useState, useEffect } from 'react';
import { Database as DbIcon, Download, RotateCcw, Trash2, Plus, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';

interface BackupFile {
    filename: string;
    size: number;
    createdAt: number;
}

const AutoBackupConfig: React.FC = () => {
    const [enabled, setEnabled] = useState(false);
    const [interval, setIntervalVal] = useState(60);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setLoading(true);
        fetch('/api/admin/backup-settings')
            .then(r => r.json())
            .then(data => {
                setEnabled(data.enabled);
                setIntervalVal(data.intervalMinutes);
            })
            .catch(e => console.error(e))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/admin/backup-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled, intervalMinutes: interval })
            });
            if (res.ok) {
                // Optional: show toast
            }
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700 animate-pulse h-24"></div>;

    return (
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${enabled ? 'bg-green-500/10 text-green-500' : 'bg-slate-700/50 text-slate-500'}`}>
                    <RotateCcw size={24} className={enabled ? 'animate-spin-slow' : ''} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Backup Automático</h3>
                    <p className="text-sm text-slate-400">
                        {enabled
                            ? `Ativo: Rodando a cada ${interval} minutos.`
                            : 'O sistema de backup automático está desligado.'}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-4 bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                <div className="flex items-center gap-2">
                    <label className="text-sm font-bold text-slate-400">Status:</label>
                    <button
                        onClick={() => setEnabled(!enabled)}
                        className={`relative w-12 h-6 rounded-full transition-colors ${enabled ? 'bg-green-600' : 'bg-slate-700'}`}
                    >
                        <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${enabled ? 'translate-x-6' : ''}`} />
                    </button>
                    <span className={`text-xs font-bold ${enabled ? 'text-green-500' : 'text-slate-500'}`}>
                        {enabled ? 'LIGADO' : 'DESLIGADO'}
                    </span>
                </div>

                <div className="w-px h-8 bg-slate-700 mx-2" />

                <div className="flex items-center gap-2">
                    <label className="text-sm font-bold text-slate-400">Intervalo (min):</label>
                    <input
                        type="number"
                        min="5"
                        max="10080"
                        value={interval}
                        onChange={(e) => setIntervalVal(parseInt(e.target.value) || 60)}
                        className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-sm font-mono text-center focus:border-amber-500 outline-none"
                    />
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="ml-4 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded font-bold text-sm transition-all shadow-lg shadow-amber-600/20 disabled:opacity-50"
                >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : 'Salvar Config'}
                </button>
            </div>
        </div>
    );
};

export const AdminBackup: React.FC = () => {
    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [backupName, setBackupName] = useState('');
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
    const [showConfirmRestore, setShowConfirmRestore] = useState<string | null>(null);

    const loadBackups = async () => {
        setLoading(true);
        try {
            const resp = await fetch('/api/admin/backups');
            if (resp.ok) {
                const data = await resp.json();
                setBackups(Array.isArray(data) ? data : []);
            } else {
                setBackups([]);
            }
        } catch (e) {
            console.error('Erro ao carregar backups:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadBackups();
    }, []);

    const handleCreateBackup = async () => {
        if (actionLoading) return;
        setActionLoading('create');
        setMessage(null);
        try {
            const resp = await fetch('/api/admin/backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: backupName || 'manual_backup' })
            });
            if (resp.ok) {
                setMessage({ text: 'Backup criado com sucesso!', type: 'success' });
                setBackupName('');
                loadBackups();
            } else {
                setMessage({ text: 'Falha ao criar backup.', type: 'error' });
            }
        } catch (e) {
            setMessage({ text: 'Erro de conexão.', type: 'error' });
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeleteBackup = async (filename: string) => {
        if (actionLoading) return;
        setActionLoading(`delete-${filename}`);
        try {
            const resp = await fetch(`/api/admin/backups/${filename}`, { method: 'DELETE' });
            if (resp.ok) {
                loadBackups();
            }
        } catch (e) {
            console.error('Erro ao deletar:', e);
        } finally {
            setActionLoading(null);
        }
    };

    const handleRestore = async (filename: string) => {
        if (actionLoading) return;
        setActionLoading(`restore-${filename}`);
        setMessage(null);
        try {
            const resp = await fetch('/api/admin/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename })
            });
            if (resp.ok) {
                setMessage({ text: 'Banco de dados restaurado com sucesso! (Merge concluído)', type: 'success' });
                setShowConfirmRestore(null);
            } else {
                const err = await resp.json();
                setMessage({ text: `Falha na restauração: ${err.error || 'Erro desconhecido'}`, type: 'error' });
            }
        } catch (e) {
            setMessage({ text: 'Erro crítico na restauração.', type: 'error' });
        } finally {
            setActionLoading(null);
        }
    };

    const handleDownload = (filename: string) => {
        window.open(`/api/admin/backups/download/${filename}`, '_blank');
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (actionLoading) return;
        setActionLoading('upload');
        setMessage(null);

        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64 = (reader.result as string).split(',')[1];
                const resp = await fetch('/api/admin/backups/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: file.name, content: base64 })
                });

                if (resp.ok) {
                    setMessage({ text: 'Backup enviado com sucesso!', type: 'success' });
                    loadBackups();
                } else {
                    const err = await resp.json();
                    setMessage({ text: `Falha no envio: ${err.error || 'Erro desconhecido'}`, type: 'error' });
                }
            } catch (e) {
                setMessage({ text: 'Erro ao processar arquivo.', type: 'error' });
            } finally {
                setActionLoading(null);
                e.target.value = '';
            }
        };
        reader.readAsDataURL(file);
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-700 pb-4">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <DbIcon className="text-red-500" /> Gerenciador de Backups
                    </h2>
                    <p className="text-slate-400 text-sm">Crie, gerencie, baixe e suba pontos de restauração.</p>
                </div>
                <div className="flex gap-2">
                    <label className={`cursor-pointer bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded font-bold text-sm transition-all flex items-center gap-2 ${actionLoading === 'upload' ? 'opacity-50 pointer-events-none' : ''}`}>
                        {actionLoading === 'upload' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} className="rotate-180" />}
                        Subir backup (.json / .db / …)
                        <input type="file" onChange={handleUpload} className="hidden" accept=".db,.sqlite,.back,.json,.sql,.gz" />
                    </label>
                </div>
            </div>

            {message && (
                <div className={`p-4 rounded border flex items-center gap-3 ${message.type === 'success' ? 'bg-green-900/20 border-green-900 text-green-400' : 'bg-red-900/20 border-red-900 text-red-400'}`}>
                    {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
                    <span className="text-sm font-bold">{message.text}</span>
                    <button onClick={() => setMessage(null)} className="ml-auto text-xs opacity-50 hover:opacity-100">Fechar</button>
                </div>
            )}

            {/* AUTO BACKUP CONFIGURATION */}
            <AutoBackupConfig />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 space-y-6">
                    <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 space-y-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Plus className="text-green-500" size={18} /> Novo Backup Local
                        </h3>
                        <div>
                            <label className="block text-xs uppercase text-slate-500 mb-1 font-bold">Identificador (Opcional)</label>
                            <input
                                type="text"
                                value={backupName}
                                onChange={e => setBackupName(e.target.value)}
                                placeholder="ex: antes_da_update"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:border-red-500 outline-none"
                            />
                        </div>
                        <button
                            onClick={handleCreateBackup}
                            disabled={!!actionLoading}
                            className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-2 rounded transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
                        >
                            {actionLoading === 'create' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                            Criar Backup Agora
                        </button>
                    </div>

                    <div className="bg-amber-900/10 p-6 rounded-xl border border-amber-900/30 space-y-3">
                        <h3 className="text-amber-500 font-bold flex items-center gap-2">
                            <AlertTriangle size={18} /> Aviso de Restauração
                        </h3>
                        <p className="text-xs text-amber-500/80 leading-relaxed">
                            A restauração utiliza um sistema de <strong className="text-amber-400">Mesclagem Seletiva (Merge)</strong>.
                            Apenas tabelas e colunas presentes no arquivo de backup serão atualizadas.
                            Novas funcionalidades e configurações da versão atual serão preservadas se não existirem no backup.
                        </p>
                    </div>
                </div>

                <div className="md:col-span-2">
                    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                        <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-900/50">
                            <h3 className="font-bold text-white">Backups Disponíveis no Servidor</h3>
                            <button onClick={loadBackups} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                                {loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Atualizar
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs uppercase text-slate-500 bg-slate-900/30 font-bold">
                                    <tr>
                                        <th className="px-6 py-3">Arquivo</th>
                                        <th className="px-6 py-3">Tamanho</th>
                                        <th className="px-6 py-3 text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {backups.length === 0 ? (
                                        <tr>
                                            <td colSpan={3} className="px-6 py-12 text-center text-slate-500 italic">
                                                Nenhum backup encontrado no diretório.
                                            </td>
                                        </tr>
                                    ) : (
                                        <>
                                            {/* BACKUPS MANUAIS */}
                                            {backups.filter(b => !b.filename.startsWith('auto_')).length > 0 && (
                                                <>
                                                    <tr className="bg-slate-800/80">
                                                        <td colSpan={3} className="px-6 py-2 text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-t border-slate-700">
                                                            Backups Manuais
                                                        </td>
                                                    </tr>
                                                    {backups.filter(b => !b.filename.startsWith('auto_')).map(b => (
                                                        <tr key={b.filename} className="hover:bg-slate-700/30 transition-colors group">
                                                            <td className="px-6 py-4">
                                                                <div className="flex flex-col">
                                                                    <span className="text-white font-medium truncate max-w-xs" title={b.filename}>{b.filename}</span>
                                                                    <span className="text-[10px] text-slate-500">{new Date(b.createdAt).toLocaleString()}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 text-slate-400">{formatSize(b.size)}</td>
                                                            <td className="px-6 py-4 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    {showConfirmRestore === b.filename ? (
                                                                        <div className="flex items-center gap-1 bg-amber-900/30 p-1 rounded border border-amber-900/50">
                                                                            <span className="text-[10px] text-amber-500 px-2 font-bold uppercase">Confirmar?</span>
                                                                            <button
                                                                                onClick={() => handleRestore(b.filename)}
                                                                                className="bg-amber-600 hover:bg-amber-500 text-white text-[10px] px-2 py-1 rounded font-bold"
                                                                            >
                                                                                Sim
                                                                            </button>
                                                                            <button
                                                                                onClick={() => setShowConfirmRestore(null)}
                                                                                className="text-slate-400 hover:text-white text-[10px] px-2 py-1"
                                                                            >
                                                                                Não
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <button
                                                                                onClick={() => handleDownload(b.filename)}
                                                                                disabled={!!actionLoading}
                                                                                className="p-2 text-slate-400 hover:text-amber-500 transition-colors"
                                                                                title="Baixar arquivo para o PC"
                                                                            >
                                                                                <Download size={18} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => setShowConfirmRestore(b.filename)}
                                                                                disabled={!!actionLoading}
                                                                                className="p-2 text-slate-400 hover:text-amber-500 transition-colors"
                                                                                title="Restaurar este backup"
                                                                            >
                                                                                <RotateCcw size={18} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleDeleteBackup(b.filename)}
                                                                                disabled={!!actionLoading}
                                                                                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                                                                                title="Deletar arquivo"
                                                                            >
                                                                                <Trash2 size={18} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </>
                                            )}

                                            {/* BACKUPS AUTOMÁTICOS */}
                                            {backups.filter(b => b.filename.startsWith('auto_')).length > 0 && (
                                                <>
                                                    <tr className="bg-slate-800/80">
                                                        <td colSpan={3} className="px-6 py-2 text-xs font-bold text-amber-400 uppercase tracking-widest border-b border-t border-slate-700">
                                                            Backups Automáticos (Últimas 24h)
                                                        </td>
                                                    </tr>
                                                    {backups.filter(b => b.filename.startsWith('auto_')).map(b => (
                                                        <tr key={b.filename} className="hover:bg-slate-700/30 transition-colors group">
                                                            <td className="px-6 py-4">
                                                                <div className="flex flex-col">
                                                                    <span className="text-white font-medium truncate max-w-xs" title={b.filename}>{b.filename}</span>
                                                                    <span className="text-[10px] text-slate-500">{new Date(b.createdAt).toLocaleString()}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 text-slate-400">{formatSize(b.size)}</td>
                                                            <td className="px-6 py-4 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    {showConfirmRestore === b.filename ? (
                                                                        <div className="flex items-center gap-1 bg-amber-900/30 p-1 rounded border border-amber-900/50">
                                                                            <span className="text-[10px] text-amber-500 px-2 font-bold uppercase">Confirmar?</span>
                                                                            <button
                                                                                onClick={() => handleRestore(b.filename)}
                                                                                className="bg-amber-600 hover:bg-amber-500 text-white text-[10px] px-2 py-1 rounded font-bold"
                                                                            >
                                                                                Sim
                                                                            </button>
                                                                            <button
                                                                                onClick={() => setShowConfirmRestore(null)}
                                                                                className="text-slate-400 hover:text-white text-[10px] px-2 py-1"
                                                                            >
                                                                                Não
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <button
                                                                                onClick={() => handleDownload(b.filename)}
                                                                                disabled={!!actionLoading}
                                                                                className="p-2 text-slate-400 hover:text-amber-500 transition-colors"
                                                                                title="Baixar arquivo para o PC"
                                                                            >
                                                                                <Download size={18} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => setShowConfirmRestore(b.filename)}
                                                                                disabled={!!actionLoading}
                                                                                className="p-2 text-slate-400 hover:text-amber-500 transition-colors"
                                                                                title="Restaurar este backup"
                                                                            >
                                                                                <RotateCcw size={18} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleDeleteBackup(b.filename)}
                                                                                disabled={!!actionLoading}
                                                                                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                                                                                title="Deletar arquivo"
                                                                            >
                                                                                <Trash2 size={18} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </>
                                            )}
                                        </>
                                    )}

                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
};
