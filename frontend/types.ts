export interface SlotLayout {
  id: string; // for machines: 'slot_0', 'slot_1'..., for aux: 'battery', 'wiring', 'ai_0'...
  type: 'machine' | 'battery' | 'wiring' | 'multiplier' | 'power' | 'config' | 'coin_selector' | 'battery_bar' | 'production_display'
  | 'instant_recharge'
  | 'rewarded_ad'
  | 'daily_boost'
  | 'charger_bar'
  | 'stat_monitor';
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  w: number; // percentage
  h: number; // percentage
}

export interface RigLayout {
  slots: SlotLayout[];
  canvasWidth?: number;  // Reference width (e.g. 500px)
  canvasHeight?: number; // Reference height (e.g. 800px)
}

export interface Upgrade {
  id: string;
  name: string;
  category: string;
  type: 'machine' | 'infrastructure' | 'battery' | 'wiring' | 'multiplier' | 'charger';
  baseCost: number;
  baseProduction: number; // Production per second
  powerConsumption?: number; // Watts (consumed per second)
  powerCapacity?: number; // Watt-hours (total energy storage)
  multiplier?: number; // Percentage increase (e.g. 0.1 for 10%)
  slotsCapacity?: number; // For racks: number of machine slots
  aiSlotsCapacity?: number; // For racks: number of machine slots
  description: string;
  icon: string;

  // New Fields for Editor & Market Logic
  status: 'normal' | 'legacy' | 'exclusive' | 'limited';
  maxGlobalStock?: number; // For limited editions
  totalSold?: number; // Total sold count for limited editions

  // Visuals
  image?: string; // Base64 or URL of the item image (AI Generated)

  // Circuit Effects
  energyConsumptionReduction?: number; // 0.1 = 10% reduction for rigs
  energyTransferRateBonus?: number; // 0.1 = 10% bonus for charger transfer


  // Compatibility Logic
  compatibleRacks?: string[]; // Array of Rack IDs that this item can be installed into. If empty, fits all.

  // Custom Layout (for infrastructure/racks)
  layout?: RigLayout;

  // Rewarded Video
  rewardWh?: number; // Added: reward amount for this específico charger

  // Market Availability
  sellInHardwareMarket?: boolean;
  sellInBlackMarket?: boolean;
  isActive?: boolean;
  isNft?: boolean;
  visibleToAccessLevelIds?: string[];
}

export interface PlacedRack {
  id: string;
  itemId: string; // The upgrade ID (e.g., 'rack_10u')
  slots: (string | null)[]; // Variable size based on rack type
  roomId: string;
  slotIndex: number;

  // Electrical System
  wiringId: string | null; // Slot for wiring
  batteryId: string | null; // Slot for battery

  // AI System
  multiplierSlots: (string | null)[]; // Slots for AI optimizers

  currentCharge: number; // Current energy stored
  isOn: boolean; // Power switch state
  selectedCoinId?: string; // Mining coin selected for this rack
}

export interface WorkshopStructure {
  id: string;
  itemId: string;
  // Generic slots for internal items (batteries, components)
  // Maps to the layout slots by index or id
  internalSlots: Record<string, string | null>; // slotId -> Instance ID or Item ID
  currentCharge: number;
  slotCharges?: Record<string, number>; // slotId -> charge percentage (0-100)
  slotItemIds?: Record<string, string>; // slotId -> Original Item ID (e.g. 'battery_car')
  installedAt?: number;
}

export interface StoredBattery {
  id: string; // Instance ID
  itemId: string; // Type ID (e.g. battery_aa)
  currentCharge: number;
}

export interface MarketListing {
  id: string;
  sellerName: string;
  itemId: string;
  price: number;
  qty: number; // Quantity of items in this listing
  expiresAt: number; // For bots, it expires. For players, it might not expire or expire slowly.
  isPlayer?: boolean; // Flag to identify if it's a player listing
  reservedBy?: string;
  reservedUntil?: number;
  status?: 'active' | 'sold';
}

export interface SystemNews {
  id: string;
  text: string;
  link?: string;
  active: boolean;
  duration?: number; // Duration in seconds to display this news
  authorName?: string;
  createdAt: number;
  adType?: 'horizontal' | 'vertical';
  imageUrl?: string;
}

export interface AccessLevel {
  id: string;
  name: string;
  description: string;
  isDefault: boolean; // Assigned on free registration
  isActive: boolean; // If false, users with this role cannot login
  priceUsdc?: number; // If > 0, requires Web3 payment
  contractAddress?: string; // For simulation of payment
  inactiveMessage?: string; // Message shown when user tries to login with inactive role
  newsPostingEnabled?: boolean;
  allowedPages?: string[];
}

export interface RigRoom {
  id: string;
  name: string;
  initialCapacity: number;
  maxCapacity: number;
  baseSlotPrice: number;
  slotPriceIncreasePercent: number;
  allowedLevels: string[];
  allowedSeasonPassIds?: string[];
  isActive: boolean;
  sortOrder: number;
  owned?: boolean;
  unlockedSlots?: number;
  visibleToAccessLevelIds?: string[];
}

// LOOT BOXES
export type LootBoxTrigger = string;

export interface LootBoxItem {
  id: string; // If type=item: upgrade ID • if currency: 'usdc' • if coin: mining coin ID • if bundle: AdminUpgrade ID
  type: 'item' | 'currency' | 'coin' | 'bundle';
  minQty: number;
  maxQty: number;
  probability: number; // 0-100%
}

export interface LootBox {
  id: string;
  name: string;
  description: string;
  price: number; // Cost in USDC if bought in shop
  trigger: LootBoxTrigger;
  items: LootBoxItem[];
  icon: string;
  isActive?: boolean;
}

export interface GameState {
  usdc: number;
  blackMarketBalance?: number;
  startTime: number;

  stock: Record<string, number>;
  unopenedBoxes: Record<string, number>; // ID of LootBox -> Quantity
  claimedBoxes?: string[]; // IDs of unique lootboxes already claimed by the player
  storedBatteries: StoredBattery[];
  placedRacks: PlacedRack[];
  playerListings: MarketListing[]; // Items the player is selling
  coinBalances?: Record<string, number>;

  // Referral State
  claimedReferrals: number;
  referralBonusClaimed: boolean;

  // Workshop State
  workshopSlots?: (WorkshopStructure | null)[]; // 6 slots for workshop structures

  // Daily Actions State (key -> timestamp)
  dailyActions?: Record<string, number>;
}

export interface User {
  username: string;
  email: string;
  password?: string;
  isAdmin?: boolean;
  polygonWallet?: string; // Web3 Wallet Address
  isBlocked?: boolean; // If true, user cannot login
  accessLevelId?: string; // Linked AccessLevel ID
  accessLevelIds?: string[]; // All possessed access levels

  // Referral System
  referralCode?: string; // Unique code for this user
  referredBy?: string; // Code of the user who referred this user
  referrals?: string[]; // List of usernames referred by this user
  totalUsdcDeposited?: number;
  totalCryptoWithdrawn?: number;
  lastActiveAt?: number;
  isNewRegistration?: boolean;
  isImpersonating?: boolean;
  id?: string;
  adminPermissions?: string[];
}

export interface Web3Settings {
  depositWallet: string;
  payoutWallet: string;
  depositTokenContract: string;
  depositTokenContractBnb?: string;
  depositTokenContractBase?: string;
  withdrawTokenName: string;
  withdrawTokenContract: string;
  withdrawTokens?: Array<{ name: string; contract: string; payoutWallet: string; minAmount?: number; minWithdrawalUsdc?: number; feePercent?: number; disabled?: boolean }>;
  minDepositUsdc?: number;
  depositPolygonDisabled?: boolean;
  depositBnbDisabled?: boolean;
  depositBaseDisabled?: boolean;
}

export interface AdminUpgradeItemGrant { itemId: string; qty: number }
export interface AdminUpgradeBoxGrant { boxId: string; qty: number }
export interface AdminUpgradeCoinGrant { coinId: string; amount: number }
export interface AdminUpgrade {
  id: string;
  name: string;
  description: string;
  priceUsdc: number;
  grantUsdc?: number;
  grantAccessLevelId?: string;
  isActive?: boolean;
  items?: AdminUpgradeItemGrant[];
  boxes?: AdminUpgradeBoxGrant[];
  passes?: string[];
  coins?: AdminUpgradeCoinGrant[];
  visibleToAccessLevelIds?: string[];
}

export interface MiningCoin {
  id: string;
  name: string;
  symbol: string;
  networkHashrate: number;
  blockReward: number;
  blockTime: number;
  priceUSD: number;
  algorithm: string;
  difficulty: number;
  multiplier: number;
  color: string;
  description: string;
  minProportion: number; // minimum proportion based on miner power
  usdcRate: number; // value per USDC
  isActive: boolean; // if false, visible but not selectable
  showInExchange: boolean;
  realNetworkHashrate?: number;
  targetDailyUSD?: number;
}

export interface SeasonPassReward {
  id: number;
  type: 'item' | 'currency';
  itemId?: string; // If type='item'
  coinId?: string; // If type='currency' (e.g., 'usdc', or mining coin id)
  qty: number;
}

export interface SeasonPass {
  id: string;
  seasonId: string;
  name: string;
  description: string;
  priceUsdc: number;
  emblemUrl: string;
  isActive: boolean;
  rewards?: SeasonPassReward[];
}

export interface SeasonPurchase {
  passId: string;
  seasonId: string;
  purchasedAt: number;
}

export interface MonetizationSettings {
  applixirEnabled: boolean;
  applixirSiteId: string;
  applixirZoneId: string;
  applixirAccountId: string;
  applixirRewardMessage: string;
  applixirCallbackSecret: string;

  ezoicEnabled: boolean;
  ezoicPublisherId: string;
  ezoicAppId: string;
  ezoicPlaceholderId: string;
}

// --- ECONOMY INTERFACES ---
export interface EconomySettings {
  blackMarketEnabled?: boolean;
  hardwareMarketEnabled?: boolean;
  marketTaxPercent?: number;
  realActiveMiners?: number;
  realNetworkHashrates?: Record<string, number>;
  activeMinersByCoin?: Record<string, number>;
}

export interface AdminMarketListing {
  id: string;
  sellerId: number;
  sellerName: string;
  itemId: string;
  price: number;
  qty: number;
  status: 'active' | 'sold';
  expiresAt: number;
  reservedBy?: number;
  reservedUntil?: number;
}


export interface PromoCode {
  code: string;
  lootBoxId?: string;
  upgradeId?: string;
  adminUpgradeId?: string;
  type: 'per_player' | 'global_once' | 'roleta_player_1x' | 'roleta_global_1x';
  isActive: boolean;
  createdAt: number;
  redemptionsCount?: number;
}

export interface PromoCodeRedemption {
  code: string;
  userId: number;
  userName?: string;
  redeemedAt: number;
}

export interface WheelItem {
  id: string;
  label: string;
  weight: number;
  color: string;
  itemId?: string; // Links to game item ID
  image?: string; // Optional image URL or emoji
}

export interface Prediction {
  text: string;
  loading: boolean;
}

export interface MultiAccountInfo {
  registration_ip: string;
  account_count: number;
  usernames: string[];
  emails: string[];
  ids: number[];
}

export interface HistoryMultiAccountInfo {
  ip: string;
  user_count: number;
  usernames: string[];
  emails: string[];
}

export interface SuspectedAutoReferral {
  referrer_id: number;
  referrer_username: string;
  referrer_ip: string;
  referred_id: number;
  referred_username: string;
  referred_ip: string;
}

export interface AccessLog {
  id: number;
  ip: string;
  attempted_url: string;
  user_agent?: string;
  details?: string;
  created_at: number;
}

export interface BlacklistEntry {
  ip: string;
  reason?: string;
  added_at: number;
}

export interface SecurityStats {
  multiAccounts: MultiAccountInfo[];
  historyMultiAccounts: HistoryMultiAccountInfo[];
  suspectedAutoReferrals: SuspectedAutoReferral[];
  accessLogs: AccessLog[];
  blacklist: BlacklistEntry[];
}

export interface ReferralModel {
  id: number;
  name: string;
  description: string;
  sender_reward_usdc: number;
  receiver_reward_usdc: number;
  sender_loot_box_id: string | null;
  receiver_loot_box_id: string | null;
  is_active: number; // 0 or 1
}

