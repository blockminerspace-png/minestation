/**
 * Bundle da página Upgrade + lista admin-upgrades (mesma lógica que GET /api/admin-upgrades).
 */
import pool from '../config/db.js';
import { prisma } from '../config/prisma.js';
import { EMAIL_ADDRESS_MAX_LENGTH } from '../models/registrationValidation.js';
import {
  loadLootBoxesCatalogForBootstrap,
  loadMiningCoinsForBootstrap,
  loadSeasonPassesCatalogForBootstrap,
  loadUpgradesForBootstrap
} from './publicBootstrapPayload.js';

const NFT_AUTO_ROOM_ID = 'room_1775484506874';
const NFT_AUTO_POLICY_ROOM_NAME_KEYS = ['nfts auto', 'nft auto', 'nfts arbam'];

function normalizeRigRoomPolicyNameKeyServer(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function isNftAutoArmario1OnlyRoomRowFromDb(row: { id?: unknown; name?: unknown }): boolean {
  if (!row) return false;
  const id = String(row.id || '').trim();
  if (id === NFT_AUTO_ROOM_ID) return true;
  return NFT_AUTO_POLICY_ROOM_NAME_KEYS.includes(normalizeRigRoomPolicyNameKeyServer(row.name));
}

/** Igual a `GET /api/admin-upgrades` (req.userId pode ser undefined → só ativos). */
export async function loadAdminUpgradesForUser(userId: number | undefined): Promise<unknown[]> {
  let isAdminUser = false;
  let userRoomIds: string[] = [];
  if (userId) {
    const uRow = await prisma.users.findUnique({
      where: { id: userId },
      select: { is_admin: true }
    });
    if (uRow?.is_admin) isAdminUser = true;

    const rooms = await prisma.user_rig_rooms.findMany({
      where: { user_id: userId },
      select: { room_id: true }
    });
    userRoomIds = rooms.map((r) => r.room_id);
  }

  const query = isAdminUser
    ? 'SELECT * FROM admin_upgrades ORDER BY COALESCE(sort_order, 0) ASC, created_at DESC'
    : 'SELECT * FROM admin_upgrades WHERE is_active = 1 ORDER BY COALESCE(sort_order, 0) ASC, created_at DESC';
  const upsRes = await pool.query(query);
  const itemsRes = await pool.query('SELECT * FROM admin_upgrade_items');
  const boxesRes = await pool.query('SELECT * FROM admin_upgrade_boxes');
  const passesRes = await pool.query('SELECT * FROM admin_upgrade_passes');
  const coinsRes = await pool.query('SELECT * FROM admin_upgrade_coins');
  const visibilityRes = await pool.query('SELECT * FROM admin_upgrade_visibility');

  const itemsMap = itemsRes.rows.reduce<Record<string, { itemId: string; qty: number }[]>>((acc, r) => {
    (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push({ itemId: r.item_id, qty: r.qty });
    return acc;
  }, {});
  const boxesMap = boxesRes.rows.reduce<Record<string, { boxId: string; qty: number }[]>>((acc, r) => {
    (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push({ boxId: r.box_id, qty: r.qty });
    return acc;
  }, {});
  const passesMap = passesRes.rows.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push(r.pass_id);
    return acc;
  }, {});
  const coinsMap = coinsRes.rows.reduce<Record<string, { coinId: string; amount: unknown }[]>>((acc, r) => {
    (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push({ coinId: r.coin_id, amount: r.amount });
    return acc;
  }, {});
  const visibilityMap = visibilityRes.rows.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push(r.access_level_id);
    return acc;
  }, {});

  return upsRes.rows.map((u: Record<string, unknown>) => ({
    id: u.id,
    name: u.name,
    description: u.description,
    priceUsdc: u.price_usdc,
    grantUsdc: u.grant_usdc,
    grantAccessLevelId: u.grant_access_level_id,
    isActive: !!u.is_active,
    items: itemsMap[String(u.id)] || [],
    boxes: boxesMap[String(u.id)] || [],
    passes: passesMap[String(u.id)] || [],
    coins: coinsMap[String(u.id)] || [],
    visibleToAccessLevelIds: visibilityMap[String(u.id)] || [],
    alreadyOwned: u.id === '53f0c699-0471-4e65-a147-17064e3aafe0' && userRoomIds.includes('room_1765936323521'),
    version: u.version != null ? Number(u.version) : 1,
    slug: u.slug ?? null,
    category: u.category != null ? String(u.category) : 'PROMO_PACK',
    originalPriceUsdc:
      u.original_price_usdc != null && String(u.original_price_usdc).trim() !== ''
        ? String(u.original_price_usdc)
        : null,
    stockRemaining: u.stock_remaining != null ? Number(u.stock_remaining) : null,
    maxPerUser: u.max_per_user != null ? Number(u.max_per_user) : 1,
    startsAt: u.starts_at != null ? Number(u.starts_at) : null,
    endsAt: u.ends_at != null ? Number(u.ends_at) : null,
    sortOrder: u.sort_order != null ? Number(u.sort_order) : 0,
    imageUrl: u.image_url != null ? String(u.image_url) : null
  }));
}

/** Igual ao JSON de `GET /api/my-rig-rooms/:email` após validar `uid`. */
export async function loadMyRigRoomsForUser(uid: number): Promise<unknown[]> {
  const urowRes = await pool.query('SELECT access_level_id FROM users WHERE id = $1', [uid]);
  const urow = urowRes.rows[0] as { access_level_id?: string } | undefined;
  const currentLvlId = urow?.access_level_id || null;

  const userLvlsRes = await pool.query('SELECT access_level_id FROM user_access_levels WHERE user_id = $1', [uid]);
  const userLvlIds = userLvlsRes.rows.map((l: { access_level_id: string }) => l.access_level_id);
  if (currentLvlId && !userLvlIds.includes(currentLvlId)) {
    userLvlIds.push(currentLvlId);
  }

  const passPurchRes = await pool.query('SELECT pass_id FROM season_purchases WHERE user_id = $1', [uid]);
  const userPassIds = passPurchRes.rows.map((p: { pass_id: string }) => p.pass_id);

  const racksRoomRes = await pool.query(
    `SELECT DISTINCT
       CASE
         WHEN room_id IS NULL OR BTRIM(COALESCE(room_id, '')) = '' OR BTRIM(room_id) = 'main' THEN 'room_initial'
         ELSE BTRIM(room_id)
       END AS room_id
     FROM placed_racks WHERE user_id = $1`,
    [uid]
  );
  const roomIdsWithPlacedRacks = new Set(
    racksRoomRes.rows.map((row: { room_id: string }) => row.room_id)
  );

  const rowsRes = await pool.query(
    `SELECT 
       rr.id, rr.name, rr.initial_capacity, rr.max_capacity, rr.base_slot_price, rr.slot_price_increase_percent, 
       rr.allowed_levels, rr.allowed_season_pass_ids, rr.is_active, rr.sort_order, 
       urr.purchased_at, urr.unlocked_slots 
     FROM rig_rooms rr 
     LEFT JOIN user_rig_rooms urr ON urr.room_id = rr.id AND urr.user_id = $1 
     ORDER BY rr.sort_order ASC`,
    [uid]
  );

  const list = rowsRes.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    initialCapacity: r.initial_capacity,
    maxCapacity: r.max_capacity,
    baseSlotPrice: r.base_slot_price,
    slotPriceIncreasePercent: r.slot_price_increase_percent,
    allowedLevels: r.allowed_levels
      ? (() => {
          try {
            return JSON.parse(String(r.allowed_levels)) as unknown[];
          } catch {
            return [];
          }
        })()
      : [],
    allowedSeasonPassIds: r.allowed_season_pass_ids
      ? (() => {
          try {
            return JSON.parse(String(r.allowed_season_pass_ids)) as unknown[];
          } catch {
            return [];
          }
        })()
      : [],
    isActive: !!r.is_active,
    sortOrder: r.sort_order,
    owned: !!r.purchased_at,
    unlockedSlots: r.unlocked_slots || 0,
    nftAutoArmario1Only: isNftAutoArmario1OnlyRoomRowFromDb(r as { id?: unknown; name?: unknown })
  }));

  return list.filter((r) => {
    const row = r as {
      allowedLevels: unknown[];
      allowedSeasonPassIds: unknown[];
      owned: boolean;
      id: string;
    };
    const allowedLvl = Array.isArray(row.allowedLevels) ? row.allowedLevels : [];
    const allowedSeason = Array.isArray(row.allowedSeasonPassIds) ? row.allowedSeasonPassIds : [];

    const levelOk = allowedLvl.length === 0 || allowedLvl.some((lvl) => userLvlIds.includes(String(lvl)));
    const seasonOk =
      allowedSeason.length === 0 || allowedSeason.some((passId) => userPassIds.includes(String(passId)));

    const hasRacksHere = roomIdsWithPlacedRacks.has(row.id);
    return row.owned || hasRacksHere || (levelOk && seasonOk);
  });
}

export async function getUpgradeAccountShopBundlePayload(userId: number): Promise<{
  seasonPasses: unknown[];
  seasonPurchases: Array<{ passId: string; seasonId: string; purchasedAt: number }>;
  adminUpgrades: unknown[];
  upgrades: unknown[];
  lootBoxes: unknown[];
  adminUpgradePurchases: string[];
  miningCoins: unknown[];
  rigRooms: unknown[];
}> {
  const [
    seasonPasses,
    purchasesRes,
    adminUpgrades,
    upgrades,
    lootBoxes,
    adminPurchRows,
    miningCoins,
    rigRooms
  ] = await Promise.all([
    loadSeasonPassesCatalogForBootstrap(),
    pool.query('SELECT pass_id, season_id, purchased_at FROM season_purchases WHERE user_id = $1', [userId]),
    loadAdminUpgradesForUser(userId),
    loadUpgradesForBootstrap(userId),
    loadLootBoxesCatalogForBootstrap(),
    prisma.admin_upgrade_purchases.findMany({
      where: { user_id: userId },
      select: { upgrade_id: true }
    }),
    loadMiningCoinsForBootstrap(),
    loadMyRigRoomsForUser(userId)
  ]);

  const seasonPurchases = (purchasesRes.rows as { pass_id: string; season_id: string; purchased_at: unknown }[]).map(
    (r) => ({
      passId: r.pass_id,
      seasonId: r.season_id,
      purchasedAt: Number(r.purchased_at)
    })
  );

  return {
    seasonPasses,
    seasonPurchases,
    adminUpgrades,
    upgrades,
    lootBoxes,
    adminUpgradePurchases: adminPurchRows.map((r) => r.upgrade_id),
    miningCoins,
    rigRooms
  };
}

/** Lista de IDs de pacotes admin já comprados (alinhado ao que o frontend esperava de GET /api/admin-upgrade-purchases/:email). */
export async function loadAdminUpgradePurchaseIdsForUser(userId: number): Promise<string[]> {
  const rows = await prisma.admin_upgrade_purchases.findMany({
    where: { user_id: userId },
    select: { upgrade_id: true }
  });
  return rows.map((r) => r.upgrade_id);
}

export function normalizeEmailParam(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function isEmailParamInvalid(email: string): boolean {
  return !email || email.length > EMAIL_ADDRESS_MAX_LENGTH || /[\x00-\x1f<>]/.test(email);
}
