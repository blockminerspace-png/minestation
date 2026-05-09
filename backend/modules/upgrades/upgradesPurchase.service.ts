import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { grantAdminUpgradeRewardsInTx } from '../../models/adminUpgradeGrantModel.js';
import { RoletaAppError } from '../../validation/roletaValidation.js';
import { parseUpgradePackageId, usdcDecimalFromRow } from './upgrades.catalog.js';

const GENESIS_BUNDLE_UPGRADE_ID = '53f0c699-0471-4e65-a147-17064e3aafe0';
const GENESIS_ROOM_ID = 'room_1765936323521';
const IDEM_SCOPE = 'upgrade_purchase';

export type UpgradePurchaseOk = {
  ok: true;
  newUsdc: number;
  idempotentReplay: boolean;
  packageVersion: number;
};

function buildIdemPayload(ok: UpgradePurchaseOk): string {
  return JSON.stringify(ok);
}

/**
 * Compra atómica de pacote admin (Upgrades): idempotência, validação de versão, stock limitado, saldo e entrega.
 */
export async function runUpgradePackagePurchase(args: {
  userId: number;
  packageIdRaw: unknown;
  /** Quando `null`, não grava/replay em `upgrade_purchase_idempotency` (compat. rota legada). */
  idempotencyKey: string | null;
  clientPackageVersion: number | null | undefined;
  nowMs?: number;
}): Promise<UpgradePurchaseOk> {
  const userId = args.userId;
  const idemKey = args.idempotencyKey;
  const nowMs = args.nowMs ?? Date.now();
  const nowBi = BigInt(nowMs);
  const pkgId = parseUpgradePackageId(args.packageIdRaw);
  if (!pkgId) {
    throw new RoletaAppError('Pacote inválido.', 400);
  }

  return prisma.$transaction(
    async (tx) => {
      if (idemKey) {
        const existing = await tx.upgrade_purchase_idempotency.findUnique({
          where: {
            user_id_scope_idempotency_key: {
              user_id: userId,
              scope: IDEM_SCOPE,
              idempotency_key: idemKey
            }
          }
        });
        if (existing?.response_json) {
          try {
            const parsed = JSON.parse(existing.response_json) as UpgradePurchaseOk;
            if (parsed && parsed.ok === true && typeof parsed.newUsdc === 'number') {
              return { ...parsed, idempotentReplay: true };
            }
          } catch {
            /* fall through */
          }
        }
      }

      await tx.$queryRaw(Prisma.sql`SELECT id FROM admin_upgrades WHERE id = ${pkgId} FOR UPDATE`);

      const user = await tx.users.findUnique({
        where: { id: userId },
        select: { id: true, access_level_id: true }
      });
      if (!user) {
        throw new RoletaAppError('Utilizador não encontrado.', 404);
      }

      const upgrade = await tx.admin_upgrades.findUnique({ where: { id: pkgId } });
      if (!upgrade) {
        throw new RoletaAppError('Pacote não encontrado.', 404);
      }
      if (!upgrade.is_active) {
        throw new RoletaAppError('Pacote indisponível ou inativo.', 422);
      }

      if (upgrade.starts_at != null && nowBi < upgrade.starts_at) {
        throw new RoletaAppError('Pacote ainda não está à venda.', 422);
      }
      if (upgrade.ends_at != null && nowBi > upgrade.ends_at) {
        throw new RoletaAppError('Pacote expirado.', 422);
      }

      const clientV = args.clientPackageVersion;
      if (clientV != null && Number.isFinite(clientV) && clientV !== upgrade.version) {
        throw new RoletaAppError('Esta oferta foi atualizada — recarregue a página e tente novamente.', 409);
      }

      const dup = await tx.admin_upgrade_purchases.findUnique({
        where: { user_id_upgrade_id: { user_id: userId, upgrade_id: upgrade.id } }
      });
      if (dup) {
        throw new RoletaAppError('Já adquiriu este pacote.', 422);
      }

      if (
        upgrade.grant_access_level_id &&
        user.access_level_id === upgrade.grant_access_level_id
      ) {
        throw new RoletaAppError(`Já possui o nível de acesso deste pacote.`, 422);
      }

      if (pkgId === GENESIS_BUNDLE_UPGRADE_ID) {
        const room = await tx.user_rig_rooms.findUnique({
          where: { user_id_room_id: { user_id: userId, room_id: GENESIS_ROOM_ID } }
        });
        if (room) {
          throw new RoletaAppError('Já possui a sala incluída neste pacote.', 422);
        }
      }

      if (upgrade.stock_remaining != null) {
        const stockRows = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            UPDATE admin_upgrades
            SET stock_remaining = stock_remaining - 1
            WHERE id = ${pkgId}
              AND is_active = 1
              AND stock_remaining IS NOT NULL
              AND stock_remaining > 0
            RETURNING id
          `
        );
        if (!stockRows.length) {
          throw new RoletaAppError('Esgotado: não há mais unidades deste pacote.', 422);
        }
      }

      const gs = await tx.game_states.findUnique({
        where: { user_id: userId },
        select: { usdc: true }
      });
      const balance = usdcDecimalFromRow(gs?.usdc ?? 0);
      const price = usdcDecimalFromRow(upgrade.price_usdc);
      if (balance.lt(price)) {
        throw new RoletaAppError('Saldo USDC insuficiente.', 422);
      }

      const newBalFloat = balance.minus(price).toNumber();
      await tx.game_states.update({
        where: { user_id: userId },
        data: { usdc: newBalFloat }
      });

      try {
        await tx.admin_upgrade_purchases.create({
          data: {
            user_id: userId,
            upgrade_id: upgrade.id,
            purchased_at: nowBi
          }
        });
      } catch (e: unknown) {
        const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
        if (code === 'P2002') {
          throw new RoletaAppError('Esta compra já foi registada — recarregue a página.', 409);
        }
        throw e;
      }

      await grantAdminUpgradeRewardsInTx(userId, upgrade.id, tx);

      const finalGs = await tx.game_states.findUnique({
        where: { user_id: userId },
        select: { usdc: true }
      });
      const newUsdc = Number(finalGs?.usdc ?? 0);

      const fresh = await tx.admin_upgrades.findUnique({
        where: { id: pkgId },
        select: { version: true }
      });

      const out: UpgradePurchaseOk = {
        ok: true,
        newUsdc,
        idempotentReplay: false,
        packageVersion: fresh?.version ?? upgrade.version
      };

      if (idemKey) {
        try {
          await tx.upgrade_purchase_idempotency.create({
            data: {
              user_id: userId,
              scope: IDEM_SCOPE,
              idempotency_key: idemKey,
              response_json: buildIdemPayload(out),
              created_at: nowBi
            }
          });
        } catch (e: unknown) {
          const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
          if (code === 'P2002') {
            const again = await tx.upgrade_purchase_idempotency.findUnique({
              where: {
                user_id_scope_idempotency_key: {
                  user_id: userId,
                  scope: IDEM_SCOPE,
                  idempotency_key: idemKey
                }
              }
            });
            if (again?.response_json) {
              const parsed = JSON.parse(again.response_json) as UpgradePurchaseOk;
              return { ...parsed, idempotentReplay: true };
            }
          }
          throw e;
        }
      }

      return out;
    },
    { timeout: 60_000, maxWait: 10_000 }
  );
}
