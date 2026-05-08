/**
 * Preços USD de referência para a UI da mineração (cotação de mercado via API pública).
 * Não altera o yield do jogo (servidor / yield por hash); só enriquece a resposta da API.
 */

const COINGECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price';

/** Símbolo (maiúsculas) → id CoinGecko para moedas comuns. */
const SYMBOL_TO_COINGECKO = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  DOGE: 'dogecoin',
  KAS: 'kaspa',
  XMR: 'monero',
  ZEC: 'zcash',
  RVN: 'ravencoin',
  ETC: 'ethereum-classic',
  XCH: 'chia',
  DASH: 'dash',
  TON: 'the-open-network',
  SOL: 'solana',
  XRP: 'ripple',
  TRX: 'tron',
  ADA: 'cardano',
  DOT: 'polkadot',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  POL: 'matic-network',
  LINK: 'chainlink',
  ATOM: 'cosmos',
  NEAR: 'near',
  APT: 'aptos',
  SUI: 'sui',
  SEI: 'sei-network',
  TIA: 'celestia',
  INJ: 'injective-protocol',
  FIL: 'filecoin',
  AR: 'arweave',
  HBAR: 'hedera-hashgraph',
  VET: 'vechain',
  ALGO: 'algorand',
  XLM: 'stellar',
  EOS: 'eos',
  ICP: 'internet-computer',
  STX: 'blockstack',
  ORDI: 'ordinals',
  PEPE: 'pepe',
  SHIB: 'shiba-inu',
  BONK: 'bonk',
  WIF: 'dogwifcoin',
  FLOKI: 'floki'
};

let cache = { at: 0, byMiningId: /** @type {Record<string, number | null>} */ ({}) };

function parseEnvJsonMap(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    const o = JSON.parse(String(raw));
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && v.trim()) out[String(k).trim()] = v.trim().toLowerCase();
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * @param {Array<Record<string, unknown>>} rows - linhas `mining_coins`
 * @param {{ ttlMs?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<Record<string, number | null>>} `mining_coins.id` → USD ou null
 */
export async function fetchLiveUsdByMiningCoinRowIds(rows, opts = {}) {
  const ttlMs = opts.ttlMs ?? 60_000;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const now = Date.now();
  if (now - cache.at < ttlMs && cache.at > 0 && Object.keys(cache.byMiningId).length > 0) {
    const out = {};
    let miss = false;
    for (const row of rows) {
      const mid = String(row.id ?? '').trim();
      if (!mid) continue;
      if (!(mid in cache.byMiningId)) {
        miss = true;
        break;
      }
      out[mid] = cache.byMiningId[mid];
    }
    if (!miss && rows.length > 0) return out;
  }

  const envMap = parseEnvJsonMap(process.env.MINING_COINGECKO_IDS_JSON);
  /** @type {Map<string, string>} miningRowId → coingecko id */
  const miningIdToGecko = new Map();
  for (const row of rows) {
    const mid = String(row.id ?? '').trim();
    if (!mid) continue;
    let gecko = envMap && envMap[mid] ? envMap[mid] : null;
    if (!gecko) {
      const sym = String(row.symbol ?? '')
        .trim()
        .toUpperCase();
      if (sym && SYMBOL_TO_COINGECKO[sym]) gecko = SYMBOL_TO_COINGECKO[sym];
    }
    if (gecko) miningIdToGecko.set(mid, gecko);
  }

  const uniqueGecko = [...new Set(miningIdToGecko.values())];
  const byMiningId = {};

  if (uniqueGecko.length === 0) {
    cache = { at: now, byMiningId: {} };
    for (const row of rows) {
      const mid = String(row.id ?? '').trim();
      if (mid) byMiningId[mid] = null;
    }
    return byMiningId;
  }

  const url = `${COINGECKO_SIMPLE}?ids=${encodeURIComponent(uniqueGecko.join(','))}&vs_currencies=usd`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let j;
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    j = await res.json();
  } finally {
    clearTimeout(t);
  }

  for (const row of rows) {
    const mid = String(row.id ?? '').trim();
    if (!mid) continue;
    const gecko = miningIdToGecko.get(mid);
    if (!gecko) {
      byMiningId[mid] = null;
      continue;
    }
    const v = j[gecko]?.usd;
    byMiningId[mid] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  cache = { at: now, byMiningId: { ...cache.byMiningId, ...byMiningId } };
  return byMiningId;
}

/** Throttle entre gravações de preço na BD (ms). Padrão 10 min. */
const DEFAULT_PRICE_DB_SYNC_INTERVAL_MS = 600_000;
let lastDbUsdSyncAt = 0;

/**
 * Grava `price_usd` e `usdc_rate` em `mining_coins` a partir do CoinGecko (mesma lógica do GET).
 * Não altera yield por hash nem `mining_yield_history`; só referência na BD para relatórios / fallback da UI.
 *
 * Ligar: `MINING_AUTO_SYNC_USD_PRICES=1`
 * Intervalo: `MINING_PRICE_DB_SYNC_INTERVAL_MS` (opcional, default 600000).
 */
export async function maybeSyncLiveUsdToMiningCoinsPostgres(pool, opts = {}) {
  const rawEn = process.env.MINING_AUTO_SYNC_USD_PRICES;
  const enabled = opts.enabled ?? String(rawEn ?? '').trim() === '1';
  if (!enabled) return { skipped: true, reason: 'MINING_AUTO_SYNC_USD_PRICES!=1' };

  const envInt = process.env.MINING_PRICE_DB_SYNC_INTERVAL_MS
    ? parseInt(String(process.env.MINING_PRICE_DB_SYNC_INTERVAL_MS).trim(), 10)
    : NaN;
  const intervalMs =
    Number.isFinite(Number(opts.intervalMs)) && Number(opts.intervalMs) > 0
      ? Number(opts.intervalMs)
      : Number.isFinite(envInt) && envInt >= 60_000
        ? envInt
        : DEFAULT_PRICE_DB_SYNC_INTERVAL_MS;

  const now = Date.now();
  if (lastDbUsdSyncAt > 0 && now - lastDbUsdSyncAt < intervalMs) {
    return { skipped: true, reason: 'throttle' };
  }

  const c = await pool.connect();
  try {
    const res = await c.query('SELECT * FROM mining_coins WHERE is_active = 1 ORDER BY id');
    const rows = res.rows;
    if (!rows.length) {
      lastDbUsdSyncAt = Date.now();
      return { ok: true, updated: 0 };
    }

    let liveById;
    try {
      liveById = await fetchLiveUsdByMiningCoinRowIds(rows, { ttlMs: 0 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[MiningLivePrices] DB USD sync: CoinGecko falhou:', msg);
      return { ok: false, error: msg };
    }

    let updated = 0;
    await c.query('BEGIN');
    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      if (!id) continue;
      const v = liveById[id];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
      const rounded = Math.round(v * 1e8) / 1e8;
      await c.query('UPDATE mining_coins SET price_usd = $1, usdc_rate = $1 WHERE id = $2', [rounded, id]);
      updated++;
    }
    await c.query('COMMIT');
    lastDbUsdSyncAt = Date.now();
    return { ok: true, updated };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MiningLivePrices] DB USD sync falhou:', msg);
    return { ok: false, error: msg };
  } finally {
    c.release();
  }
}

/** Texto fixo para a UI: blocos, recompensa por bloco vs preço USD. */
export const MINING_ECONOMY_PUBLIC_META = Object.freeze({
  blockIntervalMinutes: 10,
  blocksPerDay: 144,
  blocksPer28Days: 4032,
  notePt:
    'Na rede Bitcoin (referência clássica), um bloco a cada ~10 minutos: são 144 blocos por dia e 4032 blocos em ~28 dias (144×28). ' +
    'No jogo, a recompensa de mineração é contada por bloco (quantidade de moeda por bloco / regras do servidor), não é calculada a partir do preço em dólar. ' +
    'O valor em USD que aparece ao lado é só cotação de mercado (API pública, cache ~1 min) para referência visual; não define o yield das tuas rigs.',
  livePriceProvider: 'CoinGecko simple/price (mercado)',
  livePriceHintPt:
    'Opcional: define MINING_COINGECKO_IDS_JSON no servidor, ex. {"id-da-tua-linha-mining_coins":"bitcoin"}, para ligar linhas sem símbolo conhecido.',
  priceDbSyncHintPt:
    'Opcional: MINING_AUTO_SYNC_USD_PRICES=1 grava price_usd e usdc_rate na base a cada MINING_PRICE_DB_SYNC_INTERVAL_MS (padrão 600000 ms). Não altera yield por hash.',
  blockGridHintPt:
    'Crédito de mineração e linhas globais de yield seguem janelas de 10 min a partir de 00:00 UTC (144/dia). Para tempo contínuo até ao relógio real: MINING_WALL_CLOCK_TEN_MIN_GRID=0.'
});
