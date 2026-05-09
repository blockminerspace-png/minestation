import { prisma } from '../../config/prisma.js';
import { getProfilePageBundlePayload } from '../../lib/meBundlesPayload.js';
import { ensureUserReferralCode, listUserAccessLevelIds } from '../../models/authModel.js';
import { normalizePublicAssetUrl } from '../../lib/publicAssetUrl.js';
import { REFERRAL_DEPOSIT_COMMISSION_PERCENT } from '../../models/referralCommissionModel.js';

function safePublicInviteBaseUrl(raw: string): string {
  const t = String(raw || '').trim().replace(/\/+$/, '');
  if (!t) return '';
  if (!/^https?:\/\//i.test(t)) return '';
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

export async function buildProfileStatePayload(input: {
  userId: number;
  inviteBaseUrl: string;
}): Promise<Record<string, unknown>> {
  const uid = Number(input.userId);
  const base = safePublicInviteBaseUrl(input.inviteBaseUrl);

  const [userRow, bundle, invitedCount, accessLevels] = await Promise.all([
    prisma.users.findUnique({
      where: { id: uid },
      select: {
        id: true,
        username: true,
        email: true,
        access_level_id: true,
        polygon_wallet: true,
        referral_code: true,
        referred_by: true,
        is_blocked: true
      }
    }),
    getProfilePageBundlePayload(uid),
    prisma.referrals.count({ where: { user_id: uid } }),
    prisma.access_levels.findMany({
      where: {},
      select: { id: true, name: true, is_active: true, news_posting_enabled: true }
    })
  ]);

  if (!userRow) {
    return { ok: false, error: 'Utilizador não encontrado.' };
  }

  const referralCode = await ensureUserReferralCode(
    uid,
    String(userRow.username || ''),
    userRow.referral_code
  );

  const userLvlIds = await listUserAccessLevelIds(uid, userRow.access_level_id);
  const primaryLevelId = userRow.access_level_id || '';
  const levelRow = accessLevels.find((l) => l.id === primaryLevelId);
  const accessLevelLabel = levelRow?.name || primaryLevelId || '—';

  const passes = (bundle.seasonPasses || []) as Array<{
    id?: string;
    name?: string;
    emblemUrl?: string;
  }>;
  const purchases = bundle.seasonPurchases || [];
  const badges = purchases.map((p) => {
    const pass = passes.find((sp) => sp.id === p.passId);
    const rawUrl = pass?.emblemUrl;
    const imageUrl =
      typeof rawUrl === 'string' && rawUrl.trim() ? normalizePublicAssetUrl(rawUrl) : undefined;
    return {
      passId: p.passId,
      seasonId: p.seasonId,
      name: typeof pass?.name === 'string' ? pass.name.slice(0, 120) : p.passId,
      imageUrl: imageUrl && !/^javascript:/i.test(imageUrl) ? imageUrl : null,
      purchasedAt: p.purchasedAt
    };
  });

  const inviteUrl =
    referralCode && base ? `${base}?ref=${encodeURIComponent(referralCode)}` : referralCode ? `?ref=${encodeURIComponent(referralCode)}` : '';

  return {
    ok: true,
    identity: {
      email: userRow.email,
      username: userRow.username,
      displayName: userRow.username,
      accessLevelId: primaryLevelId,
      accessLevelLabel,
      status: userRow.is_blocked ? 'blocked' : 'active',
      emailReadOnly: true
    },
    permissions: {
      canChangeUsername: true,
      canBindReferral: !userRow.referred_by,
      canConnectWallet: true,
      canRemoveWallet: !!userRow.polygon_wallet
    },
    limits: {
      usernameMin: 3,
      usernameMax: 50,
      passwordMax: 50,
      referralCodeMax: 50
    },
    referral: {
      code: referralCode,
      inviteUrl,
      invitedCount,
      commissionPercent: REFERRAL_DEPOSIT_COMMISSION_PERCENT,
      commissionRule:
        'O indicador recebe comissão em USDC apenas quando o indicado tem depósito USDC creditado; o valor é calculado no servidor.',
      referredBy: userRow.referred_by ?? null
    },
    wallet: {
      network: 'polygon',
      chainId: 137,
      address: userRow.polygon_wallet || null
    },
    badges,
    bundle: {
      seasonPasses: bundle.seasonPasses,
      seasonPurchases: bundle.seasonPurchases,
      accessLevels: bundle.accessLevels,
      lootBoxes: bundle.lootBoxes,
      newsFee: bundle.newsFee,
      profileGame: bundle.profileGame
    },
    accessLevelsCatalog: accessLevels.map((l) => ({
      id: l.id,
      name: l.name,
      isActive: !!l.is_active,
      newsPostingEnabled: !!l.news_posting_enabled
    })),
    userAccessLevelIds: userLvlIds
  };
}
