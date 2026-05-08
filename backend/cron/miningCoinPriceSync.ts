import type { Pool, PoolClient } from 'pg';
import { sanitizeForLog } from '../lib/safeText.js';

const LOG_PREFIX = '[MiningCoinPriceSync]';

/**
 * Símbolo da moeda minerável (coluna `mining_coins.symbol`, ex. «Pol», «BNB») → id CoinGecko para `/simple/price`.
 * Inclui aliases comuns; símbolos desconhecidos ficam de fora (preço continua manual).
 */
export function miningSymbolToCoingeckoId(symbolRaw: unknown): string | null {
  let s = String(symbolRaw ?? '')
    .replace(/\u00a0/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (!s) return null;
  const head = s.split(/[\s/|,-]+/).filter(Boolean)[0] || '';
  if (!head) return null;
  s = head;
  const map: Record<string, string> = {
    WBTC: 'wrapped-bitcoin',
    BTC: 'bitcoin',
    BNB: 'binancecoin',
    /** Polygon PoS nativo (POL, ex-MATIC) — `matic-network` deixou de expor `usd` no simple/price. */
    POL: 'polygon-ecosystem-token',
    MATIC: 'polygon-ecosystem-token',
    POLYGON: 'polygon-ecosystem-token',
    ETH: 'ethereum',
    WETH: 'ethereum',
    STETH: 'staked-ether',
    SOL: 'solana',
    DOGE: 'dogecoin',
    TRX: 'tron',
    USDT: 'tether',
    USDC: 'usd-coin',
    DAI: 'dai',
    BUSD: 'binance-usd',
    FRAX: 'frax',
    TUSD: 'true-usd',
    USDD: 'usdd',
    ADA: 'cardano',
    DOT: 'polkadot',
    AVAX: 'avalanche-2',
    LINK: 'chainlink',
    XRP: 'ripple',
    LTC: 'litecoin',
    BCH: 'bitcoin-cash',
    XLM: 'stellar',
    ATOM: 'cosmos',
    NEAR: 'near',
    APT: 'aptos',
    ARB: 'arbitrum',
    OP: 'optimism',
    TON: 'the-open-network',
    SUI: 'sui',
    SEI: 'sei-network',
    FTM: 'fantom',
    CRO: 'crypto-com-chain',
    OKB: 'okb',
    MNT: 'mantle',
    IMX: 'immutable-x',
    GRT: 'the-graph',
    INJ: 'injective',
    RNDR: 'render-token',
    FIL: 'filecoin',
    HBAR: 'hedera-hashgraph',
    VET: 'vechain',
    QNT: 'quant-network',
    AAVE: 'aave',
    MKR: 'maker',
    SNX: 'havven',
    CRV: 'curve-dao-token',
    LDO: 'lido-dao',
    UNI: 'uniswap',
    SHIB: 'shiba-inu',
    PEPE: 'pepe',
    FLOKI: 'floki',
    BONK: 'bonk',
    WIF: 'dogwifcoin',
    '1INCH': '1inch',
    ENS: 'ethereum-name-service',
    SAND: 'the-sandbox',
    MANA: 'decentraland',
    AXS: 'axie-infinity',
    CHZ: 'chiliz',
    FET: 'fetch-ai',
    TIA: 'celestia',
    STRK: 'starknet',
    JUP: 'jupiter-exchange-solana',
    PYTH: 'pyth-network',
    WLD: 'worldcoin-wld',
    PENDLE: 'pendle',
    RUNE: 'thorchain',
    KAS: 'kaspa',
    BSV: 'bitcoin-cash-sv',
    EOS: 'eos',
    XTZ: 'tezos',
    ICP: 'internet-computer',
    FLOW: 'flow',
    EGLD: 'elrond-erd-2',
    KAVA: 'kava',
    ROSE: 'oasis-network',
    ZEC: 'zcash',
    DASH: 'dash',
    NEO: 'neo',
    WAVES: 'waves',
    ZIL: 'zilliqa',
    ONE: 'harmony',
    KLAY: 'klay-token',
    CELO: 'celo',
    GLMR: 'moonbeam',
    MOVR: 'moonriver',
    MINA: 'mina-protocol',
    SC: 'siacoin',
    DCR: 'decred',
    XMR: 'monero'
  };
  return map[s] ?? null;
}

export type FetchCoingeckoOptions = {
  apiKey?: string;
  timeoutMs?: number;
};

async function fetchCoingeckoUsdByIdChunk(
  uniq: string[],
  opts: FetchCoingeckoOptions
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (uniq.length === 0) return out;

  const timeoutMs =
    Number.isFinite(opts.timeoutMs) && (opts.timeoutMs as number) >= 3000 ? Math.floor(opts.timeoutMs as number) : 15_000;
  const apiKey = opts.apiKey?.trim();
  const base = apiKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  const url = `${base}/simple/price?ids=${encodeURIComponent(uniq.join(','))}&vs_currencies=usd`;
  const headers: Record<string, string> = {};
  if (apiKey) headers['x-cg-pro-api-key'] = apiKey;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CoinGecko HTTP ${res.status}: ${sanitizeForLog(body, 200)}`);
  }
  const json = (await res.json()) as Record<string, { usd?: number } | undefined>;
  for (const id of uniq) {
    const row = json[id];
    const usd = row?.usd;
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
      out.set(id, usd);
    }
  }
  return out;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pedidos à CoinGecko em blocos (URL mais curta, falha parcial não bloqueia o resto).
 * Tamanho: `COINGECKO_SIMPLE_PRICE_CHUNK` (5–80, default 28) ou env ausente.
 *
 * Re-tenta fatias que falharam em blocos menores e, no fim, pede ids ainda sem preço
 * um a um (com pequeno intervalo) para reduzir «metade das moedas atualizou e metade ficou velha».
 */
export async function fetchCoingeckoUsdById(ids: string[], opts: FetchCoingeckoOptions = {}): Promise<Map<string, number>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, number>();
  if (uniq.length === 0) return out;

  const rawChunk = process.env.COINGECKO_SIMPLE_PRICE_CHUNK;
  const parsed = rawChunk ? parseInt(String(rawChunk).trim(), 10) : NaN;
  let chunkSize = Number.isFinite(parsed) ? Math.floor(parsed) : 28;
  chunkSize = Math.min(80, Math.max(5, chunkSize));

  const chunkErrors: string[] = [];
  const failedSlices: string[][] = [];

  const ingest = (part: Map<string, number>) => {
    for (const [k, v] of part) out.set(k, v);
  };

  for (let i = 0; i < uniq.length; i += chunkSize) {
    const slice = uniq.slice(i, i + chunkSize);
    try {
      ingest(await fetchCoingeckoUsdByIdChunk(slice, opts));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      chunkErrors.push(msg);
      failedSlices.push(slice);
      console.warn(
        `${LOG_PREFIX} CoinGecko chunk falhou (ids=%s): %s`,
        sanitizeForLog(slice.join(','), 180),
        sanitizeForLog(msg, 220)
      );
    }
  }

  const RETRY_SUB = 5;
  for (const slice of failedSlices) {
    for (let j = 0; j < slice.length; j += RETRY_SUB) {
      const sub = slice.slice(j, j + RETRY_SUB);
      try {
        ingest(await fetchCoingeckoUsdByIdChunk(sub, opts));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `${LOG_PREFIX} CoinGecko re-tentativa sub-chunk (ids=%s): %s`,
          sanitizeForLog(sub.join(','), 120),
          sanitizeForLog(msg, 180)
        );
        for (let k = 0; k < sub.length; k++) {
          const id = sub[k];
          if (k > 0) await sleepMs(400);
          try {
            ingest(await fetchCoingeckoUsdByIdChunk([id], opts));
          } catch (e2) {
            const m2 = e2 instanceof Error ? e2.message : String(e2);
            console.warn(
              `${LOG_PREFIX} CoinGecko id único falhou id=%s: %s`,
              sanitizeForLog(id, 48),
              sanitizeForLog(m2, 160)
            );
          }
        }
      }
    }
  }

  const stillMissing = uniq.filter((id) => {
    const v = out.get(id);
    return v == null || !Number.isFinite(v) || v <= 0;
  });
  const maxSingle = 40;
  for (let i = 0; i < stillMissing.length && i < maxSingle; i++) {
    const id = stillMissing[i];
    if (i > 0) await sleepMs(350);
    try {
      ingest(await fetchCoingeckoUsdByIdChunk([id], opts));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `${LOG_PREFIX} CoinGecko fill-missing id=%s: %s`,
        sanitizeForLog(id, 48),
        sanitizeForLog(msg, 160)
      );
    }
  }

  if (out.size === 0 && chunkErrors.length > 0) {
    throw new Error(chunkErrors.join(' | '));
  }
  return out;
}

export type SyncMiningCoinPricesResult = {
  updated: number;
  skippedNoMapping: number;
  skippedNoPrice: number;
  errors: string[];
};

let isSyncRunning = false;

function parseTruthyEnv(raw: unknown): boolean | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === '') return null;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return null;
}

function resolvePriceSyncEnabled(): boolean {
  const nextGen = parseTruthyEnv(process.env.MINING_COIN_PRICE_SYNC_ENABLED);
  if (nextGen != null) return nextGen;

  const legacy = parseTruthyEnv(process.env.MINING_AUTO_SYNC_USD_PRICES);
  if (legacy != null) return legacy;

  return true;
}

/**
 * Lê `mining_coins`, pede USD à CoinGecko e atualiza `price_usd` + `usdc_rate` (mesmo valor de mercado).
 */
export async function syncMiningCoinPricesFromExternal(pool: Pool): Promise<SyncMiningCoinPricesResult> {
  const result: SyncMiningCoinPricesResult = {
    updated: 0,
    skippedNoMapping: 0,
    skippedNoPrice: 0,
    errors: []
  };

  if (isSyncRunning) {
    console.log(`${LOG_PREFIX} tick ignorado (execução anterior ainda a correr)`);
    return result;
  }
  isSyncRunning = true;
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const { rows } = await client!.query<{ id: string; symbol: unknown }>('SELECT id, symbol FROM mining_coins');
    const coinIdsByGecko = new Map<string, string[]>();
    const unmappedSymbols = new Set<string>();

    for (const row of rows) {
      const gid = miningSymbolToCoingeckoId(row.symbol);
      if (!gid) {
        result.skippedNoMapping++;
        const sym = String(row.symbol ?? '').trim();
        if (sym) unmappedSymbols.add(sym);
        continue;
      }
      const cid = String(row.id);
      if (!coinIdsByGecko.has(gid)) coinIdsByGecko.set(gid, []);
      coinIdsByGecko.get(gid)!.push(cid);
    }

    const geckoIds = [...coinIdsByGecko.keys()];
    if (geckoIds.length === 0) {
      if (rows.length > 0) {
        console.warn(
          `${LOG_PREFIX} nenhum símbolo nas linhas de mining_coins mapeia para CoinGecko (skippedNoMapping=%s). Ajuste o símbolo (ex.: POL, BNB, WBTC) ou amplie miningSymbolToCoingeckoId.`,
          result.skippedNoMapping
        );
      }
      return result;
    }

    if (unmappedSymbols.size > 0) {
      const list = [...unmappedSymbols].slice(0, 24).join(', ');
      const more = unmappedSymbols.size > 24 ? ` (+${unmappedSymbols.size - 24} mais)` : '';
      console.warn(`${LOG_PREFIX} símbolos sem mapeamento CoinGecko: %s%s`, list, more);
    }

    const timeoutRaw = process.env.MINING_COIN_PRICE_SYNC_HTTP_TIMEOUT_MS;
    const timeoutMs = timeoutRaw ? parseInt(String(timeoutRaw).trim(), 10) : NaN;

    let priceByGecko: Map<string, number>;
    try {
      priceByGecko = await fetchCoingeckoUsdById(geckoIds, {
        apiKey: process.env.COINGECKO_API_KEY,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 3000 ? timeoutMs : 15_000
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      console.warn(`${LOG_PREFIX} fetch falhou:`, sanitizeForLog(msg, 400));
      return result;
    }

    await client!.query('BEGIN');
    try {
      for (const [gid, coinIds] of coinIdsByGecko) {
        const price = priceByGecko.get(gid);
        if (price == null || !Number.isFinite(price) || price <= 0) {
          result.skippedNoPrice += coinIds.length;
          console.warn(`${LOG_PREFIX} resposta sem preço válido id=%s`, sanitizeForLog(gid, 64));
          continue;
        }
        for (const cid of coinIds) {
          const r = await client!.query(
            'UPDATE mining_coins SET price_usd = $1, usdc_rate = $1 WHERE id = $2',
            [price, cid]
          );
          if (r.rowCount && r.rowCount > 0) result.updated++;
        }
      }
      await client!.query('COMMIT');
    } catch (e) {
      await client!.query('ROLLBACK').catch(() => {
        /* ignore */
      });
      throw e;
    }

    if (result.updated > 0 || result.skippedNoPrice > 0) {
      console.log(
        `${LOG_PREFIX} tick ok updated=%s skippedNoPrice=%s skippedNoMapping=%s geckoIds=%s`,
        result.updated,
        result.skippedNoPrice,
        result.skippedNoMapping,
        geckoIds.length
      );
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(msg);
    console.error(`${LOG_PREFIX} erro:`, sanitizeForLog(msg, 400));
    return result;
  } finally {
    try {
      client?.release();
    } catch {
      /* ignore */
    }
    isSyncRunning = false;
  }
}

function resolvePriceSyncIntervalMs(optsInterval?: number): number {
  if (optsInterval != null && Number.isFinite(optsInterval)) {
    return Math.max(60_000, Math.floor(optsInterval));
  }
  const raw =
    process.env.MINING_COIN_PRICE_SYNC_INTERVAL_MS ??
    process.env.MINING_PRICE_DB_SYNC_INTERVAL_MS;
  const envMs = raw ? parseInt(String(raw).trim(), 10) : NaN;
  if (Number.isFinite(envMs) && envMs >= 60_000) {
    return Math.floor(envMs);
  }
  return 600_000;
}

export type StartMiningCoinPriceSyncCronOptions = {
  intervalMs?: number;
  startupDelayMs?: number;
  workerRole?: string;
};

/**
 * Agenda sincronização de preços só em `BACKGROUND` ou `ALL` (compatível com cluster).
 */
export function startMiningCoinPriceSyncCron(pool: Pool, opts: StartMiningCoinPriceSyncCronOptions = {}): void {
  const role = opts.workerRole ?? process.env.WORKER_ROLE ?? 'ALL';
  if (role !== 'BACKGROUND' && role !== 'ALL') {
    console.log(`${LOG_PREFIX} não agendado (WORKER_ROLE=%s)`, sanitizeForLog(role, 32));
    return;
  }

  const enabled = resolvePriceSyncEnabled();
  if (!enabled) {
    console.log(
      `${LOG_PREFIX} desligado (MINING_COIN_PRICE_SYNC_ENABLED=%s MINING_AUTO_SYNC_USD_PRICES=%s)`,
      sanitizeForLog(String(process.env.MINING_COIN_PRICE_SYNC_ENABLED ?? ''), 16),
      sanitizeForLog(String(process.env.MINING_AUTO_SYNC_USD_PRICES ?? ''), 16)
    );
    return;
  }

  const intervalMs = resolvePriceSyncIntervalMs(opts.intervalMs);
  const startupDelayMs = Math.max(0, Math.floor(opts.startupDelayMs ?? 10_000));

  setTimeout(() => {
    void syncMiningCoinPricesFromExternal(pool).catch((e) => {
      console.error(`${LOG_PREFIX} tick inicial:`, sanitizeForLog(e instanceof Error ? e.message : String(e), 200));
    });
    setInterval(() => {
      void syncMiningCoinPricesFromExternal(pool).catch((e) => {
        console.error(`${LOG_PREFIX} tick:`, sanitizeForLog(e instanceof Error ? e.message : String(e), 200));
      });
    }, intervalMs);
  }, startupDelayMs);

  console.log(
    `${LOG_PREFIX} agendado intervalMs=%s startupDelayMs=%s role=%s envInterval=%s legacyInterval=%s`,
    intervalMs,
    startupDelayMs,
    sanitizeForLog(role, 32),
    sanitizeForLog(String(process.env.MINING_COIN_PRICE_SYNC_INTERVAL_MS ?? ''), 24),
    sanitizeForLog(String(process.env.MINING_PRICE_DB_SYNC_INTERVAL_MS ?? ''), 24)
  );
}
