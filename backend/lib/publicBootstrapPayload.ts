/**
 * Payload agregado para o SPA: uma ida à API em vez de 8+ pedidos em paralelo.
 * Manter alinhado com GET /api/upgrades, /api/access-levels, /api/loot-boxes, etc.
 */
import pool from '../config/db.js';
import { prisma } from '../config/prisma.js';
import { miningRuntimeStats } from '../cron/miningRuntimeStats.js';
import { getSettingsRecord, getSettingValue } from './settingsPrisma.js';
import { normalizePublicAssetUrl } from './publicAssetUrl.js';

/** Alinhado com `GAME_NAV_LABEL_KEYS` no frontend (`constants/gameNavLabels.ts`). */
const GAME_NAV_SHORT_KEYS = [
  'servers',
  'inventory',
  'oficina',
  'hardware_store',
  'black_market',
  'arcade',
  'lucky_store',
  'roleta',
  'wallet',
  'ranking',
  'upgrade',
  'transparency',
  'support',
  'partners'
] as const;

const NAV_PREFIX = 'nav.';

function settingsFlagEnabled(v: unknown): boolean {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export async function loadUpgradesForBootstrap(userId: number | undefined): Promise<unknown[]> {
  let isAdminUser = false;
  if (userId) {
    const uRow = await prisma.users.findUnique({
      where: { id: userId },
      select: { is_admin: true }
    });
    if (uRow?.is_admin) isAdminUser = true;
  }

  const rows = await prisma.upgrades.findMany({
    where: isAdminUser
      ? {
          AND: [
            { NOT: { id: { startsWith: 'temp_legacy_' } } },
            { category: { not: 'legacy-temp' } },
            { type: { not: 'legacy-temp' } }
          ]
        }
      : { is_active: 1 }
  });
  const compatRows = await prisma.upgrade_compat_racks.findMany();

  const compatMap = compatRows.reduce<Record<string, string[]>>((acc, r) => {
    acc[r.upgrade_id] = acc[r.upgrade_id] || [];
    acc[r.upgrade_id].push(r.rack_id);
    return acc;
  }, {});

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    type: r.type,
    baseCost: r.base_cost,
    baseProduction: r.base_production,
    powerConsumption: r.power_consumption ?? undefined,
    powerCapacity: r.power_capacity ?? undefined,
    multiplier: r.multiplier ?? undefined,
    slotsCapacity: r.slots_capacity ?? undefined,
    aiSlotsCapacity: r.ai_slots_capacity ?? undefined,
    description: r.description,
    icon: r.icon,
    status: r.status,
    isNft: !!r.is_nft,
    nftContract: r.nft_contract ?? undefined,
    nftTokenId: r.nft_token_id ?? undefined,
    maxGlobalStock: r.max_global_stock ?? undefined,
    totalSold: Number((r as { total_sold?: unknown }).total_sold) || 0,
    image: normalizePublicAssetUrl(r.image != null ? String(r.image) : undefined) ?? undefined,
    layout: r.layout
      ? (() => {
          try {
            return JSON.parse(r.layout) as unknown;
          } catch {
            return undefined;
          }
        })()
      : undefined,
    compatibleRacks: compatMap[r.id] || [],
    rewardWh: r.reward_wh ?? 0,
    sellInHardwareMarket: r.sell_in_hardware_market !== 0,
    sellInBlackMarket: r.sell_in_black_market !== 0,
    isActive: r.is_active !== 0
  }));
}

export async function loadAccessLevelsForBootstrap(): Promise<unknown[]> {
  const rows = await prisma.access_levels.findMany();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isDefault: !!r.is_default,
    isActive: !!r.is_active,
    priceUsdc: r.price_usdc ?? undefined,
    contractAddress: r.contract_address ?? undefined,
    inactiveMessage: r.inactive_message ?? undefined,
    newsPostingEnabled: !!r.news_posting_enabled,
    allowedPages: r.allowed_pages
      ? (() => {
          try {
            return JSON.parse(r.allowed_pages) as unknown[];
          } catch {
            return [];
          }
        })()
      : []
  }));
}

export async function loadLootBoxesCatalogForBootstrap(): Promise<unknown[]> {
  const boxes = await prisma.loot_boxes.findMany({
    orderBy: [{ is_active: 'desc' }, { trigger: 'asc' }, { name: 'asc' }, { id: 'asc' }]
  });
  const boxIds = boxes.map((b) => b.id);
  const itemRows =
    boxIds.length === 0 ? [] : await prisma.loot_box_items.findMany({ where: { box_id: { in: boxIds } } });
  const itemMap: Record<
    string,
    Array<{ id: string; type: string; minQty: number; maxQty: number; probability: number }>
  > = {};
  for (const it of itemRows) {
    itemMap[it.box_id] = itemMap[it.box_id] || [];
    itemMap[it.box_id].push({
      id: it.item_id,
      type: it.item_type,
      minQty: it.min_qty,
      maxQty: it.max_qty,
      probability: it.probability
    });
  }
  return boxes.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    price: b.price,
    trigger: b.trigger,
    icon: b.icon,
    isActive: b.is_active === undefined || b.is_active === null ? true : !!b.is_active,
    items: itemMap[b.id] || []
  }));
}

export async function loadMiningCoinsForBootstrap(): Promise<unknown[]> {
  const resDb = await pool.query('SELECT * FROM mining_coins ORDER BY name ASC');
  return resDb.rows.map((r: Record<string, unknown>) => {
    let usedRate = parseFloat(String(r.network_hashrate)) || 100;
    if (miningRuntimeStats.globalNetworkHashrates.has(String(r.id))) {
      const dyn = miningRuntimeStats.globalNetworkHashrates.get(String(r.id));
      if (dyn && dyn > 0) usedRate = dyn;
    }
    return {
      id: r.id,
      name: r.name,
      symbol: r.symbol,
      description: r.description,
      color: r.color,
      algorithm: r.algorithm,
      multiplier: r.multiplier,
      difficulty: r.difficulty,
      minProportion: r.min_proportion,
      usdcRate: r.usdc_rate,
      isActive: !!r.is_active,
      networkHashrate: usedRate,
      blockReward: r.block_reward,
      blockTime: r.block_time,
      priceUSD: r.price_usd,
      targetDailyUSD: parseFloat(String(r.target_daily_usd)) || 0,
      showInExchange: !!r.show_in_exchange
    };
  });
}

export async function loadEconomySettingsForBootstrap(): Promise<{
  hardwareMarketEnabled: boolean;
  blackMarketEnabled: boolean;
  marketTaxPercent: number;
  blackMarketPriceBandPercent: number;
}> {
  const rowRes = await pool.query(
    'SELECT black_market_enabled, hardware_market_enabled, market_tax_percent, black_market_price_band_percent FROM economy_settings WHERE id = 1'
  );
  const row = rowRes.rows[0] as Record<string, unknown> | undefined;
  const set = await getSettingsRecord([
    'hardware_market_enabled',
    'black_market_enabled',
    'market_tax_percent',
    'black_market_price_band_percent'
  ]);
  const hw = row
    ? Number(row.hardware_market_enabled) !== 0
    : set.hardware_market_enabled != null
      ? set.hardware_market_enabled === '1'
      : true;
  const bk = row
    ? Number(row.black_market_enabled) !== 0
    : set.black_market_enabled != null
      ? set.black_market_enabled === '1'
      : true;

  let tax = NaN;
  if (row && row.market_tax_percent != null && row.market_tax_percent !== '') {
    tax = Number(row.market_tax_percent);
  }
  if (!Number.isFinite(tax)) {
    tax = set.market_tax_percent != null ? Number(set.market_tax_percent) : 0;
  }
  if (!Number.isFinite(tax)) tax = 0;
  tax = Math.min(100, Math.max(0, tax));

  let band = 20;
  if (row && row.black_market_price_band_percent != null && row.black_market_price_band_percent !== '') {
    const b = Number(row.black_market_price_band_percent);
    if (Number.isFinite(b)) band = Math.min(200, Math.max(0, b));
  } else if (set.black_market_price_band_percent != null && set.black_market_price_band_percent !== '') {
    const b = Number(set.black_market_price_band_percent);
    if (Number.isFinite(b)) band = Math.min(200, Math.max(0, b));
  }

  return {
    hardwareMarketEnabled: hw,
    blackMarketEnabled: bk,
    marketTaxPercent: tax,
    blackMarketPriceBandPercent: band
  };
}

export async function loadWeb3SettingsForBootstrap(): Promise<Record<string, unknown>> {
  const keys = [
    'web3_deposit_wallet',
    'web3_payout_wallet',
    'web3_deposit_token_contract',
    'web3_deposit_token_contract_bnb',
    'web3_deposit_token_contract_base',
    'web3_min_deposit_usdc',
    'web3_withdraw_token_name',
    'web3_withdraw_token_contract',
    'web3_withdraw_tokens',
    'web3_deposit_polygon_disabled',
    'web3_deposit_bnb_disabled',
    'web3_deposit_base_disabled'
  ];
  const settings = await getSettingsRecord(keys);

  let withdrawTokens: unknown[] = [];
  try {
    withdrawTokens = settings.web3_withdraw_tokens ? JSON.parse(settings.web3_withdraw_tokens) : [];
  } catch {
    withdrawTokens = [];
  }

  return {
    depositWallet: settings.web3_deposit_wallet || '',
    payoutWallet: settings.web3_payout_wallet || '',
    depositTokenContract: settings.web3_deposit_token_contract || '',
    depositTokenContractBnb: settings.web3_deposit_token_contract_bnb || '',
    depositTokenContractBase: settings.web3_deposit_token_contract_base || '',
    minDepositUsdc: settings.web3_min_deposit_usdc ? parseFloat(settings.web3_min_deposit_usdc) : undefined,
    withdrawTokenName: settings.web3_withdraw_token_name || '',
    withdrawTokenContract: settings.web3_withdraw_token_contract || '',
    withdrawTokens,
    depositPolygonDisabled: settingsFlagEnabled(settings.web3_deposit_polygon_disabled),
    depositBnbDisabled: settingsFlagEnabled(settings.web3_deposit_bnb_disabled),
    depositBaseDisabled: settingsFlagEnabled(settings.web3_deposit_base_disabled)
  };
}

/** Alinha com `GET /api/news`: remove notícias expiradas antes de listar. */
export async function loadSystemNewsForBootstrap(): Promise<unknown[]> {
  const expRaw = await getSettingValue('news_post_expire_days');
  const expDays = expRaw != null && expRaw !== '' ? Number(expRaw) || 0 : 0;
  if (expDays > 0) {
    const cutoff = Date.now() - expDays * 24 * 3600 * 1000;
    await pool.query('DELETE FROM system_news WHERE created_at < $1', [cutoff]);
  }
  const rowsRes = await pool.query('SELECT * FROM system_news ORDER BY created_at DESC');
  return rowsRes.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    text: r.text,
    link: r.link ?? undefined,
    active: !!r.active,
    duration: r.duration ?? undefined,
    authorName: r.author_name ?? undefined,
    createdAt: r.created_at,
    adType: r.ad_type ?? 'horizontal',
    imageUrl: r.image_url ?? undefined
  }));
}

export async function loadGameNavLabelsForBootstrap(): Promise<Record<string, string>> {
  const rows = await prisma.ui_display_labels.findMany({ orderBy: { key: 'asc' } });
  const map: Record<string, string> = {};
  for (const row of rows) {
    const k = row.key != null ? String(row.key).trim() : '';
    const v = row.value != null ? String(row.value).trim() : '';
    if (k && v) map[k] = v.slice(0, 200);
  }
  const out: Record<string, string> = {};
  for (const short of GAME_NAV_SHORT_KEYS) {
    const v = map[`${NAV_PREFIX}${short}`];
    if (typeof v === 'string' && v.trim()) out[short] = v.trim();
  }
  return out;
}

export type PublicBootstrapPayload = {
  upgrades: unknown[];
  accessLevels: unknown[];
  lootBoxes: unknown[];
  miningCoins: unknown[];
  economySettings: Awaited<ReturnType<typeof loadEconomySettingsForBootstrap>>;
  web3Settings: Record<string, unknown>;
  systemNews: unknown[];
  gameNavLabels: Record<string, string>;
};

export type PublicBootstrapLitePayload = Pick<
  PublicBootstrapPayload,
  'accessLevels' | 'miningCoins' | 'economySettings' | 'lootBoxes' | 'web3Settings'
>;

/** Mesmo formato que `GET /api/season-passes` (inclui recompensas por pass). */
export async function loadSeasonPassesCatalogForBootstrap(): Promise<unknown[]> {
  const rowsRes = await pool.query('SELECT * FROM season_passes');
  const passes: unknown[] = [];
  for (const r of rowsRes.rows as Record<string, unknown>[]) {
    const rewardsRes = await pool.query('SELECT * FROM season_pass_rewards WHERE pass_id = $1', [r.id]);
    passes.push({
      id: r.id,
      seasonId: r.season_id,
      name: r.name,
      description: r.description,
      priceUsdc: r.price_usdc,
      emblemUrl: r.emblem_url ?? '',
      isActive: !!r.is_active,
      rewards: (rewardsRes.rows as Record<string, unknown>[]).map((rew) => ({
        id: rew.id,
        type: rew.type,
        itemId: rew.item_id,
        coinId: rew.coin_id,
        qty: rew.qty
      }))
    });
  }
  return passes;
}

export async function getPublicBootstrapPayload(userId: number | undefined, lite: boolean): Promise<unknown> {
  if (lite) {
    const [accessLevels, miningCoins, economySettings, lootBoxes, web3Settings] = await Promise.all([
      loadAccessLevelsForBootstrap(),
      loadMiningCoinsForBootstrap(),
      loadEconomySettingsForBootstrap(),
      loadLootBoxesCatalogForBootstrap(),
      loadWeb3SettingsForBootstrap()
    ]);
    const payload: PublicBootstrapLitePayload = {
      accessLevels,
      miningCoins,
      economySettings,
      lootBoxes,
      web3Settings
    };
    return payload;
  }

  const [upgrades, accessLevels, lootBoxes, miningCoins, economySettings, web3Settings, systemNews, gameNavLabels] =
    await Promise.all([
      loadUpgradesForBootstrap(userId),
      loadAccessLevelsForBootstrap(),
      loadLootBoxesCatalogForBootstrap(),
      loadMiningCoinsForBootstrap(),
      loadEconomySettingsForBootstrap(),
      loadWeb3SettingsForBootstrap(),
      loadSystemNewsForBootstrap(),
      loadGameNavLabelsForBootstrap()
    ]);

  const payload: PublicBootstrapPayload = {
    upgrades,
    accessLevels,
    lootBoxes,
    miningCoins,
    economySettings,
    web3Settings,
    systemNews,
    gameNavLabels
  };
  return payload;
}
