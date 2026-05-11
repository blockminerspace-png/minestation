import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { stableIntentFingerprint } from '../../lib/gameIntentIdempotencyPrisma.js';
import { materializeUpgradePackageAsLootBoxInTx } from '../../models/adminUpgradeGrantModel.js';
import { RoletaAppError } from '../../validation/roletaValidation.js';
import { parseUpgradePackageId, usdcDecimalFromRow } from './upgrades.catalog.js';

const IDEM_SCOPE = 'upgrade_purchase';

export type UpgradePurchaseOk = {
  ok: true;
  newUsdc: number;
  idempotentReplay: boolean;
  packageVersion: number;
  /** Caixa criada para o pacote (`Caixas da Sorte`). */
  box?: { id: string; name: string; quantity: number };
};

function buildIdemPayload(ok: UpgradePurchaseOk): string {
  return JSON.stringify(ok);
}

/**
 * Garante que recompensas do pacote apontam para IDs existentes antes de debitar USDC.
 * Evita erros Prisma genéricos (P20xx) na entrega e mensagem opaca «Erro ao processar o pedido.».
 */
async function assertUpgradeGrantReferencesExist(
  tx: Prisma.TransactionClient,
  upgradeId: string,
  grantAccessLevelId: string | null | undefined
): Promise<void> {
  const [items, boxes, coins, passes] = await Promise.all([
    tx.admin_upgrade_items.findMany({ where: { upgrade_id: upgradeId }, select: { item_id: true } }),
    tx.admin_upgrade_boxes.findMany({ where: { upgrade_id: upgradeId }, select: { box_id: true } }),
    tx.admin_upgrade_coins.findMany({ where: { upgrade_id: upgradeId }, select: { coin_id: true } }),
    tx.admin_upgrade_passes.findMany({ where: { upgrade_id: upgradeId }, select: { pass_id: true } })
  ]);

  const itemIds = [...new Set(items.map((r) => String(r.item_id || '').trim()).filter(Boolean))];
  if (itemIds.length > 0) {
    const found = await tx.upgrades.findMany({ where: { id: { in: itemIds } }, select: { id: true } });
    const ok = new Set(found.map((f) => f.id));
    const missing = itemIds.filter((id) => !ok.has(id));
    if (missing.length > 0) {
      throw new RoletaAppError(
        `Pacote com configuração inválida: peça(es) em falta no catálogo (${missing.slice(0, 5).join(', ')}). Contacte o suporte.`,
        422
      );
    }
  }

  const boxIds = [...new Set(boxes.map((r) => String(r.box_id || '').trim()).filter(Boolean))];
  if (boxIds.length > 0) {
    const found = await tx.loot_boxes.findMany({ where: { id: { in: boxIds } }, select: { id: true } });
    const ok = new Set(found.map((f) => f.id));
    const missing = boxIds.filter((id) => !ok.has(id));
    if (missing.length > 0) {
      throw new RoletaAppError(
        `Pacote com configuração inválida: caixa(s) em falta (${missing.slice(0, 5).join(', ')}). Contacte o suporte.`,
        422
      );
    }
  }

  const passIds = [...new Set(passes.map((r) => String(r.pass_id || '').trim()).filter(Boolean))];
  if (passIds.length > 0) {
    const found = await tx.season_passes.findMany({ where: { id: { in: passIds } }, select: { id: true } });
    const ok = new Set(found.map((f) => f.id));
    const missing = passIds.filter((id) => !ok.has(id));
    if (missing.length > 0) {
      throw new RoletaAppError(
        `Pacote com configuração inválida: season pass em falta (${missing.slice(0, 5).join(', ')}). Contacte o suporte.`,
        422
      );
    }
  }

  const coinIds = [...new Set(coins.map((r) => String(r.coin_id || '').trim()).filter(Boolean))];
  for (const cid of coinIds) {
    if (cid.toLowerCase() === 'usdc') continue;
    const row = await tx.mining_coins.findUnique({ where: { id: cid }, select: { id: true } });
    if (!row) {
      throw new RoletaAppError(
        `Pacote com configuração inválida: moeda «${cid}» inexistente. Contacte o suporte.`,
        422
      );
    }
  }

  const al = grantAccessLevelId != null ? String(grantAccessLevelId).trim() : '';
  if (al) {
    const row = await tx.access_levels.findUnique({ where: { id: al }, select: { id: true } });
    if (!row) {
      throw new RoletaAppError(
        `Pacote com configuração inválida: nível de acesso em falta. Contacte o suporte.`,
        422
      );
    }
  }
}

/** Fingerprint do pedido (pacote + versão opcional declarada pelo cliente). */
export function upgradePurchaseRequestFingerprint(
  packageId: string,
  clientPackageVersion: number | null | undefined
): string {
  return stableIntentFingerprint({
    op: 'upgrade_package_purchase',
    packageId: String(packageId || '').trim(),
    clientPackageVersion: clientPackageVersion != null && Number.isFinite(clientPackageVersion) ? clientPackageVersion : null
  });
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
          const curFp = upgradePurchaseRequestFingerprint(pkgId, args.clientPackageVersion);
          const stFp = String(existing.request_fingerprint ?? '').trim();
          if (stFp && curFp !== stFp) {
            throw new RoletaAppError('Mesma chave de idempotência com pedido diferente.', 409);
          }
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
        select: { id: true }
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

      await assertUpgradeGrantReferencesExist(tx, upgrade.id, upgrade.grant_access_level_id);

      const gs = await tx.game_states.findUnique({
        where: { user_id: userId },
        select: { usdc: true }
      });
      if (!gs) {
        throw new RoletaAppError(
          'Estado do jogo ainda não foi criado. Entre no jogo (carregue o save) e tente comprar novamente.',
          422
        );
      }
      const balance = usdcDecimalFromRow(gs.usdc);
      const price = usdcDecimalFromRow(upgrade.price_usdc);
      if (balance.lt(price)) {
        throw new RoletaAppError('Saldo USDC insuficiente.', 422);
      }

      const newBalFloat = balance.minus(price).toNumber();
      await tx.game_states.update({
        where: { user_id: userId },
        data: { usdc: newBalFloat }
      });

      await tx.admin_upgrade_purchases.create({
        data: {
          user_id: userId,
          upgrade_id: upgrade.id,
          purchased_at: nowBi
        }
      });

      /**
       * Em vez de entregar items / moedas / passes / acesso directamente,
       * materializamos o pacote como **uma caixa única** em `loot_boxes` e
       * incrementamos `unopened_boxes` em +1. A entrega real acontece quando
       * o jogador abrir a caixa em "Caixas da Sorte" (linha bundle =>
       * `grantAdminUpgradeRewardsInTx`).
       */
      const created = await materializeUpgradePackageAsLootBoxInTx(tx, {
        userId,
        upgradeId: upgrade.id
      });

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
        packageVersion: fresh?.version ?? upgrade.version,
        box: { id: created.boxId, name: created.boxName, quantity: 1 }
      };

      if (idemKey) {
        const idemFp = upgradePurchaseRequestFingerprint(pkgId, args.clientPackageVersion);
        try {
          await tx.upgrade_purchase_idempotency.create({
            data: {
              user_id: userId,
              scope: IDEM_SCOPE,
              idempotency_key: idemKey,
              response_json: buildIdemPayload(out),
              created_at: nowBi,
              request_fingerprint: idemFp
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
              const stFp2 = String(again.request_fingerprint ?? '').trim();
              if (stFp2 && stFp2 !== idemFp) {
                throw new RoletaAppError('Mesma chave de idempotência com pedido diferente.', 409);
              }
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
