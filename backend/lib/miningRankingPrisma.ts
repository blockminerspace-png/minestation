import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { batteryIdLooksLikePhysicalInstanceUuid } from './batteryInstanceResolve.js';

/** Resolve `placed_racks.battery_id` (instância ou catálogo) → id de upgrade para hashrate no ranking. */
async function buildRackBatteryIdToCatalogMap(
  racks: Array<{ battery_id: string | null }>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rawIds = [
    ...new Set(
      racks.map((r) => (r.battery_id != null ? String(r.battery_id).trim() : '')).filter((x) => x.length > 0)
    )
  ];
  if (rawIds.length === 0) return out;

  for (const id of rawIds) {
    if (!batteryIdLooksLikePhysicalInstanceUuid(id)) out.set(id, id);
  }

  const uuidIds = rawIds.filter((id) => batteryIdLooksLikePhysicalInstanceUuid(id));
  if (uuidIds.length > 0) {
    const stored = await prisma.stored_batteries.findMany({
      where: { id: { in: uuidIds } },
      select: { id: true, item_id: true }
    });
    for (const s of stored) {
      out.set(String(s.id), String(s.item_id));
    }
  }

  const still = uuidIds.filter((id) => !out.has(id));
  if (still.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ iid: string; item_id: string }>>(
      Prisma.sql`
        SELECT DISTINCT ON (ch.battery_instance_id)
          ch.battery_instance_id::text AS iid,
          ch.battery_item_id::text AS item_id
        FROM charging_history ch
        WHERE ch.battery_instance_id IN (${Prisma.join(still)})
          AND ch.battery_item_id IS NOT NULL
          AND BTRIM(ch.battery_item_id::text) <> ''
        ORDER BY ch.battery_instance_id, ch.timestamp DESC
      `
    );
    for (const row of rows) {
      if (row.iid && row.item_id) out.set(String(row.iid), String(row.item_id));
    }
  }

  return out;
}

type CoinLite = { id: string; name: string; symbol: string };

type PublicRankingUser = {
  user_id: number;
  username: string;
  coins: Record<string, number>;
};

type AdminRankingUser = PublicRankingUser & {
  balances: Record<string, number>;
};

function groupByRackId<T extends { rack_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.rack_id;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

/** Ranking público: poder por moeda por utilizador (mesmas regras que o SQL anterior). */
export async function getPublicMiningRankingPayload(): Promise<{
  timestamp: number;
  ranking: PublicRankingUser[];
  coins: CoinLite[];
}> {
  const coins = await prisma.mining_coins.findMany({
    select: { id: true, name: true, symbol: true }
  });
  const coinsMap = new Map(coins.map((c) => [c.id, c]));

  const upgrades = await prisma.upgrades.findMany();
  const upgradesMap = new Map(upgrades.map((u) => [u.id, u]));

  const eligibleUsers = await prisma.users.findMany({
    where: { is_blocked: 0, ranking_excluded: 0 },
    select: { id: true, username: true }
  });
  const usernameById = new Map(eligibleUsers.map((u) => [u.id, u.username]));
  const eligibleIds = eligibleUsers.map((u) => u.id);

  const racks =
    eligibleIds.length === 0
      ? []
      : await prisma.placed_racks.findMany({
          where: {
            is_on: 1,
            user_id: { in: eligibleIds },
            wiring_id: { not: null },
            battery_id: { not: null }
          }
        });

  const rackIds = racks.map((r) => r.id);
  const allSlots =
    rackIds.length === 0
      ? []
      : await prisma.rack_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, machine_item_id: true }
        });
  const allMult =
    rackIds.length === 0
      ? []
      : await prisma.rack_multiplier_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, multiplier_item_id: true }
        });
  const slotsByRack = groupByRackId(allSlots);
  const multByRack = groupByRackId(allMult);

  const battCatalogByRackBatteryId = await buildRackBatteryIdToCatalogMap(racks);

  const rankingData = new Map<number, PublicRankingUser>();

  for (const rack of racks) {
    if (!rack.selected_coin_id) continue;
    const coinId = rack.selected_coin_id;
    if (!coinsMap.has(coinId)) continue;

    const rawBat = rack.battery_id ? String(rack.battery_id).trim() : '';
    const catBat = rawBat ? battCatalogByRackBatteryId.get(rawBat) || '' : '';
    const battDef = catBat ? upgradesMap.get(catBat) : undefined;
    if (!battDef) continue;
    const isInfinite = battDef && battDef.power_capacity === -1;
    if (!isInfinite && rack.current_charge <= 0) continue;

    const slots = slotsByRack.get(rack.id) || [];
    let rackBaseProd = 0;
    for (const s of slots) {
      if (s.machine_item_id) {
        const up = upgradesMap.get(s.machine_item_id);
        if (up && up.base_production) rackBaseProd += up.base_production;
      }
    }
    if (rackBaseProd === 0) continue;

    const mults = multByRack.get(rack.id) || [];
    let multiplierFactor = 1;
    for (const m of mults) {
      if (m.multiplier_item_id) {
        const up = upgradesMap.get(m.multiplier_item_id);
        if (up && up.multiplier) multiplierFactor += up.multiplier;
      }
    }

    const totalPower = rackBaseProd * multiplierFactor;
    const uname = usernameById.get(rack.user_id);
    if (uname == null) continue;

    if (!rankingData.has(rack.user_id)) {
      rankingData.set(rack.user_id, {
        user_id: rack.user_id,
        username: uname,
        coins: {}
      });
    }
    const uData = rankingData.get(rack.user_id)!;
    if (!uData.coins[coinId]) uData.coins[coinId] = 0;
    uData.coins[coinId] += totalPower;
  }

  return {
    timestamp: Date.now(),
    ranking: Array.from(rankingData.values()),
    coins: Array.from(coinsMap.values())
  };
}

/** Ranking admin: poder + saldos `coin_balances` por moeda minerável. */
export async function getAdminMiningRankingPayload(): Promise<{
  timestamp: number;
  ranking: AdminRankingUser[];
  coins: CoinLite[];
}> {
  const coins = await prisma.mining_coins.findMany({
    select: { id: true, name: true, symbol: true }
  });
  const coinsMap = new Map(coins.map((c) => [c.id, c]));

  const upgrades = await prisma.upgrades.findMany();
  const upgradesMap = new Map(upgrades.map((u) => [u.id, u]));

  const eligibleUsers = await prisma.users.findMany({
    where: { is_blocked: 0, ranking_excluded: 0 },
    select: { id: true, username: true }
  });
  const eligibleIds = eligibleUsers.map((u) => u.id);

  const rankingData = new Map<number, AdminRankingUser>();
  for (const u of eligibleUsers) {
    rankingData.set(u.id, {
      user_id: u.id,
      username: u.username,
      coins: {},
      balances: {}
    });
  }

  const racks =
    eligibleIds.length === 0
      ? []
      : await prisma.placed_racks.findMany({
          where: {
            is_on: 1,
            user_id: { in: eligibleIds },
            wiring_id: { not: null },
            battery_id: { not: null }
          }
        });

  const rackIds = racks.map((r) => r.id);
  const allSlots =
    rackIds.length === 0
      ? []
      : await prisma.rack_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, machine_item_id: true }
        });
  const allMult =
    rackIds.length === 0
      ? []
      : await prisma.rack_multiplier_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, multiplier_item_id: true }
        });
  const slotsByRack = groupByRackId(allSlots);
  const multByRack = groupByRackId(allMult);

  const battCatalogByRackBatteryId = await buildRackBatteryIdToCatalogMap(racks);

  for (const rack of racks) {
    if (!rack.selected_coin_id || !coinsMap.has(rack.selected_coin_id)) continue;

    const rawBat = rack.battery_id ? String(rack.battery_id).trim() : '';
    const catBat = rawBat ? battCatalogByRackBatteryId.get(rawBat) || '' : '';
    const battDef = catBat ? upgradesMap.get(catBat) : undefined;
    if (!battDef) continue;
    const isInfinite = battDef && battDef.power_capacity === -1;
    if (!isInfinite && rack.current_charge <= 0) continue;

    const slots = slotsByRack.get(rack.id) || [];
    let rackBaseProd = 0;
    for (const s of slots) {
      if (s.machine_item_id) {
        const up = upgradesMap.get(s.machine_item_id);
        if (up && up.base_production) rackBaseProd += up.base_production;
      }
    }
    if (rackBaseProd === 0) continue;

    const mults = multByRack.get(rack.id) || [];
    let multiplierFactor = 1;
    for (const m of mults) {
      if (m.multiplier_item_id) {
        const up = upgradesMap.get(m.multiplier_item_id);
        if (up && up.multiplier) multiplierFactor += up.multiplier;
      }
    }

    const totalRackPower = rackBaseProd * multiplierFactor;
    const userEntry = rankingData.get(rack.user_id);
    if (userEntry) {
      const cid = rack.selected_coin_id;
      userEntry.coins[cid] = (userEntry.coins[cid] || 0) + totalRackPower;
    }
  }

  const coinIdsForBalances = Array.from(coinsMap.keys());
  if (coinIdsForBalances.length > 0) {
    const balances = await prisma.coin_balances.findMany({
      where: { coin_id: { in: coinIdsForBalances } },
      select: { user_id: true, coin_id: true, amount: true }
    });
    for (const b of balances) {
      const userEntry = rankingData.get(b.user_id);
      if (userEntry) userEntry.balances[b.coin_id] = b.amount;
    }
  }

  const result = Array.from(rankingData.values()).filter((u) => {
    const hasPower = Object.values(u.coins).some((v) => Number(v) > 0);
    const hasBalance = Object.values(u.balances).some((v) => Number(v) > 0);
    return hasPower || hasBalance;
  });

  return {
    timestamp: Date.now(),
    ranking: result,
    coins: Array.from(coinsMap.values())
  };
}
