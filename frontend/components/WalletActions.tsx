import React, { useState } from 'react';
import { CreditCard, Upload, Download, HardDrive, Coins, TrendingUp, Shield, Clock } from 'lucide-react';

interface WalletActionsProps {
  onAddUSDC: (amount: number, network?: string) => void;
  onStartDeposit?: (amount: number, network?: string) => void;
  hasWallet?: boolean;
  coinBalances: Record<string, number>;
  miningCoins: { id: string; name: string; symbol: string; priceUSD: number }[];
  coinRates?: Record<string, number>;
  onWithdrawCoin: (coinId: string, amount: number) => void;
  withdrawTokens?: Array<{ name: string; contract: string; minAmount?: number; minWithdrawalUsdc?: number; feePercent?: number }>;

  prefillAmount?: number;
  depositStatus?: 'awaiting' | 'success' | 'queued' | 'cancelled' | 'failed';
  depositAmount?: number;
  onCloseDepositStatus?: () => void;
  minDepositUsdc?: number;
  depositPolygonDisabled?: boolean;
  depositBnbDisabled?: boolean;
  depositBaseDisabled?: boolean;
}

export const WalletActions: React.FC<WalletActionsProps> = ({ onAddUSDC, onStartDeposit, hasWallet = false, coinBalances, miningCoins, coinRates = {}, onWithdrawCoin, prefillAmount, withdrawTokens, depositStatus, depositAmount, onCloseDepositStatus, minDepositUsdc, depositPolygonDisabled, depositBnbDisabled, depositBaseDisabled }) => {
  const [usdcAmount, setUsdcAmount] = useState<string>('');
  const [selectedNetwork, setSelectedNetwork] = useState<'polygon' | 'bnb' | 'base'>('polygon');
  const [selectedCoinId, setSelectedCoinId] = useState<string>(miningCoins[0]?.id || '');
  const [coinAmount, setCoinAmount] = useState<string>('');

  const handleDeposit = () => {
    const val = parseFloat(usdcAmount);
    if (!hasWallet) return;
    const minDep = typeof minDepositUsdc === 'number' ? minDepositUsdc : 0.001;
    if (!isNaN(val) && val >= minDep) {
      if (onStartDeposit) onStartDeposit(val, selectedNetwork); else onAddUSDC(val, selectedNetwork);
      setUsdcAmount('');
    }
  };

  React.useEffect(() => {
    if (typeof prefillAmount === 'number' && prefillAmount > 0) {
      setUsdcAmount(String(prefillAmount));
    }
  }, [prefillAmount]);

  const handleWithdrawCoin = () => {
    const val = parseFloat(coinAmount);
    const bal = (coinBalances[selectedCoinId] || 0);
    const coin = miningCoins.find(c => c.id === selectedCoinId);
    const matching = (withdrawTokens || []).find(t => {
      const isNameMatch = t.name === (coin?.name || '');
      const isNative = ['POL', 'POLYGON', 'BNB', 'ETH', 'WETH'].includes(t.name?.toUpperCase() || '');
      const hasValidContract = /^0x[a-fA-F0-9]{40}$/.test(t.contract || '');
      return isNameMatch && (isNative || hasValidContract);
    });
    const enabled = hasWallet && !!matching;

    let minW = matching?.minAmount ?? 0;
    if (matching?.minWithdrawalUsdc && coin && coin.priceUSD > 0) {
      minW = matching.minWithdrawalUsdc / coin.priceUSD;
    }

    if (!isNaN(val) && val >= minW && val > 0 && val <= bal && enabled) {
      const fee = matching?.feePercent ? (val * (matching.feePercent / 100)) : 0;
      const net = val - fee;
      const msg = `Confirmar pedido de levantamento?\n\n` +
        `Valor bruto: ${formatAmount(val)} ${coin?.symbol}\n` +
        `Taxa (${matching?.feePercent || 0}%): -${formatAmount(fee)} ${coin?.symbol}\n` +
        `Líquido estimado: ${formatAmount(net)} ${coin?.symbol}\n\n` +
        `O processamento pode levar até 24 horas na sua carteira conectada.`;

      if (confirm(msg)) {
        onWithdrawCoin(selectedCoinId, val);
        setCoinAmount('');
      }
    }
  };


  const formatAmount = (val: number) => (val < 1 && val > 0) ? val.toFixed(8) : val.toLocaleString('en-US', { maximumFractionDigits: 6 });

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-lg flex flex-col gap-4 transition-colors">
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 mb-2">
        <CreditCard size={18} className="text-orange-500 dark:text-orange-400" />
        <h3 className="text-slate-800 dark:text-slate-300 font-bold">Entradas em USDC</h3>
      </div>
      {depositStatus && (
        <div
          className={
            depositStatus === 'awaiting'
              ? 'mt-3 p-3 rounded border text-center bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-400'
              : depositStatus === 'success'
                ? 'mt-3 p-3 rounded border text-center bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400'
                : depositStatus === 'queued'
                  ? 'mt-3 p-3 rounded border text-center bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-900/20 dark:border-sky-800 dark:text-sky-300'
                  : depositStatus === 'cancelled'
                    ? 'mt-3 p-3 rounded border text-center bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400'
                    : 'mt-3 p-3 rounded border text-center bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-400'
          }
        >
          {depositStatus === 'awaiting' && (
            <div className="text-[12px]">Aguardando confirmação na rede{typeof depositAmount === 'number' ? ` (${depositAmount} USDC)` : ''}.</div>
          )}
          {depositStatus === 'success' && (
            <div className="flex flex-col items-center gap-2">
              <div className="text-[12px] font-bold">Entrada confirmada</div>
              <button onClick={onCloseDepositStatus} className="text-[12px] bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded">Fechar</button>
            </div>
          )}
          {depositStatus === 'queued' && (
            <div className="flex flex-col items-center gap-2">
              <div className="text-[12px] font-bold">Confirmação na fila do servidor</div>
              <div className="text-[11px] opacity-90">Os USDC serão creditados após a rede confirmar — pode fechar o site. Atualize o saldo mais tarde ou reabra a carteira.</div>
              <button onClick={onCloseDepositStatus} className="text-[12px] bg-sky-700 hover:bg-sky-600 text-white px-3 py-1 rounded">Entendi</button>
            </div>
          )}
          {depositStatus === 'cancelled' && (
            <div className="flex flex-col items-center gap-2">
              <div className="text-[12px] font-bold">Transação cancelada</div>
              <button onClick={onCloseDepositStatus} className="text-[12px] bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded">Fechar</button>
            </div>
          )}
          {depositStatus === 'failed' && (
            <div className="flex flex-col items-center gap-2">
              <div className="text-[12px] font-bold">Falha ao confirmar. Tente novamente.</div>
              <button onClick={onCloseDepositStatus} className="text-[12px] bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded">Fechar</button>
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-50 dark:bg-slate-950/50 p-3 rounded border border-slate-200 dark:border-slate-800">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Rede da entrada</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'polygon', name: 'Polygon', color: 'bg-orange-500', border: 'border-orange-500/50', text: 'text-orange-500' },
              { id: 'bnb', name: 'BNB Chain', color: 'bg-yellow-500', border: 'border-yellow-500/50', text: 'text-yellow-500' },
              { id: 'base', name: 'Base', color: 'bg-amber-500', border: 'border-amber-500/50', text: 'text-amber-500' }
            ].filter(net => {
              if (net.id === 'polygon') return !depositPolygonDisabled;
              if (net.id === 'bnb') return !depositBnbDisabled;
              if (net.id === 'base') return !depositBaseDisabled;
              return true;
            }).map((net) => (
              <button
                key={net.id}
                onClick={() => setSelectedNetwork(net.id as any)}
                className={`flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all ${selectedNetwork === net.id
                  ? `${net.border} ${net.color} text-white shadow-lg`
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
              >
                <div className={`w-2 h-2 rounded-full mb-1 ${selectedNetwork === net.id ? 'bg-white' : net.color}`}></div>
                <span className="text-[10px] font-bold uppercase">{net.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={typeof minDepositUsdc === 'number' ? minDepositUsdc : 0.001}
            step="0.001"
            placeholder="0.00"
            value={usdcAmount}
            onChange={(e) => setUsdcAmount(e.target.value)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-green-500 outline-none font-mono transition-colors"
          />
          <button
            onClick={handleDeposit}
            disabled={!hasWallet || !usdcAmount || parseFloat(usdcAmount) < (typeof minDepositUsdc === 'number' ? minDepositUsdc : 0.001)}
            className="bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 border border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 text-xs font-bold px-4 rounded transition-colors"
          >
            ENVIAR USDC
          </button>
        </div>
        {!hasWallet && (
          <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">Conecte uma carteira no perfil para creditar USDC.</p>
        )}
        <p className="text-[10px] text-slate-500 dark:text-slate-600 mt-2 italic flex items-center gap-2">
          <Shield size={10} className="text-green-500" /> Liquidação automática via contrato inteligente.
        </p>
      </div>

      <div className="bg-slate-50 dark:bg-slate-950/50 p-3 rounded border border-slate-200 dark:border-slate-800">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-amber-600 dark:text-amber-500 font-bold flex items-center gap-1">
            <Upload size={12} /> Levantar cripto minerada
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
          <select
            value={selectedCoinId}
            onChange={(e) => setSelectedCoinId(e.target.value)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            {miningCoins.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="text-[12px] text-slate-500 dark:text-slate-400 font-mono">
            Saldo on-chain: {formatAmount(coinBalances[selectedCoinId] || 0)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1 justify-end">
            <TrendingUp size={10} /> {formatAmount(coinRates[selectedCoinId] || 0)}/s
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <input
            type="number"
            placeholder={`0.00`}
            min={0}
            value={coinAmount}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setCoinAmount(isNaN(v) ? e.target.value : String(Math.max(0, v)));
            }}
            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-amber-500 outline-none font-mono transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            {(() => {
              const c = miningCoins.find(x => x.id === selectedCoinId);
              const m = (withdrawTokens || []).find(t => t.name === (c?.name || ''));
              if (m?.feePercent && parseFloat(coinAmount) > 0) {
                return <span className="text-[9px] font-bold text-red-500 bg-red-100 dark:bg-red-900/30 px-1 rounded">-{m.feePercent}%</span>;
              }
              return null;
            })()}
          </div>
        </div>
        {(() => {
          const c = miningCoins.find(x => x.id === selectedCoinId);
          const m = (withdrawTokens || []).find(t => t.name === (c?.name || ''));
          let minW = m?.minAmount ?? 0;
          if (m?.minWithdrawalUsdc && c && c.priceUSD > 0) minW = m.minWithdrawalUsdc / c.priceUSD;

          const amtNum = parseFloat(coinAmount);
          const feePercent = m?.feePercent || 0;
          const feeAmount = !isNaN(amtNum) ? (amtNum * feePercent / 100) : 0;
          const netAmount = !isNaN(amtNum) ? (amtNum - feeAmount) : 0;

          return (
            <div className="mt-2 space-y-1">
              <div className="flex justify-between px-1">
                <span className="text-[9px] text-slate-500 font-bold uppercase">
                  {minW > 0 ? `Mínimo: ${formatAmount(minW)} ${c?.symbol}` : ''}
                </span>
                {feePercent > 0 && (
                  <span className="text-[9px] text-red-500 font-bold uppercase">
                    Taxa: {feePercent}%
                  </span>
                )}
              </div>

              {!isNaN(amtNum) && amtNum > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-2 text-[10px] space-y-1 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">VALOR BRUTO:</span>
                    <span className="text-slate-600 dark:text-slate-300 font-mono">{formatAmount(amtNum)} {c?.symbol}</span>
                  </div>
                  {feePercent > 0 && (
                    <div className="flex justify-between items-center text-red-500">
                      <span>TAXA ({feePercent}%):</span>
                      <span className="font-mono">-{formatAmount(feeAmount)} {c?.symbol}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center font-black pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-amber-600 dark:text-amber-400">VOCÊ RECEBE:</span>
                    <span className="text-amber-600 dark:text-amber-400 font-mono text-xs">{formatAmount(netAmount)} {c?.symbol}</span>
                  </div>
                  <div className="pt-1 flex items-center gap-1 text-[8px] text-amber-600 dark:text-amber-500 font-bold uppercase tracking-tighter">
                    <Clock size={10} /> O saque será confirmado em até 24 horas
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleWithdrawCoin}
            disabled={
              !hasWallet ||
              !coinAmount ||
              parseFloat(coinAmount) > (coinBalances[selectedCoinId] || 0) ||
              parseFloat(coinAmount) < ((() => {
                const c = miningCoins.find(x => x.id === selectedCoinId);
                const m = (withdrawTokens || []).find(t => t.name === (c?.name || ''));
                if (m?.minWithdrawalUsdc && c && c.priceUSD > 0) return m.minWithdrawalUsdc / c.priceUSD;
                return m?.minAmount ?? 0;
              })()) ||
              !(withdrawTokens || []).find(t => {
                const c = miningCoins.find(x => x.id === selectedCoinId);
                const isNameMatch = t.name === (c?.name || '');
                const isNative = ['POL', 'POLYGON', 'BNB', 'ETH', 'WETH'].includes(t.name?.toUpperCase() || '');
                const hasValidContract = /^0x[a-fA-F0-9]{40}$/.test(t.contract || '');
                return isNameMatch && (isNative || hasValidContract);
              })
            }
            className="bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-bold px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-9"
          >
            LEVANTAR
          </button>

        </div>
        {!(withdrawTokens || []).find(t => {
          const c = miningCoins.find(x => x.id === selectedCoinId);
          const isNameMatch = t.name === (c?.name || '');
          const isNative = ['POL', 'POLYGON', 'BNB', 'ETH', 'WETH'].includes(t.name?.toUpperCase() || '');
          const hasValidContract = /^0x[a-fA-F0-9]{40}$/.test(t.contract || '');
          return isNameMatch && (isNative || hasValidContract);
        }) && (
            <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">Levantamento indisponível para este par.</p>
          )}
        <p className="text-[10px] text-slate-500 dark:text-slate-600 mt-2 italic flex items-center gap-1">
          <HardDrive size={10} /> O valor sai do saldo minerado do ativo selecionado.
        </p>
        {!hasWallet && (
          <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">Conecte uma carteira Polygon no perfil para levantar.</p>
        )}
      </div>

      <div className="bg-slate-50 dark:bg-slate-950/50 p-3 rounded border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 mb-2">
          <Coins size={12} className="text-orange-600 dark:text-orange-400" />
          <span className="text-xs text-slate-700 dark:text-slate-300 font-bold">Ativos em mineração</span>
        </div>
        <div className="space-y-1">
          {miningCoins.length === 0 ? (
            <div className="text-[12px] text-slate-500">Nenhum par ativo no momento.</div>
          ) : miningCoins.map(c => (
            <div key={c.id} className="flex items-center justify-between text-[12px] font-mono">
              <span className="text-slate-600 dark:text-slate-300">{c.name}</span>
              <span className="text-amber-700 dark:text-amber-300">{formatAmount(coinRates[c.id] || 0)}/s</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
