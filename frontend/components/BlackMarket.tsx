
import React, { useState, useEffect } from 'react';
import { GameState, MarketListing, Upgrade } from '../types';
import { Skull, DollarSign, PlusCircle, Package, Tag, Trash2, ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { getMarketListings, reserveMarketListing, cancelMarketReservation, buyMarketListing, claimMarketFunds, getCustodyListings, claimCustodyItem } from '../services/api';

interface BlackMarketProps {
  gameState: GameState;
  onBuyListing: (listing: MarketListing) => void;
  onCreateListing?: (itemId: string, price: number, qty: number) => void;
  onCancelListing?: (listingId: string) => void;
  upgrades: Upgrade[];
  currentUserName?: string;
  currentUserEmail?: string;
  isEnabled?: boolean;
  onClaimSuccess?: () => void;
  refreshTrigger?: number;
}

export const BlackMarket: React.FC<BlackMarketProps> = ({ gameState, onBuyListing, onCreateListing, onCancelListing, upgrades, currentUserName, currentUserEmail, isEnabled = true, onClaimSuccess, refreshTrigger = 0 }) => {
  if (!upgrades || upgrades.length === 0) return <div className="p-8 text-center text-slate-500 animate-pulse">Carregando mercado...</div>;



  const [mode, setMode] = useState<'buy' | 'sell' | 'vault'>('buy');
  const [marketListings, setMarketListings] = useState<MarketListing[]>([]);
  const [custodyListings, setCustodyListings] = useState<MarketListing[]>([]);
  const [confirmListing, setConfirmListing] = useState<MarketListing | null>(null);

  // Selling Form State
  // Selling Form State
  const [sellItemId, setSellItemId] = useState<string>(upgrades?.[0]?.id || '');
  const [sellPrice, setSellPrice] = useState<string>('');
  const [sellQty, setSellQty] = useState<string>('1');

  const getOwnedCount = (upgradeId: string) => {
    let count = gameState.stock[upgradeId] || 0;
    const up = upgrades.find(u => u.id === upgradeId);
    if (!up) return count;
    if (up.type === 'infrastructure') {
      count += gameState.placedRacks.filter(r => r.itemId === upgradeId).length;
    } else {
      gameState.placedRacks.forEach(r => {
        r.slots.forEach(s => { if (s === upgradeId) count++; });
        if (r.batteryId === upgradeId) count++;
        if (r.wiringId === upgradeId) count++;
        r.multiplierSlots?.forEach(s => { if (s === upgradeId) count++; });
      });
    }
    return count;
  };

  const getMarketPrice = (upgradeId: string) => {
    const def = upgrades.find(u => u.id === upgradeId);
    if (!def) return 0;
    return def.baseCost;
  };

  const getLastOfferPrice = (upgradeId: string) => {
    const listings = gameState.playerListings.filter(l => l.itemId === upgradeId);
    if (listings.length === 0) return undefined;
    return listings[listings.length - 1].price;
  };

  const getGlobalLastOfferPrice = (upgradeId: string) => {
    const market = marketListings.filter(l => l.itemId === upgradeId);
    if (market.length > 0) return market[market.length - 1].price;
    return getLastOfferPrice(upgradeId);
  };

  useEffect(() => {
    const ref = getGlobalLastOfferPrice(sellItemId);
    const fallback = getMarketPrice(sellItemId);
    const suggest = (ref ?? fallback);
    setSellPrice(suggest > 0 ? String(suggest) : '');
  }, [sellItemId, marketListings]);

  useEffect(() => {
    (async () => {
      const list = await getMarketListings();
      setMarketListings(list);
      if (mode === 'vault') {
        const custody = await getCustodyListings();
        setCustodyListings(custody);
      }
    })();
  }, [mode, refreshTrigger]);

  const handleSellSubmit = () => {
    console.log('[BlackMarket] handleSellSubmit called with:', { sellItemId, sellPrice, sellQty });
    if (!onCreateListing) {
      console.warn('[BlackMarket] onCreateListing is undefined');
      return;
    }
    const price = parseFloat(sellPrice);
    const qty = parseInt(sellQty);

    if (price > 0 && qty > 0) {
      console.log('[BlackMarket] Calling onCreateListing');
      onCreateListing(sellItemId, price, qty);
      setSellPrice('');
      setSellQty('1');
    } else {
      console.warn('[BlackMarket] Invalid price or qty', { price, qty });
    }
  };

  const formatCost = (val: number) => {
    if (val < 0.0001) return val.toFixed(8);
    if (val < 1) return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
    return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // Get upgrades player has in stock
  const sellableItems = upgrades.filter(u => (gameState.stock[u.id] || 0) > 0 && u.sellInBlackMarket !== false);
  const selectedSellItem = upgrades.find(u => u.id === sellItemId);
  const marketPrice = selectedSellItem ? getMarketPrice(selectedSellItem.id) : 0;
  const refPrice = (getGlobalLastOfferPrice(sellItemId) ?? marketPrice);
  const minAllowed = refPrice * 0.8;
  const maxAllowed = refPrice * 1.2;
  const parsedSellPrice = parseFloat(sellPrice);
  const parsedSellQty = parseInt(sellQty);
  const publishDisabled = (!sellableItems.length || !sellPrice || !sellQty || isNaN(parsedSellPrice) || parsedSellPrice <= 0 || isNaN(parsedSellQty) || parsedSellQty <= 0 || parsedSellPrice < minAllowed || parsedSellPrice > maxAllowed);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col shadow-2xl relative transition-colors">
      {/* Background Texture */}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] opacity-50 pointer-events-none"></div>

      {/* Header */}
      <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center relative z-10">
        <div>
          <h2 className="text-xl font-bold text-red-500 flex items-center gap-2 animate-pulse">
            <Skull size={20} /> MERCADO NEGRO (P2P)
          </h2>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest">Conexão Criptografada • Não-Rastreável</p>
        </div>

        <div className="flex gap-2 items-center">
          {(gameState.blackMarketBalance || 0) > 0 && (
            <div className="mr-2 flex items-center gap-2 bg-yellow-900/50 px-3 py-1 rounded border border-yellow-700 animate-in fade-in zoom-in">
              <span className="text-[10px] text-yellow-500 uppercase font-bold">Saldo:</span>
              <span className="text-sm font-mono font-bold text-yellow-400">${formatCost(gameState.blackMarketBalance || 0)}</span>
              <div className="text-[10px] text-yellow-600">(Resgate no Cofre)</div>
            </div>
          )}

          <button
            onClick={() => setMode('buy')}
            className={`px-4 py-2 rounded font-bold text-xs transition-colors border ${mode === 'buy' ? 'bg-red-900/50 border-red-500 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            COMPRAR
          </button>
          <button
            onClick={() => setMode('sell')}
            className={`px-4 py-2 rounded font-bold text-xs transition-colors border ${mode === 'sell' ? 'bg-red-900/50 border-red-500 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            VENDER
          </button>

          <button
            onClick={() => setMode('vault')}
            className={`px-4 py-2 rounded font-bold text-xs transition-colors border ${mode === 'vault' ? 'bg-red-900/50 border-red-500 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            COFRE
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div className="p-4 custom-scrollbar relative z-10 bg-slate-900/80">

        {/* BUY MODE */}
        {mode === 'buy' && (
          <div className="space-y-3">
            {marketListings.length === 0 ? (
              <div className="text-center py-8 text-slate-400 border border-dashed border-slate-800 rounded-lg">
                Nenhuma oferta disponível no momento.
              </div>
            ) : (
              <div className="space-y-2">
                {marketListings.map(listing => {
                  const item = upgrades.find(u => u.id === listing.itemId);
                  if (!item) return null;
                  if (item.sellInBlackMarket === false) return null;
                  const isOwn = listing.sellerName === currentUserName || listing.sellerName === currentUserEmail;
                  if (isOwn) return null; // Hide own listings from buy view

                  const canAfford = gameState.usdc >= listing.price;
                  const isReservedForOther = listing.reservedBy && listing.reservedBy !== currentUserName && listing.reservedBy !== currentUserEmail;
                  const hasImage = item.image;
                  return (
                    <div key={listing.id} className="bg-slate-800/50 border border-slate-700 hover:border-slate-500 rounded-lg p-3 flex justify-between items-center group transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-2xl text-slate-400 overflow-hidden">
                          {hasImage ? <img src={hasImage} className="w-full h-full object-cover" /> : item.icon}
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-200 text-sm group-hover:text-red-400 transition-colors">
                            {item.name}
                            {(listing.qty && listing.qty > 1) && (
                              <span className="ml-2 text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded border border-red-800">
                                x{listing.qty}
                              </span>
                            )}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-500">Vendedor: {listing.sellerName}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-bold text-sm ${canAfford ? 'text-green-400' : 'text-red-500'}`}>
                          ${formatCost(listing.price)}
                        </div>
                        <button
                          onClick={async () => {
                            const r = await reserveMarketListing(listing.id);
                            if (r && r.ok) { setConfirmListing(listing); const list = await getMarketListings(); setMarketListings(list); }
                          }}
                          disabled={!canAfford || isOwn || isReservedForOther || !isEnabled}
                          className={`
                                            mt-1 px-4 py-1.5 rounded text-xs font-bold flex items-center gap-1 ml-auto transition-colors
                                            ${(!canAfford || isOwn || isReservedForOther || !isEnabled) ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-800'}
                                        `}
                        >
                          {!isEnabled ? 'DESATIVADO' : 'COMPRAR'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* VAULT MODE */}
      {mode === 'vault' && (
        <div className="space-y-4">
          {/* CLAIM FUNDS UI */}
          {(gameState.blackMarketBalance || 0) > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-800/50 p-4 rounded-lg flex items-center justify-between">
              <div>
                <div className="text-yellow-500 font-bold text-sm uppercase mb-1">Saldo de Vendas</div>
                <div className="text-2xl font-mono text-yellow-400 font-bold">${formatCost(gameState.blackMarketBalance || 0)}</div>
              </div>
              <button
                onClick={async () => {
                  const res = await claimMarketFunds();
                  if (res && res.ok) {
                    if (onClaimSuccess) onClaimSuccess();
                  }
                }}
                className="bg-yellow-600 hover:bg-yellow-500 text-black font-bold px-6 py-2 rounded shadow-lg transition-colors border border-yellow-400"
              >
                RESGATAR SALDO
              </button>
            </div>
          )}

          <h3 className="text-slate-400 font-bold text-xs uppercase flex items-center gap-2 mt-4">
            <Lock size={14} /> Itens em Custódia ({custodyListings.length})
          </h3>

          {custodyListings.length === 0 ? (
            <div className="text-center py-12 text-slate-600 border border-dashed border-slate-800 rounded-lg">
              <Lock size={48} className="mx-auto mb-4 opacity-20" />
              Seu cofre está vazio.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {custodyListings.map(l => {
                const item = upgrades.find(u => u.id === l.itemId);
                if (!item) return null;
                return (
                  <div key={l.id} className="bg-slate-950 border border-slate-800 p-3 rounded flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-slate-500">
                      {item.image ? <img src={item.image} className="w-full h-full object-cover" /> : item.icon}
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-slate-200 text-sm">
                        {item.name}
                        {(l.qty && l.qty > 1) && <span className="text-xs text-slate-500 ml-2">x{l.qty}</span>}
                      </div>
                      <div className="text-xs text-slate-500">Comprado por: ${formatCost(l.price)}</div>
                    </div>
                    <button
                      onClick={async () => {
                        const r = await claimCustodyItem(l.id);
                        if (r && r.ok) {
                          if (onClaimSuccess) onClaimSuccess();
                          const custody = await getCustodyListings();
                          setCustodyListings(custody);
                        }
                      }}
                      className="bg-blue-900/50 hover:bg-blue-800 border border-blue-700 text-blue-300 text-xs px-3 py-1.5 rounded font-bold transition-colors"
                    >
                      RESGATAR
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* SELL MODE */}
      {mode === 'sell' && (
        <div className="flex flex-col h-full gap-6">

          {/* Sell Form */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2 text-sm border-b border-slate-800 pb-2">
              <PlusCircle size={16} className="text-red-500" /> CRIAR NOVA OFERTA
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase font-bold">Item do Estoque</label>
                <div className="relative">
                  <select
                    value={sellItemId}
                    onChange={(e) => setSellItemId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 pl-9 text-slate-200 text-sm outline-none focus:border-red-500 appearance-none"
                  >
                    {sellableItems.length === 0 && <option value="">Estoque Vazio</option>}
                    {sellableItems.map(u => (
                      <option key={u.id} value={u.id}>{u.name} (x{gameState.stock[u.id]})</option>
                    ))}
                  </select>
                  <Package className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Preço Unit. (USDC)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={sellPrice}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        const mp = selectedSellItem ? getMarketPrice(selectedSellItem.id) : 0;
                        const ref = getGlobalLastOfferPrice(sellItemId) ?? mp;
                        const min = ref * 0.8;
                        const max = ref * 1.2;
                        if (isNaN(v)) {
                          setSellPrice(e.target.value);
                        } else {
                          const clamped = Math.max(min, Math.min(max, v));
                          setSellPrice(String(clamped));
                        }
                      }}
                      placeholder={(selectedSellItem ? getMarketPrice(selectedSellItem.id) : 0).toString() || "0.00"}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 pl-7 text-slate-200 text-sm outline-none focus:border-red-500 font-mono"
                    />
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Quantidade</label>
                  <input
                    type="number"
                    min="1"
                    max={gameState.stock[sellItemId] || 1}
                    value={sellQty}
                    onChange={(e) => setSellQty(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 text-sm outline-none focus:border-red-500 font-mono"
                  />
                </div>
              </div>
            </div>

            {selectedSellItem && (
              <div className="mt-3 flex justify-between items-center text-xs text-slate-500 bg-slate-900/50 p-2 rounded">
                <span>Preço de Mercado (Loja): <span className="text-green-500 font-mono">${formatCost(marketPrice)}</span></span>
                <span>
                  Seu Preço:
                  <span className={`font-mono font-bold ${(() => { const p = parseFloat(sellPrice); return isNaN(p) ? '' : (p >= marketPrice ? 'text-red-500' : 'text-green-500'); })()}`}>
                    ${sellPrice ? formatCost(parseFloat(sellPrice)) : '0.00'}
                  </span>
                </span>
              </div>
            )}

            {selectedSellItem && (
              <div className="mt-2 text-[10px] text-slate-400">
                Sugestão: 5% abaixo do mercado. Limite: ±20% da última oferta deste item, ou ±20% do preço de mercado se não houver oferta anterior.
              </div>
            )}

            <button
              onClick={handleSellSubmit}
              disabled={publishDisabled || !isEnabled}
              className="w-full mt-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 rounded transition-colors text-sm flex items-center justify-center gap-2"
            >
              {!isEnabled ? 'MERCADO DESATIVADO' : 'PUBLICAR OFERTA'} <ArrowRight size={16} />
            </button>
          </div>

          {/* Active Player Listings (Custody) */}
          <div className="flex-1 overflow-y-auto bg-slate-950/30 p-3 rounded-lg border border-slate-800/50">
            <h3 className="text-slate-300 font-bold mb-1 flex items-center gap-2 text-xs uppercase tracking-wider">
              <Tag size={14} className="text-green-500" /> Minhas Ofertas Ativas
            </h3>
            <p className="text-[10px] text-slate-500 mb-4 flex items-center gap-1">
              <ShieldCheck size={10} /> Seus itens ficam seguros no cofre do mercado até a venda.
            </p>

            {gameState.playerListings.length === 0 ? (
              <div className="text-center py-8 text-slate-600 border border-dashed border-slate-800 rounded-lg">
                Nenhuma oferta ativa no momento.
              </div>
            ) : (
              <div className="space-y-2">
                {gameState.playerListings.filter(l => !l.status || l.status === 'active').map(listing => {
                  const item = upgrades.find(u => u.id === listing.itemId);
                  if (!item) return null;

                  return (
                    <div key={listing.id} className="bg-slate-950 border border-slate-800 rounded p-2 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-xl text-slate-400 overflow-hidden">
                          {item.image ? <img src={item.image} className="w-full h-full object-cover" /> : item.icon}
                        </div>
                        <div>
                          <div className="text-slate-300 font-bold text-xs">{item.name}</div>
                          <div className="text-green-500 font-mono text-xs">${formatCost(listing.price)}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => onCancelListing && onCancelListing(listing.id)}
                        className="text-slate-500 hover:text-red-500 transition-colors p-2"
                        title="Cancelar Oferta"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}



      {
        confirmListing && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 w-full max-w-md shadow-2xl">
              <h3 className="text-red-500 font-bold text-sm mb-3">Confirmar Compra</h3>
              {(() => {
                const item = upgrades.find(u => u.id === confirmListing.itemId);
                const canAfford = gameState.usdc >= confirmListing.price;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-2xl text-slate-400 overflow-hidden">
                        {item?.image ? <img src={item.image} className="w-full h-full object-cover" /> : item?.icon}
                      </div>
                      <div>
                        <div className="text-slate-200 font-bold text-sm">
                          {item?.name || confirmListing.itemId}
                          {(confirmListing.qty && confirmListing.qty > 1) && ` (x${confirmListing.qty})`}
                        </div>
                        <div className="text-xs text-slate-500">Vendedor: {confirmListing.sellerName}</div>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Preço</span>
                      <span className={`font-mono ${canAfford ? 'text-green-400' : 'text-red-500'}`}>${formatCost(confirmListing.price)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Saldo atual</span>
                      <span className="font-mono text-slate-300">${formatCost(gameState.usdc)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Saldo após compra</span>
                      <span className={`font-mono ${canAfford ? 'text-slate-300' : 'text-red-500'}`}>${formatCost(gameState.usdc - confirmListing.price)}</span>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button onClick={async () => {
                        if (!confirmListing) return;
                        await cancelMarketReservation(confirmListing.id);
                        setConfirmListing(null);
                        const list = await getMarketListings();
                        setMarketListings(list);
                      }} className="flex-1 px-3 py-2 text-xs font-bold uppercase rounded border bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300">
                        Cancelar
                      </button>
                      <button onClick={async () => {
                        if (!confirmListing) return;
                        const res = await buyMarketListing(confirmListing.id);
                        if (res && res.ok) {
                          if (onClaimSuccess) onClaimSuccess();
                          setConfirmListing(null);
                          const list = await getMarketListings();
                          setMarketListings(list);
                        } else {
                          if (res.error === 'Insufficient USDC') alert(`Saldo insuficiente. Faltam $${res.missing?.toFixed(2) || '0.00'}`);
                          else alert(res.error || 'Erro ao comprar item.');
                        }
                      }} disabled={gameState.usdc < confirmListing.price} className="flex-1 px-3 py-2 text-xs font-bold uppercase rounded border bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white border-red-700">
                        Confirmar
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
    </div>
  );
};
