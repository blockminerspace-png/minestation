import React, { useEffect, useState, useCallback } from 'react';
import { Send, PlusCircle, RefreshCw, Wallet, ShieldCheck, Database } from 'lucide-react';
import { getWeb3Settings, setWeb3Settings, getMiningCoins } from '../../services/api';
import { MiningCoin } from '../../types';

type TokenCfg = { name: string; contract: string; payoutWallet: string; minAmount?: number; minWithdrawalUsdc?: number; feePercent?: number; disabled?: boolean };


export const Web3Withdraw: React.FC = () => {
  const [payoutWallet, setPayoutWallet] = useState('');
  const [withdrawTokens, setWithdrawTokens] = useState<TokenCfg[]>([]);
  const [miningCoins, setMiningCoins] = useState<MiningCoin[]>([]);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loadingCoins, setLoadingCoins] = useState(false);
  const [checkingBalance, setCheckingBalance] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoadingCoins(true);
    const [settings, coins] = await Promise.all([
      getWeb3Settings(),
      getMiningCoins()
    ]);

    if (settings) {
      setPayoutWallet(settings.payoutWallet || '');
      const wt = Array.isArray(settings.withdrawTokens) ? settings.withdrawTokens : [];
      setWithdrawTokens(wt);
    }

    if (coins) {
      setMiningCoins(coins);
    }
    setLoadingCoins(false);
  };

  const getNetworkInfo = (symbol: string) => {
    const s = symbol?.toUpperCase();
    if (['ETH', 'WETH', 'SOL'].includes(s)) {
      return {
        chainId: '0x2105',
        chainName: 'Base Mainnet',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://mainnet.base.org'],
        blockExplorerUrls: ['https://basescan.org']
      };
    }
    if (s === 'BNB') {
      return {
        chainId: '0x38',
        chainName: 'BNB Smart Chain',
        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
        rpcUrls: ['https://bsc-dataseed.binance.org'],
        blockExplorerUrls: ['https://bscscan.com']
      };
    }
    // Default to Polygon for everything else (Pol, etc.)
    return {
      chainId: '0x89',
      chainName: 'Polygon Mainnet',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-rpc.com'],
      blockExplorerUrls: ['https://polygonscan.com']
    };
  };

  const connectWallet = async (symbol?: string): Promise<string | null> => {
    try {
      const eth = (window as any).ethereum;
      if (!eth) {
        alert("Carteira (MetaMask) não detectada!");
        return null;
      }
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      const addr = accounts && accounts[0];
      if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;

      if (symbol) {
        const net = getNetworkInfo(symbol);
        const chainId = await eth.request({ method: 'eth_chainId' });
        if (chainId !== net.chainId) {
          try {
            await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: net.chainId }] });
          } catch (switchError: any) {
            if (switchError.code === 4902) {
              try {
                await eth.request({
                  method: 'wallet_addEthereumChain', params: [net]
                });
              } catch { }
            }
          }
        }
      }
      return addr;
    } catch {
      return null;
    }
  };

  const handleConnectPayoutWallet = async () => {
    const addr = await connectWallet();
    if (addr) setPayoutWallet(addr);
  };

  const checkBalance = async (coinName: string, wallet: string, contract?: string) => {
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return;

    const eth = (window as any).ethereum;
    if (!eth) return;

    setCheckingBalance(coinName);
    try {
      const net = getNetworkInfo(coinName);
      const chainId = await eth.request({ method: 'eth_chainId' });
      if (chainId !== net.chainId) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: net.chainId }] });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            try {
              await eth.request({ method: 'wallet_addEthereumChain', params: [net] });
            } catch {
              setBalances(prev => ({ ...prev, [coinName]: 'Rede incorreta' }));
              return;
            }
          } else {
            setBalances(prev => ({ ...prev, [coinName]: 'Rede incorreta' }));
            return;
          }
        }
      }

      let balanceHex = '0x0';
      const isNative = !contract || contract.trim() === '';

      if (isNative) {
        // Native balance (ETH on Base, POL on Poly, BNB on BSC)
        balanceHex = await eth.request({
          method: 'eth_getBalance',
          params: [wallet, 'latest']
        });
      } else {
        // ERC20 balance
        const cleanWallet = wallet.toLowerCase().replace('0x', '');
        const data = '0x70a08231' + cleanWallet.padStart(64, '0');
        balanceHex = await eth.request({
          method: 'eth_call',
          params: [{ to: contract, data }, 'latest']
        });
      }

      const balInt = BigInt(balanceHex);
      const formatted = (Number(balInt) / 1e18).toFixed(6);
      setBalances(prev => ({ ...prev, [coinName]: formatted }));
    } catch (err) {
      console.error('Balance check failed', err);
      setBalances(prev => ({ ...prev, [coinName]: 'Erro' }));
    } finally {
      setCheckingBalance(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const s = await getWeb3Settings();
    await setWeb3Settings({
      ...s!,
      payoutWallet,
      withdrawTokens,
    });
    setSaving(false);
    setSavedAt(Date.now());
  };

  const updateTokenCfg = (name: string, field: keyof TokenCfg, value: any) => {
    setWithdrawTokens(prev => {
      const exists = prev.find(t => t.name === name);
      if (exists) {
        return prev.map(t => t.name === name ? { ...t, [field]: value } : t);
      } else {
        const newCfg: TokenCfg = { name, contract: '', payoutWallet, minAmount: undefined, minWithdrawalUsdc: undefined, feePercent: undefined };
        return [...prev, { ...newCfg, [field]: value }];
      }

    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Send size={18} className="text-green-400" />
            <h3 className="font-bold text-white">Configuração Global de Carteira</h3>
          </div>
          <button onClick={loadAll} className="text-slate-400 hover:text-white transition-colors">
            <RefreshCw size={16} className={loadingCoins ? 'animate-spin' : ''} />
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-3">Defina a carteira padrão para pagamentos (pode ser alterada por moeda abaixo).</p>

        <div className="flex items-center gap-2 mb-2">
          <button onClick={handleConnectPayoutWallet} className="bg-green-900/30 hover:bg-green-900/50 border border-green-700 text-green-300 text-xs font-bold px-3 py-2 rounded transition-colors flex items-center gap-2">
            <Wallet size={14} /> Conectar carteira
          </button>
          {payoutWallet && <span className="text-[10px] font-mono text-slate-400 truncate bg-slate-900 px-2 py-1 rounded border border-slate-700">{payoutWallet}</span>}
        </div>

        <input
          type="text"
          value={payoutWallet}
          onChange={(e) => setPayoutWallet(e.target.value)}
          placeholder="0x..."
          className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm focus:border-green-500 outline-none"
        />
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Database size={18} className="text-amber-400" />
          <h3 className="font-bold text-white">Carteiras por Moeda Minerada</h3>
        </div>
        <p className="text-xs text-slate-400 mb-4">Configure os endereços de saque e verifique o saldo disponível para cada moeda ativa.</p>

        <div className="space-y-4">
          {loadingCoins ? (
            <div className="py-10 text-center text-slate-500 text-sm italic">Carregando moedas...</div>
          ) : miningCoins.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-sm italic">Nenhuma moeda minerável ativa encontrada.</div>
          ) : (
            miningCoins.map((coin) => {
              const cfg = withdrawTokens.find(t => t.name === coin.symbol) || { name: coin.symbol, contract: '', payoutWallet: payoutWallet, minAmount: undefined };
              const balance = balances[coin.symbol];

              return (
                <div key={coin.id} className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border" style={{ borderColor: coin.color, color: coin.color, backgroundColor: `${coin.color}15` }}>
                        {coin.symbol[0]}
                      </div>
                      <div>
                        <span className="text-white font-bold block">{coin.name}</span>
                        <span className="text-[10px] text-slate-500 uppercase">{coin.algorithm}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-end mr-2">
                        <span className="text-[10px] text-slate-500 font-bold mb-1">STATUS SAQUE</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={!cfg.disabled}
                            onChange={(e) => updateTokenCfg(coin.symbol, 'disabled', !e.target.checked)}
                          />
                          <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
                          <span className="ms-2 text-[10px] font-bold text-slate-400 uppercase">{!cfg.disabled ? 'Ativado' : 'Desativado'}</span>
                        </label>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">SALDO DISPONÍVEL</span>
                        <span className={`text-sm font-mono font-bold ${balance === 'Erro' ? 'text-red-400' : 'text-green-400'}`}>
                          {balance || '---'} {coin.symbol}
                        </span>
                      </div>
                      <button
                        onClick={() => checkBalance(coin.symbol, cfg.payoutWallet || payoutWallet, cfg.contract)}
                        disabled={checkingBalance === coin.symbol}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"
                      >
                        <RefreshCw size={14} className={checkingBalance === coin.symbol ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
                    <div className="md:col-span-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] text-slate-500 font-bold block uppercase">Carteira de Pagamento ({coin.symbol})</label>
                        <button
                          onClick={async () => {
                            const addr = await connectWallet(coin.symbol);
                            if (addr) updateTokenCfg(coin.symbol, 'payoutWallet', addr);
                          }}
                          className="text-[10px] text-green-400 hover:text-green-300 font-bold flex items-center gap-1 transition-colors"
                        >
                          <Wallet size={10} /> Conectar Individual
                        </button>
                      </div>
                      <input
                        type="text"
                        value={cfg.payoutWallet}
                        onChange={(e) => updateTokenCfg(coin.symbol, 'payoutWallet', e.target.value)}
                        placeholder={payoutWallet || "0x..."}
                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-xs font-mono focus:border-green-500/50 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1 uppercase">Contrato (Opcional Token)</label>
                      <input
                        type="text"
                        value={cfg.contract}
                        onChange={(e) => updateTokenCfg(coin.symbol, 'contract', e.target.value)}
                        placeholder="Vazio para moeda nativa"
                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1">SAQUE MÍN. (USDC)</label>
                      <input
                        type="number"
                        value={typeof cfg.minWithdrawalUsdc === 'number' ? String(cfg.minWithdrawalUsdc) : ''}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          updateTokenCfg(coin.symbol, 'minWithdrawalUsdc', isNaN(v) ? undefined : Math.max(0, v));
                        }}
                        placeholder="Ex: 5.00"
                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-xs"
                      />
                      {cfg.minWithdrawalUsdc && coin.priceUSD > 0 && (
                        <span className="text-[9px] text-amber-500 mt-1 block">
                          ≈ {(cfg.minWithdrawalUsdc / coin.priceUSD).toLocaleString('en-US', { maximumFractionDigits: 6 })} {coin.symbol}
                        </span>
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1">TAXA DE SAQUE (%)</label>
                      <input
                        type="number"
                        value={typeof cfg.feePercent === 'number' ? String(cfg.feePercent) : ''}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          updateTokenCfg(coin.symbol, 'feePercent', isNaN(v) ? undefined : Math.max(0, v));
                        }}
                        placeholder="Ex: 1.5"
                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-xs"
                      />
                    </div>

                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 sticky bottom-4 z-10">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2 rounded-lg text-sm font-bold border shadow-lg transition-all flex items-center gap-2 ${saving ? 'bg-slate-700 text-slate-400 border-slate-700' : 'bg-green-600 text-white border-green-500 hover:bg-green-500 hover:scale-105 active:scale-95'}`}
        >
          {saving ? <RefreshCw size={16} className="animate-spin" /> : <ShieldCheck size={18} />}
          {saving ? 'SALVANDO...' : 'SALVAR TODAS AS CONFIGURAÇÕES'}
        </button>
        {savedAt && (
          <div className="bg-slate-900 border border-green-500/30 text-green-400 text-[10px] px-3 py-2 rounded-lg flex items-center shadow-md">
            CONFIGURAÇÕES ATUALIZADAS!
          </div>
        )}
      </div>
    </div>
  );
};
