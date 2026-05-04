import React, { useState, useEffect, useCallback } from 'react';
import { SystemNews, User, Upgrade, AccessLevel, LootBox, RigRoom } from '../types';
import { Activity, Users, Layers, Gift, Newspaper, Shield, ChevronLeft, ChevronRight, Wallet, Cog, DollarSign, Store, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import { AdminDashboard } from './AdminDashboard';
import { AdminUsers } from './AdminUsers';
import { AdminEditor } from './AdminEditor';
import { AdminLootBoxes } from './AdminLootBoxes';
import { AdminNews } from './AdminNews';
import { AdminWeb3Menu } from './AdminWeb3Menu';

import { getUsers, getSystemNews, getMiningCoins, getAdminUserMap } from '../services/api';
import { AdminSettingsPageVisibility } from './AdminSettingsPageVisibility';
import { AdminSettingsNavLabels } from './AdminSettingsNavLabels';
import { AdminRigRooms } from './AdminRigRooms';
import { AdminRigLayoutEditor } from './AdminRigLayoutEditor';
import { AdminBlackMarket } from './AdminBlackMarket';
import { AdminGames } from './AdminGames';
import { Layout, Database, Banknote, Skull, Gamepad2, Scale } from 'lucide-react';
import { AdminBackup } from './AdminBackup';
import { AdminSupport } from './AdminSupport';
import type { AdminUsersJumpTarget } from './AdminUsers';

import { AdminMonetization } from './AdminMonetization';
import { AdminReports } from './AdminReports';
import { AdminSecurity } from './AdminSecurity';
import { AdminSeasonPasses } from './AdminSeasonPasses';
import { AdminTransparency } from './AdminTransparency';
import { BarChart as BarChartIcon } from 'lucide-react';
import { getSeasonPasses } from '../services/api';

interface AdminPanelProps {
    onUpdateGameUpgrades?: (upgrades: Upgrade[]) => Promise<void> | void;
    gameUpgrades?: Upgrade[];
    onUpdateAccessLevels?: (levels: AccessLevel[]) => void;
    accessLevels?: AccessLevel[];
    onUpdateLootBoxes?: (boxes: LootBox[]) => void;
    lootBoxes?: LootBox[];
    user?: User | null;
}
export const AdminPanel: React.FC<AdminPanelProps> = ({
    onUpdateGameUpgrades, gameUpgrades = [],
    onUpdateAccessLevels, accessLevels = [],
    onUpdateLootBoxes, lootBoxes = [],
    user
}) => {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'news' | 'users' | 'editor' | 'lootboxes' | 'web3' | 'settings' | 'layout' | 'backup' | 'monetization' | 'p2p' | 'reports' | 'games' | 'security' | 'shops' | 'transparency' | 'support'>(() => {
        try {
            return (localStorage.getItem('adminActiveTab') as any) || 'dashboard';
        } catch { return 'dashboard'; }
    });

    useEffect(() => {
        localStorage.setItem('adminActiveTab', activeTab);
    }, [activeTab]);

    // Security check: If activeTab is restricted, reset to dashboard or first allowed
    useEffect(() => {
        if (!user) return;
        if (user.adminPermissions === null || user.adminPermissions === undefined) return;
        if (!Array.isArray(user.adminPermissions)) return;
        if (!user.adminPermissions.includes(activeTab)) {
            // If current tab not allowed, find first allowed or default to dashboard
            const allowed = user.adminPermissions;
            if (allowed.length > 0) setActiveTab(allowed[0] as any);
            else setActiveTab('dashboard'); // fallback
        }
    }, [user, activeTab]);

    const [newsList, setNewsList] = useState<SystemNews[]>([]);
    const [userMap, setUserMap] = useState<Array<{ id: number; username: string; polygonWallet?: string; email: string }>>([]);
    const [isDataLoaded, setIsDataLoaded] = useState(false);

    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem('adminSidebarCollapsed') === 'true';
        } catch { return false; }
    });
    const [shopsSubtab, setShopsSubtab] = useState<'hardware' | 'blackmarket' | 'layout'>('hardware');
    const [settingsSubtab, setSettingsSubtab] = useState<
        'pages' | 'navlabels' | 'rigrooms' | 'news' | 'monetization' | 'passes'
    >('pages');

    const [seasonPasses, setSeasonPasses] = useState<any[]>([]);
    const [jumpToUser, setJumpToUser] = useState<AdminUsersJumpTarget | null>(null);

    const clearJumpToUser = useCallback(() => setJumpToUser(null), []);

    const loadPasses = async () => {
        try {
            const list = await getSeasonPasses();
            setSeasonPasses(list || []);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        if (activeTab === 'settings' && settingsSubtab === 'passes') {
            loadPasses();
        }
    }, [activeTab, settingsSubtab]);

    useEffect(() => {
        localStorage.setItem('adminSidebarCollapsed', String(sidebarCollapsed));
    }, [sidebarCollapsed]);

    // Load static/map data once
    useEffect(() => {
        console.log('[AdminPanel] Loading user map...');
        const loadMap = async () => {
            try {
                const map = await getAdminUserMap();
                console.log('[AdminPanel] User map loaded:', map.length, 'users');
                setUserMap(map);
                setIsDataLoaded(true);
                console.log('[AdminPanel] isDataLoaded set to true');
            } catch (error) {
                console.error('[AdminPanel] Error loading user map:', error);
            }
        };
        loadMap();
    }, []);

    // Load data based on active tab with 5s interval (User proposal)
    useEffect(() => {
        if (!activeTab) return;

        const fetchData = async () => {
            if (activeTab === 'news' || settingsSubtab === 'news') {
                const news = await getSystemNews();
                setNewsList(news);
            }
        };

        // Immediate load on tab change
        fetchData();

        // 5s interval for active tab only
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [activeTab, settingsSubtab]);

    return (
        <div className="bg-slate-900 text-slate-200 font-mono flex">
            <aside className={`bg-slate-950 border-r border-red-900/50 p-4 sticky top-0 h-screen flex flex-col gap-4 shrink-0 transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-20' : 'w-72'}`}>
                <div className="flex items-center justify-between">
                    <div className={`flex items-center transition-all duration-300 ${sidebarCollapsed ? 'justify-center w-full' : 'gap-3 w-auto'} overflow-hidden`}>
                        <div className="bg-red-600 text-white p-2 rounded-lg shadow-lg shadow-red-600/20 shrink-0">
                            <Shield size={24} />
                        </div>
                        <div className={`transition-all duration-300 ${sidebarCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto ml-3'} whitespace-nowrap`}>
                            <h1 className="text-xl font-bold text-white tracking-widest">BACKEND ADMIN</h1>
                            <p className="text-[10px] text-red-500 uppercase">Acesso Restrito • Nível 5</p>
                        </div>
                    </div>
                    {!sidebarCollapsed && (
                        <button onClick={() => setSidebarCollapsed(v => !v)} className="p-2 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 shrink-0">
                            <ChevronLeft size={16} />
                        </button>
                    )}
                </div>
                {sidebarCollapsed && (
                    <button onClick={() => setSidebarCollapsed(v => !v)} className="w-full flex justify-center p-2 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 shrink-0">
                        <ChevronRight size={16} />
                    </button>
                )}
                <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-2 overflow-x-hidden">
                    {[
                        { id: 'dashboard', icon: <Activity size={18} />, label: 'Dashboard' },
                        { id: 'users', icon: <Users size={18} />, label: 'Usuários' },
                        { id: 'shops', icon: <Store size={18} />, label: 'Lojas' },
                        { id: 'lootboxes', icon: <Gift size={18} />, label: 'Caixas' },
                        { id: 'web3', icon: <Wallet size={18} />, label: 'Web3' },
                        { id: 'settings', icon: <Cog size={18} />, label: 'Configurações' },
                        { id: 'reports', icon: <BarChartIcon size={18} />, label: 'Relatórios' },
                        { id: 'transparency', icon: <Scale size={18} />, label: 'Transparência' },
                        { id: 'games', icon: <Gamepad2 size={18} />, label: 'Games' },
                        { id: 'security', icon: <Shield size={18} />, label: 'Segurança' },
                        { id: 'backup', icon: <Database size={18} />, label: 'Backup' },
                        { id: 'support', icon: <MessageCircle size={18} />, label: 'Suporte' },
                    ].filter(item => {
                        if (!user) return false;
                        if (user.adminPermissions === null || user.adminPermissions === undefined) return true;
                        if (!Array.isArray(user.adminPermissions)) return true; // Default to allow if not array
                        return user.adminPermissions.includes(item.id);
                    })
                        .map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id as any)}
                                className={`w-full flex items-center px-3 py-2.5 rounded text-sm font-bold transition-all duration-200 border group ${activeTab === item.id
                                    ? 'bg-red-600/10 text-white border-red-900/50 shadow-[0_0_15px_rgba(220,38,38,0.1)]'
                                    : 'text-slate-400 hover:text-white border-transparent hover:bg-slate-800/50'
                                    } ${sidebarCollapsed ? 'justify-center' : 'justify-start gap-3'}`}
                                title={sidebarCollapsed ? item.label : ''}
                            >
                                <div className={`shrink-0 transition-transform duration-300 ${activeTab === item.id ? 'scale-110' : 'group-hover:scale-110'}`}>
                                    {item.icon}
                                </div>
                                <span className={`transition-all duration-300 overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0 invisible' : 'w-auto opacity-100 visible'}`}>
                                    {item.label}
                                </span>
                            </button>
                        ))
                    }
                </nav>
            </aside>
            <main className="min-w-0 flex-1 overflow-x-hidden">
                <div className="max-w-7xl mx-auto min-w-0 p-4 sm:p-6">
                    {/* Security Wrapper Helper */}
                    {(() => {
                        const isAllowed = (tab: string) => {
                            if (!user) return false;
                            if (user.adminPermissions === null || user.adminPermissions === undefined) return true;
                            if (!Array.isArray(user.adminPermissions)) return true; // Default to allow if not array
                            // Check exact match or if any permission starts with "tab:" (for sub-menus)
                            return user.adminPermissions.includes(tab) ||
                                user.adminPermissions.some(p => p.startsWith(`${tab}:`));
                        };

                        return (
                            <>
                                {activeTab === 'dashboard' && (
                                    <AdminDashboard users={userMap as any} gameUpgrades={gameUpgrades} />
                                )}
                                {activeTab === 'users' && isDataLoaded && (
                                    <>
                                        {console.log('[AdminPanel] Rendering AdminUsers with', userMap.length, 'users')}
                                        <AdminUsers
                                            user={user}
                                            users={userMap as any}
                                            accessLevels={accessLevels}
                                            onUpdateAccessLevels={onUpdateAccessLevels}
                                            gameUpgrades={gameUpgrades}
                                            jumpToUser={jumpToUser}
                                            onJumpToUserHandled={clearJumpToUser}
                                        />
                                    </>
                                )}
                                {activeTab === 'users' && !isDataLoaded && (
                                    <>
                                        {console.log('[AdminPanel] Showing loader, isDataLoaded:', isDataLoaded)}
                                        <div className="flex flex-col items-center justify-center p-12 space-y-4">
                                            <div className="text-amber-500 text-4xl animate-spin">⏳</div>
                                            <div className="text-slate-400 font-bold">Carregando dados administrativos...</div>
                                            <div className="text-xs text-slate-500">Aguardando informações do servidor.</div>
                                        </div>
                                    </>
                                )}
                                {activeTab === 'shops' && isAllowed('shops') && (
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-2 border-b border-slate-700 pb-3 mb-3">
                                            {isAllowed('shops:hardware') && (
                                                <button
                                                    onClick={() => setShopsSubtab('hardware')}
                                                    className={`px-4 py-2 text-sm font-bold rounded border flex items-center gap-2 transition-all ${shopsSubtab === 'hardware' ? 'bg-red-600/20 text-white border-red-600/50 shadow-[0_0_10px_rgba(220,38,38,0.1)]' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    <Layers size={16} />
                                                    Mercado de Hardware
                                                </button>
                                            )}
                                            {isAllowed('shops:blackmarket') && (
                                                <button
                                                    onClick={() => setShopsSubtab('blackmarket')}
                                                    className={`px-4 py-2 text-sm font-bold rounded border flex items-center gap-2 transition-all ${shopsSubtab === 'blackmarket' ? 'bg-red-600/20 text-white border-red-600/50 shadow-[0_0_10px_rgba(220,38,38,0.1)]' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    <Skull size={16} />
                                                    Mercado Negro
                                                </button>
                                            )}
                                            {isAllowed('shops:layout') && (
                                                <button
                                                    onClick={() => setShopsSubtab('layout')}
                                                    className={`px-4 py-2 text-sm font-bold rounded border flex items-center gap-2 transition-all ${shopsSubtab === 'layout' ? 'bg-red-600/20 text-white border-red-600/50 shadow-[0_0_10px_rgba(220,38,38,0.1)]' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    <Layout size={16} />
                                                    Estruturas
                                                </button>
                                            )}
                                        </div>
                                        {shopsSubtab === 'hardware' && isAllowed('shops:hardware') && (
                                            <AdminEditor
                                                gameUpgrades={gameUpgrades}
                                                onUpdateGameUpgrades={onUpdateGameUpgrades}
                                            />
                                        )}
                                        {shopsSubtab === 'blackmarket' && isAllowed('shops:blackmarket') && (
                                            <AdminBlackMarket gameUpgrades={gameUpgrades} />
                                        )}
                                        {shopsSubtab === 'layout' && isAllowed('shops:layout') && (
                                            <AdminRigLayoutEditor
                                                gameUpgrades={gameUpgrades}
                                                onUpdateGameUpgrades={onUpdateGameUpgrades}
                                            />
                                        )}
                                    </div>
                                )}
                                {activeTab === 'lootboxes' && isAllowed('lootboxes') && (
                                    <AdminLootBoxes
                                        lootBoxes={lootBoxes}
                                        onUpdateLootBoxes={onUpdateLootBoxes}
                                        gameUpgrades={gameUpgrades}
                                    />
                                )}
                                {activeTab === 'web3' && isAllowed('web3') && (
                                    <AdminWeb3Menu />
                                )}

                                {activeTab === 'settings' && isAllowed('settings') && (
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-2 border-b border-slate-700 pb-3 mb-3">
                                            {isAllowed('settings:pages') && (
                                                <button
                                                    onClick={() => setSettingsSubtab('pages')}
                                                    className={`px-3 py-2 text-xs font-bold rounded border ${settingsSubtab === 'pages' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    Visibilidade de Páginas por Nível
                                                </button>
                                            )}
                                            {isAllowed('settings:pages') && (
                                                <button
                                                    onClick={() => setSettingsSubtab('navlabels')}
                                                    className={`px-3 py-2 text-xs font-bold rounded border ${settingsSubtab === 'navlabels' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    Nomes do menu (jogador)
                                                </button>
                                            )}
                                            {isAllowed('settings:rigrooms') && (
                                                <button
                                                    onClick={() => setSettingsSubtab('rigrooms')}
                                                    className={`px-3 py-2 text-xs font-bold rounded border ${settingsSubtab === 'rigrooms' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    Gerenciador de salas de Rigs
                                                </button>
                                            )}
                                            {isAllowed('settings:news') && (
                                                <button
                                                    onClick={() => setSettingsSubtab('news')}
                                                    className={`px-3 py-2 text-xs font-bold rounded border ${settingsSubtab === 'news' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    Gerenciar News
                                                </button>
                                            )}
                                            {isAllowed('settings:monetization') && (
                                                <button
                                                    onClick={() => setSettingsSubtab('monetization')}
                                                    className={`px-3 py-2 text-xs font-bold rounded border ${settingsSubtab === 'monetization' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    Monetização
                                                </button>
                                            )}
                                            {isAllowed('settings:passes') && (
                                                <button
                                                    onClick={() => setSettingsSubtab('passes')}
                                                    className={`px-3 py-2 text-xs font-bold rounded border ${settingsSubtab === 'passes' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-400 hover:text-white border-transparent hover:border-slate-700'}`}
                                                >
                                                    Passes de Temporada
                                                </button>
                                            )}
                                        </div>
                                        {settingsSubtab === 'pages' && isAllowed('settings:pages') && (
                                            <AdminSettingsPageVisibility accessLevels={accessLevels} onUpdateAccessLevels={onUpdateAccessLevels} />
                                        )}
                                        {settingsSubtab === 'navlabels' && isAllowed('settings:pages') && (
                                            <AdminSettingsNavLabels />
                                        )}
                                        {settingsSubtab === 'rigrooms' && isAllowed('settings:rigrooms') && (
                                            <AdminRigRooms accessLevels={accessLevels} />
                                        )}
                                        {settingsSubtab === 'news' && isAllowed('settings:news') && (
                                            <AdminNews
                                                newsList={newsList}
                                                setNewsList={setNewsList}
                                                accessLevels={accessLevels}
                                                onUpdateAccessLevels={onUpdateAccessLevels}
                                            />
                                        )}
                                        {settingsSubtab === 'monetization' && isAllowed('settings:monetization') && (
                                            <AdminMonetization />
                                        )}
                                        {settingsSubtab === 'passes' && isAllowed('settings:passes') && (
                                            <AdminSeasonPasses seasonPasses={seasonPasses} onUpdatePasses={loadPasses} />
                                        )}
                                    </div>
                                )}

                                {activeTab === 'backup' && isAllowed('backup') && (
                                    <AdminBackup />
                                )}
                                {activeTab === 'reports' && isAllowed('reports') && (
                                    <AdminReports users={userMap as any} />
                                )}
                                {activeTab === 'transparency' && isAllowed('transparency') && (
                                    <AdminTransparency />
                                )}
                                {activeTab === 'games' && isAllowed('games') && (
                                    <AdminGames gameUpgrades={gameUpgrades} />
                                )}
                                {activeTab === 'security' && isAllowed('security') && (
                                    <AdminSecurity />
                                )}
                                {activeTab === 'support' && isAllowed('support') && (
                                    <AdminSupport
                                        canOpenPlayerProfile={isAllowed('users')}
                                        onOpenPlayerProfile={(p) => {
                                            if (!isAllowed('users')) {
                                                window.alert(
                                                    'Para gerir o perfil deste jogador (estoque, carteira, níveis de acesso, etc.) precisa da permissão Utilizadores no painel admin.'
                                                );
                                                return;
                                            }
                                            setJumpToUser({
                                                key: Date.now(),
                                                userId: p.userId,
                                                email: p.email,
                                                username: p.username,
                                            });
                                            setActiveTab('users');
                                        }}
                                    />
                                )}
                            </>
                        );
                    })()}
                </div>
            </main>
        </div>
    );
};
