import React, { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';
import type { LucideIcon } from 'lucide-react';
import { AccessLevel, User, SeasonPass, SeasonPurchase, AdminUpgrade, Upgrade, LootBox, MiningCoin, RigRoom } from '../types';
import { Crown, CheckCircle2, ShieldCheck, Zap, Rocket, Gift } from 'lucide-react';
import { getSeasonPasses, getSeasonPurchases, purchaseSeasonPass, getAdminUpgrades, purchaseAdminUpgrade, getUpgrades, getLootBoxes, getAdminUpgradePurchases, getMiningCoins, getMyRigRooms } from '../services/api';

interface UpgradeAccountProps {
  user: User;
  accessLevels: AccessLevel[];
  onUpgrade: (newLevelId: string) => void;
  usdcBalance?: number;
  onSuggestDeposit?: (amount: number) => void;
  onPassPurchased?: (seasonId: string, passId: string, newUsdc: number) => void;
  onReloadGameState?: () => void;
}

/** Lista branca para descrições HTML vindas do admin (UpgradeAccount). */
const RICH_HTML_PURIFY: Config = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'u',
    'span',
    'div',
    'ul',
    'ol',
    'li',
    'h3',
    'h4',
    'h5',
    'small',
    'sub',
    'sup',
    'a'
  ],
  ALLOWED_ATTR: ['class', 'href', 'title', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false
};

let richHtmlPurifyHooksInstalled = false;
function ensureRichHtmlPurifyHooks(): void {
  if (richHtmlPurifyHooksInstalled) return;
  richHtmlPurifyHooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A' || !(node instanceof HTMLAnchorElement)) return;
    if (node.getAttribute('target') === '_blank') {
      const rel = node.getAttribute('rel') || '';
      if (!/\bnoopener\b/i.test(rel)) {
        node.setAttribute('rel', rel ? `${rel} noopener noreferrer`.trim() : 'noopener noreferrer');
      }
    }
  });
}

function sanitizeRichHtmlFragment(html: string): string {
  if (!html) return '';
  ensureRichHtmlPurifyHooks();
  return DOMPurify.sanitize(html, RICH_HTML_PURIFY);
}

const RichDescription: React.FC<{ content: string; isRaw?: boolean }> = ({ content, isRaw }) => {
  if (!content) return null;

  let trimmed = content.trim();
  // Remove wrapping single/double quotes more aggressively
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    trimmed = trimmed.substring(1, trimmed.length - 1).trim();
  }

  // If it doesn't look like HTML, render as plain text with pre-wrap
  if (!trimmed.startsWith('<')) {
    return (
      <div
        className={`mb-4 text-sm ${isRaw ? '' : 'text-slate-600 dark:text-slate-300'}`}
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {trimmed}
      </div>
    );
  }

  // HTML/JSX Content
  let processed = trimmed.replace(/className=/g, 'class=');
  const iconRegex = /<([A-Z][a-zA-Z0-9]+)\s*([^>]*)\/>/g;
  const iconsMap: Record<string, LucideIcon> = { Gift, CheckCircle2, ShieldCheck, Zap, Rocket, Crown };

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = iconRegex.exec(processed)) !== null) {
    if (match.index > lastIndex) {
      const htmlPart = processed.substring(lastIndex, match.index);
      parts.push(<span key={`text-${lastIndex}`} dangerouslySetInnerHTML={{ __html: sanitizeRichHtmlFragment(htmlPart) }} />);
    }
    const iconName = match[1];
    const propsStr = match[2];
    const IconComponent = iconsMap[iconName];
    if (IconComponent) {
      const sizeMatch = propsStr.match(/size=\{?(\d+)\}?/);
      const classMatch = propsStr.match(/class(?:Name)?=["']([^"']+)["']/);
      parts.push(<IconComponent key={`icon-${match.index}`} size={sizeMatch ? parseInt(sizeMatch[1]) : 16} className={classMatch ? classMatch[1] : ''} />);
    } else {
      parts.push(<span key={`error-${match.index}`}>{match[0]}</span>);
    }
    lastIndex = iconRegex.lastIndex;
  }

  if (lastIndex < processed.length) {
    const htmlPart = processed.substring(lastIndex);
    parts.push(<span key={`text-${lastIndex}`} dangerouslySetInnerHTML={{ __html: sanitizeRichHtmlFragment(htmlPart) }} />);
  }

  return (
    <div
      className={`rich-description ${isRaw ? '' : 'mb-4 text-sm text-slate-600 dark:text-slate-300'}`}
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {parts}
    </div>
  );
};


export const UpgradeAccount: React.FC<UpgradeAccountProps> = ({ user, accessLevels, onUpgrade, usdcBalance = 0, onSuggestDeposit, onPassPurchased, onReloadGameState }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [seasonPasses, setSeasonPasses] = useState<SeasonPass[]>([]);
  const [seasonPurchases, setSeasonPurchases] = useState<SeasonPurchase[]>([]);
  const [loadingPasses, setLoadingPasses] = useState<boolean>(false);
  const [adminUpgrades, setAdminUpgrades] = useState<AdminUpgrade[]>([]);
  const [gameItems, setGameItems] = useState<Upgrade[]>([]);
  const [lootBoxDefs, setLootBoxDefs] = useState<LootBox[]>([]);
  const [adminUpgradePurchases, setAdminUpgradePurchases] = useState<string[]>([]);
  const [miningCoins, setMiningCoins] = useState<MiningCoin[]>([]);
  const [userRooms, setUserRooms] = useState<RigRoom[]>([]);

  useEffect(() => {
    let mounted = true;
    setLoadingPasses(true);
    (async () => {
      const [passes, purchases, offers, items, boxes, adminPurch, coins, rooms] = await Promise.all([
        getSeasonPasses(),
        user?.email ? getSeasonPurchases(user.email) : Promise.resolve([]),
        getAdminUpgrades(),
        getUpgrades(),
        getLootBoxes(),
        user?.email ? getAdminUpgradePurchases(user.email) : Promise.resolve([]),
        getMiningCoins(),
        user?.email ? getMyRigRooms(user.email) : Promise.resolve([])
      ]);
      if (!mounted) return;
      setSeasonPasses(passes.filter(p => p.isActive));
      setSeasonPurchases(purchases);
      setAdminUpgrades(offers);
      setGameItems(items);
      setLootBoxDefs(boxes);
      setAdminUpgradePurchases(adminPurch);
      setMiningCoins(coins || []);
      setUserRooms(rooms || []);
      setLoadingPasses(false);
    })();
    return () => { mounted = false; };
  }, [user]);

  const handleBuyAdminUpgrade = async (offer: AdminUpgrade) => {
    if (isProcessing) return;
    const price = offer.priceUsdc || 0;

    // Safety check repeated here
    const alreadyBought = adminUpgradePurchases.includes(offer.id) ||
      (offer.grantAccessLevelId && (
        (user.accessLevelIds && user.accessLevelIds.includes(offer.grantAccessLevelId)) ||
        user.accessLevelId === offer.grantAccessLevelId
      )) ||
      (offer.id === '53f0c699-0471-4e65-a147-17064e3aafe0' && userRooms.some(r => r.id === 'room_1765936323521' && r.owned));

    if (alreadyBought) return;
    if (usdcBalance < price) {
      const missing = Math.max(0, price - usdcBalance);
      if (onSuggestDeposit) onSuggestDeposit(parseFloat(missing.toFixed(2)));
      return;
    }
    setIsProcessing(true);
    const res = await purchaseAdminUpgrade(user.email, offer.id);
    setIsProcessing(false);
    if (res && res.ok) {
      if (res.newUsdc !== undefined && onPassPurchased) onPassPurchased('', offer.id, res.newUsdc);
      setAdminUpgradePurchases(prev => Array.from(new Set([...(prev || []), offer.id])));
      if (onReloadGameState) onReloadGameState();
      alert(`Upgrade comprado: ${offer.name}`);
    } else if (res && res.missing && onSuggestDeposit) {
      onSuggestDeposit(parseFloat(res.missing.toFixed(2)));
    } else if (res && res.error) {
      alert(res.error);
    }
  };

  const visibleAdminOffers = adminUpgrades
    .filter(u => u.isActive !== false)
    .filter(u => !u.visibleToAccessLevelIds || u.visibleToAccessLevelIds.length === 0 || (user.accessLevelIds && user.accessLevelIds.some(l => u.visibleToAccessLevelIds!.includes(l))) || (user.accessLevelId && u.visibleToAccessLevelIds.includes(user.accessLevelId)))
    .sort((a, b) => (a.priceUsdc || 0) - (b.priceUsdc || 0));

  const getTierStyles = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('genesis dao') || n.includes('náutilos') || n.includes('nautilos')) return { border: 'neon-border-cyan', text: 'text-amber-300 neon-text-cyan', btn: 'from-amber-500 to-orange-600 shadow-amber-500/30', glow: 'bg-gradient-to-r from-amber-500/20 to-orange-500/25' };
    if (n.includes('nemo')) return { border: 'neon-border-purple', text: 'text-orange-500 neon-text-purple', btn: 'from-orange-600 to-orange-800 shadow-orange-500/20', glow: 'bg-orange-500/10' };
    if (n.includes('baleia')) return { border: 'neon-border-cyan', text: 'text-amber-500 neon-text-cyan', btn: 'from-amber-600 to-orange-600 shadow-amber-500/20', glow: 'bg-amber-500/10' };
    if (n.includes('kraken')) return { border: 'neon-border-green', text: 'text-green-500 neon-text-green', btn: 'from-green-600 to-emerald-600 shadow-green-500/20', glow: 'bg-green-500/10' };
    return { border: 'border-slate-800', text: 'text-white', btn: 'from-slate-700 to-slate-800', glow: 'bg-white/5' };
  };

  return (
    <div className="h-full flex flex-col p-8 overflow-y-auto custom-scrollbar relative bg-slate-950">
      {/* Background Decor */}
      <div className="nebula-bg" />

      <div className="relative z-10 w-full max-w-7xl mx-auto">
        <header className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-black text-white mb-4 tracking-tight">
            Escolha o <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">nível certo</span> para a sua sala
          </h2>
        </header>

        {loadingPasses ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
          </div>
        ) : visibleAdminOffers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center rounded-3xl border border-slate-800 bg-slate-900/40 max-w-xl mx-auto">
            <Crown className="text-slate-600 mb-4" size={48} />
            <p className="text-lg font-bold text-slate-200 mb-2">Nenhum upgrade disponível no momento</p>
            <p className="text-sm text-slate-500 max-w-md">
              Não há pacotes de nível à venda para o seu perfil agora, ou todos já foram adquiridos. Volte mais tarde ou fale com o suporte se esperava ver uma oferta aqui.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {visibleAdminOffers
              .map(offer => {
                const styles = getTierStyles(offer.name);
                const alreadyBought = adminUpgradePurchases.includes(offer.id) ||
                  (offer.grantAccessLevelId && (
                    (user.accessLevelIds && user.accessLevelIds.includes(offer.grantAccessLevelId)) ||
                    user.accessLevelId === offer.grantAccessLevelId
                  )) ||
                  (offer.id === '53f0c699-0471-4e65-a147-17064e3aafe0' && userRooms.some(r => r.id === 'room_1765936323521' && r.owned));

                const boxList = (offer.boxes || []).map(b => {
                  const def = lootBoxDefs.find(x => x.id === b.boxId);
                  return { qty: b.qty || 1, name: (def?.name || b.boxId) };
                });
                const itemList = (offer.items || []).map(i => ({ qty: i.qty || 1, name: (gameItems.find(x => x.id === i.itemId)?.name || i.itemId) }));

                return (
                  <div key={offer.id} className={`group relative glass-card rounded-[2rem] p-8 border transition-all duration-500 flex flex-col min-h-[550px] ${styles.border} ${alreadyBought ? 'opacity-80 scale-95 grayscale-[0.5]' : 'hover:-translate-y-4 hover:brightness-110'}`}>

                    {/* Inner Glow */}
                    <div className={`absolute top-0 inset-x-0 h-40 ${styles.glow} blur-3xl rounded-full -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />

                    <div className="relative z-10 flex flex-col h-full">
                      {/* Name & Icon */}
                      <div className="flex justify-between items-start mb-6">
                        <h3 className={`text-3xl font-black uppercase tracking-tighter leading-none ${styles.text}`}>
                          {offer.name}
                        </h3>
                        <Crown className={`${styles.text} shrink-0`} size={24} />
                      </div>

                      {/* Description (HTML opcional do admin, sanitizado com DOMPurify) */}
                      <div className="text-sm text-slate-300 font-medium mb-8 leading-relaxed">
                        <RichDescription
                          isRaw
                          content={
                            offer.description?.trim()
                              ? offer.description
                              : 'Desbloqueie vantagens e conteúdos extras na sua operação.'
                          }
                        />
                      </div>

                      {/* Price */}
                      <div className="flex items-baseline gap-2 mb-10">
                        <span className="text-5xl font-black text-white">${offer.priceUsdc}</span>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">USDC</span>
                      </div>

                      {/* Action Button */}
                      <button
                        onClick={() => handleBuyAdminUpgrade(offer)}
                        disabled={isProcessing || alreadyBought}
                        className={`w-full py-4 rounded-2xl font-black text-xs tracking-[0.1em] uppercase transition-all duration-300 relative overflow-hidden group/btn disabled:grayscale disabled:opacity-50 mb-8
                          ${alreadyBought ? 'bg-slate-800 text-slate-500' : `bg-gradient-to-br ${styles.btn} text-white shadow-2xl hover:scale-[1.02] active:scale-95`}
                        `}
                      >
                        <span className="relative z-10">
                          {alreadyBought ? 'ADQUIRIDO' : isProcessing ? 'PROCESSANDO...' : 'ADQUIRIR E UPGRADAR'}
                        </span>
                        {!alreadyBought && (
                          <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300" />
                        )}
                      </button>

                      {/* Content List */}
                      <div className="flex-1 space-y-4 overflow-hidden">
                        {(boxList.length > 0 || itemList.length > 0) && (
                          <>
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">CONTEÚDO ADICIONAL:</div>
                            <div className="space-y-2">
                              {boxList.map((box, i) => (
                                <div key={i} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-3 text-sm group-hover:bg-white/10 transition-colors">
                                  <span className={`font-black ${styles.text.split(' ')[0]}`}>{box.qty}x</span>
                                  <span className="text-slate-200">{box.name}</span>
                                </div>
                              ))}
                              {itemList.map((item, i) => (
                                <div key={i} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-3 text-sm group-hover:bg-white/10 transition-colors">
                                  <span className={`font-black ${styles.text.split(' ')[0]}`}>{item.qty}x</span>
                                  <span className="text-slate-200">{item.name}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Badge for Owned */}
                    {alreadyBought && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[10px] font-black px-4 py-1 rounded-full shadow-lg z-20">
                        ADQUIRIDO
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};


