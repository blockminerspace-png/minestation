/**
 * Bundles autenticados: uma resposta HTTP em vez de várias chamadas no perfil.
 */
import pool from '../config/db.js';
import { prisma } from '../config/prisma.js';
import { getSettingValue } from './settingsPrisma.js';
import {
  loadAccessLevelsForBootstrap,
  loadLootBoxesCatalogForBootstrap,
  loadSeasonPassesCatalogForBootstrap
} from './publicBootstrapPayload.js';

export async function getProfilePageBundlePayload(userId: number): Promise<{
  seasonPasses: unknown[];
  seasonPurchases: Array<{ passId: string; seasonId: string; purchasedAt: number }>;
  accessLevels: unknown[];
  referrals: string[];
  lootBoxes: unknown[];
  newsFee: number;
  profileGame: { usdc: number; claimedReferrals: number };
}> {
  const [
    seasonPasses,
    accessLevels,
    lootBoxes,
    purchasesRes,
    refsRes,
    feeRaw,
    gs
  ] = await Promise.all([
    loadSeasonPassesCatalogForBootstrap(),
    loadAccessLevelsForBootstrap(),
    loadLootBoxesCatalogForBootstrap(),
    pool.query('SELECT pass_id, season_id, purchased_at FROM season_purchases WHERE user_id = $1', [userId]),
    pool.query('SELECT referred_username FROM referrals WHERE user_id = $1 ORDER BY id ASC', [userId]),
    getSettingValue('news_post_fee_usdc'),
    prisma.game_states.findUnique({
      where: { user_id: userId },
      select: { usdc: true, claimed_referrals: true }
    })
  ]);

  const newsFee = feeRaw != null && feeRaw !== '' ? Number(feeRaw) || 0 : 0;
  const seasonPurchases = (purchasesRes.rows as { pass_id: string; season_id: string; purchased_at: unknown }[]).map(
    (r) => ({
      passId: r.pass_id,
      seasonId: r.season_id,
      purchasedAt: Number(r.purchased_at)
    })
  );
  const referrals = (refsRes.rows as { referred_username: string }[]).map((r) => r.referred_username);

  return {
    seasonPasses,
    seasonPurchases,
    accessLevels,
    referrals,
    lootBoxes,
    newsFee,
    profileGame: {
      usdc: Number(gs?.usdc ?? 0),
      claimedReferrals: Number(gs?.claimed_referrals ?? 0)
    }
  };
}
