import { Prisma } from '@prisma/client';

export type UserPutCoreTxInput = {
  uid: number;
  usernameForUpdate: string;
  normalizedEmail: string;
  /** `null` = não alterar coluna `password`. */
  passwordHash: string | null;
  polygonForUpdate: string | null;
  accessLevelIdForUpdate: string | null;
  referredByForUpdate: string | null;
  allowAccessLevelFromBody: boolean;
  accessLevelIdsValidated: string[] | null;
  clientIpReferral: string;
};

async function bumpUnopenedBox(tx: Prisma.TransactionClient, userId: number, boxId: string): Promise<void> {
  await tx.unopened_boxes.upsert({
    where: { user_id_box_id: { user_id: userId, box_id: boxId } },
    create: { user_id: userId, box_id: boxId, qty: 1 },
    update: { qty: { increment: 1 } }
  });
}

/**
 * Núcleo transacional de `PUT /api/user`: atualização de utilizador, níveis de acesso e recompensas de referral.
 * Deve correr dentro de `prisma.$transaction`.
 */
export async function executeUserPutCoreTransaction(
  tx: Prisma.TransactionClient,
  input: UserPutCoreTxInput
): Promise<void> {
  const {
    uid,
    usernameForUpdate,
    normalizedEmail,
    passwordHash,
    polygonForUpdate,
    accessLevelIdForUpdate,
    referredByForUpdate,
    allowAccessLevelFromBody,
    accessLevelIdsValidated,
    clientIpReferral
  } = input;

  const now = BigInt(Date.now());
  const nowMs = Date.now();

  const userUpdateBase = {
    username: usernameForUpdate,
    email: normalizedEmail,
    polygon_wallet: polygonForUpdate,
    access_level_id: accessLevelIdForUpdate,
    referred_by: referredByForUpdate
  };

  if (passwordHash != null) {
    await tx.users.update({
      where: { id: uid },
      data: { ...userUpdateBase, password: passwordHash }
    });
  } else {
    await tx.users.update({
      where: { id: uid },
      data: userUpdateBase
    });
  }

  if (allowAccessLevelFromBody && accessLevelIdForUpdate) {
    await tx.user_access_levels.createMany({
      data: [{ user_id: uid, access_level_id: accessLevelIdForUpdate, granted_at: now }],
      skipDuplicates: true
    });
  }

  if (allowAccessLevelFromBody && accessLevelIdsValidated) {
    await tx.user_access_levels.deleteMany({ where: { user_id: uid } });
    if (accessLevelIdsValidated.length > 0) {
      await tx.user_access_levels.createMany({
        data: accessLevelIdsValidated.map((alid) => ({
          user_id: uid,
          access_level_id: alid,
          granted_at: now
        })),
        skipDuplicates: true
      });
    }
    if (accessLevelIdForUpdate) {
      await tx.user_access_levels.createMany({
        data: [{ user_id: uid, access_level_id: accessLevelIdForUpdate, granted_at: now }],
        skipDuplicates: true
      });
    }
  }

  if (!referredByForUpdate) return;

  const ref = await tx.users.findFirst({
    where: {
      referral_code: { equals: referredByForUpdate, mode: 'insensitive' }
    },
    select: { id: true, access_level_id: true }
  });

  const referredUsername = usernameForUpdate;
  if (!ref || !referredUsername) return;

  const referrerRow = await tx.users.findUnique({
    where: { id: ref.id },
    select: { registration_ip: true }
  });
  const referrerRegIp = referrerRow?.registration_ip ?? null;

  const historyHit = await tx.user_history_ips.findUnique({
    where: { user_id_ip: { user_id: ref.id, ip: clientIpReferral } }
  });

  if ((referrerRegIp && referrerRegIp === clientIpReferral) || historyHit != null) {
    console.warn(
      `[Referral] Bloqueada tentativa de auto-indicação. IP ${clientIpReferral} vinculado ao indicador ID: ${ref.id}`
    );
    throw new Error(
      'Auto-indicação não permitida. Você não pode usar seu próprio código de indicação em contas do mesmo IP.'
    );
  }

  let insertedReferral = false;
  try {
    await tx.referrals.create({
      data: { user_id: ref.id, referred_username: referredUsername }
    });
    insertedReferral = true;
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      insertedReferral = false;
    } else {
      throw e;
    }
  }

  if (!insertedReferral) return;

  const alId = ref.access_level_id || 'normal';
  const link = await tx.access_level_referral_models.findUnique({
    where: { access_level_id: alId }
  });
  const model =
    link?.referral_model_id != null
      ? await tx.referral_models.findFirst({
          where: { id: link.referral_model_id, is_active: 1 }
        })
      : null;

  if (model) {
    console.log(`[Referral] Using Advanced Model: ${model.name} for Access Level: ${alId}`);

    const senderUsdc = model.sender_reward_usdc ?? 0;
    if (senderUsdc > 0) {
      await tx.game_states.update({
        where: { user_id: ref.id },
        data: { usdc: { increment: senderUsdc } }
      });
    }
    if (model.sender_loot_box_id) {
      await bumpUnopenedBox(tx, ref.id, model.sender_loot_box_id);
    }

    const receiverUsdc = model.receiver_reward_usdc ?? 0;
    if (receiverUsdc > 0) {
      await tx.game_states.update({
        where: { user_id: uid },
        data: { usdc: { increment: receiverUsdc } }
      });
    }
    if (model.receiver_loot_box_id) {
      await bumpUnopenedBox(tx, uid, model.receiver_loot_box_id);
      await tx.player_claimed_boxes.createMany({
        data: [{ user_id: uid, box_id: model.receiver_loot_box_id, claimed_at: BigInt(nowMs) }],
        skipDuplicates: true
      });
    }

    await tx.game_states.update({
      where: { user_id: ref.id },
      data: { claimed_referrals: { increment: 1 } }
    });
    await tx.game_states.update({
      where: { user_id: uid },
      data: { referral_bonus_claimed: 1 }
    });
  } else {
    const senderBoxes = await tx.loot_boxes.findMany({
      where: { trigger: 'referral_sender' },
      select: { id: true }
    });
    for (const box of senderBoxes) {
      await bumpUnopenedBox(tx, ref.id, box.id);
    }
    await tx.game_states.update({
      where: { user_id: ref.id },
      data: { claimed_referrals: { increment: 1 } }
    });

    const gs = await tx.game_states.findUnique({
      where: { user_id: uid },
      select: { referral_bonus_claimed: true }
    });
    if (gs && !gs.referral_bonus_claimed) {
      const receiverBoxes = await tx.loot_boxes.findMany({
        where: { trigger: 'referral_receiver' },
        select: { id: true }
      });
      for (const box of receiverBoxes) {
        await bumpUnopenedBox(tx, uid, box.id);
        await tx.player_claimed_boxes.createMany({
          data: [{ user_id: uid, box_id: box.id, claimed_at: BigInt(nowMs) }],
          skipDuplicates: true
        });
      }
      await tx.game_states.update({
        where: { user_id: uid },
        data: { referral_bonus_claimed: 1 }
      });
    }
  }
}
