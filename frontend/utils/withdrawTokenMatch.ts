/**
 * Configuração de saque tal como vem do admin (Web3Withdraw):
 *  - `name`: gravado tipicamente como `coin.symbol` (ex.: "ETH") mas o legado pode usar `coin.name` ("Ether").
 *  - `symbol` / `coinId`: campos opcionais futuros para emparelhar diretamente.
 *  - `disabled`: token presente mas marcado como temporariamente off.
 */
export interface WithdrawTokenCfgLike {
  name?: string;
  symbol?: string;
  coinId?: string;
  contract?: string;
  payoutWallet?: string;
  minAmount?: number;
  minWithdrawalUsdc?: number;
  feePercent?: number;
  disabled?: boolean;
}

const NATIVE_TOKEN_NAMES = new Set(['POL', 'POLYGON', 'BNB', 'ETH', 'WETH']);

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

/** Devolve a configuração que corresponde à moeda, tolerando variações case/whitespace e o split symbol/name. */
export function findWithdrawTokenCfg<T extends WithdrawTokenCfgLike>(
  tokens: readonly T[] | undefined | null,
  coin: { id?: string; symbol?: string; name?: string } | undefined | null
): T | null {
  if (!tokens || !coin) return null;
  const cId = norm(coin.id);
  const cSym = norm(coin.symbol);
  const cNm = norm(coin.name);
  if (!cId && !cSym && !cNm) return null;
  for (const t of tokens) {
    const tId = norm(t.coinId);
    const tSym = norm(t.symbol);
    const tNm = norm(t.name);
    if (cId && tId === cId) return t;
    if (cSym && (tSym === cSym || tNm === cSym)) return t;
    if (cNm && (tNm === cNm || tSym === cNm)) return t;
  }
  return null;
}

/** `true` se a config existe **e** está pronta a usar (contract válido para ERC20 ou token nativo). */
export function isWithdrawTokenUsable(cfg: WithdrawTokenCfgLike | null | undefined): boolean {
  if (!cfg || cfg.disabled) return false;
  const sym = String(cfg.symbol || cfg.name || '').toUpperCase();
  const isNative = NATIVE_TOKEN_NAMES.has(sym);
  const hasValidContract = /^0x[a-fA-F0-9]{40}$/.test(String(cfg.contract || ''));
  return isNative || hasValidContract;
}
