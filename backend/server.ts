import './dist/utils/loadEnv.js';
import express from 'express'; // Reload Trigger 2026-01-29
import http from 'http';
import { WebSocketServer } from 'ws';
import cluster from 'node:cluster';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import net from 'net';
import crypto from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { GoogleGenAI } from "@google/genai";
import bcrypt from 'bcryptjs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);





import db, { connectPrisma, disconnectPrisma, prisma } from './dist/config/db.js';
import { Prisma } from '@prisma/client';
import { startMiningYieldCron, computeProgressForUser, sanitizeApiMessage } from './dist/cron/miningScheduler.js';
import { getGlobalNetworkStats } from './dist/cron/miningGlobalStatsStore.js';
import { initGenesisStackServices, getGenesisMongo } from './dist/lib/genesisStack/init.js';
import { miningRuntimeStats } from './dist/cron/miningRuntimeStats.js';
import { fetchLiveUsdByMiningCoinRowIds, MINING_ECONOMY_PUBLIC_META } from './lib/miningLivePrices.js';
import { normalizePublicAssetUrl } from './dist/lib/publicAssetUrl.js';
import { recoverOrphanRackBatteryStorageRows } from './dist/lib/orphanRackBatteryRecovery.js';
import { ensureStoredBatteriesIntegrity } from './dist/lib/ensureStoredBatteriesIntegrity.js';

/** Tempo de bloco fixo na economia do simulador (10 minutos) — alinhado ao admin / frontend. */
const MINING_BLOCK_TIME_SECONDS_FIXED = 600;

function roundMiningEconomyField8Decimals(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 1e8) / 1e8;
}

/**
 * Mesma ideia do cron de yield: reward/sec ÷ hashrate efectiva (máx entre rede real e floor da moeda).
 * Usado para decidir se gravamos linha em `mining_yield_history` — mudar só `price_usd` não altera isto.
 */
function spotYieldPerHashForCoin(
  coinId: string,
  blockReward: number,
  blockTimeSec: number,
  networkHashrate: number
): number {
  const bt = Number(blockTimeSec) > 0 ? Number(blockTimeSec) : MINING_BLOCK_TIME_SECONDS_FIXED;
  const br = Number(blockReward);
  const nh = Number(networkHashrate) > 0 ? Number(networkHashrate) : 1;
  const realNet = Number(miningRuntimeStats.globalNetworkHashrates.get(String(coinId)) || 0);
  const rewardPerSec = bt > 0 ? br / bt : 0;
  const effectiveHashrate = Math.max(realNet, nh);
  if (!(effectiveHashrate > 0) || !Number.isFinite(rewardPerSec)) return 0;
  const y = rewardPerSec / effectiveHashrate;
  return Number.isFinite(y) ? y : 0;
}

const SPOT_YIELD_EPS = 1e-22;
import { UI_DISPLAY_LABEL_KEY_SET } from './dist/config/uiDisplayLabelKeys.js';
import {
  allowsAdminRouteAccess,
  permissionTabSetFromDbJson,
  resolveAdminRouteRequirement
} from './dist/utils/adminRouteAuth.js';
import {
  resolveIsSuperAdminFromUserRow,
  LEGACY_SUPER_ADMIN_EMAILS
} from './dist/utils/legacySuperAdmin.js';
import {
  attachSecurityThreatResponseObserver,
  startSecurityThreatObserverBackgroundScan
} from './dist/utils/securityThreatObserver.js';
import { initDb } from './dist/config/initDb.js';
import { sendResetEmail } from './dist/utils/mailer.js';
import {
  COOKIE_ACCESS,
  getJwtAuthConfig,
  createResolveAuthMiddleware,
  issueJwtAuthCookies,
  handleJwtRefresh,
  revokeJwtRefreshForUser,
  clearAuthCookies,
  verifyAccessToken
} from './dist/src/auth/index.js';
import { registerDeviceFingerprintAdminRoutes } from './dist/controllers/deviceFingerprintAdminController.js';
import { registerP2pMarketRoutes } from './dist/controllers/p2pMarketController.js';
import {
  registerLootBoxPlayerRoutes,
  registerLootBoxAdminRoutes
} from './dist/controllers/lootBoxController.js';
import { registerRoletaPlayerRoutes } from './dist/controllers/roletaController.js';
import { fetchWheelPrizesForApiConfig } from './dist/models/roletaModel.js';
import { grantAdminUpgradeRewardsInTx, grantPassRewardsInTx } from './dist/models/adminUpgradeGrantModel.js';
import { pgSqlTx, prismaTxToPoolLikeClient } from './dist/lib/sqlTransaction.js';
import { getPublicBootstrapPayload } from './dist/lib/publicBootstrapPayload.js';
import { getProfilePageBundlePayload } from './dist/lib/meBundlesPayload.js';
import {
  getUpgradeAccountShopBundlePayload,
  loadAdminUpgradesForUser,
  loadAdminUpgradePurchaseIdsForUser,
  loadMyRigRoomsForUser,
  isEmailParamInvalid,
  normalizeEmailParam
} from './dist/lib/meUpgradeShopBundlePayload.js';
import {
  runReferralCommissionOnTx,
  creditDepositReferralCommissionPg,
  newAdminUsdcGiftReferralIdempotencyKey
} from './dist/models/referralCommissionModel.js';
import { registerPromoRedeemRoutes } from './dist/controllers/promoRedeemController.js';
import { runBulkRoomBattery, isValidRoomId } from './dist/lib/roomBatteryBulk.js';
import {
  loadUserStock,
  loadUserStoredBatteries,
  loadUserPlacedRacksWithSlots,
  loadUpgradesWithCompat,
  persistStockStoredBatteriesPlacedRacks
} from './dist/lib/serverRoomPersistence.js';
import {
  buildRackBatteryPersistSnapshot,
  collectMountedBatteryInstanceIdsFromPlacedRacks,
  fetchBatteryUpgradeRowsByIds,
  isRackBatteryInstanceUuid,
  loadStoredBatteryRowsForIds,
  type PrevPlacedRackBattRow,
  type StoredBatteryRowSnap
} from './dist/lib/batteryPersistHelpers.js';
import { mergeSaveGameSlicePayload } from './dist/lib/gameSaveSliceMerge.js';
import * as backupModel from './dist/models/backupModel.js';
import { getPgRestoreSpawnOptions } from './dist/config/database.js';
import { getPgRestorePath } from './dist/config/pgRestore.js';
import { registerBackupRoutes, startScheduledSqlBackups } from './dist/controllers/backupController.js';
import {
  createSupportTicketUploadMiddlewares,
  registerSupportTicketRoutes
} from './dist/controllers/supportTicketController.js';
import { registerSupportMutationRoutes } from './dist/controllers/supportMutationController.js';
import { registerPartnerYoutubeRoutes } from './dist/controllers/partnerYoutubeController.js';
import { registerWorkshopMutationRoutes } from './dist/controllers/workshopMutationController.js';
import { registerInventoryRoutes } from './dist/controllers/inventoryController.js';
import { registerPlayerCalculatorRoutes } from './dist/controllers/playerCalculatorController.js';
import { ensurePartnerYoutubeSchema } from './dist/models/partnerYoutubeModel.js';
import {
  sendInternalErrorOrPrisma,
  sendInternalErrorSafeMessageOrPrisma,
  sendInternalErrorShapeOrPrisma,
  HttpControlledError,
  respondIfHttpControlledError
} from './dist/utils/apiErrorResponse.js';
import { appendGameActivityLogMongo, listGameActivityLogsMongo } from './dist/lib/mongoLogs.js';
import {
  getSettingValue,
  getSettingsRecord,
  upsertSettingsEntries
} from './dist/lib/settingsPrisma.js';
import {
  getAdminMiningRankingPayload,
  getPublicMiningRankingPayload
} from './dist/lib/miningRankingPrisma.js';
import { computePlayerGameHeaderSnapshot } from './dist/lib/playerGameHeaderSnapshot.js';
import {
  ActivityThrottleMaps,
  resolveActivityThrottleConfig
} from './dist/lib/activityThrottle.js';
import {
  mountImageStaticMiddleware,
  registerImageAssetRoutes,
  runImageRootStartupOrganizeIfEnabled
} from './dist/controllers/imageAssetController.js';
import {
  SAVE_GAME_ITEM_ID_RE,
  validateStockForSave,
  validateUnopenedBoxesForSave,
  validateDailyActionsForSave,
  validateStoredBatteriesForSave,
  sanitizeStoredBatteriesForSavePayload,
  validateStoredBatteryWarehouseRemovalAllowed,
  StoredBatterySaveGuardError,
  validateWorkshopSlotsPayloadForSave,
  enrichWorkshopSlotsSlotItemIdsFromChargingHistory,
  refreshStoredBatteriesWorkshopLinkage
} from './dist/lib/saveGameEconomyValidate.js';
import {
  validateLoginEmail,
  validateLoginFieldsPresent,
  validateLoginPassword,
  validateSignupPassword,
  validateSignupUsername,
  validateOptionalPolygonWallet,
  validateOptionalAccessLevelId,
  validateOptionalReferralCodeInput,
  validateAccessLevelIdsArray,
  EMAIL_ADDRESS_MAX_LENGTH,
  SIGNUP_EMAIL_MAX_TOTAL
} from './dist/models/registrationValidation.js';
import { getUserIdByEmail, EmailPolicyError, IpLimitError } from './dist/models/userModel.js';
import {
  findUserByEmail,
  insertSession,
  recordLoginIp,
  ensureUserReferralCode,
  updateUserPasswordHash,
  listUserAccessLevelIds,
  findUserById,
  findSessionRow,
  findActiveSessionUserId,
  findSessionUserIdIgnoringExpiry,
  deleteSessionBySessionId,
  updateUserPolygonAndAccess,
  clearUserPolygonWallet
} from './dist/models/authModel.js';
import { executeUserPutCoreTransaction } from './dist/models/userPutCoreTransaction.js';

// Global Error Handlers to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught Exception:', err);
  // It's generally safer to exit after an uncaught exception, but here we log it first.
  // process.exit(1); 
});

const WORKER_ROLE = process.env.WORKER_ROLE || 'ALL';
console.log(`[Worker ${process.pid}] Started with Role: ${WORKER_ROLE}`);

function isValidSaveGameItemId(value: unknown): value is string {
  return typeof value === 'string' && SAVE_GAME_ITEM_ID_RE.test(value);
}

const LEGACY_TEMP_PARSED_CTE = `
      WITH parsed AS (
        SELECT u.id AS temp_id,
               btrim(substring(u.description FROM 'original=([^ ]+) email=')) AS orig_id
        FROM upgrades u
        WHERE (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
          AND u.description IS NOT NULL
          AND u.description LIKE '%original=%'
          AND u.description LIKE '% email=%'
      ),
      pairs AS (
        SELECT s.user_id, s.item_id AS temp_id, s.qty, p.orig_id
        FROM stock s
        INNER JOIN parsed p ON p.temp_id = s.item_id
        INNER JOIN upgrades r ON r.id = p.orig_id
        WHERE length(p.orig_id) > 0
          AND p.orig_id ~ '^[a-zA-Z0-9_.-]{1,200}$'
          AND r.id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
          AND NOT (COALESCE(r.category, '') = 'legacy-temp' AND COALESCE(r.type, '') = 'legacy-temp')
      )`;

/** Stock órfão / legacy-temp: tenta voltar ao upgrade real antes de criar placeholder. */
async function ensureStockItemIdsSane() {
  const client = await db.connect();
  let mergeN = 0;
  let delN = 0;
  let moveN = 0;
  try {
    // 1a) Placeholder legacy-temp → somar qty na linha real já existente e apagar temporários
    await client.query('BEGIN');
    const mergeRes = await client.query(`
      ${LEGACY_TEMP_PARSED_CTE},
      inc AS (
        SELECT user_id, orig_id, SUM(qty)::bigint AS add_qty
        FROM pairs
        WHERE EXISTS (SELECT 1 FROM stock x WHERE x.user_id = pairs.user_id AND x.item_id = pairs.orig_id)
        GROUP BY user_id, orig_id
      )
      UPDATE stock s
      SET qty = s.qty + inc.add_qty
      FROM inc
      WHERE s.user_id = inc.user_id AND s.item_id = inc.orig_id
    `);
    mergeN = mergeRes.rowCount ?? 0;
    const delMerged = await client.query(`
      ${LEGACY_TEMP_PARSED_CTE}
      DELETE FROM stock s
      USING pairs
      WHERE s.user_id = pairs.user_id AND s.item_id = pairs.temp_id
        AND EXISTS (SELECT 1 FROM stock x WHERE x.user_id = pairs.user_id AND x.item_id = pairs.orig_id)
    `);
    delN = delMerged.rowCount ?? 0;
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.warn('[Migration] legacy-temp merge:', e instanceof Error ? e.message : String(e));
  } finally {
    client.release();
  }

  // 1b) Restantes: sem linha em stock para orig_id — agrega vários temp para um único (evita PK duplicada)
  try {
    const moveCandidates = await db.query(`
      SELECT s.user_id, s.item_id AS temp_id, s.qty, p.orig_id
      FROM stock s
      INNER JOIN (
        SELECT u.id AS temp_id,
               btrim(substring(u.description FROM 'original=([^ ]+) email=')) AS orig_id
        FROM upgrades u
        WHERE (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
          AND u.description IS NOT NULL
          AND u.description LIKE '%original=%'
          AND u.description LIKE '% email=%'
      ) p ON p.temp_id = s.item_id
      INNER JOIN upgrades r ON r.id = p.orig_id
      WHERE length(p.orig_id) > 0
        AND p.orig_id ~ '^[a-zA-Z0-9_.-]{1,200}$'
        AND r.id NOT LIKE 'temp_legacy\\_%' ESCAPE '\\'
        AND NOT (COALESCE(r.category, '') = 'legacy-temp' AND COALESCE(r.type, '') = 'legacy-temp')
        AND NOT EXISTS (SELECT 1 FROM stock x WHERE x.user_id = s.user_id AND x.item_id = p.orig_id)
    `);
    const groups = new Map();
    for (const row of moveCandidates.rows) {
      const userId = Number(row.user_id);
      const origId = String(row.orig_id || '');
      const tempId = String(row.temp_id || '');
      const qty = Number(row.qty) || 0;
      const k = `${userId}|${origId}`;
      if (!groups.has(k)) groups.set(k, { userId, origId, temps: [] });
      groups.get(k).temps.push({ tempId, qty });
    }
    for (const g of groups.values()) {
      const totalQty = g.temps.reduce((a, t) => a + t.qty, 0);
      const ex = await db.query('SELECT qty FROM stock WHERE user_id = $1 AND item_id = $2', [g.userId, g.origId]);
      if (ex.rows[0]) {
        await db.query('UPDATE stock SET qty = qty + $1 WHERE user_id = $2 AND item_id = $3', [
          totalQty,
          g.userId,
          g.origId
        ]);
        for (const t of g.temps) {
          await db.query('DELETE FROM stock WHERE user_id = $1 AND item_id = $2', [g.userId, t.tempId]);
          moveN += 1;
        }
      } else if (g.temps.length > 0) {
        const first = g.temps[0];
        await db.query('UPDATE stock SET item_id = $1, qty = $2 WHERE user_id = $3 AND item_id = $4', [
          g.origId,
          totalQty,
          g.userId,
          first.tempId
        ]);
        moveN += 1;
        for (let i = 1; i < g.temps.length; i += 1) {
          await db.query('DELETE FROM stock WHERE user_id = $1 AND item_id = $2', [g.userId, g.temps[i].tempId]);
          moveN += 1;
        }
      }
    }
    if (mergeN + delN + moveN > 0) {
      console.log(`[Migration] stock legacy-temp curado: merge ${mergeN}, del ${delN}, move ${moveN}`);
    }
  } catch (e) {
    console.warn('[Migration] legacy-temp move:', e instanceof Error ? e.message : String(e));
  }

  try {
    // 2) item_id com espaços → id canónico se existir upgrade e não houver colisão de PK
    const trimRes = await db.query(`
      UPDATE stock s
      SET item_id = btrim(s.item_id::text)
      FROM upgrades g
      WHERE g.id = btrim(s.item_id::text)
        AND s.item_id IS NOT NULL
        AND btrim(s.item_id::text) <> s.item_id::text
        AND NOT EXISTS (
          SELECT 1 FROM stock s2
          WHERE s2.user_id = s.user_id
            AND s2.item_id = btrim(s.item_id::text)
            AND (s2.user_id::text || '|' || s2.item_id::text) IS DISTINCT FROM (s.user_id::text || '|' || s.item_id::text)
        )
    `);
    if ((trimRes.rowCount ?? 0) > 0) {
      console.log(`[Migration] stock trim item_id: ${trimRes.rowCount} linha(s).`);
    }

    // 3) Remover upgrades placeholder já sem stock nem compat racks
    const orphanRes = await db.query(`
      DELETE FROM upgrades u
      WHERE (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
        AND u.id LIKE 'temp_legacy\\_%' ESCAPE '\\'
        AND NOT EXISTS (SELECT 1 FROM stock s WHERE s.item_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM upgrade_compat_racks c WHERE c.upgrade_id = u.id)
    `);
    if ((orphanRes.rowCount ?? 0) > 0) {
      console.log(`[Migration] upgrades legacy-temp órfãos removidos: ${orphanRes.rowCount}`);
    }

    const brokenRes = await db.query(
      `SELECT s.user_id, s.item_id, s.qty, u.email
         FROM stock s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN upgrades g ON g.id = btrim(COALESCE(s.item_id, '')::text)
        WHERE s.item_id IS NULL
           OR btrim(COALESCE(s.item_id, '')::text) = ''
           OR btrim(s.item_id::text) !~ '^[a-zA-Z0-9_.-]{1,200}$'
           OR g.id IS NULL
        ORDER BY s.user_id, s.item_id NULLS FIRST`
    );
    if ((brokenRes.rowCount ?? 0) === 0) return;

    let seq = 0;
    for (const row of brokenRes.rows) {
      seq += 1;
      const original = typeof row.item_id === 'string' ? row.item_id : '';
      const normalizedOriginal = original.trim() || 'sem-id';
      const slug = normalizedOriginal
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'sem-id';
      const tempId = `temp_legacy_${row.user_id}_${seq}_${slug}`.slice(0, 200);
      const label = `Item temporario recuperado #${row.user_id}-${seq}`;
      const desc = `Placeholder criado automaticamente para preservar inventario legado. original=${normalizedOriginal} email=${String(row.email || '').slice(0, 120)}`;

      await db.query(
        `INSERT INTO upgrades (
          id, name, category, type, base_cost, base_production, power_consumption, power_capacity,
          multiplier, slots_capacity, ai_slots_capacity, description, icon, status, is_nft, nft_contract,
          nft_token_id, max_global_stock, image, reward_wh, layout, sell_in_hardware_market,
          sell_in_black_market, is_active, total_sold
        ) VALUES (
          $1, $2, 'legacy-temp', 'legacy-temp', 0, 0, 0, 0,
          0, 0, 0, $3, '', 'temporary', 0, NULL,
          NULL, 0, '', 0, NULL, 0,
          0, 1, 0
        )
        ON CONFLICT (id) DO NOTHING`,
        [tempId, label, desc]
      );

      await db.query(
        `UPDATE stock
            SET item_id = $1
          WHERE user_id = $2
            AND qty = $3
            AND COALESCE(item_id, '') = COALESCE($4, '')`,
        [tempId, row.user_id, row.qty, row.item_id]
      );
    }

    console.log(`[Migration] stock saneamento (placeholders novos): ${brokenRes.rowCount ?? 0} registro(s).`);
  } catch (e) {
    console.warn('[Migration] ensureStockItemIdsSane failed:', e instanceof Error ? e.message : String(e));
  }
}

/** Painel admin — sub-aba "Textos da interface"; incluir em todas as listas de permissões (array). */
function ensureAdminSettingsLabelsInPermissions(permissions) {
  if (!Array.isArray(permissions)) return permissions;
  if (permissions.includes('settings:labels')) return permissions;
  return [...permissions, 'settings:labels'];
}

/** Aba "Parceiros" (moderação de vídeos) — incluir por defeito em todos os admins com lista explícita. */
function ensureAdminPartnersTabInPermissions(permissions) {
  if (!Array.isArray(permissions)) return permissions;
  if (permissions.includes('partners')) return permissions;
  return [...permissions, 'partners'];
}

/** Converte legado em objeto `{ tab: true }` para lista de IDs (o painel admin só usa arrays). */
function adminPermissionsObjectToTabIds(perms) {
  if (!perms || typeof perms !== 'object' || Array.isArray(perms)) return [];
  return Object.keys(perms).filter((k) => perms[k] === true || perms[k] === 1);
}

/** Resposta API: admins recebem sempre `string[]` (compat. DB antigo em objeto + front atual). */
function normalizeAdminPermissionsForApi(isAdmin, perms) {
  if (!isAdmin || perms == null) return perms;
  if (Array.isArray(perms)) return ensureAdminPartnersTabInPermissions(ensureAdminSettingsLabelsInPermissions(perms));
  if (typeof perms === 'object')
    return ensureAdminPartnersTabInPermissions(ensureAdminSettingsLabelsInPermissions(adminPermissionsObjectToTabIds(perms)));
  return perms;
}

// MIGRATION: Ensure tables exist
const ensureTables = async () => {
  // Only Background or Single Core worker should perform migrations to avoid race conditions
  if (WORKER_ROLE !== 'BACKGROUND' && WORKER_ROLE !== 'ALL') return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_upgrade_visibility (
        upgrade_id TEXT NOT NULL,
        access_level_id TEXT NOT NULL,
        PRIMARY KEY (upgrade_id, access_level_id)
      );

      CREATE TABLE IF NOT EXISTS app_cache (
        key TEXT PRIMARY KEY,
        value JSONB,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS charging_history (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        action TEXT NOT NULL,
        workshop_slot_index INTEGER,
        component_slot_id TEXT,
        battery_instance_id TEXT,
        battery_item_id TEXT,
        charge_amount DOUBLE PRECISION,
        timestamp TIMESTAMP DEFAULT NOW(),
        stock_confirmed BOOLEAN DEFAULT FALSE,
        details JSONB
      );

      CREATE TABLE IF NOT EXISTS p2p_market_trade_history (
        id BIGSERIAL PRIMARY KEY,
        created_at BIGINT NOT NULL,
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        unit_price DOUBLE PRECISION NOT NULL,
        buyer_paid_usdc DOUBLE PRECISION NOT NULL,
        seller_received_usdc DOUBLE PRECISION NOT NULL,
        tax_usdc DOUBLE PRECISION NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_p2p_market_trade_buyer ON p2p_market_trade_history (buyer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_p2p_market_trade_seller ON p2p_market_trade_history (seller_id, created_at DESC);

      ALTER TABLE player_listings ADD COLUMN IF NOT EXISTS buyer_paid_usdc double precision;
    `);
    console.log('[Migration] Tables ensured.');
  } catch (e) {
    console.error('Failed to ensure tables:', e);
  }
};
ensureTables();

/**
 * P2P mercado negro: coluna em player_listings + tabela de histórico.
 * Tem de correr em TODOS os workers (ex.: WORKER_ROLE=API em cluster), porque initDb/ensureTables
 * só correm em BACKGROUND ou ALL — sem isto a BD nunca recebia buyer_paid_usdc.
 */
/** Coluna is_super_admin + backfill único: admins atuais passam a super (acesso total API). */
const ensureAdminSuperAdminSchema = async () => {
  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin INTEGER NOT NULL DEFAULT 0`);
    const once = await db.query(`SELECT 1 FROM app_cache WHERE key = $1`, ['admin_super_admin_backfill_v1']);
    if (once.rowCount === 0) {
      await db.query(`UPDATE users SET is_super_admin = 1 WHERE is_admin = 1`);
      await db.query(
        `INSERT INTO app_cache (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO NOTHING`,
        ['admin_super_admin_backfill_v1', JSON.stringify({ v: 1 })]
      );
    }
    if (LEGACY_SUPER_ADMIN_EMAILS.length > 0) {
      await db.query(
        `UPDATE users SET is_super_admin = 1 WHERE is_admin = 1 AND LOWER(TRIM(email::text)) = ANY($1::text[])`,
        [LEGACY_SUPER_ADMIN_EMAILS as string[]]
      );
    }
  } catch (e) {
    console.warn('[Migration] is_super_admin:', e instanceof Error ? e.message : String(e));
  }
};

/** Pontuação por IP para o observador de ameaças (todos os workers — API incluída). */
const ensureSecurityThreatObserverSchema = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS security_threat_scores (
        ip TEXT PRIMARY KEY,
        score INTEGER NOT NULL DEFAULT 0,
        window_start BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_security_threat_scores_updated ON security_threat_scores(updated_at);
    `);
  } catch (e) {
    console.warn('[Migration] security_threat_scores:', e instanceof Error ? e.message : String(e));
  }
};

const ensureP2pMarketListingSchema = async () => {
  try {
    await db.query(
      `ALTER TABLE player_listings ADD COLUMN IF NOT EXISTS buyer_paid_usdc double precision`
    );
  } catch (e) {
    console.warn('[Migration] player_listings.buyer_paid_usdc:', e instanceof Error ? e.message : e);
  }
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS p2p_market_trade_history (
        id BIGSERIAL PRIMARY KEY,
        created_at BIGINT NOT NULL,
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        unit_price DOUBLE PRECISION NOT NULL,
        buyer_paid_usdc DOUBLE PRECISION NOT NULL,
        seller_received_usdc DOUBLE PRECISION NOT NULL,
        tax_usdc DOUBLE PRECISION NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_p2p_market_trade_buyer ON p2p_market_trade_history (buyer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_p2p_market_trade_seller ON p2p_market_trade_history (seller_id, created_at DESC);
    `);
  } catch (e) {
    console.warn('[Migration] p2p_market_trade_history:', e instanceof Error ? e.message : e);
  }
};

/**
 * Tickets de suporte: tem de correr em todos os workers (ex.: só API em cluster).
 * `initDb` só corre em BACKGROUND/ALL — sem isto, pedidos a /api/support/* falham com "relation does not exist".
 */
const ensureSupportTicketSchema = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'open',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created ON support_tickets (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created ON support_tickets (status, created_at DESC);

      CREATE TABLE IF NOT EXISTS support_ticket_replies (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        admin_user_id INTEGER NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket_created ON support_ticket_replies (ticket_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS support_ticket_player_replies (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_support_ticket_player_replies_ticket ON support_ticket_player_replies (ticket_id, created_at ASC);
    `);
  } catch (e) {
    console.warn('[Migration] support_tickets:', e instanceof Error ? e.message : e);
  }
};

// MIGRATION: Ensure default mining coins exist
const ensureMiningCoins = async () => {
  // Automatic seeding disabled by user request.
  // The calculator should only work with DB data.
  /*
  try {
    // const res = await db.query('SELECT COUNT(*) FROM mining_coins');
    // if (parseInt(res.rows[0].count) === 0) {
    console.log('Verifying/Seeding initial mining coins...');
    const initialCoins = [
      {
        id: '1', name: 'Bitcoin', symbol: 'BTC', network_hashrate: 600000000000000000000,
        block_reward: 3.125, block_time: 600, price_usd: 95000, algorithm: 'SHA-256',
        difficulty: 80000000000000, multiplier: 1, color: '#F7931A', min_proportion: 0.0000000001,
        description: 'Ouro digital', is_active: 1, usdc_rate: 95000
      },
      {
        id: '2', name: 'Kaspa', symbol: 'KAS', network_hashrate: 1000000000000000,
        block_reward: 100, block_time: 1, price_usd: 0.15, algorithm: 'kHeavyHash',
        difficulty: 1, multiplier: 1, color: '#49C8B5', min_proportion: 0.000001,
        description: 'BlockDAG rápido', is_active: 1, usdc_rate: 0.15
      },
      {
        id: '3', name: 'Nanit', symbol: 'NANIT', network_hashrate: 1000000000,
        block_reward: 10, block_time: 60, price_usd: 0.50, algorithm: 'Scrypt',
        difficulty: 10, multiplier: 1, color: '#8247E5', min_proportion: 0.001,
        description: 'Moeda nativa', is_active: 1, usdc_rate: 0.50
      },
      {
        id: '4', name: 'Polygon', symbol: 'POL', network_hashrate: 500000000000,
        block_reward: 5, block_time: 2, price_usd: 0.40, algorithm: 'Proof-of-Stake',
        difficulty: 5000, multiplier: 1, color: '#8247E5', min_proportion: 0.00001,
        description: 'Escalabilidade Ethereum', is_active: 1, usdc_rate: 0.40
      },
      {
        id: '5', name: 'Wrapped Ether', symbol: 'WETH', network_hashrate: 900000000000000,
        block_reward: 2, block_time: 12, price_usd: 3500, algorithm: 'Ethash',
        difficulty: 12000000000, multiplier: 1, color: '#627EEA', min_proportion: 0.00000001,
        description: 'Ether Tokenizado', is_active: 1, usdc_rate: 3500
      },
      {
        id: '6', name: 'Wrapped Bitcoin', symbol: 'WBTC', network_hashrate: 600000000000000000000,
        block_reward: 3.125, block_time: 600, price_usd: 95000, algorithm: 'SHA-256',
        difficulty: 80000000000000, multiplier: 1, color: '#201A26', min_proportion: 0.00000001,
        description: 'Bitcoin no Ethereum', is_active: 1, usdc_rate: 95000
      }
    ];

    for (const coin of initialCoins) {
      await db.query(`
          INSERT INTO mining_coins (id, name, symbol, network_hashrate, block_reward, block_time, price_usd, algorithm, difficulty, multiplier, color, min_proportion, description, is_active, usdc_rate)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO NOTHING
        `, [
        coin.id, coin.name, coin.symbol, coin.network_hashrate, coin.block_reward, coin.block_time,
        coin.price_usd, coin.algorithm, coin.difficulty, coin.multiplier, coin.color,
        coin.min_proportion, coin.description, coin.is_active, coin.usdc_rate
      ]);
    }
    console.log('Mining coins seeded (if missing).');
  } catch (e) {
    console.error('Failed to seed mining coins:', e);
  }
  */
};

const ensureUserLevels = async () => {
  try {
    // Admin & Tester Restore
    await db.query(`UPDATE users SET is_admin=1, access_level_id='tester', admin_permissions='{"dashboard":true,"users":true,"settings":true,"settings:labels":true,"economy":true,"logs":true,"security":true,"cms":true,"marketplace":true,"upgrades":true}' WHERE email='klealbert19@gmail.com'`);
    await db.query(`UPDATE users SET access_level_id='tester' WHERE email='klealbert82@gmail.com'`);

    // Partner Restore
    await db.query(`UPDATE users SET access_level_id='partner' WHERE email='adfyhubgaming@gmail.com'`);

    // Founder Restore (Batch 1)
    const founders = [
      'gamescryptobr@gmail.com', 'jogadordenft@proton.me', 'chavascal92@hotmail.com',
      'ng_jefferson@hotmail.com', 'maujox20@gmail.com', 'arbamoficial@gmail.com',
      'projeto@jr-tecnologia.com', 'emersonprado82@gmail.com', 'betocryptodefi@gmail.com',
      'marcelorodriguesgarcia89@gmail.com', 'washingtonjrdesouza@gmail.com', 'klealbert82@hotmail.com',
      'tetelh128@gmail.com', 'dan.riber12@gmail.com', 'samsgamesp2e@gmail.com',
      'jose.souza03@gmail.com', 'pedrohenriquebarbosadasilveira@gmail.com', 'b3d1k@outlook.com'
    ];

    for (const email of founders) {
      await db.query(`UPDATE users SET access_level_id='founder' WHERE email = $1`, [email]);
    }

    console.log('[Auto-Restore] Níveis de acesso restaurados para Admins, Founders e Partners.');
  } catch (e) { console.error('Erro ao restaurar níveis:', e); }
};
// ensureUserLevels(); -> Moved to startServer to ensure correct order and worker role


// MIGRATION: Ensure 'total_sold' exists in upgrades (auto-fix)
const ensureTotalSoldColumn = async () => {
  try {
    await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upgrades' AND column_name='total_sold') THEN 
                    ALTER TABLE upgrades ADD COLUMN total_sold INTEGER DEFAULT 0; 
                END IF; 
            END $$;
        `);
    console.log("Checked/Added 'total_sold' column to upgrades table.");
  } catch (e) {
    console.error("Failed to check/add 'total_sold' column:", e);
  }
};


const ensureUsdcDefault = async () => {
  try {
    await db.query(`
            ALTER TABLE game_states ALTER COLUMN usdc SET DEFAULT 0;
        `);
    console.log("Ensured default 0 for usdc in game_states.");
  } catch (e) {
    console.error("Failed to set default for usdc:", e);
  }
};

// --- REFERRAL: depósito/gift USDC → comissão 5% idempotente; hardware/black_market → modelo de nível ---
const processReferralCommission = async (client, userId, amount, type) => {
  if (type === 'deposit') {
    const uid = Number(userId);
    const amt = Number(amount);
    if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(amt) || amt <= 0) return;
    const key = newAdminUsdcGiftReferralIdempotencyKey(uid, amt);
    await creditDepositReferralCommissionPg(client, uid, amt, key);
    return;
  }
  await runReferralCommissionOnTx(pgSqlTx(client), userId, amount, type);
};

const ensureAdminPermissionsColumn = async () => {
  try {
    await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='admin_permissions') THEN 
                    ALTER TABLE users ADD COLUMN admin_permissions TEXT; 
                END IF; 
            END $$;
        `);
    console.log("Checked/Added 'admin_permissions' column to users table.");
  } catch (e) {
    console.error("Failed to check/add 'admin_permissions' column:", e);
  }
};

const ensureSystemNewsAdColumns = async () => {
  try {
    await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='system_news' AND column_name='ad_type') THEN 
                    ALTER TABLE system_news ADD COLUMN ad_type TEXT DEFAULT 'horizontal'; 
                END IF; 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='system_news' AND column_name='image_url') THEN 
                    ALTER TABLE system_news ADD COLUMN image_url TEXT; 
                END IF; 
            END $$;
        `);
    console.log("Checked/Added 'ad_type' and 'image_url' columns to system_news table.");
  } catch (e) {
    console.error("Failed to check/add ad columns to system_news:", e);
  }
};

const ensureMiningCoinsTable = async () => {
  try {
    await db.query(`
            CREATE TABLE IF NOT EXISTS mining_coins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                network_hashrate DOUBLE PRECISION,
                block_reward DOUBLE PRECISION,
                block_time DOUBLE PRECISION,
                price_usd DOUBLE PRECISION,
                algorithm TEXT,
                difficulty DOUBLE PRECISION,
                multiplier DOUBLE PRECISION DEFAULT 1,
                color TEXT,
                description TEXT DEFAULT '',
                min_proportion DOUBLE PRECISION DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                usdc_rate DOUBLE PRECISION DEFAULT 0
            );
        `);
    console.log("Ensured mining_coins table exists (with new columns if needed).");
    // Check for missing columns in existing table (migration)
    await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='symbol') THEN 
                    ALTER TABLE mining_coins ADD COLUMN symbol TEXT DEFAULT ''; 
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='network_hashrate') THEN 
                    ALTER TABLE mining_coins ADD COLUMN network_hashrate DOUBLE PRECISION DEFAULT 0; 
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='block_reward') THEN 
                    ALTER TABLE mining_coins ADD COLUMN block_reward DOUBLE PRECISION DEFAULT 0; 
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='block_time') THEN 
                    ALTER TABLE mining_coins ADD COLUMN block_time DOUBLE PRECISION DEFAULT 60; 
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='price_usd') THEN 
                    ALTER TABLE mining_coins ADD COLUMN price_usd DOUBLE PRECISION DEFAULT 0; 
                END IF;
                 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='algorithm') THEN 
                    ALTER TABLE mining_coins ADD COLUMN algorithm TEXT DEFAULT ''; 
                END IF;
                 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='difficulty') THEN 
                    ALTER TABLE mining_coins ADD COLUMN difficulty DOUBLE PRECISION DEFAULT 1; 
                END IF;
                 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='multiplier') THEN 
                    ALTER TABLE mining_coins ADD COLUMN multiplier DOUBLE PRECISION DEFAULT 1; 
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='color') THEN 
                    ALTER TABLE mining_coins ADD COLUMN color TEXT DEFAULT '#ffffff'; 
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='target_daily_usd') THEN 
                    ALTER TABLE mining_coins ADD COLUMN target_daily_usd DOUBLE PRECISION DEFAULT 0; 
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='show_in_exchange') THEN 
                    ALTER TABLE mining_coins ADD COLUMN show_in_exchange INTEGER DEFAULT 1; 
                END IF;
            END $$;
        `);
  } catch (e) {
    console.error("Failed to ensure mining_coins table/columns:", e);
  }
};

const ensureUpgrades = async () => {
  try {
    const upgrades = [
      {
        id: 'rack_10u', name: 'Rack Padrão 10U', category: 'rack', type: 'rack',
        base_cost: 100, base_production: 0, power_consumption: 0, power_capacity: 0,
        multiplier: 0, slots_capacity: 10, ai_slots_capacity: 0,
        description: 'Rack básico para iniciar sua operação.', icon: 'server', status: 'common',
        is_nft: 0, max_global_stock: -1, image: '', reward_wh: 0, layout: '',
        sell_in_hardware_market: 1, sell_in_black_market: 0, is_active: 1
      },
      {
        id: 'small_battery', name: 'Bateria Pequena', category: 'battery', type: 'battery',
        base_cost: 50, base_production: 0, power_consumption: 0, power_capacity: 1000,
        multiplier: 0, slots_capacity: 0, ai_slots_capacity: 0,
        description: 'Bateria de 1kWh.', icon: 'battery', status: 'common',
        is_nft: 0, max_global_stock: -1, image: '', reward_wh: 0, layout: '',
        sell_in_hardware_market: 1, sell_in_black_market: 0, is_active: 1
      },
      {
        id: 'solar_panel', name: 'Painel Solar', category: 'generator', type: 'generator',
        base_cost: 500, base_production: 10, power_consumption: 0, power_capacity: 0,
        multiplier: 0, slots_capacity: 0, ai_slots_capacity: 0,
        description: 'Gera energia limpa.', icon: 'sun', status: 'common',
        is_nft: 0, max_global_stock: -1, image: '', reward_wh: 0, layout: '',
        sell_in_hardware_market: 1, sell_in_black_market: 0, is_active: 1
      },
      {
        id: 'diesel_generator', name: 'Gerador Diesel', category: 'generator', type: 'generator',
        base_cost: 1500, base_production: 50, power_consumption: 0, power_capacity: 0,
        multiplier: 0, slots_capacity: 0, ai_slots_capacity: 0,
        description: 'Gerador potente a diesel.', icon: 'zap', status: 'uncommon',
        is_nft: 0, max_global_stock: -1, image: '', reward_wh: 0, layout: '',
        sell_in_hardware_market: 1, sell_in_black_market: 0, is_active: 1
      }
    ];

    for (const u of upgrades) {
      await db.query(`
        INSERT INTO upgrades (
          id, name, category, type, base_cost, base_production, power_consumption, power_capacity, 
          multiplier, slots_capacity, ai_slots_capacity, description, icon, status, is_nft, 
          max_global_stock, image, reward_wh, layout, sell_in_hardware_market, sell_in_black_market, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        ON CONFLICT (id) DO NOTHING
      `, [
        u.id, u.name, u.category, u.type, u.base_cost, u.base_production, u.power_consumption, u.power_capacity,
        u.multiplier, u.slots_capacity, u.ai_slots_capacity, u.description, u.icon, u.status, u.is_nft,
        u.max_global_stock, u.image, u.reward_wh, u.layout, u.sell_in_hardware_market, u.sell_in_black_market, u.is_active
      ]);
    }
    console.log('[Seed] Upgrades basicos garantidos.');
  } catch (e) {
    console.error('[Seed] Falha ao garantir upgrades:', e);
  }
};

// Init Gemini
const genAI = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;

// --- UTILS & CORE HELPERS ---
const parseCookies = (req) => {
  const header = req.headers.cookie || '';
  return header.split(';').map(v => v.trim()).filter(Boolean).reduce((acc, cur) => { const i = cur.indexOf('='); if (i > 0) acc[cur.slice(0, i)] = cur.slice(i + 1); return acc; }, {});
};

try {
  getJwtAuthConfig();
} catch (e) {
  console.error('[JWT]', e instanceof Error ? e.message : String(e));
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    process.exit(1);
  }
}

/**
 * IP do cliente: por defeito **não** confia em CF-Connecting-IP / True-Client-IP (spoofing se o Node
 * estiver exposto sem proxy que os remova). Com `TRUST_CF_CONNECTING_IP=1` (ex.: atrás da Cloudflare
 * com origem só acessível via proxy), esses cabeçalhos passam a ter prioridade.
 */
const TRUST_CF_CONNECTING_IP = String(process.env.TRUST_CF_CONNECTING_IP || '').trim() === '1';

const getClientIp = (req) => {
  if (TRUST_CF_CONNECTING_IP) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf && typeof cf === 'string') return cf.split(',')[0].trim();
    const tci = req.headers['true-client-ip'];
    if (tci && typeof tci === 'string') return tci.split(',')[0].trim();
  }
  // Preferir req.ip: com trust proxy definido, o Express aplica a cadeia correta de XFF
  // (evita primeiro hop spoofado e alinha com o mesmo IP usado em req.ip em setups com proxy).
  if (req.ip) {
    const ip = String(req.ip).trim();
    if (ip && ip !== '::1' && ip !== '127.0.0.1' && ip !== '::ffff:127.0.0.1') return ip;
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
};

if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' && !TRUST_CF_CONNECTING_IP) {
  console.log(
    '[Security] TRUST_CF_CONNECTING_IP não está a 1 — cabeçalhos CF-Connecting-IP / True-Client-IP ignorados. Defina TRUST_CF_CONNECTING_IP=1 quando o origin estiver só atrás da Cloudflare (ou proxy equivalente).'
  );
}

const isIpFromUser = async (ip) => {
  try {
    const hit = await prisma.user_history_ips.findFirst({ where: { ip }, select: { user_id: true } });
    return hit != null;
  } catch (e) {
    return false;
  }
};

const authenticateToken = (req, res, next) => {
  if (req.userId) return next();
  return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
};

const checkIsAdmin = async (uid) => {
  if (!uid) return false;
  try {
    const r = await prisma.users.findUnique({ where: { id: uid }, select: { is_admin: true } });
    return !!r?.is_admin;
  } catch (e) {
    console.error('[checkIsAdmin] Error:', e);
    return false;
  }
};

async function loadAdminGateContext(userId) {
  try {
    const row = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        is_admin: true,
        email: true,
        is_super_admin: true,
        admin_permissions: true
      }
    });
    if (!row || !row.is_admin) return null;
    let parsedPm = null;
    try {
      parsedPm = row.admin_permissions ? JSON.parse(row.admin_permissions) : null;
    } catch {
      parsedPm = null;
    }
    return {
      isSuperAdmin: resolveIsSuperAdminFromUserRow(row),
      tabSet: permissionTabSetFromDbJson(parsedPm),
      rawAdminPermissions: parsedPm
    };
  } catch (e) {
    console.error('[loadAdminGateContext]', e);
    return null;
  }
}

/** Normaliza origem para bater com o header `Origin` do browser (sem barra final). */
function normalizeCorsOrigin(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  const t = raw.trim().replace(/\/+$/, '');
  return t;
}

/**
 * Origens: FRONTEND_URL ou aliases (muitos .env usam um único URL público),
 * + CORS_ALLOWED_ORIGINS (vírgulas), + lista fixa do domínio público no código.
 */
function buildCorsOriginSet() {
  const s = new Set();
  const add = (o) => {
    if (o == null || typeof o !== 'string') return;
    const t = normalizeCorsOrigin(o);
    if (t) s.add(t);
  };
  const primaryPublic =
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_URL ||
    process.env.SITE_URL ||
    process.env.VITE_APP_URL ||
    '';
  add(primaryPublic);
  for (const part of String(process.env.CORS_ALLOWED_ORIGINS || '').split(',')) add(part);
  for (const part of String(process.env.CORS_EXTRA_ORIGINS || '').split(',')) add(part);
  ['https://genesisdao.tech', 'https://www.genesisdao.tech', 'https://test.genesisdao.tech'].forEach(add);
  return s;
}
const ALLOWED_CORS_ORIGINS = buildCorsOriginSet();
{
  const primary =
    normalizeCorsOrigin(
      process.env.FRONTEND_URL ||
        process.env.PUBLIC_URL ||
        process.env.SITE_URL ||
        process.env.VITE_APP_URL ||
        ''
    ) || '(nenhuma)';
  console.log(
    `[CORS] URL pública (.env): ${primary} | origens permitidas: ${ALLOWED_CORS_ORIGINS.size} (FRONTEND_URL, PUBLIC_URL, SITE_URL, CORS_ALLOWED_ORIGINS, CORS_EXTRA_ORIGINS, genesisdao.tech, test.genesisdao.tech)`
  );
}

/**
 * Eventos de jogo para auditoria no admin (MongoDB; não falha o fluxo principal).
 * O primeiro argumento mantém-se por compatibilidade com chamadas antigas (`pool`) mas é ignorado.
 */
async function appendGameActivityLog(_q, userId, action, meta) {
  if (!userId || !action) return;
  const uid = typeof userId === 'number' ? userId : parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) return;
  const safeAction = String(action).slice(0, 200);
  let metaObj: Record<string, unknown> = {};
  try {
    metaObj = JSON.parse(JSON.stringify(meta == null ? {} : meta)) as Record<string, unknown>;
  } catch {
    metaObj = {};
  }
  await appendGameActivityLogMongo(uid, safeAction, metaObj);
}

/** WebSocket: métricas do painel admin (KPIs; cookie de sessão). */
let adminDashboardWss: WebSocketServer | null = null;
/** WebSocket: cabeçalho do jogo (tokens, USDC, hashrate) para jogador com sessão válida. */
let playerGameHeaderWss: WebSocketServer | null = null;
/** WebSocket: atualizações do mercado P2P (clientes ligam em /ws/market). */
let marketWss: WebSocketServer | null = null;
/** Limite de upgrades /ws/market por IP (mitigação DoS; por worker em cluster). */
const marketWsConnectionsByIp = new Map<string, number>();
const marketWsMaxPerIp = Math.min(
  500,
  Math.max(1, parseInt(String(process.env.MARKET_WS_MAX_PER_IP || '25'), 10) || 25)
);

function marketWsBroadcastLocal(payload) {
  if (!marketWss) return;
  const msg = JSON.stringify(payload);
  for (const c of marketWss.clients) {
    if (c.readyState === 1) c.send(msg);
  }
}
function emitMarketWs(payload) {
  marketWsBroadcastLocal(payload);
  if (cluster.isWorker && typeof process.send === 'function') {
    try {
      process.send({ type: 'market_ws_broadcast', payload });
    } catch (_) { /* ignore */ }
  }
}

const isAdmin = async (req, res, next) => {
  const ip = getClientIp(req);
  if (!req.originalUrl.includes('/api/admin/dashboard-stats') && !req.originalUrl.includes('/api/system/time')) {
    console.log(`[AdminCheck] IP: ${ip}, URL: ${req.originalUrl}`);
  }
  const logAccess = async (details) => {
    if (req.url.includes('/api/admin/dashboard-stats') || req.url.includes('/api/system/time')) {
      return;
    }

    try {
      await db.query(`
        INSERT INTO admin_access_logs (ip, attempted_url, user_agent, details, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [ip, req.originalUrl || req.url, req.headers['user-agent'], details, Date.now()]);
    } catch (e) {
      console.error('[AdminAudit] Failed to log:', e.message);
    }
  };

  let uidForAdmin = req.userId;

  try {
    if (!uidForAdmin) {
      const resolved = await resolveUserIdFromAccessCookieOrSid(req);
      if (resolved) {
        uidForAdmin = resolved;
        req.userId = resolved;
      } else {
        const fromUser = await isIpFromUser(ip);
        await logAccess(`No session cookie provided. IsKnownUser: ${fromUser}`);
        return res.status(401).json({ error: 'Não autenticado' });
      }
    }

    const ctx = await loadAdminGateContext(uidForAdmin);
    if (!ctx) {
      await logAccess(`User ID ${uidForAdmin} attempted admin access without admin flag`);
      return res.status(403).json({ error: 'Acesso negado' });
    }

    req.isSuperAdmin = ctx.isSuperAdmin;
    req.adminPermissions = ctx.rawAdminPermissions;

    const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
    const rule = resolveAdminRouteRequirement(req.method || 'GET', pathOnly);
    if (!allowsAdminRouteAccess(ctx.isSuperAdmin, ctx.tabSet, rule)) {
      await logAccess(`Permissão admin negada: user=${uidForAdmin} path=${pathOnly}`);
      return res.status(403).json({ error: 'Permissão insuficiente para esta operação.' });
    }

    next();
  } catch (e) {
    console.error('[isAdmin] Internal Error:', e);
    res.status(500).json({ error: 'Erro interno' });
  }
};

/** JWT access (`gm_access`) ou cookie `sid` — mesmo critério que o middleware HTTP. */
async function resolveUserIdFromAccessCookieOrSid(req): Promise<number | null> {
  const accessRaw = parseCookies(req)[COOKIE_ACCESS];
  if (typeof accessRaw === 'string' && accessRaw.length > 0) {
    try {
      const v = verifyAccessToken(accessRaw);
      const uid = Number(v.userId);
      if (Number.isFinite(uid) && uid > 0) return uid;
    } catch {
      /* continuar para sid */
    }
  }
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const s = await prisma.sessions.findUnique({
    where: { session_id: sid },
    select: { user_id: true, expires_at: true }
  });
  if (!s || Number(s.expires_at) < Date.now()) return null;
  const uid = Number(s.user_id);
  return Number.isFinite(uid) && uid > 0 ? uid : null;
}

/** JWT ou `sid` + sessão válida + `is_admin` (upgrade WS /ws/admin-dashboard). */
async function resolveAdminUserIdFromWsUpgradeRequest(req) {
  try {
    const userId = await resolveUserIdFromAccessCookieOrSid(req);
    if (userId == null) return null;
    const ctx = await loadAdminGateContext(userId);
    if (!ctx) return null;
    if (!allowsAdminRouteAccess(ctx.isSuperAdmin, ctx.tabSet, { kind: 'tab', tab: 'dashboard' })) return null;
    return userId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[AdminDashWs] resolve session:', msg);
    return null;
  }
}

/** JWT ou `sid` + sessão válida para upgrade WS `/ws/player-game`. */
async function resolveSessionUserIdFromWsUpgradeRequest(req) {
  try {
    return await resolveUserIdFromAccessCookieOrSid(req);
  } catch (e) {
    console.warn('[PlayerGameWs] resolve session:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

const app = express();

/** Imagens do jogo (itens, racks) na imagem Docker; uploads admin/suporte só em `img/uploads` (pode ter volume). */
const IMG_DIR = path.join(__dirname, 'img');
const IMG_UPLOADS_DIR = path.join(__dirname, 'img', 'uploads');
try {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(IMG_UPLOADS_DIR, { recursive: true });
} catch { /* ignore */ }

runImageRootStartupOrganizeIfEnabled(IMG_DIR);

const { uploadSupport, uploadSupportReply } = createSupportTicketUploadMiddlewares(IMG_UPLOADS_DIR);
// Número de proxies à frente do Node (ex.: 1 = só Nginx; 2 = Cloudflare + Nginx). Evita trust proxy=true,
// que confia em todos os hops e pode distorcer req.ip. Ajuste TRUST_PROXY_HOPS no .env se o IP real vier errado.
const trustProxyHops = parseInt(String(process.env.TRUST_PROXY_HOPS ?? '1'), 10);
app.set('trust proxy', Number.isFinite(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : 1);
const desiredPort = parseInt(process.env.API_PORT || process.env.PORT || '3001', 10);

/** Produção: tráfego HTTP na borda → redirecionamento 308 para HTTPS (usa X-Forwarded-Proto do Nginx/CF). */
const enforceHttpsRedirect =
  process.env.NODE_ENV === 'production' && String(process.env.ENFORCE_HTTPS ?? '1') !== '0';
if (enforceHttpsRedirect) {
  app.use((req, res, next) => {
    const hostname = String(req.hostname || '').toLowerCase();
    const hostHdr = String(req.get('Host') || '').toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      hostHdr.startsWith('localhost:') ||
      hostHdr.startsWith('127.0.0.1:')
    ) {
      return next();
    }
    const raw = String(req.get('X-Forwarded-Proto') || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (raw === 'https' || raw === 'wss') return next();
    if (raw === 'http' || raw === 'ws') {
      // Não usar X-Forwarded-Host (open redirect se o cliente injectar o cabeçalho até ao Node).
      const hostHdr = String(req.get('Host') || req.hostname || '').trim();
      const hostOnly = hostHdr.split(':')[0].toLowerCase();
      if (!hostOnly || !/^[a-z0-9.-]+$/i.test(hostOnly)) return next();
      const path = req.originalUrl || req.url || '/';
      return res.redirect(308, `https://${hostOnly}${path}`);
    }
    return next();
  });
}

const cspUpgradeInsecure =
  process.env.NODE_ENV === 'production' && String(process.env.CSP_UPGRADE_INSECURE ?? '1') !== '0';

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.applixir.com",
        "https://static.cloudflareinsights.com",
        "https://www.googletagmanager.com",
        "https://www.google-analytics.com",
        "https://*.googletagmanager.com"
      ],
      "connect-src": [
        "'self'",
        "https://cdn.applixir.com",
        "https://*.googleapis.com",
        "https://api.etherscan.io",
        "https://www.google-analytics.com",
        "https://www.googletagmanager.com",
        "https://analytics.google.com",
        "https://region1.google-analytics.com",
        "https://stats.g.doubleclick.net"
      ],
      "img-src": ["'self'", "data:", "https:", "http:"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "frame-src": ["'self'", "https://cdn.applixir.com"],
      "object-src": ["'none'"],
      ...(cspUpgradeInsecure ? { "upgrade-insecure-requests": [] } : {}),
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));

// IP Blacklist Middleware (GLOBAL)
app.use(async (req, res, next) => {
  const ip = getClientIp(req);
  try {
    const blHit = await prisma.ip_blacklist.findUnique({ where: { ip }, select: { ip: true } });
    if (blHit) {
      // Return JSON to avoid frontend parse errors
      return res.status(403).json({ error: 'Sua conexão foi bloqueada por razões de segurança.' });
    }
  } catch (e) { /* ignore DB error on every request */ }
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) return callback(null, true);
    if (ALLOWED_CORS_ORIGINS.has(origin)) return callback(null, true);
    console.error('CORS blocked origin:', origin);
    // [] = origem negada com resposta preflight válida (evita callback(Error) → next(err) sem cabeçalhos CORS).
    return callback(null, []);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Edit', 'X-Game-Save-Domain']
}));

const parseRateLimit = (raw, fallback, min, max) => {
  const n = parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};
// Limite global /api por IP. O SPA faz várias chamadas em paralelo a cada 10–15s; IPs partilhados (CGNAT, café,
// escritório) somam no mesmo bucket — piso baixo (ex.: 200) bloqueava utilizadores “do nada”. Ajuste API_RATE_LIMIT_MAX.
const apiRateLimitMax = parseRateLimit(process.env.API_RATE_LIMIT_MAX, 20000, 5000, 250000);
const authRateLimitMax = parseRateLimit(process.env.AUTH_RATE_LIMIT_MAX, 40, 5, 1000);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    const ip = getClientIp(req);
    return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
  },
  message: { error: 'Muitas requisições vindas deste IP, tente novamente mais tarde.' },
  validate: { trustProxy: true }
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    const ip = getClientIp(req);
    return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
  },
  message: { error: 'Muitas tentativas de login, tente novamente mais tarde.' },
  validate: { trustProxy: true }
});

/** Pedidos de link por email (evita abuso / enumeração em massa). */
const passwordResetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseRateLimit(process.env.PASSWORD_RESET_EMAIL_MAX_PER_HOUR, 8, 3, 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    const ip = getClientIp(req);
    return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
  },
  message: { error: 'Muitos pedidos de redefinição a partir deste IP. Tente novamente mais tarde.' },
  validate: { trustProxy: true }
});

/** Vincular código / rotas legacy de referral — bucket por IP + utilizador autenticado. */
const referralClaimSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseRateLimit(process.env.REFERRAL_CLAIM_MAX_PER_15M, 30, 5, 120),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${getClientIp(req)}:${req.userId != null ? String(req.userId) : 'anon'}`,
  skip: (req) => {
    const ip = getClientIp(req);
    return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
  },
  message: { error: 'Muitas operações de indicação. Tente novamente mais tarde.' },
  validate: { trustProxy: true }
});

app.use('/api/', limiter);
app.use('/api/login', authLimiter);

attachSecurityThreatResponseObserver(app, {
  backupModel,
  getClientIp
});

app.use(express.json({ limit: '5mb' })); // Reduzido o limite para 5MB por segurança
app.use(express.urlencoded({ limit: '5mb', extended: true }));

const jwtAllowLegacySession =
  process.env.JWT_ALLOW_LEGACY_SESSION !== '0' &&
  process.env.JWT_ALLOW_LEGACY_SID !== '0';
app.use(createResolveAuthMiddleware({ parseCookies, allowLegacySession: jwtAllowLegacySession }));

app.use((req, res, next) => {
  const url = req.url || '';
  if (/\/cgi-bin\b/i.test(url)) {
    return res.status(404).end();
  }
  next();
});

mountImageStaticMiddleware(app, IMG_UPLOADS_DIR, IMG_DIR);

// --- Bootstrap SPA (catálogo + economia num único GET; ?lite=1 para refresh leve) ---
app.get('/api/bootstrap', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    const l = (req.query as { lite?: unknown }).lite;
    const lite = l === '1' || String(l).toLowerCase() === 'true';
    const data = await getPublicBootstrapPayload(req.userId, lite);
    res.json(data);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.get('/api/me/profile-bundle', authenticateToken, async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const data = await getProfilePageBundlePayload(req.userId);
    res.json(data);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

/** Desliga a carteira Polygon do perfil (persiste `polygon_wallet = null`). */
app.delete('/api/me/polygon-wallet', authenticateToken, async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const uid = Number(req.userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    return res.status(400).json({ error: 'Sessão inválida.' });
  }
  try {
    await clearUserPolygonWallet(uid);
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.get('/api/me/upgrade-shop-bundle', authenticateToken, async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const data = await getUpgradeAccountShopBundlePayload(req.userId);
    res.json(data);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- Moved utilities below ---

/** Reduz writes em `users.last_active_at` e `user_history_ips` (hot path em todo pedido autenticado). Por worker. */
const activityThrottleMaps = new ActivityThrottleMaps(resolveActivityThrottleConfig());

// Activity tracking (utilizador já resolvido por JWT ou sessão legacy)
app.use(async (req, res, next) => {
  if (!req.userId) return next();
  try {
    const now = Date.now();
    const ip = getClientIp(req);
    const uid = req.userId;
    if (typeof uid !== 'number' || uid <= 0) return next();

    const writeLastActive = activityThrottleMaps.shouldWriteLastActive(uid, now);
    const writeHistoryIp = activityThrottleMaps.shouldWriteHistoryIp(uid, ip, now);

    activityThrottleMaps.prune(now);

    if (writeLastActive) {
      await prisma.users.update({
        where: { id: uid },
        data: { last_active_at: BigInt(now) }
      });
      activityThrottleMaps.markLastActiveWritten(uid, now);
    }
    const sid = parseCookies(req).sid;
    if (sid) {
      const seenThrottle = now - 45000;
      await prisma.sessions.updateMany({
        where: {
          session_id: sid,
          OR: [{ last_seen_at: { lt: BigInt(seenThrottle) } }, { last_seen_at: BigInt(0) }]
        },
        data: { last_seen_at: BigInt(now) }
      });
    }
    if (writeHistoryIp) {
      await prisma.user_history_ips.upsert({
        where: { user_id_ip: { user_id: uid, ip } },
        create: { user_id: uid, ip, last_used_at: BigInt(now) },
        update: { last_used_at: BigInt(now) }
      });
      activityThrottleMaps.markHistoryIpWritten(uid, ip, now);
    }
  } catch (e) { /* ignore */ }
  next();
});

registerDeviceFingerprintAdminRoutes(app, { isAdmin });
registerP2pMarketRoutes(app, { emitMarketWs });
registerLootBoxPlayerRoutes(app, {
  appendGameActivityLog
});
registerLootBoxAdminRoutes(app, { isAdmin });
registerRoletaPlayerRoutes(app, {
  authenticateToken,
  appendGameActivityLog
});
registerPromoRedeemRoutes(app, {
  parseCookies,
  grantAdminUpgradeRewards: grantAdminUpgradeRewardsInTx,
  appendGameActivityLog
});
registerBackupRoutes(app, {
  isAdmin,
  backupModel,
  getPgRestoreSpawnOptions,
  getPgRestorePath
});
registerSupportMutationRoutes(app, {
  authenticateToken,
  uploadSupport,
  appendGameActivityLog
});
registerSupportTicketRoutes(app, {
  authenticateToken,
  isAdmin,
  uploadSupportReply,
  appendGameActivityLog
});
registerPartnerYoutubeRoutes(app, {
  authenticateToken,
  isAdmin,
  appendGameActivityLog
});
registerWorkshopMutationRoutes(app, { authenticateToken });
registerInventoryRoutes(app, { authenticateToken });
registerPlayerCalculatorRoutes(app, { authenticateToken });
registerImageAssetRoutes(app, {
  isAdmin,
  imgDir: IMG_DIR,
  uploadsDir: IMG_UPLOADS_DIR
});

const PLAYER_ACTIVITY_ACTIONS = new Set(['room_battery_smart', 'room_battery_bulk_equip', 'room_battery_remove_all']);

function sanitizePlayerActivityMeta(raw) {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const roomId = raw.roomId;
  if (typeof roomId === 'string' && roomId.length > 0 && roomId.length <= 120 && !/[\x00-\x1f<>]/.test(roomId)) {
    out.roomId = roomId;
  }
  const bid = raw.batteryUpgradeId;
  if (bid === '' || (typeof bid === 'string' && /^[a-zA-Z0-9_.-]{1,200}$/.test(bid))) {
    out.batteryUpgradeId = typeof bid === 'string' ? bid : '';
  }
  if (raw.smartFill === true) out.smartFill = true;
  if (raw.smartFill === false) out.smartFill = false;
  if (raw.rigSort === 'slot_asc' || raw.rigSort === 'hashrate_desc') out.rigSort = raw.rigSort;
  for (const k of ['appliedRigs', 'compatibleRigs']) {
    const n = raw[k];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100000) out[k] = Math.floor(n);
  }
  if (raw.ok === true || raw.ok === false) out.ok = raw.ok;
  return out;
}

function sanitizePlayerActivityClientHints(raw, depth = 0) {
  if (depth > 4 || raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (count++ > 48) break;
    if (typeof k !== 'string' || k.length > 64 || !/^[a-zA-Z0-9_]+$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 600);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3) {
      const nested = sanitizePlayerActivityClientHints(v, depth + 1);
      if (Object.keys(nested).length) out[k] = nested;
    }
  }
  return out;
}

app.post('/api/player-activity-log', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const action = typeof req.body?.action === 'string' ? req.body.action.slice(0, 80) : '';
  if (!PLAYER_ACTIVITY_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Ação inválida' });
  }
  const meta = sanitizePlayerActivityMeta(req.body?.meta);
  if (action === 'room_battery_bulk_equip') {
    const id = meta.batteryUpgradeId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_.-]{1,200}$/.test(id)) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
  }
  if (action === 'room_battery_smart') {
    if (meta.smartFill !== true) return res.status(400).json({ error: 'Dados inválidos' });
    if (meta.batteryUpgradeId) return res.status(400).json({ error: 'Dados inválidos' });
  }
  if (action === 'room_battery_remove_all') {
    if (meta.smartFill === true) return res.status(400).json({ error: 'Dados inválidos' });
    if (meta.batteryUpgradeId) return res.status(400).json({ error: 'Dados inválidos' });
  }
  const clientHints = sanitizePlayerActivityClientHints(req.body?.clientHints);
  const ip = getClientIp(req);
  const uaHdr = req.headers['user-agent'];
  const ua = typeof uaHdr === 'string' ? uaHdr.slice(0, 500) : '';
  try {
    await appendGameActivityLog(db, req.userId, `client_${action}`, {
      meta,
      server: { ip, userAgent: ua },
      clientHints
    });
    console.log(`[PlayerActivity] user=${req.userId} action=${action}`);
  } catch (e) {
    console.warn('[PlayerActivity]', e?.message || e);
  }
  return res.json({ ok: true });
});

// CACHE REMOVIDO CONFORME SOLICITADO

// --- Ranking / hashrates: um único tick em miningYieldCron + getGlobalNetworkStats() ---
startMiningYieldCron(db);


// --- CHARGING HISTORY ENDPOINTS ---

app.get('/api/charging-history', authenticateToken, async (req, res) => {
  try {
    const u = await prisma.users.findUnique({ where: { id: req.userId! }, select: { email: true } });
    if (!u) return res.status(404).json({ error: 'User not found' });

    const rows = await prisma.charging_history.findMany({
      where: { user_email: u.email },
      orderBy: { timestamp: 'desc' },
      take: 100
    });
    res.json(rows);
  } catch (e) {
    console.error('[ChargingHistory] Error fetching:', e);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

app.post('/api/charging-history/log', authenticateToken, async (req, res) => {
  const { action, workshop_slot_index, component_slot_id, battery_instance_id, battery_item_id, charge_amount, stock_confirmed, details } = req.body;

  try {
    const u = await prisma.users.findUnique({ where: { id: req.userId! }, select: { email: true } });
    if (!u) return res.status(404).json({ error: 'User not found' });

    const detailsJson: Prisma.InputJsonValue =
      details && typeof details === 'object' && !Array.isArray(details)
        ? (details as Prisma.InputJsonValue)
        : {};

    await prisma.charging_history.create({
      data: {
        user_email: u.email,
        action: String(action ?? ''),
        workshop_slot_index:
          workshop_slot_index === undefined || workshop_slot_index === null
            ? null
            : Number(workshop_slot_index),
        component_slot_id:
          component_slot_id === undefined || component_slot_id === null
            ? null
            : String(component_slot_id),
        battery_instance_id:
          battery_instance_id === undefined || battery_instance_id === null
            ? null
            : String(battery_instance_id),
        battery_item_id:
          battery_item_id === undefined || battery_item_id === null ? null : String(battery_item_id),
        charge_amount: charge_amount === undefined || charge_amount === null ? null : Number(charge_amount),
        stock_confirmed: !!stock_confirmed,
        details: detailsJson
      }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[ChargingHistory] Error logging:', e);
    res.status(500).json({ error: 'Erro ao registrar histórico' });
  }
});

// --- Moved middlewares below ---

app.get('/api/admin/wheel/config', isAdmin, async (req, res) => {
  try {
    const items = await fetchWheelPrizesForApiConfig();
    res.json(items);
  } catch (e) {
    console.error(e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin/wheel/config', isAdmin, async (req, res) => {
  const items = req.body; // Array of items
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Lista de prémios inválida' });
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.wheel_prizes.deleteMany({});
      for (const item of items) {
        await tx.wheel_prizes.create({
          data: {
            id: String(item.id),
            label: String(item.label),
            weight: Number(item.weight),
            color: String(item.color),
            item_id: item.itemId != null && String(item.itemId).trim() !== '' ? String(item.itemId) : null
          }
        });
      }
    });
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.get('/api/admin/wheel/players', isAdmin, async (req, res) => {
  try {
    const rows = await prisma.wheel_players.findMany({ orderBy: { added_at: 'desc' } });
    res.json(
      rows.map((r) => ({
        username: r.username,
        added_at: Number(r.added_at)
      }))
    );
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin/wheel/players', isAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  try {
    const at = BigInt(Date.now());
    await prisma.wheel_players.upsert({
      where: { username: String(username) },
      create: { username: String(username), added_at: at },
      update: { added_at: at }
    });
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- MINING RANKING (PUBLIC) ---
app.get('/api/ranking/public', authenticateToken, async (req, res) => {
  try {
    const payload = await getPublicMiningRankingPayload();
    res.json(payload);
  } catch (e) {
    console.error('Public Ranking Error:', e);
    res.status(500).json({ error: 'Erro ao obter ranking.' });
  }
});

// --- MINING RANKING ---
app.get('/api/admin/ranking', isAdmin, async (req, res) => {
  try {
    const payload = await getAdminMiningRankingPayload();
    res.json(payload);
  } catch (e) {
    console.error('Admin Ranking Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- COIN BALANCE UPDATE (ADMIN) ---
app.post('/api/admin/update-coin-balance', isAdmin, async (req, res) => {
  const { userId, coinId, amount } = req.body;

  if (userId === undefined || !coinId || amount === undefined) {
    return res.status(400).json({ error: 'Missing fields: userId, coinId, amount' });
  }

  const client = await db.connect();
  try {
    await client.query(`
      INSERT INTO coin_balances (user_id, coin_id, amount) 
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, coin_id) 
      DO UPDATE SET amount = EXCLUDED.amount
    `, [userId, coinId, amount]);

    res.json({ ok: true });
  } catch (e) {
    console.error('Update Coin Balance Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

app.post('/api/admin/bulk-update-coin-balance', isAdmin, async (req, res) => {
  const { coinId, amount } = req.body;
  console.log(`[Admin] Requisitada atualização em massa para ${coinId} com valor ${amount}`);

  if (!coinId || amount === undefined) {
    return res.status(400).json({ error: 'Campos ausentes: coinId, amount' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Determinar usuários afetados: mineradores ativos OU qualquer pessoa que já tenha saldo desta moeda
    const usersRes = await client.query(`
      SELECT DISTINCT user_id 
      FROM placed_racks 
      WHERE is_on = 1 
      AND wiring_id IS NOT NULL 
      AND battery_id IS NOT NULL
      AND selected_coin_id = $1
      UNION
      SELECT user_id FROM coin_balances WHERE coin_id = $1 AND amount > 0
    `, [coinId]);

    const userIds = usersRes.rows.map(r => r.user_id);
    console.log(`[Admin] Encontrados ${userIds.length} usuários (mineradores ou com saldo) para a moeda ${coinId}`);

    if (userIds.length > 0) {
      // Atualização em massa: 
      // O INSERT usa GREATEST(0, $3) para novos registros não começarem negativos.
      // O UPDATE usa o valor bruto ($3) para somar ou subtrair, mas garante final >= 0.
      await client.query(`
        INSERT INTO coin_balances (user_id, coin_id, amount) 
        SELECT u, $2, GREATEST(0, $3::double precision) FROM unnest($1::int[]) AS u
        ON CONFLICT (user_id, coin_id) 
        DO UPDATE SET amount = GREATEST(0, coin_balances.amount + $3::double precision)
      `, [userIds, coinId, amount]);
    }

    await client.query('COMMIT');
    res.json({ ok: true, count: userIds.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Bulk Update Coin Balance Error:', e);
    sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno no servidor.');
  } finally {
    client.release();
  }
});

// --- ECONOMY MANAGER ---
app.get('/api/admin/economy-stats', isAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    // 1. Fetch Coins & Upgrades
    const coinsRes = await client.query('SELECT * FROM mining_coins');
    const coins = coinsRes.rows;
    const coinsMap = new Map();
    coins.forEach(c => coinsMap.set(c.id, { ...c, realActiveMiners: 0, realTotalHashrate: 0 }));

    const upsRes = await client.query('SELECT id, base_production, multiplier, power_capacity FROM upgrades');
    const upsMap = new Map();
    upsRes.rows.forEach(u => upsMap.set(u.id, u));

    // 2. Fetch Active Racks
    const racksRes = await client.query(`
      SELECT pr.* 
      FROM placed_racks pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.is_on = 1 
      AND pr.wiring_id IS NOT NULL 
      AND pr.battery_id IS NOT NULL
      AND u.is_blocked = 0
    `);

    // 3. Optimization: Fetch slot contents
    // To avoid N+1, we fetch all relevant slots.
    const allSlots = await client.query('SELECT rack_id, machine_item_id FROM rack_slots');
    const slotsMap = {};
    allSlots.rows.forEach(s => {
      if (!slotsMap[s.rack_id]) slotsMap[s.rack_id] = [];
      slotsMap[s.rack_id].push(s.machine_item_id);
    });

    const allMultis = await client.query('SELECT rack_id, multiplier_item_id FROM rack_multiplier_slots');
    const multiMap = {};
    allMultis.rows.forEach(m => {
      if (!multiMap[m.rack_id]) multiMap[m.rack_id] = [];
      multiMap[m.rack_id].push(m.multiplier_item_id);
    });

    // 4. Calculate Real Stats
    const activeMinersSets = {}; // coinId -> Set(userId)

    for (const rack of racksRes.rows) {
      if (!rack.selected_coin_id) continue;
      const cid = rack.selected_coin_id;
      if (!coinsMap.has(cid)) continue;

      // Battery check
      const battDef = upsMap.get(rack.battery_id);
      const isInfinite = battDef && battDef.power_capacity === -1;
      if (!isInfinite && rack.current_charge <= 0) continue;

      // Base Prod
      let base = 0;
      (slotsMap[rack.id] || []).forEach(mid => {
        const u = upsMap.get(mid);
        if (u) base += (u.base_production || 0);
      });
      if (base === 0) continue;

      // Multiplier
      let mult = 1;
      (multiMap[rack.id] || []).forEach(mid => {
        const u = upsMap.get(mid);
        if (u) mult += (u.multiplier || 0);
      });

      const power = base * mult;

      const cStats = coinsMap.get(cid);
      cStats.realTotalHashrate += power;

      if (!activeMinersSets[cid]) activeMinersSets[cid] = new Set();
      activeMinersSets[cid].add(rack.user_id);
    }

    // 5. Finalize
    const result = Array.from(coinsMap.values()).map(c => ({
      ...c,
      realActiveMiners: activeMinersSets[c.id] ? activeMinersSets[c.id].size : 0
    }));

    res.json(result);
  } catch (e) {
    console.error('Economy Stats Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

/** Runtime de mineração (hashrates ao vivo) — não confundir com GET /api/admin/economy-stats (lista de moedas). */
app.get('/api/admin/mining-runtime-summary', isAdmin, async (req, res) => {
  try {
    const realNetworkHashrates = Object.fromEntries(miningRuntimeStats.globalNetworkHashrates);
    const activeMinersByCoin = Object.fromEntries(miningRuntimeStats.globalActiveMinersByCoin);
    res.json({
      realActiveMiners: miningRuntimeStats.globalActiveMiners,
      realNetworkHashrates,
      activeMinersByCoin
    });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// Proxy Etherscan (chave só no servidor) — usado pelo painel admin Relatórios / Dashboard.
app.get('/api/admin/etherscan/treasury-token-txs', isAdmin, async (req, res) => {
  const apiKey = (process.env.ETHERSCAN_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'ETHERSCAN_API_KEY não configurada no servidor.' });
  }
  const page = Math.min(100, Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1));
  const offset = Math.min(1000, Math.max(1, parseInt(String(req.query.offset ?? '20'), 10) || 20));
  const USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  const fallbackTreasury = '0x3D9bDA32f0cbA0E84C332Fd0151D434A4840F38a'.toLowerCase();
  const legacyTreasury = '0x2c386Bf962339B497d5EC6A0EdB255D30004F3B6'.toLowerCase();
  /** Carteira antiga — fase lançamento (Relatórios admin). */
  const legacyLaunchTreasury = '0x33d2406707e5e4b314d15784e73bb08f0c46db42'.toLowerCase();
  let configuredTreasury = '';
  try {
    const raw = await getSettingValue('web3_deposit_wallet');
    if (typeof raw === 'string') {
      const t = raw.trim().toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(t)) configuredTreasury = t;
    }
  } catch (e) {
    console.error('[treasury-token-txs] settings read', e);
  }
  const primaryTreasury = configuredTreasury || fallbackTreasury;
  const allowed = new Set([legacyTreasury, legacyLaunchTreasury, primaryTreasury]);
  const requested = String(req.query.address ?? '').trim().toLowerCase();
  const treasury =
    requested.length === 42 && requested.startsWith('0x') && allowed.has(requested)
      ? requested
      : primaryTreasury;
  const url = `https://api.etherscan.io/v2/api?chainid=137&module=account&action=tokentx&contractaddress=${USDC}&address=${treasury}&page=${page}&offset=${offset}&startblock=0&endblock=99999999&sort=desc&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    console.error('[etherscan proxy]', e.message || e);
    res.status(502).json({ error: 'Falha ao contactar Etherscan.' });
  }
});

app.post('/api/admin/economy-settings', isAdmin, async (req, res) => {
  const { coinId, networkHashrate, blockReward } = req.body;

  if (!coinId || networkHashrate === undefined || blockReward === undefined) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const coinIdStr = String(coinId);
    const prev = await prisma.mining_coins.findUnique({ where: { id: coinIdStr } });
    if (!prev) return res.status(404).json({ error: 'Coin not found' });

    const nhNew = roundMiningEconomyField8Decimals(
      Math.max(1_000_000, Number(networkHashrate)) || 1_000_000
    );
    const brNew = roundMiningEconomyField8Decimals(Math.max(0, Number(blockReward)));

    const oldY = spotYieldPerHashForCoin(
      coinIdStr,
      prev.block_reward,
      prev.block_time,
      prev.network_hashrate
    );
    const newY = spotYieldPerHashForCoin(coinIdStr, brNew, prev.block_time, nhNew);
    const yieldChanged =
      !Number.isFinite(oldY) ||
      !Number.isFinite(newY) ||
      Math.abs(oldY - newY) > SPOT_YIELD_EPS;

    await prisma.mining_coins.update({
      where: { id: coinIdStr },
      data: { network_hashrate: nhNew, block_reward: brNew }
    });

    if (yieldChanged) {
      await prisma.mining_yield_history.create({
        data: {
          coin_id: coinIdStr,
          yield_per_hash: newY,
          block_reward: brNew,
          network_hashrate: nhNew,
          effective_at: BigInt(Date.now())
        }
      });
    }

    const coin = await prisma.mining_coins.findUnique({ where: { id: coinIdStr } });
    res.json({ ok: true, coin });
  } catch (e) {
    console.error('Update Economy Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});


app.delete('/api/admin/wheel/players/:username', isAdmin, async (req, res) => {
  const { username } = req.params;
  try {
    await prisma.wheel_players.deleteMany({ where: { username: String(username) } });
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- WALLET LABELS ---
app.get('/api/wallet-labels', isAdmin, async (req, res) => {
  try {
    const rows = await prisma.wallet_labels.findMany();
    res.json(
      rows.map((r) => ({
        address: r.address,
        label: r.label,
        updated_at: Number(r.updated_at)
      }))
    );
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/wallet-labels', isAdmin, async (req, res) => {
  const { address, label } = req.body;
  if (!address || !label) return res.status(400).json({ error: 'Missing fields' });
  try {
    const at = BigInt(Date.now());
    await prisma.wallet_labels.upsert({
      where: { address: String(address) },
      create: { address: String(address), label: String(label), updated_at: at },
      update: { label: String(label), updated_at: at }
    });
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// API UTILITIES

/** Domínios permitidos para novo cadastro público (contas antigas não são alteradas). */
const SIGNUP_EMAIL_ALLOWLIST = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.com.br', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.it', 'yahoo.ca', 'yahoo.com.ar',
  'ymail.com', 'rocketmail.com',
  'mail.ru', 'inbox.ru', 'bk.ru', 'list.ru',
  'web.de'
]);

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamailblock.com', 'sharklasers.com', 'yopmail.com', 'yopmail.fr',
  'tempmail.com', 'temp-mail.org', 'throwaway.email', 'trashmail.com', '10minutemail.com', '10minutemail.net',
  'fakeinbox.com', 'getnada.com', 'maildrop.cc', 'dispostable.com', 'emailondeck.com', 'burnermail.io',
  'moakt.com', 'tmpmail.org', 'mailcatch.com', 'spam4.me', 'grr.la', 'mailnesia.com', 'trashmail.de',
  'discard.email', 'discardmail.com', 'wegwerfmail.de', 'trashmail.ws', 'armyspy.com', 'cuvox.de', 'dayrep.com',
  'einrot.com', 'fleckens.hu', 'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us'
]);

const assertPublicSignupEmailAllowed = (normalizedEmail) => {
  const at = normalizedEmail.lastIndexOf('@');
  if (at < 1 || at === normalizedEmail.length - 1) {
    return { ok: false, error: 'E-mail inválido.' };
  }
  const domain = normalizedEmail.slice(at + 1).toLowerCase().trim();
  if (!domain || domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
    return { ok: false, error: 'E-mail inválido.' };
  }
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain) || domain.endsWith('.yopmail.com')) {
    return {
      ok: false,
      error: 'E-mails temporários ou descartáveis não são aceites. Cadastre-se com Gmail, Outlook, Yahoo, Hotmail, Live, Mail.ru ou Web.de. Suporte: https://t.me/+Fm72joLwb-tjYTZh'
    };
  }
  if (SIGNUP_EMAIL_ALLOWLIST.has(domain)) return { ok: true };
  return {
    ok: false,
    error: 'Cadastro permitido apenas com contas Gmail, Outlook, Yahoo, Hotmail, Live, Mail.ru ou Web.de. E-mails temporários não são aceites. Comunidade: https://t.me/+Fm72joLwb-tjYTZh'
  };
};

// --- ADMIN UPGRADES (BUNDLES) ---
// Concessão de pacotes / recompensas de pass: `grantAdminUpgradeRewardsInTx` e `grantPassRewardsInTx` em `models/adminUpgradeGrantModel.ts`.

app.get('/api/admin-upgrades', async (req, res) => {
  try {
    const list = await loadAdminUpgradesForUser(req.userId);
    res.json(list);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.get('/api/admin-upgrade-purchases/:email', authenticateToken, async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const email = normalizeEmailParam(req.params.email);
  if (isEmailParamInvalid(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  try {
    const uidRes = await db.query('SELECT id FROM users WHERE lower(trim(email::text)) = $1', [email]);
    if (!uidRes.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
    const uid = uidRes.rows[0].id;
    if (Number(uid) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const ids = await loadAdminUpgradePurchaseIdsForUser(Number(uid));
    res.json(ids);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin-upgrades', isAdmin, async (req, res) => {
  const u = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Upsert Parent
    await client.query(`
      INSERT INTO admin_upgrades (id, name, description, price_usdc, grant_usdc, grant_access_level_id, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
      name=$2, description=$3, price_usdc=$4, grant_usdc=$5, grant_access_level_id=$6, is_active=$7
    `, [u.id, u.name, u.description, u.priceUsdc, u.grantUsdc, u.grantAccessLevelId || null, u.isActive ? 1 : 0, Date.now()]);

    // Clear children
    await client.query('DELETE FROM admin_upgrade_items WHERE upgrade_id = $1', [u.id]);
    await client.query('DELETE FROM admin_upgrade_boxes WHERE upgrade_id = $1', [u.id]);
    await client.query('DELETE FROM admin_upgrade_passes WHERE upgrade_id = $1', [u.id]);
    await client.query('DELETE FROM admin_upgrade_coins WHERE upgrade_id = $1', [u.id]);
    await client.query('DELETE FROM admin_upgrade_visibility WHERE upgrade_id = $1', [u.id]);

    // Insert children
    for (const i of (u.items || [])) {
      await client.query('INSERT INTO admin_upgrade_items (upgrade_id, item_id, qty) VALUES ($1,$2,$3)', [u.id, i.itemId, i.qty]);
    }
    for (const b of (u.boxes || [])) {
      await client.query('INSERT INTO admin_upgrade_boxes (upgrade_id, box_id, qty) VALUES ($1,$2,$3)', [u.id, b.boxId, b.qty]);
    }
    for (const p of (u.passes || [])) {
      await client.query('INSERT INTO admin_upgrade_passes (upgrade_id, pass_id) VALUES ($1,$2)', [u.id, p]);
    }
    for (const c of (u.coins || [])) {
      await client.query('INSERT INTO admin_upgrade_coins (upgrade_id, coin_id, amount) VALUES ($1,$2,$3)', [u.id, c.coinId, c.amount]);
    }
    for (const vid of (u.visibleToAccessLevelIds || [])) {
      await client.query('INSERT INTO admin_upgrade_visibility (upgrade_id, access_level_id) VALUES ($1,$2)', [u.id, vid]);
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Failed to save admin upgrade', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

app.delete('/api/admin-upgrades/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  const purchased = await prisma.admin_upgrade_purchases.findFirst({
    where: { upgrade_id: String(id) },
    select: { user_id: true }
  });
  if (purchased) {
    return res.status(400).send('Este upgrade já foi comprado por usuários e não pode ser excluído.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM admin_upgrade_items WHERE upgrade_id = $1', [id]);
    await client.query('DELETE FROM admin_upgrade_boxes WHERE upgrade_id = $1', [id]);
    await client.query('DELETE FROM admin_upgrade_passes WHERE upgrade_id = $1', [id]);
    await client.query('DELETE FROM admin_upgrade_coins WHERE upgrade_id = $1', [id]);

    const delRes = await client.query('DELETE FROM admin_upgrades WHERE id = $1 RETURNING id', [id]);

    await client.query('COMMIT');
    if (delRes.rowCount === 0) return res.status(404).send('Upgrade não encontrado');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Failed to delete admin upgrade', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

app.post('/api/admin-upgrades/purchase', async (req, res) => {
  const { upgradeId } = req.body;
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (!upgradeId) return res.status(400).json({ error: 'Missing fields' });

  const uid = req.userId;
  try {
    const newUsdc = await prisma.$transaction(
      async (tx) => {
        const user = await tx.users.findUnique({
          where: { id: uid },
          select: { id: true, access_level_id: true }
        });
        if (!user) throw new Error('Usuário não encontrado');

        const gs = await tx.game_states.findUnique({
          where: { user_id: uid },
          select: { usdc: true }
        });
        const usdc = Number(gs?.usdc ?? 0);

        const upgrade = await tx.admin_upgrades.findUnique({
          where: { id: String(upgradeId) }
        });
        if (!upgrade) throw new Error('Upgrade não encontrado');
        if (!upgrade.is_active) throw new Error('Upgrade inativo/expirado');

        const dup = await tx.admin_upgrade_purchases.findUnique({
          where: { user_id_upgrade_id: { user_id: uid, upgrade_id: upgrade.id } }
        });
        if (dup) throw new Error('Você já possui este upgrade');

        if (
          upgrade.grant_access_level_id &&
          user.access_level_id === upgrade.grant_access_level_id
        ) {
          throw new Error(`Você já possui o nível de acesso ${upgrade.grant_access_level_id}`);
        }

        if (String(upgradeId) === '53f0c699-0471-4e65-a147-17064e3aafe0') {
          const room = await tx.user_rig_rooms.findUnique({
            where: { user_id_room_id: { user_id: uid, room_id: 'room_1765936323521' } }
          });
          if (room) throw new Error('Você já possui a Sala Gênesis deste pacote.');
        }

        const price = Number(upgrade.price_usdc);
        if (usdc < price) {
          throw new HttpControlledError(400, {
            ok: false,
            error: 'Saldo insuficiente',
            missing: price - usdc
          });
        }

        await tx.game_states.updateMany({
          where: { user_id: uid },
          data: { usdc: { decrement: price } }
        });

        await tx.admin_upgrade_purchases.create({
          data: {
            user_id: uid,
            upgrade_id: upgrade.id,
            purchased_at: BigInt(Date.now())
          }
        });

        await grantAdminUpgradeRewardsInTx(uid, upgrade.id, tx);

        const final = await tx.game_states.findUnique({
          where: { user_id: uid },
          select: { usdc: true }
        });
        return Number(final?.usdc ?? 0);
      },
      { timeout: 60_000, maxWait: 10_000 }
    );

    res.json({ ok: true, newUsdc });
  } catch (e) {
    if (respondIfHttpControlledError(res, e)) return;
    console.error('Purchase error:', e);
    sendInternalErrorShapeOrPrisma(res, 'admin-upgrade-purchase', e, { ok: false }, 'Erro ao processar a compra.');
  }
});

// --- UPGRADES ---
app.get('/api/upgrades', async (req, res) => {
  try {
    let isAdminUser = false;
    if (req.userId) {
      const uRow = await prisma.users.findUnique({
        where: { id: req.userId },
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

    const compatMap = compatRows.reduce((acc, r) => {
      acc[r.upgrade_id] = acc[r.upgrade_id] || [];
      acc[r.upgrade_id].push(r.rack_id);
      return acc;
    }, {});
    const upgrades = rows.map(r => ({
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
      layout: r.layout ? (() => { try { return JSON.parse(r.layout); } catch { return undefined; } })() : undefined,
      compatibleRacks: compatMap[r.id] || [],
      rewardWh: r.reward_wh ?? 0,
      sellInHardwareMarket: r.sell_in_hardware_market !== 0,
      sellInBlackMarket: r.sell_in_black_market !== 0,
      isActive: r.is_active !== 0
    }));
    res.json(upgrades);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/upgrades', isAdmin, async (req, res) => {
  const upgrades = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Get all current IDs to track what needs to be deleted
    const currentRes = await client.query('SELECT id FROM upgrades');
    const existingIds = new Set(currentRes.rows.map(r => r.id));
    const incomingIds = new Set(upgrades.map(u => u.id));

    // 2. UPSERT incoming items
    for (const u of upgrades) {
      await client.query(`
        INSERT INTO upgrades (
          id,name,category,type,base_cost,base_production,power_consumption,power_capacity,
          multiplier,slots_capacity,ai_slots_capacity,description,icon,status,is_nft,
          nft_contract,nft_token_id,max_global_stock,image,layout,reward_wh,
          sell_in_hardware_market,sell_in_black_market,is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, category=EXCLUDED.category, type=EXCLUDED.type,
          base_cost=EXCLUDED.base_cost, base_production=EXCLUDED.base_production,
          power_consumption=EXCLUDED.power_consumption, power_capacity=EXCLUDED.power_capacity,
          multiplier=EXCLUDED.multiplier, slots_capacity=EXCLUDED.slots_capacity,
          ai_slots_capacity=EXCLUDED.ai_slots_capacity, description=EXCLUDED.description,
          icon=EXCLUDED.icon, status=EXCLUDED.status, is_nft=EXCLUDED.is_nft,
          nft_contract=EXCLUDED.nft_contract, nft_token_id=EXCLUDED.nft_token_id,
          max_global_stock=EXCLUDED.max_global_stock, image=EXCLUDED.image,
          layout=EXCLUDED.layout, reward_wh=EXCLUDED.reward_wh,
          sell_in_hardware_market=EXCLUDED.sell_in_hardware_market,
          sell_in_black_market=EXCLUDED.sell_in_black_market,
          is_active=EXCLUDED.is_active
      `, [
        u.id, u.name, u.category, u.type, u.baseCost, u.baseProduction,
        u.powerConsumption ?? null, u.powerCapacity ?? null, u.multiplier ?? null,
        u.slotsCapacity ?? null, u.aiSlotsCapacity ?? null, u.description,
        (u.icon || '📦'), u.status, u.isNft ? 1 : 0, u.nftContract ?? null,
        u.nftTokenId ?? null, u.maxGlobalStock ?? null, u.image ?? null,
        u.layout ? JSON.stringify(u.layout) : null, u.rewardWh ?? 0,
        u.sellInHardwareMarket !== false ? 1 : 0, u.sellInBlackMarket !== false ? 1 : 0, u.isActive !== false ? 1 : 0
      ]);

      // Update compatibility (delete all for this item, then re-insert)
      await client.query('DELETE FROM upgrade_compat_racks WHERE upgrade_id = $1', [u.id]);
      for (const rid of (u.compatibleRacks || [])) {
        await client.query('INSERT INTO upgrade_compat_racks (upgrade_id, rack_id) VALUES ($1, $2)', [u.id, rid]);
      }
    }

    // 3. Delete items that are no longer present (SAFE DELETE)
    const legacyProtectRes = await client.query(
      `SELECT id FROM upgrades WHERE id ~ '^temp_legacy_' OR category = 'legacy-temp'`
    );
    const protectedUpgradeIds = new Set(legacyProtectRes.rows.map((r: { id: string }) => r.id));

    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
        if (protectedUpgradeIds.has(id)) {
          continue;
        }
        try {
          // Identify constraints before deleting? No, try/catch is safer for race conditions
          // Force delete references in compat table first (optimization)
          await client.query('DELETE FROM upgrade_compat_racks WHERE upgrade_id = $1', [id]);
          await client.query('DELETE FROM upgrades WHERE id = $1', [id]);
        } catch (err) {
          console.warn(`[Upgrades] Could not delete pending removal item ${id}: ${err.message}`);
          // Optional: Mark as legacy/deprecated instead?
          await client.query("UPDATE upgrades SET status='legacy', sell_in_hardware_market=0, sell_in_black_market=0 WHERE id=$1", [id]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[Upgrades API] Error saving upgrades:', e);
    sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno ao salvar upgrades.');
  } finally {
    client.release();
  }
});

app.post('/api/upgrades/buy', async (req, res) => {
  const { cart } = req.body || {};
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) {
    return res.status(400).json({ error: 'Carrinho vazio ou inválido' });
  }

  const entries = Object.entries(cart);
  if (entries.length === 0 || entries.length > 100) {
    return res.status(400).json({ error: 'Carrinho inválido' });
  }

  const ID_RE = /^[a-zA-Z0-9_.-]{1,160}$/;
  const MAX_LINE_QTY = 50000;
  for (const [id, rawQty] of entries) {
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Item inválido no carrinho.' });
    const q = Number(rawQty);
    if (!Number.isInteger(q) || q < 1 || q > MAX_LINE_QTY) {
      return res.status(400).json({ error: 'Quantidade inválida.' });
    }
  }

  const hwVal = await getSettingValue('hardware_market_enabled');
  if (hwVal != null && hwVal !== '1') {
    return res.status(403).json({ error: 'Mercado de hardware pausado.' });
  }

  const client = await db.connect();
  try {
    const uid = req.userId;
    await client.query('BEGIN');

    const upgradeIds = Object.keys(cart).sort();
    const upgradesRes = await client.query(
      `SELECT id, base_cost, name, sell_in_hardware_market, status, max_global_stock, total_sold,
              COALESCE(is_active, 1) AS ia, COALESCE(is_nft, 0) AS is_nft
       FROM upgrades WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [upgradeIds]
    );
    if (upgradesRes.rows.length !== upgradeIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Um ou mais itens do carrinho não existem.' });
    }

    let totalCost = 0;
    const itemsToBuy = [];
    const limitedItemsToUpdate = [];

    for (const [id, rawQty] of Object.entries(cart)) {
      const qty = Number(rawQty);
      const u = upgradesRes.rows.find(x => x.id === id);
      if (!u) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Item inválido: ${id}` });
      }
      if (Number(u.ia) === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Item indisponível: ${u.name}` });
      }
      if (u.sell_in_hardware_market === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Item não disponível para venda: ${u.name}` });
      }
      if (Number(u.is_nft) === 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Itens NFT não podem ser comprados na Lojinha com USDC. Usa os fluxos de carteira / NFT do jogo.'
        });
      }

      if (u.status === 'limited') {
        const available = (Number(u.max_global_stock) || 0) - (Number(u.total_sold) || 0);
        if (available < qty) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Estoque insuficiente para ${u.name}. Restam ${available}.` });
        }
        limitedItemsToUpdate.push({ id: u.id, qty });
      }

      const unit = Number(u.base_cost);
      if (!Number.isFinite(unit) || unit < 0 || unit > 1e12) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Preço de item inválido.' });
      }
      const cost = unit * qty;
      if (!Number.isFinite(cost) || cost < 0 || cost > 1e15) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Valor de compra inválido.' });
      }
      totalCost += cost;
      itemsToBuy.push({ id, qty, name: u.name });
    }

    const gsRes = await client.query('SELECT usdc FROM game_states WHERE user_id = $1 FOR UPDATE', [uid]);
    const currentUsdc = Number(gsRes.rows[0]?.usdc) || 0;
    if (currentUsdc < totalCost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Saldo insuficiente', missing: totalCost - currentUsdc });
    }

    const newUsdc = currentUsdc - totalCost;
    const now = Date.now();
    const deductRes = await client.query(
      `UPDATE game_states SET usdc = $1, last_updated_at = $2, server_updated_at = $2
       WHERE user_id = $3 AND usdc >= $4`,
      [newUsdc, now, uid, totalCost]
    );
    if (deductRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    for (const lim of limitedItemsToUpdate) {
      const updateRes = await client.query(
        `UPDATE upgrades SET total_sold = total_sold + $1
         WHERE id = $2 AND (max_global_stock - total_sold) >= $1`,
        [lim.qty, lim.id]
      );
      if (updateRes.rowCount === 0) {
        throw Object.assign(
          new Error('Este item esgotou enquanto confirmavas a compra. Atualiza a página e tenta de novo.'),
          { buyClientError: true, httpStatus: 409 }
        );
      }
    }

    for (const item of itemsToBuy) {
      await client.query(
        `INSERT INTO stock (user_id, item_id, qty) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_id) DO UPDATE SET qty = stock.qty + EXCLUDED.qty`,
        [uid, item.id, item.qty]
      );
    }

    await client.query('COMMIT');

    const unameRes = await db.query('SELECT username FROM users WHERE id = $1', [uid]);
    const username = unameRes.rows[0]?.username || '';
    console.log('[HardwareBuy] ts=%s userId=%s username=%s totalUsdc=%s newUsdc=%s lines=%s',
      new Date().toISOString(),
      uid,
      username,
      totalCost.toFixed(6),
      newUsdc.toFixed(6),
      JSON.stringify(itemsToBuy.map((i) => ({ id: i.id, qty: i.qty, name: i.name })))
    );
    await appendGameActivityLog(db, uid, 'hardware_buy', {
      totalUsdc: Number(totalCost.toFixed(6)),
      newUsdc: Number(newUsdc.toFixed(6)),
      lines: itemsToBuy.map((i) => ({ id: i.id, qty: i.qty, name: i.name }))
    });

    res.json({ ok: true, newUsdc });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    const err = e as { buyClientError?: boolean; httpStatus?: number; message?: string };
    if (err && err.buyClientError && typeof err.message === 'string') {
      return res.status(Number.isInteger(err.httpStatus) ? err.httpStatus : 400).json({ error: err.message });
    }
    console.error('[BuyUpgrades] Error:', e);
    sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao processar compra.');
  } finally {
    client.release();
  }
});

async function fetchMonetizationSettingsObject() {
  const s = await getSettingsRecord([
    'applixir_enabled',
    'applixir_site_id',
    'applixir_zone_id',
    'applixir_account_id',
    'applixir_reward_message',
    'applixir_callback_secret',
    'ezoic_enabled',
    'ezoic_publisher_id',
    'ezoic_app_id',
    'ezoic_placeholder_id'
  ]);
  return {
    applixirEnabled: s.applixir_enabled === '1',
    applixirSiteId: s.applixir_site_id || '',
    applixirZoneId: s.applixir_zone_id || '',
    applixirAccountId: s.applixir_account_id || '',
    applixirRewardMessage: s.applixir_reward_message || 'Parabéns! Você ganhou {reward} W/h',
    applixirCallbackSecret: s.applixir_callback_secret || '',
    ezoicEnabled: s.ezoic_enabled === '1',
    ezoicPublisherId: s.ezoic_publisher_id || '',
    ezoicAppId: s.ezoic_app_id || '',
    ezoicPlaceholderId: s.ezoic_placeholder_id || ''
  };
}

/** Público: nunca envia applixirCallbackSecret (validação de reward fica no servidor). */
app.get('/api/monetization-settings', async (req, res) => {
  try {
    const settings = await fetchMonetizationSettingsObject();
    const { applixirCallbackSecret: _omit, ...publicSettings } = settings;
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(publicSettings);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.get('/api/admin/monetization-settings', isAdmin, async (req, res) => {
  try {
    const settings = await fetchMonetizationSettingsObject();
    res.setHeader('Cache-Control', 'no-store');
    res.json(settings);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/monetization-settings', isAdmin, async (req, res) => {
  const {
    applixirEnabled, applixirSiteId, applixirZoneId, applixirAccountId, applixirRewardMessage, applixirCallbackSecret,
    ezoicEnabled, ezoicPublisherId, ezoicAppId, ezoicPlaceholderId
  } = req.body || {};

  try {
    await upsertSettingsEntries([
      { key: 'applixir_enabled', value: applixirEnabled ? '1' : '0' },
      { key: 'applixir_site_id', value: String(applixirSiteId || '') },
      { key: 'applixir_zone_id', value: String(applixirZoneId || '') },
      { key: 'applixir_account_id', value: String(applixirAccountId || '') },
      {
        key: 'applixir_reward_message',
        value:
          typeof applixirRewardMessage === 'string'
            ? applixirRewardMessage
            : 'Parabéns! Você ganhou {reward} W/h'
      },
      { key: 'applixir_callback_secret', value: typeof applixirCallbackSecret === 'string' ? applixirCallbackSecret : '' },
      { key: 'ezoic_enabled', value: ezoicEnabled ? '1' : '0' },
      { key: 'ezoic_publisher_id', value: String(ezoicPublisherId || '') },
      { key: 'ezoic_app_id', value: String(ezoicAppId || '') },
      { key: 'ezoic_placeholder_id', value: String(ezoicPlaceholderId || '') }
    ]);
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- SYSTEM TIME & DAILY ACTIONS ---
app.get('/api/system/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

app.post('/api/daily-boost', async (req, res) => {
  const { slotIndex } = req.body;

  if (!req.userId) return res.status(401).json({ error: 'Não autorizado' });
  if (slotIndex === undefined) return res.status(400).json({ error: 'slotIndex ausente' });
  const slotIdx = Number(slotIndex);
  if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx > 5) {
    return res.status(400).json({ error: 'Índice de bancada inválido.' });
  }

  const uid = req.userId;
  if (!uid) return res.status(404).json({ error: 'User not found' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const slotRes = await client.query('SELECT * FROM workshop_slots WHERE user_id = $1 AND slot_index = $2', [uid, slotIdx]);
    const slot = slotRes.rows[0];

    if (!slot || !slot.item_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nenhum carregador equipado neste slot.' });
    }

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
    const actionKey = `daily_boost_slot_${slotIdx}`;

    const actionRes = await client.query('SELECT last_performed_at FROM daily_actions WHERE user_id = $1 AND action_key = $2', [uid, actionKey]);
    const lastPerformed = actionRes.rows[0]?.last_performed_at;

    // DETAILED LOGGING for debugging (commented for production)
    // console.log(`[DailyBoost] User: ${uid}, Slot: ${slotIndex}`);
    // console.log(`[DailyBoost] ActionKey: ${actionKey}`);
    // console.log(`[DailyBoost] LastPerformed: ${lastPerformed} (${lastPerformed ? new Date(Number(lastPerformed)).toISOString() : 'NONE'})`);
    // console.log(`[DailyBoost] StartOfDay (UTC): ${startOfDay} (${new Date(startOfDay).toISOString()})`);
    // console.log(`[DailyBoost] Can use? ${!lastPerformed || Number(lastPerformed) < startOfDay}`);

    if (lastPerformed && Number(lastPerformed) >= startOfDay) {
      await client.query('ROLLBACK');
      // console.warn(`[DailyBoost] BLOCKED: User ${uid} already used boost for slot ${slotIndex} today`);
      return res.status(400).json({ error: 'Você já usou o boost para este carregador hoje.' });
    }

    const upgRes = await client.query('SELECT power_capacity FROM upgrades WHERE id = $1', [slot.item_id]);
    const upg = upgRes.rows[0];
    const maxCap = upg?.power_capacity || 1000;

    const newCharge = maxCap;
    const boostAmount = maxCap - (slot.current_charge || 0);

    await client.query('INSERT INTO daily_actions (user_id, action_key, last_performed_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, action_key) DO UPDATE SET last_performed_at = EXCLUDED.last_performed_at', [uid, actionKey, Date.now()]);
    await client.query('UPDATE workshop_slots SET current_charge = $1 WHERE user_id = $2 AND slot_index = $3', [newCharge, uid, slotIdx]);

    await client.query('COMMIT');
    res.json({ ok: true, newCharge, boostAmount });
  } catch (e) {
    await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

// ADMIN: Reset Daily Boost for specific user/slot
app.post('/api/admin/reset-daily-boost', isAdmin, async (req, res) => {
  const { email, slotIndex } = req.body;

  if (!email || slotIndex === undefined) {
    return res.status(400).json({ error: 'Email and slotIndex required' });
  }

  try {
    const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userRes.rows[0].id;
    const actionKey = `daily_boost_slot_${slotIndex}`;

    // Delete the daily action record to allow boost again
    const result = await db.query('DELETE FROM daily_actions WHERE user_id = $1 AND action_key = $2', [userId, actionKey]);

    res.json({
      ok: true,
      message: `Daily boost reset for ${email} slot ${slotIndex}`,
      deletedRows: result.rowCount
    });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// ADMIN: Get user's unopened boxes
app.get('/api/admin/user-boxes', isAdmin, async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userRes.rows[0].id;

    // Get all unopened boxes for this user
    const boxesRes = await db.query(`
      SELECT box_id, qty
      FROM unopened_boxes
      WHERE user_id = $1
      ORDER BY qty DESC
    `, [userId]);

    res.json({ boxes: boxesRes.rows });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// ADMIN: Delete a specific box from user's inventory
app.post('/api/admin/delete-user-box', isAdmin, async (req, res) => {
  const { email, boxId } = req.body;

  if (!email || !boxId) {
    return res.status(400).json({ error: 'Email and boxId required' });
  }

  try {
    const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userRes.rows[0].id;

    // Delete the box
    const result = await db.query(`
      DELETE FROM unopened_boxes
      WHERE user_id = $1 AND box_id = $2
      RETURNING qty
    `, [userId, boxId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Box not found in user inventory' });
    }

    res.json({
      ok: true,
      message: `Deleted ${result.rows[0].qty}x box ${boxId} from ${email}`,
      deletedQty: result.rows[0].qty
    });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});


function timingSafeSecretEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Applixir S2S Callback — preferir header (evita segredo em URL / logs de proxy); query mantida por compatibilidade.
app.get('/api/applixir-callback', async (req, res) => {
  const { userId } = req.query;
  try {
    const dbSecret = String((await getSettingValue('applixir_callback_secret')) || '');
    if (!dbSecret) return res.status(503).send('Callback not configured');

    const hdrRaw =
      req.headers['x-applixir-callback-secret'] ||
      req.headers['x-applixir-secret'] ||
      req.headers['x-callback-secret'];
    const hdr = typeof hdrRaw === 'string' ? hdrRaw.trim() : '';
    const q = req.query.secretKey;
    const fromQuery = typeof q === 'string' ? q : Array.isArray(q) ? String(q[0] ?? '') : '';
    const provided = hdr || fromQuery;

    if (!timingSafeSecretEqual(provided, dbSecret)) return res.status(403).send('Invalid Secret');
    if (!userId) return res.status(400).send('Missing userId');
    const userIdNum = parseInt(String(userId), 10);
    if (!Number.isFinite(userIdNum) || userIdNum < 1) return res.status(400).send('Invalid userId');

    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userIdNum]);
    if (!userRes.rows[0]) return res.status(404).send('User not found');

    const wsIdx = Number(req.query.custom);
    if (Number.isInteger(wsIdx) && wsIdx >= 0 && wsIdx <= 5) {
      const rowRes = await db.query('SELECT item_id FROM workshop_slots WHERE user_id = $1 AND slot_index = $2', [userIdNum, wsIdx]);
      const row = rowRes.rows[0];
      if (row && row.item_id) {
        const nowCb = new Date();
        const startOfDay = new Date(Date.UTC(nowCb.getUTCFullYear(), nowCb.getUTCMonth(), nowCb.getUTCDate())).getTime();
        const actionKey = `reward_ad_slot_${wsIdx}`;
        const actionRes = await db.query('SELECT last_performed_at FROM daily_actions WHERE user_id = $1 AND action_key = $2', [userIdNum, actionKey]);
        const lastPerformed = actionRes.rows[0]?.last_performed_at;
        if (!lastPerformed || Number(lastPerformed) < startOfDay) {
          const upgRes = await db.query('SELECT power_capacity FROM upgrades WHERE id = $1', [row.item_id]);
          const maxCap = upgRes.rows[0]?.power_capacity || 1000;

          await db.query('UPDATE workshop_slots SET current_charge = $1 WHERE user_id = $2 AND slot_index = $3', [maxCap, userIdNum, wsIdx]);
          await db.query(
            'INSERT INTO daily_actions (user_id, action_key, last_performed_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, action_key) DO UPDATE SET last_performed_at = EXCLUDED.last_performed_at',
            [userIdNum, actionKey, Date.now()]
          );
        }
      }
    }
    res.send('OK');
  } catch (e) {
    res.status(500).send('Error');
  }
});

app.post('/api/workshop/recharge', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const wsIdx = Number(req.body?.wsIdx);
  if (!Number.isInteger(wsIdx) || wsIdx < 0 || wsIdx > 5) {
    return res.status(400).json({ error: 'Índice de bancada inválido.' });
  }

  const uid = req.userId;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const slotRes = await client.query('SELECT item_id FROM workshop_slots WHERE user_id = $1 AND slot_index = $2', [uid, wsIdx]);
    const slot = slotRes.rows[0];
    if (!slot || !slot.item_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nenhum carregador neste slot.' });
    }

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
    const actionKey = `instant_recharge_slot_${wsIdx}`;
    const actionRes = await client.query('SELECT last_performed_at FROM daily_actions WHERE user_id = $1 AND action_key = $2', [uid, actionKey]);
    const lastPerformed = actionRes.rows[0]?.last_performed_at;
    if (lastPerformed && Number(lastPerformed) >= startOfDay) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'O limite diário de recarga instantânea nesta bancada já foi utilizado. Volte amanhã (UTC) ou use o boost diário / anúncio.'
      });
    }

    const upgRes = await client.query('SELECT power_capacity FROM upgrades WHERE id = $1', [slot.item_id]);
    const maxCap = upgRes.rows[0]?.power_capacity || 1000;

    await client.query(
      'INSERT INTO daily_actions (user_id, action_key, last_performed_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, action_key) DO UPDATE SET last_performed_at = EXCLUDED.last_performed_at',
      [uid, actionKey, Date.now()]
    );
    await client.query('UPDATE workshop_slots SET current_charge = $1 WHERE user_id = $2 AND slot_index = $3', [maxCap, uid, wsIdx]);
    await client.query('COMMIT');
    res.json({ ok: true, newCharge: maxCap });
  } catch (e) {
    await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

app.post('/api/reward-ad', async (req, res) => {
  const { wsIdx: wsIdxRaw } = req.body || {};
  if (!req.userId || wsIdxRaw === undefined) return res.status(400).json({ error: 'Missing fields' });
  const wsIdx = Number(wsIdxRaw);
  if (!Number.isInteger(wsIdx) || wsIdx < 0 || wsIdx > 5) {
    return res.status(400).json({ error: 'Índice de bancada inválido.' });
  }

  const uid = req.userId;
  if (!uid) return res.status(404).json({ error: 'User not found' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const slotRes = await client.query('SELECT * FROM workshop_slots WHERE user_id = $1 AND slot_index = $2', [uid, wsIdx]);
    const slot = slotRes.rows[0];

    if (!slot || !slot.item_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nenhum carregador equipado neste slot.' });
    }

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
    const actionKey = `reward_ad_slot_${wsIdx}`;

    const actionRes = await client.query('SELECT last_performed_at FROM daily_actions WHERE user_id = $1 AND action_key = $2', [uid, actionKey]);
    const lastPerformed = actionRes.rows[0]?.last_performed_at;

    if (lastPerformed && Number(lastPerformed) >= startOfDay) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Limite diário atingido para este carregador.' });
    }

    const upgRes = await client.query('SELECT power_capacity FROM upgrades WHERE id = $1', [slot.item_id]);
    const maxCap = upgRes.rows[0]?.power_capacity || 1000;

    await client.query('INSERT INTO daily_actions (user_id, action_key, last_performed_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, action_key) DO UPDATE SET last_performed_at = EXCLUDED.last_performed_at', [uid, actionKey, Date.now()]);
    await client.query('UPDATE workshop_slots SET current_charge = $1 WHERE user_id = $2 AND slot_index = $3', [maxCap, uid, wsIdx]);

    await client.query('COMMIT');

    const rewardMsg =
      (await getSettingValue('applixir_reward_message')) || 'Parabéns! Sua estação foi totalmente carregada.';

    res.json({ ok: true, newCharge: maxCap, rewardMsg });
  } catch (e) {
    await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

// --- WEB3 DEPOSIT VERIFICATION (RPC + Polygonscan/Bscscan/Basescan + fila app_cache) ---
const POLYGON_USDC_CONTRACTS = [
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC nativo (Circle) Polygon PoS
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' // USDC.e (bridged)
];

async function fetchWithTimeout(url, options = {}, timeoutMs = 22000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const depositExplorerApi = (net) => {
  const n = (net || 'polygon').toLowerCase();
  if (n === 'polygon') return 'https://api.polygonscan.com/api';
  if (n === 'bnb' || n === 'bsc') return 'https://api.bscscan.com/api';
  if (n === 'base') return 'https://api.basescan.org/api';
  return null;
};

/** JSON-RPC público do Blockscout — não exige API key (o módulo `proxy` da API REST devolve 400 nestas instâncias). */
const depositBlockscoutEthRpcUrl = (net) => {
  const n = (net || 'polygon').toLowerCase();
  if (n === 'polygon') return 'https://polygon.blockscout.com/api/eth-rpc';
  if (n === 'bnb' || n === 'bsc') return 'https://bsc.blockscout.com/api/eth-rpc';
  if (n === 'base') return 'https://base.blockscout.com/api/eth-rpc';
  return null;
};

function parseProxyEthReceiptResponse(j) {
  if (!j || typeof j !== 'object') return null;
  if (String(j.status || '') === '0' && j.message && !j.result) return null;
  let result = j.result;
  if (typeof result === 'string') {
    try {
      result = result && result !== 'null' ? JSON.parse(result) : null;
    } catch {
      result = null;
    }
  }
  if (!result) return null;
  return { result };
}

async function fetchDepositReceiptRpc(rpcUrl, txHash) {
  try {
    const rpcRes = await fetchWithTimeout(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [txHash], id: 1 })
      },
      22000
    );
    const j = await rpcRes.json();
    if (j && j.error) {
      console.warn('[DepositVerify] RPC receipt error', rpcUrl.slice(0, 40), j.error.message || j.error);
      return null;
    }
    if (j && j.result) return j;
  } catch (e) {
    console.warn('[DepositVerify] RPC receipt:', e.message);
  }
  return null;
}

/** URLs extra quando o RPC principal (ex.: polygon-rpc.com) falha ou limita. */
function buildDepositRpcCandidates(net, primaryUrl) {
  const primary = String(primaryUrl || '').trim();
  const list = [];
  const seen = new Set();
  const add = (u) => {
    const x = String(u || '').trim().replace(/\/+$/, '');
    if (!x || seen.has(x)) return;
    seen.add(x);
    list.push(x);
  };
  add(primary);
  const n = (net || '').toLowerCase();
  if (n === 'polygon') {
    add('https://polygon-bor-rpc.publicnode.com');
    add('https://1rpc.io/matic');
    add('https://polygon.drpc.org');
  } else if (n === 'bnb' || n === 'bsc') {
    add('https://bsc-dataseed1.binance.org');
    add('https://bsc-dataseed2.binance.org');
    add('https://bsc.publicnode.com');
  } else if (n === 'base') {
    add('https://base.publicnode.com');
    add('https://1rpc.io/base');
  }
  return list;
}

async function fetchDepositReceiptExplorer(net, txHash) {
  const apiKey = String(process.env.ETHERSCAN_API_KEY || '').trim();
  if (!apiKey) return null;
  const base = depositExplorerApi(net);
  if (!base) return null;
  try {
    const url = `${base}?module=proxy&action=eth_getTransactionReceipt&txhash=${encodeURIComponent(txHash)}&apikey=${encodeURIComponent(apiKey)}`;
    const r = await fetchWithTimeout(url, {}, 22000);
    const j = await r.json();
    return parseProxyEthReceiptResponse(j);
  } catch (e) {
    console.warn('[DepositVerify] Explorer receipt:', e.message);
    return null;
  }
}

async function fetchDepositReceiptBlockscout(net, txHash) {
  const rpcUrl = depositBlockscoutEthRpcUrl(net);
  if (!rpcUrl) return null;
  try {
    const rpcRes = await fetchWithTimeout(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [txHash], id: 1 })
      },
      22000
    );
    const j = await rpcRes.json();
    if (j && j.error) {
      console.warn('[DepositVerify] Blockscout eth-rpc:', j.error.message || j.error);
      return null;
    }
    if (j && j.result) return j;
  } catch (e) {
    console.warn('[DepositVerify] Blockscout eth-rpc:', e.message);
  }
  return null;
}

async function fetchDepositReceiptUnified(net, rpcUrl, txHash) {
  const h = String(txHash || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(h)) return null;
  // 1) Blockscout eth-rpc — sem API key; costuma ser o mais fiável a partir de VPS
  const fromBlockscout = await fetchDepositReceiptBlockscout(net, h);
  if (fromBlockscout && fromBlockscout.result) return fromBlockscout;
  // 2) Polygonscan / Bscscan / Basescan (requer ETHERSCAN_API_KEY)
  const fromExplorer = await fetchDepositReceiptExplorer(net, h);
  if (fromExplorer && fromExplorer.result) return fromExplorer;
  // 3) RPC públicos + o configurado em POLYGON_RPC / BNB_RPC / BASE_RPC
  for (const url of buildDepositRpcCandidates(net, rpcUrl)) {
    const r = await fetchDepositReceiptRpc(url, h);
    if (r && r.result) return r;
  }
  return null;
}

function settingsFlagEnabled(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function isDepositNetworkDisabledInSettings(settings, network) {
  const n = (network || 'polygon').toLowerCase();
  if (n === 'polygon' || n === 'matic') return settingsFlagEnabled(settings.web3_deposit_polygon_disabled);
  if (n === 'bnb' || n === 'bsc') return settingsFlagEnabled(settings.web3_deposit_bnb_disabled);
  if (n === 'base') return settingsFlagEnabled(settings.web3_deposit_base_disabled);
  return true;
}

async function loadDepositSettings() {
  const keys = [
    'web3_deposit_wallet', 'web3_deposit_token_contract',
    'web3_deposit_token_contract_bnb', 'web3_deposit_token_contract_base',
    'web3_min_deposit_usdc',
    'web3_deposit_polygon_disabled',
    'web3_deposit_bnb_disabled',
    'web3_deposit_base_disabled'
  ];
  return getSettingsRecord(keys);
}

function resolveDepositNetwork(settings, network) {
  const net = (network || 'polygon').toLowerCase();
  let usdcContract = '';
  let rpcUrl = '';
  if (net === 'polygon') {
    usdcContract = (settings.web3_deposit_token_contract || '').toLowerCase().trim();
    rpcUrl = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
  } else if (net === 'bnb' || net === 'bsc') {
    usdcContract = (settings.web3_deposit_token_contract_bnb || '').toLowerCase().trim();
    rpcUrl = process.env.BNB_RPC || 'https://bsc-dataseed.binance.org/';
  } else if (net === 'base') {
    usdcContract = (settings.web3_deposit_token_contract_base || '').toLowerCase().trim();
    rpcUrl = process.env.BASE_RPC || 'https://mainnet.base.org';
  } else {
    return { error: 'Rede não suportada: ' + net };
  }
  const targetWallet = (settings.web3_deposit_wallet || '').toLowerCase().trim();
  if (!targetWallet || !usdcContract) {
    return { error: 'Configuração de depósito incompleta no servidor para ' + net };
  }
  return { net, targetWallet, usdcContract, rpcUrl };
}

async function queueDepositPending(txHash, payload) {
  const key = `deposit_pending:${txHash}`;
  await db.query(
    `INSERT INTO app_cache (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [key, JSON.stringify(payload)]
  );
}

/** Credita USDC a partir de um receipt já obtido (idempotente via daily_actions.tx_*). */
async function tryCreditDepositFromReceipt(uid, txHash, net, settings, receipt) {
  if (isDepositNetworkDisabledInSettings(settings, net)) {
    return { ok: false, error: 'Depósitos nesta rede estão desativados pelo administrador.' };
  }
  const resolved = resolveDepositNetwork(settings, net);
  if (resolved.error) return { ok: false, error: resolved.error };
  const { targetWallet, usdcContract, rpcUrl } = resolved;

  if (!receipt || !receipt.result) {
    return { ok: false, pending: true, error: 'receipt_missing' };
  }

  if (receipt.result.status !== '0x1' && receipt.result.status !== 1) {
    return { ok: false, error: 'Transação falhou na blockchain ' + net };
  }

  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const targetTopic2 = targetWallet.replace(/^0x/, '').padStart(64, '0').toLowerCase();
  const netLower = (net || '').toLowerCase();
  const contractCandidates =
    netLower === 'polygon' || netLower === 'matic'
      ? [...new Set([usdcContract, ...POLYGON_USDC_CONTRACTS].filter(Boolean))]
      : [usdcContract];

  let matchedLog = null;
  let matchedTokenContract = '';
  for (const c of contractCandidates) {
    const hit = (receipt.result.logs || []).find((l) => {
      const addrMatch = l.address && l.address.toLowerCase() === c;
      const topicMatch = l.topics && l.topics[0] === transferTopic;
      const destMatch = l.topics && l.topics[2] && l.topics[2].toLowerCase().includes(targetTopic2);
      return addrMatch && topicMatch && destMatch;
    });
    if (hit) {
      matchedLog = hit;
      matchedTokenContract = c;
      break;
    }
  }

  if (!matchedLog) {
    return { ok: false, error: 'Transação inválida: contrato ou destino incorretos na rede ' + net };
  }

  const walletRow = await db.query(
    "SELECT lower(trim(COALESCE(polygon_wallet::text, ''))) AS w FROM users WHERE id = $1",
    [uid]
  );
  const userWallet = walletRow.rows[0]?.w || '';
  if (!userWallet || !/^0x[a-f0-9]{40}$/.test(userWallet)) {
    return {
      ok: false,
      error: 'Regista a carteira Polygon no perfil; só podes validar depósitos enviados dessa carteira.'
    };
  }
  const topicAddr = (t) => {
    if (!t || typeof t !== 'string') return '';
    const s = t.toLowerCase();
    if (!s.startsWith('0x') || s.length < 42) return '';
    return `0x${s.slice(-40)}`;
  };
  const transferFromAddr = topicAddr(matchedLog.topics[1]);
  if (!transferFromAddr || transferFromAddr !== userWallet) {
    return {
      ok: false,
      error: 'Este envio não foi feito pela carteira ligada ao teu perfil (remetente do token não coincide).'
    };
  }

  let decimals = (net === 'bnb' || net === 'bsc') ? 18 : 6;
  try {
    const decRes = await fetchWithTimeout(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to: matchedTokenContract, data: '0x313ce567' }, 'latest'],
          id: 2
        })
      },
      15000
    );
    const decData = await decRes.json();
    if (decData && decData.result && decData.result !== '0x') {
      const parsedDec = parseInt(decData.result, 16);
      if (!isNaN(parsedDec) && parsedDec > 0 && parsedDec < 36) decimals = parsedDec;
    }
  } catch (err) {
    console.warn('[DepositVerify] decimais fallback:', decimals, err.message);
  }

  const amountRaw = BigInt(matchedLog.data);
  const amountUsdc = Number(amountRaw) / Math.pow(10, decimals);
  if (isNaN(amountUsdc)) return { ok: false, error: 'Erro ao calcular o valor do depósito' };

  const minUsdc = settings.web3_min_deposit_usdc ? parseFloat(settings.web3_min_deposit_usdc) : 0;
  if (amountUsdc < minUsdc) {
    return { ok: false, error: `Valor depositado (${amountUsdc}) é menor que o mínimo permitido (${minUsdc})` };
  }
  if (amountUsdc <= 0) return { ok: false, error: 'Valor zero na transação' };

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', [
      'ms_deposit_credit',
      String(txHash).toLowerCase()
    ]);
    const dup = await client.query('SELECT user_id FROM daily_actions WHERE action_key = $1', [`tx_${txHash}`]);
    if (dup.rowCount > 0) {
      const owner = dup.rows[0].user_id;
      if (Number(owner) !== Number(uid)) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'Esta transação já foi utilizada por outra conta.' };
      }
      await client.query('ROLLBACK');
      const bal = await db.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
      await db.query('DELETE FROM app_cache WHERE key = $1', [`deposit_pending:${txHash}`]);
      return { ok: true, amount: 0, newUsdc: bal.rows[0]?.usdc, already: true };
    }
    const now = Date.now();
    await client.query(
      `UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1,
        total_usdc_deposited = COALESCE(total_usdc_deposited, 0) + $1,
        server_updated_at = $2, last_updated_at = $2 WHERE user_id = $3`,
      [amountUsdc, now, uid]
    );
    const depoKey = `deposit_tx:${String(txHash).toLowerCase()}`;
    await creditDepositReferralCommissionPg(client, Number(uid), amountUsdc, depoKey);
    await client.query('INSERT INTO daily_actions (user_id, action_key, last_performed_at) VALUES ($1, $2, $3)', [uid, `tx_${txHash}`, now]);
    await client.query('COMMIT');
    await db.query('DELETE FROM app_cache WHERE key = $1', [`deposit_pending:${txHash}`]);
    const newBalRes = await db.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    console.log('[DepositCredit] userId=%s network=%s amountUsdc=%s tx=%s newUsdc=%s',
      uid, net, Number(amountUsdc).toFixed(8), String(txHash).slice(0, 18) + '…', newBalRes.rows[0].usdc);
    if (amountUsdc > 0) {
      await appendGameActivityLog(db, uid, 'deposit_credit', {
        network: net,
        amountUsdc: Number(Number(amountUsdc).toFixed(8)),
        txPrefix: String(txHash).slice(0, 22)
      });
    }
    return { ok: true, amount: amountUsdc, newUsdc: newBalRes.rows[0].usdc };
  } catch (dbErr) {
    await client.query('ROLLBACK');
    throw dbErr;
  } finally {
    client.release();
  }
}

async function sweepPendingDepositsOnce() {
  try {
    const rows = await db.query("SELECT key, value FROM app_cache WHERE key LIKE 'deposit_pending:%' LIMIT 40");
    if (!rows.rowCount) return;
    const settings = await loadDepositSettings();
    for (const row of rows.rows) {
      const txHash = String(row.key).replace(/^deposit_pending:/, '');
      const meta = row.value && typeof row.value === 'object' ? row.value : (typeof row.value === 'string' ? JSON.parse(row.value) : {});
      const { userId, network } = meta;
      if (!userId || !network || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        await db.query('DELETE FROM app_cache WHERE key = $1', [row.key]);
        continue;
      }
      if (isDepositNetworkDisabledInSettings(settings, network)) {
        await db.query('DELETE FROM app_cache WHERE key = $1', [row.key]);
        continue;
      }
      const resolved = resolveDepositNetwork(settings, network);
      if (resolved.error) continue;
      const receipt = await fetchDepositReceiptUnified(network, resolved.rpcUrl, txHash);
      const r = await tryCreditDepositFromReceipt(userId, txHash, network, settings, receipt);
      if (r.ok) {
        if (r.amount > 0) {
          console.log('[DepositSweep] credited userId=%s network=%s amountUsdc=%s tx=%s',
            userId, network, Number(r.amount).toFixed(8), String(txHash).slice(0, 18) + '…');
        }
      } else if (!r.pending) {
        const age = (Date.now() - (meta.createdAt || 0));
        if (age > 72 * 3600 * 1000) await db.query('DELETE FROM app_cache WHERE key = $1', [row.key]);
      }
    }
  } catch (e) {
    console.error('[DepositSweep]', e.message);
  }
}

app.post('/api/deposit/verify', async (req, res) => {
  const { email, txHash, network } = req.body || {};

  if (!email || !txHash) return res.status(400).json({ error: 'Missing email or transaction hash' });
  const uid = req.userId;
  if (!uid) return res.status(401).json({ error: 'Sessão necessária para verificar depósito.' });

  const txNorm = String(txHash).trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txNorm)) {
    return res.status(400).json({ error: 'Hash de transação inválido (64 hex após 0x).' });
  }

  const who = await db.query('SELECT lower(trim(email::text)) AS em FROM users WHERE id = $1', [uid]);
  if (!who.rows[0]) return res.status(401).json({ error: 'Utilizador inválido.' });
  if (String(email).trim().toLowerCase() !== who.rows[0].em) {
    return res.status(403).json({ error: 'O email não corresponde à sessão autenticada.' });
  }

  console.log('[DepositVerify] userId=%s network=%s tx=%s', uid, network, txNorm.slice(0, 14) + '…');

  const checkTx = await db.query('SELECT user_id FROM daily_actions WHERE action_key = $1', [`tx_${txNorm}`]);
  if (checkTx.rowCount > 0) {
    const owner = checkTx.rows[0].user_id;
    if (Number(owner) !== Number(uid)) {
      return res.status(400).json({ error: 'Esta transação já foi utilizada por outra conta.' });
    }
    const bal = await db.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    await db.query('DELETE FROM app_cache WHERE key = $1', [`deposit_pending:${txNorm}`]);
    return res.json({ ok: true, amount: 0, newUsdc: bal.rows[0]?.usdc, already: true });
  }

  try {
    const settings = await loadDepositSettings();
    if (isDepositNetworkDisabledInSettings(settings, network)) {
      return res.status(403).json({ error: 'Depósitos nesta rede estão desativados.' });
    }
    const resolved = resolveDepositNetwork(settings, network);
    if (resolved.error) {
      return res.status(resolved.error.startsWith('Rede') ? 400 : 500).json({ error: resolved.error });
    }
    const { net, rpcUrl } = resolved;

    const receipt = await fetchDepositReceiptUnified(net, rpcUrl, txNorm);
    if (!receipt || !receipt.result) {
      await queueDepositPending(txNorm, { userId: uid, network: net, createdAt: Date.now() });
      return res.json({
        ok: false,
        pending: true,
        message: 'Transação ainda na mempool ou RPC indisponível. Os USDC serão creditados automaticamente quando a rede confirmar — pode fechar esta página.'
      });
    }

    const out = await tryCreditDepositFromReceipt(uid, txNorm, net, settings, receipt);
    if (out.ok) {
      return res.json({ ok: true, amount: out.amount, newUsdc: out.newUsdc, already: !!out.already });
    }
    if (out.pending) {
      await queueDepositPending(txNorm, { userId: uid, network: net, createdAt: Date.now() });
      return res.json({
        ok: false,
        pending: true,
        message: 'Aguardando confirmação na rede. O saldo será atualizado em breve; pode fechar o site.'
      });
    }
    return res.status(400).json({ error: out.error || 'Falha na validação' });
  } catch (e) {
    console.error('[DepositVerify]', e);
    sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao validar transação.');
  }
});


app.get('/api/web3-settings', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    const keys = [
      'web3_deposit_wallet', 'web3_payout_wallet', 'web3_deposit_token_contract',
      'web3_deposit_token_contract_bnb', 'web3_deposit_token_contract_base',
      'web3_min_deposit_usdc', 'web3_withdraw_token_name', 'web3_withdraw_token_contract',
      'web3_withdraw_tokens',
      'web3_deposit_polygon_disabled', 'web3_deposit_bnb_disabled', 'web3_deposit_base_disabled'
    ];
    const settings = await getSettingsRecord(keys);

    let withdrawTokens = [];
    try { withdrawTokens = settings.web3_withdraw_tokens ? JSON.parse(settings.web3_withdraw_tokens) : []; } catch { withdrawTokens = []; }

    res.json({
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
    });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/web3-settings', isAdmin, async (req, res) => {
  const body = req.body || {};
  const {
    depositWallet, payoutWallet, depositTokenContract,
    depositTokenContractBnb, depositTokenContractBase,
    withdrawTokenName, withdrawTokenContract,
    withdrawTokens, minDepositUsdc,
    depositPolygonDisabled, depositBnbDisabled, depositBaseDisabled
  } = body;
  const to01 = (v: unknown) => {
    if (v === true || v === 1 || v === '1') return '1';
    if (v === false || v === 0 || v === '0' || v == null || v === '') return '0';
    if (typeof v === 'string' && v.toLowerCase() === 'true') return '1';
    if (typeof v === 'string' && v.toLowerCase() === 'false') return '0';
    return v ? '1' : '0';
  };
  try {
    const upserts: Array<{ key: string; value: string }> = [
      { key: 'web3_deposit_wallet', value: typeof depositWallet === 'string' ? depositWallet : '' },
      { key: 'web3_payout_wallet', value: typeof payoutWallet === 'string' ? payoutWallet : '' },
      { key: 'web3_deposit_token_contract', value: typeof depositTokenContract === 'string' ? depositTokenContract : '' },
      { key: 'web3_deposit_token_contract_bnb', value: typeof depositTokenContractBnb === 'string' ? depositTokenContractBnb : '' },
      { key: 'web3_deposit_token_contract_base', value: typeof depositTokenContractBase === 'string' ? depositTokenContractBase : '' },
      { key: 'web3_min_deposit_usdc', value: typeof minDepositUsdc === 'number' ? String(minDepositUsdc) : '' },
      { key: 'web3_withdraw_token_name', value: typeof withdrawTokenName === 'string' ? withdrawTokenName : '' },
      { key: 'web3_withdraw_token_contract', value: typeof withdrawTokenContract === 'string' ? withdrawTokenContract : '' },
      { key: 'web3_withdraw_tokens', value: Array.isArray(withdrawTokens) ? JSON.stringify(withdrawTokens) : '[]' }
    ];
    // Só gravar flags se vierem no JSON; caso contrário JSON.stringify no cliente omite undefined e apagaria o bloqueio.
    if (Object.prototype.hasOwnProperty.call(body, 'depositPolygonDisabled')) {
      upserts.push({ key: 'web3_deposit_polygon_disabled', value: to01(depositPolygonDisabled) });
    }
    if (Object.prototype.hasOwnProperty.call(body, 'depositBnbDisabled')) {
      upserts.push({ key: 'web3_deposit_bnb_disabled', value: to01(depositBnbDisabled) });
    }
    if (Object.prototype.hasOwnProperty.call(body, 'depositBaseDisabled')) {
      upserts.push({ key: 'web3_deposit_base_disabled', value: to01(depositBaseDisabled) });
    }
    await upsertSettingsEntries(upserts);
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- ECONOMY ---
app.get('/api/economy-settings', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    const rowRes = await db.query(
      'SELECT black_market_enabled, hardware_market_enabled, market_tax_percent, black_market_price_band_percent FROM economy_settings WHERE id = 1'
    );
    const row = rowRes.rows[0];
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

    res.json({
      hardwareMarketEnabled: hw,
      blackMarketEnabled: bk,
      marketTaxPercent: tax,
      blackMarketPriceBandPercent: band
    });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/economy-settings', isAdmin, async (req, res) => {
  const { hardwareMarketEnabled, blackMarketEnabled, marketTaxPercent, blackMarketPriceBandPercent } = req.body || {};
  try {
    const tax = Math.min(100, Math.max(0, Number(marketTaxPercent) || 0));
    let band = Number(blackMarketPriceBandPercent);
    if (!Number.isFinite(band)) {
      const prev = await prisma.economy_settings.findUnique({
        where: { id: 1 },
        select: { black_market_price_band_percent: true }
      });
      const prevBand =
        prev?.black_market_price_band_percent != null ? Number(prev.black_market_price_band_percent) : NaN;
      band = Number.isFinite(prevBand) ? prevBand : 20;
    }
    if (!Number.isFinite(band)) band = 20;
    band = Math.min(200, Math.max(0, band));

    const bm = blackMarketEnabled ? 1 : 0;
    const hm = hardwareMarketEnabled ? 1 : 0;

    await prisma.$transaction([
      prisma.settings.upsert({
        where: { key: 'hardware_market_enabled' },
        create: { key: 'hardware_market_enabled', value: hardwareMarketEnabled ? '1' : '0' },
        update: { value: hardwareMarketEnabled ? '1' : '0' }
      }),
      prisma.settings.upsert({
        where: { key: 'black_market_enabled' },
        create: { key: 'black_market_enabled', value: blackMarketEnabled ? '1' : '0' },
        update: { value: blackMarketEnabled ? '1' : '0' }
      }),
      prisma.settings.upsert({
        where: { key: 'market_tax_percent' },
        create: { key: 'market_tax_percent', value: String(tax) },
        update: { value: String(tax) }
      }),
      prisma.settings.upsert({
        where: { key: 'black_market_price_band_percent' },
        create: { key: 'black_market_price_band_percent', value: String(band) },
        update: { value: String(band) }
      }),
      prisma.economy_settings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          black_market_enabled: bm,
          hardware_market_enabled: hm,
          market_tax_percent: tax,
          black_market_price_band_percent: band
        },
        update: {
          black_market_enabled: bm,
          hardware_market_enabled: hm,
          market_tax_percent: tax,
          black_market_price_band_percent: band
        }
      })
    ]);

    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.get('/api/nfts', async (req, res) => {
  const contract = req.query.contract;
  const owner = req.query.owner;
  try {
    const contractsRaw = await getSettingValue('web3_nft_contracts');
    let allowed = [];
    try {
      allowed = contractsRaw ? JSON.parse(contractsRaw) : [];
    } catch {
      allowed = [];
    }
    if (!contract || typeof contract !== 'string') return res.status(400).json({ error: 'Missing contract' });

    if (!allowed.some(c => c.toLowerCase() === contract.toLowerCase())) {
      return res.json([]);
    }

    let q = 'SELECT * FROM nft_items WHERE contract_address = $1';
    let params = [contract];
    if (owner != null && owner !== '') {
      q += ' AND owner_address = $2';
      const ownerStr = Array.isArray(owner) ? String(owner[0] ?? '') : String(owner);
      params.push(ownerStr);
    }
    const resArr = await db.query(q, params);
    res.json(resArr.rows.map(r => ({
      contractAddress: r.contract_address,
      tokenId: r.token_id,
      ownerAddress: r.owner_address,
      metadata: r.metadata ? JSON.parse(r.metadata) : null
    })));
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/nfts/receive', isAdmin, async (req, res) => {
  const { contract, tokenId, toAddress } = req.body || {};
  try {
    const contractsRaw = await getSettingValue('web3_nft_contracts');
    let allowed = [];
    try {
      allowed = contractsRaw ? JSON.parse(contractsRaw) : [];
    } catch {
      allowed = [];
    }
    if (!contract || !tokenId || !toAddress) return res.status(400).json({ error: 'Missing fields' });
    if (!allowed.some(c => c.toLowerCase() === contract.toLowerCase())) return res.status(403).json({ error: 'Contract not allowed' });

    await db.query(`
      INSERT INTO nft_items (contract_address, token_id, owner_address, metadata) 
      VALUES ($1,$2,$3,COALESCE((SELECT metadata FROM nft_items WHERE contract_address=$1 AND token_id=$2), NULL))
      ON CONFLICT (contract_address, token_id) DO UPDATE SET owner_address = $3`,
      [contract, tokenId, toAddress]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/nfts/send', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const { contract, tokenId, fromAddress, toAddress } = req.body || {};
  try {
    const contractsRaw = await getSettingValue('web3_nft_contracts');
    let allowed = [];
    try {
      allowed = contractsRaw ? JSON.parse(contractsRaw) : [];
    } catch {
      allowed = [];
    }
    if (!contract || !tokenId || !fromAddress || !toAddress) return res.status(400).json({ error: 'Missing fields' });
    if (!allowed.some(c => c.toLowerCase() === contract.toLowerCase())) return res.status(403).json({ error: 'Contract not allowed' });

    const fromNorm = String(fromAddress).trim().toLowerCase();
    const toNorm = String(toAddress).trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(fromNorm) || !/^0x[a-f0-9]{40}$/.test(toNorm)) {
      return res.status(400).json({ error: 'Endereço inválido (use 0x + 40 hex).' });
    }
    if (fromNorm === toNorm) return res.status(400).json({ error: 'Origem e destino não podem ser iguais.' });

    const walletRow = await db.query(
      "SELECT lower(trim(COALESCE(polygon_wallet::text, ''))) AS w FROM users WHERE id = $1",
      [req.userId]
    );
    const userWallet = String(walletRow.rows[0]?.w || '');
    if (!userWallet || userWallet !== fromNorm) {
      return res.status(403).json({ error: 'A carteira de origem deve ser a Polygon associada ao teu perfil.' });
    }

    const rowRes = await db.query('SELECT owner_address FROM nft_items WHERE contract_address = $1 AND token_id = $2', [contract, tokenId]);
    const row = rowRes.rows[0];
    const rowOwner = String(row?.owner_address ?? '').trim().toLowerCase();
    if (!row || rowOwner !== fromNorm) return res.status(400).json({ error: 'Not owner' });
    await db.query('UPDATE nft_items SET owner_address = $1 WHERE contract_address = $2 AND token_id = $3', [toNorm, contract, tokenId]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

// --- ACCESS LEVELS ---
app.get('/api/access-levels', async (req, res) => {
  try {
    const rows = await prisma.access_levels.findMany();
    const levels = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isDefault: !!r.is_default,
      isActive: !!r.is_active,
      priceUsdc: r.price_usdc ?? undefined,
      contractAddress: r.contract_address ?? undefined,
      inactiveMessage: r.inactive_message ?? undefined,
      newsPostingEnabled: !!r.news_posting_enabled,
      allowedPages: r.allowed_pages ? (() => { try { return JSON.parse(r.allowed_pages); } catch { return []; } })() : []
    }));
    res.json(levels);
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/access-levels', isAdmin, async (req, res) => {
  const levels = req.body;
  if (!Array.isArray(levels)) return res.status(400).json({ error: 'Body must be an array' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const incomingIds = levels.map(l => l.id);

    // 1. Delete levels that are NOT in the incoming list
    // This will trigger cascade or fail if protected, but at least it won't kill valid current mappings
    await client.query('DELETE FROM access_levels WHERE id NOT IN (SELECT unnest($1::text[]))', [incomingIds]);

    // 2. Insert or Update (upsert) individual levels
    for (const l of levels) {
      await client.query(`
        INSERT INTO access_levels (id, name, description, is_default, is_active, price_usdc, contract_address, inactive_message, news_posting_enabled, allowed_pages)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          is_default = EXCLUDED.is_default,
          is_active = EXCLUDED.is_active,
          price_usdc = EXCLUDED.price_usdc,
          contract_address = EXCLUDED.contract_address,
          inactive_message = EXCLUDED.inactive_message,
          news_posting_enabled = EXCLUDED.news_posting_enabled,
          allowed_pages = EXCLUDED.allowed_pages
      `, [
        l.id, l.name, l.description,
        l.isDefault ? 1 : 0, l.isActive ? 1 : 0,
        l.priceUsdc ?? null, l.contractAddress ?? null, l.inactiveMessage ?? null,
        (l.newsPostingEnabled ? 1 : 0),
        JSON.stringify(Array.isArray(l.allowedPages) ? l.allowedPages : [])
      ]);
    }

    // 3. Update users who lost their level
    let defaultId = levels.find(l => l.isDefault)?.id || (levels[0]?.id);
    if (defaultId) {
      await client.query('UPDATE users SET access_level_id = $1 WHERE access_level_id NOT IN (SELECT unnest($2::text[]))', [defaultId, incomingIds]);
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /api/access-levels] Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

// Alinha com a sala inicial do admin (`room_initial`). Saves antigos usavam NULL / '' / 'main'.
const normalizePlacedRackRoomId = (raw) => {
  const s = raw != null ? String(raw).trim() : '';
  if (!s || s === 'main') return 'room_initial';
  return s;
};

/** Sala canónica em rig_rooms — só chassis Rack H1 NFT Collection (`armario_1`). */
const NFT_AUTO_ROOM_ID = 'room_1775484506874';
const NFT_AUTO_ALLOWED_CHASSIS_ID = 'armario_1';
/** Nomes normalizados (iguais à política no frontend) — cobre renomeações / outro id na BD. */
const NFT_AUTO_POLICY_ROOM_NAME_KEYS = ['nfts auto', 'nft auto', 'nfts arbam'];

function normalizeRigRoomPolicyNameKeyServer(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function isNftAutoArmario1OnlyRoomRowFromDb(row) {
  if (!row) return false;
  const id = String(row.id || '').trim();
  if (id === NFT_AUTO_ROOM_ID) return true;
  return NFT_AUTO_POLICY_ROOM_NAME_KEYS.includes(normalizeRigRoomPolicyNameKeyServer(row.name));
}

/** Ids de salas sujeitas à regra armario_1 apenas (consulta rig_rooms). */
async function resolveNftAutoArmario1OnlyRoomIds(q) {
  const r = await q.query(
    `SELECT id FROM rig_rooms
     WHERE id = $1
        OR lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = ANY($2::text[])`,
    [NFT_AUTO_ROOM_ID, NFT_AUTO_POLICY_ROOM_NAME_KEYS]
  );
  const ids = new Set();
  for (const row of r.rows) {
    const id = row.id != null ? String(row.id).trim() : '';
    if (id) ids.add(id);
  }
  ids.add(NFT_AUTO_ROOM_ID);
  return ids;
}

async function ensureStoredBatteriesArrayFromDb(client, uid, changes) {
  if (Array.isArray(changes.storedBatteries)) return;
  const ext = await client.query(
    'SELECT id, item_id, current_charge, power_capacity_wh, display_name, image_url, workshop_slot_index, workshop_component_slot_id FROM stored_batteries WHERE user_id = $1',
    [uid]
  );
  changes.storedBatteries = ext.rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    currentCharge: Number(r.current_charge) || 0,
    powerCapacityWh: r.power_capacity_wh != null ? Number(r.power_capacity_wh) : null,
    displayName: r.display_name != null ? String(r.display_name) : null,
    imageUrl: r.image_url != null ? String(r.image_url) : null,
    workshopSlotIndex: r.workshop_slot_index != null ? Number(r.workshop_slot_index) : null,
    workshopComponentSlotId: r.workshop_component_slot_id != null ? String(r.workshop_component_slot_id) : null
  }));
}

async function returnRackBatteryToChangesOnNftSanitize(client, uid, rack, stock, changes) {
  const bid = rack.batteryId;
  if (bid == null || String(bid).trim() === '') return;
  const s = String(bid).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
  if (isUuid) {
    const br = await client.query(
      'SELECT id, item_id, current_charge, power_capacity_wh, display_name, image_url, workshop_slot_index, workshop_component_slot_id FROM stored_batteries WHERE id = $1 AND user_id = $2',
      [s, uid]
    );
    if (br.rows[0]) {
      await ensureStoredBatteriesArrayFromDb(client, uid, changes);
      if (!changes.storedBatteries.some((x) => x.id === br.rows[0].id)) {
        const row0 = br.rows[0];
        changes.storedBatteries.push({
          id: row0.id,
          itemId: row0.item_id,
          currentCharge: Number(row0.current_charge) || 0,
          powerCapacityWh: row0.power_capacity_wh != null ? Number(row0.power_capacity_wh) : null,
          displayName: row0.display_name != null ? String(row0.display_name) : null,
          imageUrl: row0.image_url != null ? String(row0.image_url) : null,
          workshopSlotIndex: row0.workshop_slot_index != null ? Number(row0.workshop_slot_index) : null,
          workshopComponentSlotId:
            row0.workshop_component_slot_id != null ? String(row0.workshop_component_slot_id) : null
        });
      }
      return;
    }
  }
  const u = await client.query('SELECT type, power_capacity FROM upgrades WHERE id = $1', [s]);
  const row = u.rows[0];
  if (row && row.type === 'battery') {
    const capRaw = row.power_capacity;
    const cap = capRaw === null || capRaw === undefined ? null : Number(capRaw);
    const charge = Number(rack.currentCharge) || 0;
    const isInf = cap === -1;
    const isFull = isInf || (typeof cap === 'number' && cap > 0 && charge >= cap * 0.999);
    if (isFull) {
      stock[s] = Math.floor((Number(stock[s]) || 0) + 1);
    } else {
      await ensureStoredBatteriesArrayFromDb(client, uid, changes);
      changes.storedBatteries.push({
        id: crypto.randomUUID(),
        itemId: s,
        currentCharge: charge
      });
    }
    return;
  }
  stock[s] = Math.floor((Number(stock[s]) || 0) + 1);
}

/**
 * Remove rigs na sala NFT AUTO que não usam `armario_1`; devolve chassis, slots, fiação e bateria ao stock/armazém.
 * Deve correr dentro da transação do save antes de persistir placed_racks.
 */
async function sanitizePlacedRacksNftAutoRoom(client, uid, changes, saveActivityLogs) {
  const racks = changes.placedRacks;
  if (!Array.isArray(racks)) return false;
  const nftRoomIds = await resolveNftAutoArmario1OnlyRoomIds(client);
  if (!changes.stock) changes.stock = {};
  const stock = changes.stock;
  const kept = [];
  for (const r of racks) {
    if (!r || typeof r !== 'object') {
      kept.push(r);
      continue;
    }
    const room = normalizePlacedRackRoomId(r.roomId);
    if (!nftRoomIds.has(room)) {
      kept.push(r);
      continue;
    }
    const chassis = r.itemId != null ? String(r.itemId).trim() : '';
    if (!chassis || chassis === NFT_AUTO_ALLOWED_CHASSIS_ID) {
      kept.push(r);
      continue;
    }
    stock[chassis] = Math.floor((Number(stock[chassis]) || 0) + 1);
    if (r.wiringId) {
      const w = String(r.wiringId).trim();
      if (w) stock[w] = Math.floor((Number(stock[w]) || 0) + 1);
    }
    for (const slot of r.slots || []) {
      if (!slot) continue;
      const sid = String(slot).trim();
      if (sid) stock[sid] = Math.floor((Number(stock[sid]) || 0) + 1);
    }
    for (const slot of r.multiplierSlots || []) {
      if (!slot) continue;
      const mid = String(slot).trim();
      if (mid) stock[mid] = Math.floor((Number(stock[mid]) || 0) + 1);
    }
    try {
      await returnRackBatteryToChangesOnNftSanitize(client, uid, r, stock, changes);
    } catch (e) {
      console.warn('[NftAutoRoom] battery return skipped:', e?.message || e);
    }
    saveActivityLogs.push({
      action: 'rack_dismantle',
      meta: {
        rackId: r.id,
        reason: 'nft_auto_room_only_h1',
        roomId: room,
        chassis
      }
    });
    console.log(`[NftAutoRoom] userId=${uid} removed rackId=${r.id} chassis=${chassis} from NFT AUTO room`);
  }
  changes.placedRacks = kept;
  return racks.length !== kept.length;
}

// --- SERVER ROOM (Servidores: lógica autoritária no servidor) ---
app.post('/api/server-room/bulk-batteries', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const uid = req.userId;
  const body = req.body || {};
  const roomNorm = normalizePlacedRackRoomId(body.roomId);
  if (!isValidRoomId(roomNorm)) return res.status(400).json({ error: 'Sala inválida.' });
  const batteryUpgradeId = body.batteryUpgradeId != null ? String(body.batteryUpgradeId) : '';
  const runOpts = { smartFill: body.smartFill, rigSort: body.rigSort };

  const client = await db.connect();
  const saveActivityLogs = [];
  try {
    await client.query('BEGIN');
    await client.query("SET statement_timeout = '20s'");
    await client.query('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', [uid]);

    const [stock, storedBatteries, placedRacks, upgrades] = await Promise.all([
      loadUserStock(client, uid),
      loadUserStoredBatteries(client, uid),
      loadUserPlacedRacksWithSlots(client, uid),
      loadUpgradesWithCompat(client)
    ]);

    const prev = { stock, storedBatteries, placedRacks };
    const prevForBulk = {
      stock: { ...prev.stock },
      storedBatteries: [...prev.storedBatteries],
      placedRacks: prev.placedRacks.map((r) => ({
        ...r,
        slots: [...(r.slots || [])],
        multiplierSlots: [...(r.multiplierSlots || [])]
      }))
    };
    await sanitizePlacedRacksNftAutoRoom(client, uid, prevForBulk, saveActivityLogs);
    const out = runBulkRoomBattery(prevForBulk, roomNorm, batteryUpgradeId, upgrades, runOpts);
    if (!out.ok) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: out.message });
    }

    const rackVal = await validatePlacedRacksForSave(client, out.next.placedRacks, uid);
    if (!rackVal.ok) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: rackVal.error });
    }

    await persistStockStoredBatteriesPlacedRacks(
      client,
      uid,
      {
        stock: out.next.stock,
        storedBatteries: out.next.storedBatteries,
        placedRacks: out.next.placedRacks
      },
      saveActivityLogs
    );

    const finalServerUpdatedAt = Date.now();
    await client.query(
      `UPDATE game_states SET last_updated_at = $1, server_updated_at = $2 WHERE user_id = $3`,
      [finalServerUpdatedAt, finalServerUpdatedAt, uid]
    );
    await client.query('COMMIT');

    for (const ev of saveActivityLogs) {
      await appendGameActivityLog(db, uid, ev.action, ev.meta);
    }
    const smart = !!out.smartFill;
    let activityAction = 'room_battery_remove_all';
    if (smart) activityAction = 'room_battery_smart';
    else if (batteryUpgradeId) activityAction = 'room_battery_bulk_equip';
    const rigSort = runOpts?.rigSort === 'hashrate_desc' ? 'hashrate_desc' : 'slot_asc';
    await appendGameActivityLog(db, uid, activityAction, {
      roomId: roomNorm,
      batteryUpgradeId: smart ? '' : batteryUpgradeId,
      smartFill: smart,
      rigSort,
      appliedRigs: out.appliedRigs,
      compatibleRigs: out.compatibleRigs,
      ok: true,
      source: 'server_room_api'
    });

    res.json({
      ok: true,
      serverUpdatedAt: finalServerUpdatedAt,
      stock: out.next.stock,
      storedBatteries: out.next.storedBatteries,
      placedRacks: out.next.placedRacks,
      appliedRigs: out.appliedRigs,
      compatibleRigs: out.compatibleRigs,
      smartFill: smart
    });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e instanceof StoredBatterySaveGuardError) {
      return res.status(409).json({ error: e.message, forceReload: true });
    }
    console.error('[server-room/bulk-batteries]', e);
    sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
  } finally {
    client.release();
  }
});

app.post('/api/server-room/room-coins', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const uid = req.userId;
  const body = req.body || {};
  const roomNorm = normalizePlacedRackRoomId(body.roomId);
  if (!isValidRoomId(roomNorm)) return res.status(400).json({ error: 'Sala inválida.' });
  const rawCoin = body.coinId;
  let selectedCoinId = null;
  if (rawCoin != null && String(rawCoin).trim() !== '') {
    selectedCoinId = String(rawCoin).trim();
    if (!RACK_ID_RE.test(selectedCoinId)) return res.status(400).json({ error: 'Moeda inválida.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET statement_timeout = '20s'");
    await client.query('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', [uid]);

    if (selectedCoinId) {
      const cRes = await client.query('SELECT id, is_active FROM mining_coins WHERE id = $1', [selectedCoinId]);
      if (!cRes.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Moeda desconhecida.' });
      }
      if (!Number(cRes.rows[0].is_active)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Esta moeda está desativada.' });
      }
    }

    const roomSqlExpr = `COALESCE(NULLIF(BTRIM(room_id::text), ''), 'room_initial')`;
    // $1::text — sem cast, NULL em dois sítios faz o PG falhar: "could not determine data type of parameter $1"
    await client.query(
      `UPDATE placed_racks SET
        selected_coin_id = $1::text,
        is_on = CASE WHEN $1::text IS NULL THEN 0 ELSE is_on END
      WHERE user_id = $2 AND ${roomSqlExpr} = $3::text`,
      [selectedCoinId, uid, roomNorm]
    );

    const finalServerUpdatedAt = Date.now();
    await client.query(
      `UPDATE game_states SET last_updated_at = $1, server_updated_at = $2 WHERE user_id = $3`,
      [finalServerUpdatedAt, finalServerUpdatedAt, uid]
    );
    await client.query('COMMIT');

    const placedRacks = await loadUserPlacedRacksWithSlots(db, uid);
    await appendGameActivityLog(db, uid, 'room_coin_bulk', {
      roomId: roomNorm,
      coinId: selectedCoinId || '',
      source: 'server_room_api'
    });

    res.json({
      ok: true,
      serverUpdatedAt: finalServerUpdatedAt,
      placedRacks
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[server-room/room-coins]', e);
    sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
  } finally {
    client.release();
  }
});

// --- RIG ROOMS ---
app.get('/api/rig-rooms', async (req, res) => {
  try {
    const rows = await prisma.rig_rooms.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }]
    });
    const list = rows.map((r) => ({
      id: r.id,
      name: r.name,
      initialCapacity: r.initial_capacity,
      maxCapacity: r.max_capacity,
      baseSlotPrice: r.base_slot_price,
      slotPriceIncreasePercent: r.slot_price_increase_percent,
      allowedLevels: r.allowed_levels ? (() => { try { return JSON.parse(r.allowed_levels); } catch { return []; } })() : [],
      allowedSeasonPassIds: r.allowed_season_pass_ids ? (() => { try { return JSON.parse(r.allowed_season_pass_ids); } catch { return []; } })() : [],
      isActive: !!r.is_active,
      sortOrder: r.sort_order,
      nftAutoArmario1Only: isNftAutoArmario1OnlyRoomRowFromDb(r)
    }));
    res.json(list);
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/rig-rooms', isAdmin, async (req, res) => {
  const rooms = Array.isArray(req.body) ? req.body : [];
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const newIds = rooms.map(r => r.id);
    if (newIds.length > 0) {
      await client.query(`
        DELETE FROM rig_rooms
        WHERE id NOT IN (SELECT unnest($1::text[]))
          AND id NOT IN (SELECT room_id FROM user_rig_rooms)
          AND NOT EXISTS (
            SELECT 1 FROM placed_racks pr
            WHERE pr.room_id = rig_rooms.id
               OR (rig_rooms.id = 'room_initial' AND (
                    pr.room_id IS NULL
                    OR BTRIM(COALESCE(pr.room_id, '')) = ''
                    OR pr.room_id = 'main'
                  ))
          )
      `, [newIds]);
    } else {
      await client.query(`
        DELETE FROM rig_rooms
        WHERE id NOT IN (SELECT room_id FROM user_rig_rooms)
          AND NOT EXISTS (
            SELECT 1 FROM placed_racks pr
            WHERE pr.room_id = rig_rooms.id
               OR (rig_rooms.id = 'room_initial' AND (
                    pr.room_id IS NULL
                    OR BTRIM(COALESCE(pr.room_id, '')) = ''
                    OR pr.room_id = 'main'
                  ))
          )
      `);
    }

    for (const r of rooms) {
      await client.query(`
        INSERT INTO rig_rooms (
          id, name, initial_capacity, max_capacity, base_slot_price, slot_price_increase_percent, allowed_levels, allowed_season_pass_ids, is_active, sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          initial_capacity = EXCLUDED.initial_capacity,
          max_capacity = EXCLUDED.max_capacity,
          base_slot_price = EXCLUDED.base_slot_price,
          slot_price_increase_percent = EXCLUDED.slot_price_increase_percent,
          allowed_levels = EXCLUDED.allowed_levels,
          allowed_season_pass_ids = EXCLUDED.allowed_season_pass_ids,
          is_active = EXCLUDED.is_active,
          sort_order = EXCLUDED.sort_order
      `, [
        r.id, r.name,
        Math.max(0, Number(r.initialCapacity || 0)),
        Math.max(0, Number(r.maxCapacity || 0)),
        Number(r.baseSlotPrice || 0),
        Number(r.slotPriceIncreasePercent || 0),
        JSON.stringify(Array.isArray(r.allowedLevels) ? r.allowedLevels : []),
        JSON.stringify(Array.isArray(r.allowedSeasonPassIds) ? r.allowedSeasonPassIds : []),
        r.isActive ? 1 : 0,
        Number(r.sortOrder || 0)
      ]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

app.get('/api/my-rig-rooms/:email', async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
    const email = String(req.params.email || '').trim().toLowerCase();
    if (!email || email.length > EMAIL_ADDRESS_MAX_LENGTH || /[\x00-\x1f<>]/.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }
    const uidRes = await db.query('SELECT id FROM users WHERE lower(trim(email::text)) = $1', [email]);
    if (!uidRes.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
    const uid = uidRes.rows[0].id;
    if (Number(uid) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const list = await loadMyRigRoomsForUser(Number(uid));
    res.json(list);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/rig-rooms/purchase-slot', async (req, res) => {
  const roomIdRaw = req.body != null ? req.body.roomId : null;
  if (!req.userId) return res.status(401).json({ ok: false, error: 'Não autenticado' });
  const RIG_ROOM_ID_RE = /^[a-zA-Z0-9_.:-]{1,120}$/;
  const roomId =
    typeof roomIdRaw === 'string' && RIG_ROOM_ID_RE.test(roomIdRaw.trim()) ? roomIdRaw.trim() : null;
  if (!roomId) return res.status(400).json({ ok: false, error: 'Sala inválida.' });
  let quantity = Math.floor(Number(req.body?.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
  if (quantity > 50) return res.status(400).json({ ok: false, error: 'Máximo de 50 slots por compra.' });
  const uid = req.userId;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET statement_timeout = '25s'");
    await client.query('SELECT usdc FROM game_states WHERE user_id = $1 FOR UPDATE', [uid]);

    const roomRes = await client.query('SELECT * FROM rig_rooms WHERE id = $1', [roomId]);
    const roomSub = roomRes.rows[0];
    if (!roomSub || !roomSub.is_active) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Room not available' });
    }

    const userRoomRes = await client.query(
      'SELECT unlocked_slots FROM user_rig_rooms WHERE user_id = $1 AND room_id = $2',
      [uid, roomId]
    );
    const userRoom = userRoomRes.rows[0];
    const purchasedCount = userRoom ? (userRoom.unlocked_slots || 0) : 0;
    const totalCurrentSlots = roomSub.initial_capacity + purchasedCount;
    const remaining = roomSub.max_capacity - totalCurrentSlots;
    if (remaining < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Max capacity reached' });
    }
    const n = Math.min(quantity, remaining);
    const factor = 1 + (roomSub.slot_price_increase_percent / 100);
    const base = Number(roomSub.base_slot_price);
    if (!Number.isFinite(base) || base < 0 || !Number.isFinite(factor) || factor < 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: 'Configuração de preço da sala inválida.' });
    }
    let totalPrice = 0;
    for (let j = 0; j < n; j++) {
      totalPrice += base * Math.pow(factor, purchasedCount + j);
    }

    const gsRes = await client.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    const bal = Number(gsRes.rows[0]?.usdc ?? 0);
    if (bal < totalPrice) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Insufficient USDC', missing: totalPrice - bal });
    }

    await client.query('UPDATE game_states SET usdc = usdc - $1 WHERE user_id = $2', [totalPrice, uid]);

    if (userRoom) {
      await client.query(
        'UPDATE user_rig_rooms SET unlocked_slots = unlocked_slots + $1 WHERE user_id = $2 AND room_id = $3',
        [n, uid, roomId]
      );
    } else {
      await client.query(
        'INSERT INTO user_rig_rooms (user_id, room_id, purchased_at, unlocked_slots) VALUES ($1, $2, $3, $4)',
        [uid, roomId, Date.now(), n]
      );
    }

    await client.query('COMMIT');

    const finalGsRes = await db.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    const newUsdc = Number(finalGsRes.rows[0]?.usdc ?? (bal - totalPrice));
    await appendGameActivityLog(db, uid, 'rig_room_slot_purchase', {
      roomId,
      slotsPurchased: n,
      priceUsdcTotal: totalPrice,
      newUnlockedSlots: purchasedCount + n,
      newUsdc,
      atMs: Date.now()
    });
    res.json({ ok: true, newUsdc, slotsPurchased: n, totalPaid: totalPrice });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (re) {
      /* ignore */
    }
    console.error('[rig-rooms/purchase-slot]', e);
    sendInternalErrorShapeOrPrisma(res, 'rig-rooms/purchase-slot', e, { ok: false }, 'Erro ao comprar slot.');
  } finally {
    client.release();
  }
});
// --- LOOT BOXES (catálogo admin POST em dist/controllers/lootBoxController.js) ---

// --- SYSTEM NEWS ---
app.get('/api/news', async (req, res) => {
  const client = await db.connect();
  try {
    const expRaw = await getSettingValue('news_post_expire_days');
    const expDays = expRaw != null && expRaw !== '' ? Number(expRaw) || 0 : 0;
    if (expDays > 0) {
      const cutoff = Date.now() - expDays * 24 * 3600 * 1000;
      await client.query('DELETE FROM system_news WHERE created_at < $1', [cutoff]);
    }
    const rowsRes = await client.query('SELECT * FROM system_news ORDER BY created_at DESC');
    const list = rowsRes.rows.map(r => ({
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
    res.json(list);
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); } finally { client.release(); }
});

app.post('/api/news', isAdmin, async (req, res) => {
  const { id, text, link, duration, authorName, adType, imageUrl } = req.body;
  try {
    await db.query('INSERT INTO system_news (id,text,link,active,duration,author_name,created_at,ad_type,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET text = $2, link = $3, duration = $5, author_name = $6, ad_type = $8, image_url = $9',
      [id, text, link ?? null, 1, duration ?? null, authorName ?? 'Admin', Date.now(), adType ?? 'horizontal', imageUrl ?? null]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.delete('/api/news/:id', isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM system_news WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/news-fee', async (req, res) => {
  try {
    const v = await getSettingValue('news_post_fee_usdc');
    res.json({ feeUsdc: v != null && v !== '' ? Number(v) || 0 : 0 });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/news-fee', isAdmin, async (req, res) => {
  const { feeUsdc } = req.body || {};
  const val = isFinite(Number(feeUsdc)) ? Number(feeUsdc) : 0;
  try {
    await upsertSettingsEntries([{ key: 'news_post_fee_usdc', value: String(val) }]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/news-expire-days', async (req, res) => {
  try {
    const v = await getSettingValue('news_post_expire_days');
    res.json({ days: v != null && v !== '' ? Number(v) || 0 : 0 });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/news-expire-days', isAdmin, async (req, res) => {
  const { days } = req.body || {};
  const val = Math.max(0, Math.floor(Number(days) || 0));
  try {
    await upsertSettingsEntries([{ key: 'news_post_expire_days', value: String(val) }]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

// --- TRANSPARENCY (pools / tesouraria — jogadores + admin) ---
const TRANSPARENCY_CATEGORIES = new Set(['pool', 'expense', 'investment', 'other']);
function mapTransparencyEntryRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    body: r.body || undefined,
    amountUsdc: r.amount_usdc != null && Number.isFinite(Number(r.amount_usdc)) ? Number(r.amount_usdc) : undefined,
    linkUrl: r.link_url || undefined,
    sortOrder: r.sort_order != null ? Number(r.sort_order) : 0,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}

app.get('/api/transparency', async (req, res) => {
  try {
    const rows = await prisma.transparency_entries.findMany({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }]
    });
    res.json(rows.map((row) => mapTransparencyEntryRow(row)));
  } catch (e) {
    console.error('[GET /api/transparency]', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin/transparency', isAdmin, async (req, res) => {
  try {
    const { category, title, body, amountUsdc, linkUrl, sortOrder } = req.body || {};
    if (!TRANSPARENCY_CATEGORIES.has(String(category))) {
      return res.status(400).json({ error: 'Categoria inválida' });
    }
    const t = String(title || '').trim();
    if (!t) return res.status(400).json({ error: 'Título obrigatório' });
    if (t.length > 300) return res.status(400).json({ error: 'Título longo demais' });
    const b = body != null ? String(body).trim() : '';
    if (b.length > 8000) return res.status(400).json({ error: 'Descrição longa demais' });
    let amt = null;
    if (amountUsdc !== undefined && amountUsdc !== null && String(amountUsdc).trim() !== '') {
      const n = Number(amountUsdc);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'Valor USDC inválido' });
      amt = n;
    }
    const link = linkUrl != null ? String(linkUrl).trim() : '';
    if (link.length > 2048) return res.status(400).json({ error: 'Link longo demais' });
    const sort = Math.floor(Number(sortOrder)) || 0;
    const now = BigInt(Date.now());
    const ins = await prisma.transparency_entries.create({
      data: {
        category: String(category),
        title: t,
        body: b || null,
        amount_usdc: amt,
        link_url: link || null,
        sort_order: sort,
        created_at: now,
        updated_at: now
      }
    });
    res.json(mapTransparencyEntryRow(ins));
  } catch (e) {
    console.error('[POST /api/admin/transparency]', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.put('/api/admin/transparency/:id', isAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const { category, title, body, amountUsdc, linkUrl, sortOrder } = req.body || {};
    if (category != null && !TRANSPARENCY_CATEGORIES.has(String(category))) {
      return res.status(400).json({ error: 'Categoria inválida' });
    }

    const t = title != null ? String(title).trim() : null;
    if (t !== null) {
      if (!t) return res.status(400).json({ error: 'Título obrigatório' });
      if (t.length > 300) return res.status(400).json({ error: 'Título longo demais' });
    }
    let bodyVal = null;
    if (body !== undefined) {
      const bs = body == null ? '' : String(body).trim();
      if (bs.length > 8000) return res.status(400).json({ error: 'Descrição longa demais' });
      bodyVal = bs || null;
    }
    let amtVal = undefined;
    if (amountUsdc !== undefined) {
      if (amountUsdc === null || (typeof amountUsdc === 'string' && amountUsdc.trim() === '')) {
        amtVal = null;
      } else {
        const n = Number(amountUsdc);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'Valor USDC inválido' });
        amtVal = n;
      }
    }
    let linkVal = undefined;
    if (linkUrl !== undefined) {
      const lk = linkUrl == null ? '' : String(linkUrl).trim();
      if (lk.length > 2048) return res.status(400).json({ error: 'Link longo demais' });
      linkVal = lk || null;
    }
    const sortVal = sortOrder !== undefined ? (Math.floor(Number(sortOrder)) || 0) : undefined;
    const now = BigInt(Date.now());

    const c = await prisma.transparency_entries.findUnique({ where: { id } });
    if (!c) return res.status(404).json({ error: 'Registro não encontrado' });
    const nextCat = category != null ? String(category) : c.category;
    const nextTitle = t !== null ? t : c.title;
    const nextBody = bodyVal !== undefined ? bodyVal : c.body;
    const nextAmt = amtVal !== undefined ? amtVal : c.amount_usdc;
    const nextLink = linkVal !== undefined ? linkVal : c.link_url;
    const nextSort = sortVal !== undefined ? sortVal : c.sort_order;

    const upd = await prisma.transparency_entries.update({
      where: { id },
      data: {
        category: nextCat,
        title: nextTitle,
        body: nextBody,
        amount_usdc: nextAmt,
        link_url: nextLink,
        sort_order: nextSort,
        updated_at: now
      }
    });
    res.json(mapTransparencyEntryRow(upd));
  } catch (e) {
    console.error('[PUT /api/admin/transparency/:id]', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.delete('/api/admin/transparency/:id', isAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const r = await prisma.transparency_entries.deleteMany({ where: { id } });
    if (r.count === 0) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/admin/transparency/:id]', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- UI DISPLAY LABELS (textos do jogo editáveis pelo admin) ---
app.get('/api/display-labels', async (req, res) => {
  try {
    const rows = await prisma.ui_display_labels.findMany({ orderBy: { key: 'asc' } });
    const obj: Record<string, string> = {};
    for (const row of rows) {
      const k = row.key != null ? String(row.key).trim() : '';
      const v = row.value != null ? String(row.value).trim() : '';
      if (k && v) obj[k] = v.slice(0, 200);
    }
    res.json(obj);
  } catch (e) {
    console.error('[GET /api/display-labels]', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin/display-labels', isAdmin, async (req, res) => {
  const raw = req.body?.labels;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return res.status(400).json({ error: 'Campo "labels" (objeto) obrigatório.' });
  }
  const now = Date.now();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const [key, rawVal] of Object.entries(raw)) {
      if (!UI_DISPLAY_LABEL_KEY_SET.has(key)) continue;
      const val = typeof rawVal === 'string' ? rawVal.trim().slice(0, 200) : '';
      if (!val) {
        await client.query('DELETE FROM ui_display_labels WHERE key = $1', [key]);
      } else {
        await client.query(
          `INSERT INTO ui_display_labels (key, value, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [key, val, now]
        );
      }
    }
    await client.query('COMMIT');
    const r2 = await db.query('SELECT key, value FROM ui_display_labels ORDER BY key');
    const out = {};
    for (const row of r2.rows) {
      const k = row.key != null ? String(row.key).trim() : '';
      const v = row.value != null ? String(row.value).trim() : '';
      if (k && v) out[k] = v.slice(0, 200);
    }
    res.json({ ok: true, labels: out });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('[POST /api/admin/display-labels]', e);
    res.status(500).json({ error: 'Erro ao salvar rótulos.' });
  } finally {
    client.release();
  }
});

app.get('/api/player-news/pending', isAdmin, async (req, res) => {
  try {
    const rowsRes = await db.query('SELECT p.id, p.user_id, p.text, p.link, p.status, p.created_at, u.username, u.email FROM player_news_submissions p JOIN users u ON u.id = p.user_id WHERE p.status = $1 ORDER BY p.created_at DESC', ['pending']);
    res.json(rowsRes.rows.map(r => ({ id: r.id, userId: r.user_id, username: r.username, email: r.email, text: r.text, link: r.link ?? undefined, status: r.status, createdAt: r.created_at })));
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/player-news/submit', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const { email, text, link } = req.body || {};
  const PLAYER_NEWS_TEXT_MAX = 500;
  const PLAYER_NEWS_LINK_MAX = 2048;
  const textTrimmed = typeof text === 'string' ? text.trim().slice(0, PLAYER_NEWS_TEXT_MAX) : '';
  if (!email || !textTrimmed) return res.status(400).json({ error: 'Missing fields' });
  const linkForDb =
    link != null && typeof link === 'string' && link.trim()
      ? link.trim().slice(0, PLAYER_NEWS_LINK_MAX)
      : null;
  const client = await db.connect();
  try {
    const uid = req.userId;
    const selfRes = await client.query('SELECT lower(trim(email::text)) AS em FROM users WHERE id = $1', [uid]);
    const selfEmail = selfRes.rows[0]?.em;
    if (!selfEmail || String(email).trim().toLowerCase() !== selfEmail) {
      return res.status(403).json({ error: 'Email não corresponde à conta autenticada.' });
    }
    const urowRes = await client.query('SELECT access_level_id FROM users WHERE id = $1', [uid]);
    const urow = urowRes.rows[0];
    const lvlRes = urow?.access_level_id ? await client.query('SELECT * FROM access_levels WHERE id = $1', [urow.access_level_id]) : { rows: [] };
    const lvl = lvlRes.rows[0];
    if (!lvl || !lvl.is_active) return res.status(400).json({ error: 'Access level inactive' });
    if (!lvl.news_posting_enabled) return res.status(403).json({ error: 'Posting disabled for level' });

    const feeRaw = await getSettingValue('news_post_fee_usdc');
    const fee = feeRaw != null && feeRaw !== '' ? Number(feeRaw) || 0 : 0;

    const gsRes = await client.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    const bal = gsRes.rows[0]?.usdc ?? 0;

    if (bal < fee) return res.status(400).json({ error: 'Insufficient USDC', missing: fee - bal });

    await client.query('BEGIN');
    if (fee > 0) await client.query('UPDATE game_states SET usdc = usdc - $1 WHERE user_id = $2', [fee, uid]);
    await client.query('DELETE FROM player_news_submissions WHERE user_id = $1', [uid]);
    await client.query('INSERT INTO player_news_submissions (id,user_id,text,link,status,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), uid, textTrimmed, linkForDb, 'pending', Date.now()]);
    await client.query('COMMIT');

    const finalGsRes = await client.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    const newBal = finalGsRes.rows[0]?.usdc ?? 0;
    res.json({ ok: true, newUsdc: newBal });
  } catch (e) {
    await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

app.post('/api/player-news/approve', isAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const client = await db.connect();
  try {
    const rowRes = await client.query('SELECT * FROM player_news_submissions WHERE id = $1', [id]);
    const row = rowRes.rows[0];
    if (!row || row.status !== 'pending') return res.status(404).json({ error: 'Submission not found' });

    await client.query('BEGIN');
    await client.query('UPDATE player_news_submissions SET status = $1 WHERE id = $2', ['approved', id]);
    const uRes = await client.query('SELECT username FROM users WHERE id = $1', [row.user_id]);
    const u = uRes.rows[0];
    await client.query('INSERT INTO system_news (id,text,link,active,duration,author_name,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(), row.text, row.link ?? null, 1, 60, u?.username || '', Date.now()]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

app.post('/api/player-news/reject', isAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const rowRes = await db.query('SELECT * FROM player_news_submissions WHERE id = $1', [id]);
    const row = rowRes.rows[0];
    if (!row || row.status !== 'pending') return res.status(404).json({ error: 'Submission not found' });
    await db.query('UPDATE player_news_submissions SET status = $1 WHERE id = $2', ['rejected', id]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

// --- SEASON PASSES ---
app.get('/api/season-passes', async (req, res) => {
  try {
    const rowsRes = await db.query('SELECT * FROM season_passes');
    const passes = [];

    for (const r of rowsRes.rows) {
      const rewardsRes = await db.query('SELECT * FROM season_pass_rewards WHERE pass_id = $1', [r.id]);
      passes.push({
        id: r.id,
        seasonId: r.season_id,
        name: r.name,
        description: r.description,
        priceUsdc: r.price_usdc,
        emblemUrl: r.emblem_url ?? '',
        isActive: !!r.is_active,
        rewards: rewardsRes.rows.map(rew => ({
          id: rew.id,
          type: rew.type,
          itemId: rew.item_id,
          coinId: rew.coin_id,
          qty: rew.qty
        }))
      });
    }
    res.json(passes);
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/season-passes/:passId/purchases', isAdmin, async (req, res) => {
  const { passId } = req.params;
  try {
    const query = `
      SELECT u.id, u.username, u.email, sp.purchased_at
      FROM season_purchases sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.pass_id = $1
      ORDER BY sp.purchased_at DESC
    `;
    const result = await db.query(query, [passId]);
    res.json(result.rows.map(r => ({
      userId: r.id,
      username: r.username,
      email: r.email,
      purchasedAt: parseInt(r.purchased_at)
    })));
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.delete('/api/season-passes/:passId/purchases/:userId', isAdmin, async (req, res) => {
  const { passId, userId } = req.params;
  try {
    const result = await db.query('DELETE FROM season_purchases WHERE pass_id = $1 AND user_id = $2', [passId, userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Purchase not found' });

    console.log(`[SeasonPass] Admin revoked pass ${passId} for user ${userId}`);
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/season-passes', isAdmin, async (req, res) => {
  const passes = req.body || [];
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query('SELECT id FROM season_passes');
    const existingIds = new Set(existingRes.rows.map(r => r.id));
    const incomingIds = new Set((passes || []).map(p => p.id));

    for (const p of passes) {
      // Update or Insert PASS
      const updRes = await client.query('UPDATE season_passes SET season_id = $1, name = $2, description = $3, price_usdc = $4, emblem_url = $5, is_active = $6 WHERE id = $7',
        [p.seasonId, p.name, p.description, p.priceUsdc, p.emblemUrl ?? null, p.isActive ? 1 : 0, p.id]);

      if (updRes.rowCount === 0) {
        await client.query('INSERT INTO season_passes (id,season_id,name,description,price_usdc,emblem_url,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [p.id, p.seasonId, p.name, p.description, p.priceUsdc, p.emblemUrl ?? null, p.isActive ? 1 : 0]);
      }

      // Handle Rewards: Delete old and insert new (simpler strategy)
      await client.query('DELETE FROM season_pass_rewards WHERE pass_id = $1', [p.id]);
      if (p.rewards && Array.isArray(p.rewards)) {
        for (const r of p.rewards) {
          await client.query(
            'INSERT INTO season_pass_rewards (pass_id, type, item_id, coin_id, qty) VALUES ($1, $2, $3, $4, $5)',
            [p.id, r.type, r.itemId || null, r.coinId || null, r.qty || 0]
          );
        }
      }
    }

    // Soft delete missing passes if no purchases, else mark inactive
    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
        const refRes = await client.query('SELECT COUNT(1) AS c FROM season_purchases WHERE pass_id = $1', [id]);
        const count = parseInt(refRes.rows[0]?.c) || 0;
        if (count > 0) {
          await client.query('UPDATE season_passes SET is_active = 0 WHERE id = $1', [id]);
        } else {
          await client.query('DELETE FROM season_passes WHERE id = $1', [id]);
        }
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

app.get('/api/season-purchases/:email', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const email = String(req.params.email || '').trim().toLowerCase();
  if (!email || email.length > EMAIL_ADDRESS_MAX_LENGTH || /[\x00-\x1f<>]/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  try {
    const uidRes = await db.query('SELECT id FROM users WHERE lower(trim(email::text)) = $1', [email]);
    if (!uidRes.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
    const uid = uidRes.rows[0].id;
    if (Number(uid) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const rowsRes = await db.query('SELECT pass_id, season_id, purchased_at FROM season_purchases WHERE user_id = $1', [uid]);
    const list = rowsRes.rows.map(r => ({ passId: r.pass_id, seasonId: r.season_id, purchasedAt: r.purchased_at }));
    res.json(list);
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/season-pass/purchase', async (req, res) => {
  const { passId } = req.body || {};
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (!passId) return res.status(400).json({ error: 'Missing fields' });
  const uid = req.userId;
  try {
    const { bal, price } = await prisma.$transaction(
      async (tx) => {
        const pass = await tx.season_passes.findUnique({ where: { id: passId } });
        if (!pass) throw new HttpControlledError(404, { error: 'Pass not found' });
        if (!pass.is_active) throw new HttpControlledError(400, { error: 'Pass inactive' });

        const dup = await tx.season_purchases.findUnique({
          where: { user_id_pass_id: { user_id: uid, pass_id: passId } }
        });
        if (dup) throw new HttpControlledError(400, { error: 'Already purchased' });

        const gs = await tx.game_states.findUnique({
          where: { user_id: uid },
          select: { usdc: true }
        });
        const balN = Number(gs?.usdc ?? 0);
        const priceN = Number(pass.price_usdc ?? 0);
        if (balN < priceN) {
          throw new HttpControlledError(400, {
            error: 'Insufficient USDC',
            missing: priceN - balN
          });
        }

        await tx.game_states.updateMany({
          where: { user_id: uid },
          data: { usdc: { decrement: priceN } }
        });

        await tx.season_purchases.create({
          data: {
            user_id: uid,
            pass_id: passId,
            season_id: pass.season_id,
            purchased_at: BigInt(Date.now())
          }
        });

        console.log(`[Purchase] Granting rewards for user ${uid}, pass ${passId}...`);
        await grantPassRewardsInTx(tx, uid, passId, pass.season_id);

        return { bal: balN, price: priceN };
      },
      { timeout: 60_000, maxWait: 10_000 }
    );

    console.log(`[Purchase] VERIFICATION: Checking if items are in stock...`);
    const rewardsCheck = await prisma.season_pass_rewards.findMany({ where: { pass_id: passId } });
    for (const reward of rewardsCheck) {
      if (reward.type === 'item' && reward.item_id) {
        const stockRow = await prisma.stock.findUnique({
          where: { user_id_item_id: { user_id: uid, item_id: reward.item_id } }
        });
        if (stockRow) {
          console.log(
            `[Purchase] ✅ VERIFIED: ${reward.item_id} is in stock (qty: ${stockRow.qty})`
          );
        } else {
          console.error(
            `[Purchase] ❌❌❌ CRITICAL: ${reward.item_id} NOT FOUND in stock for user ${uid}!`
          );
        }
      }
    }
    console.log(`[Purchase] VERIFICATION COMPLETE`);

    res.json({ ok: true, newUsdc: bal - price });
  } catch (e) {
    if (respondIfHttpControlledError(res, e)) return;
    console.error(`[Purchase] ❌ ERROR during purchase:`, e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/season-pass/grant', isAdmin, async (req, res) => {
  const { email, passId } = req.body || {};
  if (!email || !passId) return res.status(400).json({ error: 'Missing fields' });
  try {
    const uid = await getUserIdByEmail(email, req.ip, { allowAnyDomain: true });
    await prisma.$transaction(
      async (tx) => {
        const pass = await tx.season_passes.findUnique({ where: { id: passId } });
        if (!pass) throw new HttpControlledError(404, { error: 'Pass not found' });
        const dup = await tx.season_purchases.findUnique({
          where: { user_id_pass_id: { user_id: uid, pass_id: passId } }
        });
        if (dup) throw new HttpControlledError(400, { error: 'Already purchased' });
        await tx.season_purchases.create({
          data: {
            user_id: uid,
            pass_id: passId,
            season_id: pass.season_id,
            purchased_at: BigInt(Date.now())
          }
        });
        await grantPassRewardsInTx(tx, uid, passId, pass.season_id);
      },
      { timeout: 60_000, maxWait: 10_000 }
    );

    res.json({ ok: true });
  } catch (e) {
    if (respondIfHttpControlledError(res, e)) return;
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});


// --- USERS ---
app.get('/api/users', isAdmin, async (req, res) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const limit = parseInt(String(req.query.limit ?? '50'), 10) || 50;
    const search = req.query.search ? String(req.query.search).toLowerCase() : '';
    const sortBy = req.query.sortBy || 'creation';
    const sortDir = req.query.sortDir === 'desc' ? 'DESC' : 'ASC';
    const filterStatus = req.query.filterStatus || 'all';
    const filterLevel = req.query.filterLevel || 'all';
    const filterAdminsRaw = req.query.filterAdmins;
    const filterAdminsOnly =
      filterAdminsRaw === '1' || String(filterAdminsRaw || '').toLowerCase() === 'true';
    const offset = (page - 1) * limit;

    let whereConditions = [];
    let params = [];
    let paramIdx = 1;

    if (filterAdminsOnly) {
      whereConditions.push(`u.is_admin = 1`);
    }

    // Search Filter
    if (search) {
      whereConditions.push(`(LOWER(u.username) LIKE $${paramIdx} OR LOWER(u.email) LIKE $${paramIdx} OR LOWER(u.polygon_wallet) LIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    // Access Level Filter
    if (filterLevel !== 'all') {
      whereConditions.push(`u.access_level_id = $${paramIdx}`);
      params.push(filterLevel);
      paramIdx++;
    }

    // Status Filter (Online/Offline)
    // Online = Activity in last 5 minutes (300000 ms)
    const fiveMinutesAgo = Date.now() - 300000;
    if (filterStatus === 'online') {
      whereConditions.push(`gs.last_updated_at >= $${paramIdx}`);
      params.push(fiveMinutesAgo);
      paramIdx++;
    } else if (filterStatus === 'offline') {
      whereConditions.push(`(gs.last_updated_at < $${paramIdx} OR gs.last_updated_at IS NULL)`);
      params.push(fiveMinutesAgo);
      paramIdx++;
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Sorting
    let orderByClause = 'ORDER BY u.id ASC'; // Default
    if (sortBy === 'creation') {
      orderByClause = `ORDER BY u.id ${sortDir}`;
    } else if (sortBy === 'alpha') {
      orderByClause = `ORDER BY u.username ${sortDir}`;
    }

    // Count Total (with joins for filtering)
    const countQuery = `
      SELECT COUNT(*) 
      FROM users u
      LEFT JOIN game_states gs ON u.id = gs.user_id
      ${whereClause}
    `;
    const totalRes = await db.query(countQuery, params);
    const total = parseInt(totalRes.rows[0].count);

    // Fetch Users
    const query = `
      SELECT u.* 
      FROM users u
      LEFT JOIN game_states gs ON u.id = gs.user_id
      ${whereClause} 
      ${orderByClause} 
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const uRes = await db.query(query, [...params, limit, offset]);

    const userIds = uRes.rows.map(u => u.id);
    const lvRes = await db.query('SELECT id,name FROM access_levels');

    if (userIds.length === 0) {
      return res.json({ users: [], total, pages: Math.ceil(total / limit), levels: lvRes.rows });
    }

    const refRes = await db.query('SELECT user_id, referred_username FROM referrals WHERE user_id = ANY($1)', [userIds]);
    const gsRes = await db.query('SELECT user_id, last_updated_at, total_usdc_deposited, total_crypto_withdrawn, black_market_balance FROM game_states WHERE user_id = ANY($1)', [userIds]);

    const refMap = refRes.rows.reduce((acc, r) => {
      acc[r.user_id] = acc[r.user_id] || [];
      acc[r.user_id].push(r.referred_username);
      return acc;
    }, {});

    const gsMap = gsRes.rows.reduce((acc, r) => {
      acc[r.user_id] = {
        lastUpdatedAt: r.last_updated_at,
        totalUsdcDeposited: r.total_usdc_deposited || 0,
        totalCryptoWithdrawn: r.total_crypto_withdrawn || 0,
        blackMarketBalance: r.black_market_balance || 0
      };
      return acc;
    }, {});

    const userLvlsRes = await db.query('SELECT user_id, access_level_id FROM user_access_levels WHERE user_id = ANY($1)', [userIds]);
    const userLvlsMap = userLvlsRes.rows.reduce((acc, l) => {
      acc[l.user_id] = acc[l.user_id] || [];
      acc[l.user_id].push(l.access_level_id);
      return acc;
    }, {});

    const users = uRes.rows.map(r => ({
      id: r.id,
      username: r.username,
      email: r.email,
      isAdmin: !!r.is_admin,
      isSuperAdmin: resolveIsSuperAdminFromUserRow({
        is_super_admin: r.is_super_admin,
        is_admin: r.is_admin,
        email: r.email
      }),
      polygonWallet: r.polygon_wallet ?? undefined,
      isBlocked: !!r.is_blocked,
      accessLevelId: r.access_level_id ?? undefined,
      referralCode: r.referral_code ?? undefined,
      referredBy: r.referred_by ?? undefined,
      referrals: refMap[r.id] || [],
      accessLevelIds: Array.from(new Set([
        ...(userLvlsMap[r.id] || []),
        ...(r.access_level_id ? [r.access_level_id] : [])
      ])),
      lastActiveAt: r.last_active_at ? Number(r.last_active_at) : (gsMap[r.id]?.lastUpdatedAt ? Number(gsMap[r.id]?.lastUpdatedAt) : undefined),
      totalUsdcDeposited: (gsMap[r.id]?.totalUsdcDeposited ?? 0),
      totalCryptoWithdrawn: (gsMap[r.id]?.totalCryptoWithdrawn ?? 0),
      adminPermissions: (() => {
        if (!r.is_admin) {
          try {
            return r.admin_permissions ? JSON.parse(r.admin_permissions) : [];
          } catch {
            return [];
          }
        }
        let ap = null;
        try {
          if (r.admin_permissions != null && String(r.admin_permissions).trim() !== '') {
            ap = JSON.parse(r.admin_permissions);
          }
        } catch {
          ap = null;
        }
        if (ap == null) return [];
        return normalizeAdminPermissionsForApi(true, ap);
      })()
    }));

    res.json({ users, total, pages: Math.ceil(total / limit), levels: lvRes.rows });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/admin/users/map', isAdmin, async (req, res) => {
  try {
    const resRows = await db.query(`
      SELECT 
        u.id, 
        u.username, 
        u.polygon_wallet as "polygonWallet", 
        u.email,
        (
          SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('username', r.referred_username, 'email', u2.email)), '[]')
          FROM referrals r
          LEFT JOIN users u2 ON r.referred_username = u2.username
          WHERE r.user_id = u.id
        ) as referrals
      FROM users u
    `);
    res.json(resRows.rows);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- ADVANCED REFERRALS ---
app.get('/api/admin/referral-models', isAdmin, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM referral_models ORDER BY id ASC');
    res.json(rows.rows);
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/admin/referral-models', isAdmin, async (req, res) => {
  const { id, name, description, sender_reward_usdc, receiver_reward_usdc, sender_loot_box_id, receiver_loot_box_id, is_active } = req.body;
  try {
    if (id) {
      await db.query(`
        UPDATE referral_models 
        SET name=$1, description=$2, sender_reward_usdc=$3, receiver_reward_usdc=$4, sender_loot_box_id=$5, receiver_loot_box_id=$6, is_active=$7 
        WHERE id=$8`,
        [name, description, sender_reward_usdc || 0, receiver_reward_usdc || 0, sender_loot_box_id || null, receiver_loot_box_id || null, is_active ? 1 : 0, id]);
      res.json({ ok: true });
    } else {
      await db.query(`
        INSERT INTO referral_models (name, description, sender_reward_usdc, receiver_reward_usdc, sender_loot_box_id, receiver_loot_box_id, is_active) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [name, description, sender_reward_usdc || 0, receiver_reward_usdc || 0, sender_loot_box_id || null, receiver_loot_box_id || null, is_active ? 1 : 0]);
      res.json({ ok: true });
    }
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.delete('/api/admin/referral-models/:id', isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM referral_models WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/admin/access-level-referral-assignments', isAdmin, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM access_level_referral_models');
    res.json(rows.rows.reduce((acc, r) => {
      acc[r.access_level_id] = r.referral_model_id;
      return acc;
    }, {}));
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/admin/access-level-referral-assignments', isAdmin, async (req, res) => {
  const { assignments } = req.body; // { levelId: modelId | null }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const [levelId, modelId] of Object.entries(assignments)) {
      if (modelId === null) {
        await client.query('DELETE FROM access_level_referral_models WHERE access_level_id = $1', [levelId]);
      } else {
        await client.query('INSERT INTO access_level_referral_models (access_level_id, referral_model_id) VALUES ($1, $2) ON CONFLICT (access_level_id) DO UPDATE SET referral_model_id = EXCLUDED.referral_model_id', [levelId, modelId]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

async function computeAdminDashboardStatsUncached() {
  const totalUsersRes = await db.query('SELECT COUNT(*) FROM users WHERE is_admin = 0');
  const nowMs = Date.now();
  const onlineCutoff = nowMs - 4 * 60 * 1000;
  const onlineUsersRes = await db.query(`
      SELECT COUNT(DISTINCT s.user_id) AS count
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE u.is_admin = 0
        AND s.expires_at > $1
        AND COALESCE(NULLIF(s.last_seen_at, 0), s.created_at) > $2
    `, [nowMs, onlineCutoff]);

  const depositsRes = await db.query(`
      SELECT SUM(gs.total_usdc_deposited) as total 
      FROM game_states gs
      JOIN users u ON gs.user_id = u.id
      WHERE u.is_admin = 0
    `);
  const withdrawnRes = await db.query(`
      SELECT SUM(amount_usdc) as total 
      FROM withdrawal_requests 
      WHERE status = 'completed'
    `);

  const last10Res = await db.query('SELECT username, email FROM users WHERE is_admin = 0 ORDER BY id DESC LIMIT 10');

  const topDepositsRes = await db.query(`
      SELECT u.username, u.email, gs.total_usdc_deposited as amount 
      FROM users u 
      JOIN game_states gs ON u.id = gs.user_id 
      WHERE u.is_admin = 0 AND gs.total_usdc_deposited > 0
      ORDER BY gs.total_usdc_deposited DESC LIMIT 10
    `);

  const powerRes = await db.query(`
      WITH rack_base AS (
        SELECT 
          r.id as rack_id,
          r.user_id,
          SUM(COALESCE(u.base_production, 0)) as base_prod
        FROM placed_racks r
        JOIN rack_slots rs ON r.id = rs.rack_id
        LEFT JOIN upgrades u ON rs.machine_item_id = u.id
        LEFT JOIN upgrades b ON r.battery_id = b.id
        WHERE r.is_on = 1 
          AND r.wiring_id IS NOT NULL 
          AND r.battery_id IS NOT NULL
          AND (b.power_capacity = -1 OR r.current_charge > 0)
        GROUP BY r.id, r.user_id
      ),
      rack_mult AS (
        SELECT 
          rms.rack_id,
          1 + SUM(COALESCE(u.multiplier, 0)) as total_mult
        FROM rack_multiplier_slots rms
        JOIN upgrades u ON rms.multiplier_item_id = u.id
        GROUP BY rms.rack_id
      ),
      user_power AS (
        SELECT 
          rb.user_id,
          SUM(rb.base_prod * COALESCE(rm.total_mult, 1)) as power
        FROM rack_base rb
        LEFT JOIN rack_mult rm ON rb.rack_id = rm.rack_id
        GROUP BY rb.user_id
      )
      SELECT 
        up.power,
        u.username,
        u.email,
        u.ranking_excluded
      FROM user_power up
      JOIN users u ON up.user_id = u.id
      WHERE COALESCE(u.ranking_excluded, 0) = 0
      ORDER BY up.power DESC
    `);

  const topMinersList = powerRes.rows.slice(0, 10).map(r => ({
    username: r.username,
    email: r.email,
    amount: Number(r.power)
  }));

  const globalPower = powerRes.rows.reduce((acc, r) => acc + Number(r.power), 0);

  const rankingExcludedRes = await db.query(`
      SELECT username, email FROM users
      WHERE is_admin = 0 AND COALESCE(ranking_excluded, 0) = 1
      ORDER BY LOWER(username)
      LIMIT 200
    `);

  const coinsRes = await db.query('SELECT id, name FROM mining_coins');
  const withdrawalsByCoin = [];
  for (const coin of coinsRes.rows) {
    const topWRes = await db.query(`
        SELECT u.username, u.email, SUM(w.amount_crypto) as total
        FROM users u
        JOIN withdrawal_requests w ON u.id = w.user_id
        WHERE w.coin_id = $1 AND w.status = 'completed'
        GROUP BY u.id
        ORDER BY total DESC LIMIT 10
      `, [coin.id]);
    if (topWRes.rowCount > 0) {
      withdrawalsByCoin.push({
        coinId: coin.id,
        coinName: coin.name,
        top: topWRes.rows.map(r => ({ username: r.username, email: r.email, total: Number(r.total) }))
      });
    }
  }

  return {
    totalUsers: parseInt(String(totalUsersRes.rows[0]?.count ?? 0), 10) || 0,
    onlineUsers: parseInt(String(onlineUsersRes.rows[0]?.count ?? 0), 10) || 0,
    totalDeposited: Number(depositsRes.rows[0]?.total) || 0,
    totalWithdrawn: Number(withdrawnRes.rows[0]?.total) || 0,
    last10: last10Res.rows,
    topDeposits: topDepositsRes.rows.map(r => ({ ...r, amount: Number(r.amount) })),
    topWithdrawalsByCoin: withdrawalsByCoin,
    globalPower: globalPower,
    topMiners: topMinersList,
    rankingExcluded: rankingExcludedRes.rows
  };
}

let dashboardStatsCache = null;
let lastDashboardFetch = 0;
const DASHBOARD_CACHE_TTL = 10000; // 10 seconds cache

app.get('/api/admin/dashboard-stats', isAdmin, async (req, res) => {
  const now = Date.now();
  if (dashboardStatsCache && (now - lastDashboardFetch < DASHBOARD_CACHE_TTL)) {
    return res.json(dashboardStatsCache);
  }

  try {
    dashboardStatsCache = await computeAdminDashboardStatsUncached();
    lastDashboardFetch = Date.now();
    res.json(dashboardStatsCache);
  } catch (e) {
    console.error('[DashStats] Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin/update-permissions', isAdmin, async (req, res) => {
  const { email, isAdmin: targetIsAdmin, permissions, isSuperAdmin: targetSuperRaw } = req.body;
  const emailNorm = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!emailNorm) return res.status(400).json({ error: 'Email obrigatório' });

  try {
    let permsJson = null;
    const hasSuperInBody = Object.prototype.hasOwnProperty.call(req.body, 'isSuperAdmin');
    let superVal = 0;
    if (targetIsAdmin) {
      if (hasSuperInBody) {
        superVal = !!targetSuperRaw ? 1 : 0;
      } else {
        const prev = await db.query(
          'SELECT COALESCE(is_super_admin, 0) AS is_super_admin, COALESCE(is_admin, 0) AS is_admin, email FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
          [emailNorm]
        );
        const prow = prev.rows[0];
        superVal = prow && resolveIsSuperAdminFromUserRow(prow) ? 1 : 0;
      }
    }
    if (targetIsAdmin) {
      if (Array.isArray(permissions)) {
        permsJson = JSON.stringify(ensureAdminPartnersTabInPermissions(ensureAdminSettingsLabelsInPermissions(permissions)));
      } else if (permissions && typeof permissions === 'object') {
        const tabIds = adminPermissionsObjectToTabIds(permissions);
        permsJson = JSON.stringify(ensureAdminPartnersTabInPermissions(ensureAdminSettingsLabelsInPermissions(tabIds)));
      } else {
        permsJson = JSON.stringify(ensureAdminPartnersTabInPermissions(ensureAdminSettingsLabelsInPermissions([])));
      }
    }
    await db.query(
      'UPDATE users SET is_admin = $1, admin_permissions = $2, is_super_admin = $3 WHERE LOWER(TRIM(email)) = $4',
      [targetIsAdmin ? 1 : 0, permsJson, superVal, emailNorm]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[update-permissions] Error:', e);
    res.status(500).json({ error: 'Erro ao atualizar permissões' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const powerRes = await db.query(`
      WITH rack_base AS (
        SELECT 
          r.id as rack_id,
          r.user_id,
          SUM(COALESCE(u.base_production, 0)) as base_prod
        FROM placed_racks r
        JOIN rack_slots rs ON r.id = rs.rack_id
        LEFT JOIN upgrades u ON rs.machine_item_id = u.id
        LEFT JOIN upgrades b ON r.battery_id = b.id
        WHERE r.is_on = 1 
          AND r.wiring_id IS NOT NULL 
          AND r.battery_id IS NOT NULL
          AND (b.power_capacity = -1 OR r.current_charge > 0)
        GROUP BY r.id, r.user_id
      ),
      rack_mult AS (
        SELECT 
          rms.rack_id,
          1 + SUM(COALESCE(u.multiplier, 0)) as total_mult
        FROM rack_multiplier_slots rms
        JOIN upgrades u ON rms.multiplier_item_id = u.id
        GROUP BY rms.rack_id
      ),
      user_power AS (
        SELECT 
          rb.user_id,
          SUM(rb.base_prod * COALESCE(rm.total_mult, 1)) as power
        FROM rack_base rb
        LEFT JOIN rack_mult rm ON rb.rack_id = rm.rack_id
        GROUP BY rb.user_id
      )
      SELECT 
        up.power,
        u.username
      FROM user_power up
      JOIN users u ON up.user_id = u.id
      WHERE COALESCE(u.ranking_excluded, 0) = 0
      ORDER BY up.power DESC
      LIMIT 50
    `);

    res.json(powerRes.rows.map(r => ({
      username: r.username,
      power: Number(r.power)
    })));
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});


// --- REFERRALS ---
app.get('/api/referrals/:email', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  const email = String(req.params.email || '').trim().toLowerCase();
  if (!email || email.length > EMAIL_ADDRESS_MAX_LENGTH || /[\x00-\x1f<>]/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  try {
    const uidRes = await db.query('SELECT id FROM users WHERE lower(trim(email::text)) = $1', [email]);
    if (!uidRes.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
    const uid = uidRes.rows[0].id;
    if (Number(uid) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const rowsRes = await db.query('SELECT referred_username FROM referrals WHERE user_id = $1 ORDER BY id ASC', [uid]);
    res.json(rowsRes.rows.map(r => r.referred_username));
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/referrals/claim-code', referralClaimSensitiveLimiter, async (req, res) => {
  const { code } = req.body || {};
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (code == null || (typeof code === 'string' && !code.trim())) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const codeCheck = validateOptionalReferralCodeInput(code);
  if (!codeCheck.ok) return res.status(400).json({ error: codeCheck.error });
  if (!codeCheck.code) return res.status(400).json({ error: 'Parâmetros inválidos' });
  const codeNormalized = codeCheck.code;
  const client = await db.connect();
  try {
    const uid = req.userId;
    const currentRes = await client.query('SELECT username, referred_by FROM users WHERE id = $1', [uid]);
    const current = currentRes.rows[0];
    if (!current) return res.status(400).json({ error: 'Usuário não encontrado' });
    if (current.referred_by) return res.status(400).json({ error: 'Código já vinculado' });

    const referrerRes = await client.query('SELECT id FROM users WHERE referral_code = $1', [codeNormalized]);
    const referrer = referrerRes.rows[0];
    if (!referrer) return res.status(400).json({ error: 'Código inválido' });
    if (referrer.id === uid) return res.status(400).json({ error: 'Você não pode usar seu próprio código' });

    await client.query('BEGIN');
    await client.query('UPDATE users SET referred_by = $1 WHERE id = $2', [codeNormalized, uid]);
    await client.query(
      `INSERT INTO referrals (user_id, referred_username)
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM referrals r WHERE r.user_id = $1 AND r.referred_username = $2
       )`,
      [referrer.id, current.username]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    if (client) await client.query('ROLLBACK');
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    if (client) client.release();
  }
});

app.post('/api/referrals/claim-reward', referralClaimSensitiveLimiter, async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  return res.status(410).json({
    error: 'Este fluxo foi descontinuado. A comissão de indicação (5% em USDC) é creditada automaticamente quando o indicado deposita USDC.'
  });
});

app.get('/api/wheel/config', async (req, res) => {
  try {
    const items = await fetchWheelPrizesForApiConfig();
    res.json(items);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// --- MINING COINS ---
app.get('/api/mining-coins', async (req, res) => {
  const client = await db.connect();
  try {
    const resDb = await client.query('SELECT * FROM mining_coins ORDER BY name ASC');
    client.release();

    const rows = resDb.rows;
    const coins = rows.map((r) => {
      // Calculate Network Hashrate dynamically or use DB value
      // We prefer the dynamic global variable if available and non-zero
      let usedRate = parseFloat(r.network_hashrate) || 100;
      if (miningRuntimeStats.globalNetworkHashrates.has(String(r.id))) {
        const dyn = miningRuntimeStats.globalNetworkHashrates.get(String(r.id));
        if (dyn > 0) usedRate = dyn;
      }

      return {
        id: r.id,
        name: r.name,
        symbol: r.symbol, // Added symbol
        description: r.description,
        color: r.color,
        algorithm: r.algorithm,
        multiplier: r.multiplier,
        difficulty: r.difficulty,
        minProportion: r.min_proportion,
        usdcRate: r.usdc_rate,
        isActive: !!r.is_active,
        // Injecting standard fields expected by calculator
        networkHashrate: usedRate,
        blockReward: r.block_reward,
        blockTime: r.block_time,
        priceUSD: r.price_usd, // Ensure camelCase matching calculator expectation
        targetDailyUSD: parseFloat(r.target_daily_usd) || 0, // New Field
        showInExchange: !!r.show_in_exchange
      };
    });

    let liveById: Record<string, number | null> = {};
    let liveErr: string | null = null;
    try {
      liveById = await fetchLiveUsdByMiningCoinRowIds(rows);
    } catch (e) {
      liveErr = e instanceof Error ? e.message : String(e);
      console.warn('[GET /api/mining-coins] live USD prices:', liveErr);
    }

    const enriched = coins.map((c, i) => {
      const row = rows[i];
      const id = String(row.id ?? '').trim();
      const live = id ? liveById[id] ?? null : null;
      const dbP = Number(row.price_usd ?? 0);
      return {
        ...c,
        livePriceUsd: live,
        displayPriceUsd: typeof live === 'number' && Number.isFinite(live) ? live : dbP
      };
    });

    if (String(req.query.legacy ?? '') === '1') {
      res.json(enriched);
    } else {
      res.json({
        coins: enriched,
        economy: MINING_ECONOMY_PUBLIC_META,
        livePricesError: liveErr
      });
    }
  } catch (e) { if (client) client.release(); sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/mining-coins', isAdmin, async (req, res) => {
  const payload = req.body;
  // Support both array (bulk) and single object (edit)
  const coins = Array.isArray(payload) ? payload : [payload];

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const c of coins) {
      // 1. Data Sanitization & Defaults
      const id = c.id || crypto.randomUUID();
      const name = c.name || 'Unknown';
      const symbol = c.symbol || '';
      const desc = c.description || '';
      const color = c.color || '#ffffff';
      const algo = c.algorithm || 'Unknown';

      const netRaw = parseFloat(c.networkHashrate);
      const netHash = Math.max(
        1_000_000,
        roundMiningEconomyField8Decimals(Math.max(0, Number.isFinite(netRaw) ? netRaw : 0))
      );
      const blockRew = roundMiningEconomyField8Decimals(Math.max(0, parseFloat(c.blockReward) || 0));
      const blockTime = MINING_BLOCK_TIME_SECONDS_FIXED;
      const price = roundMiningEconomyField8Decimals(Math.max(0, parseFloat(c.priceUSD) || 0));
      const diff = roundMiningEconomyField8Decimals(Math.max(1, parseFloat(c.difficulty) || 1));
      const mult = roundMiningEconomyField8Decimals(Math.max(1, parseFloat(c.multiplier) || 1));
      const minProp = roundMiningEconomyField8Decimals(Math.max(0, parseFloat(c.minProportion) || 0));
      const usdcRate = roundMiningEconomyField8Decimals(Math.max(0, parseFloat(c.usdcRate) || price));
      const targetDaily = roundMiningEconomyField8Decimals(Math.max(0, parseFloat(c.targetDailyUSD) || 0));

      // Check isActive. Frontend sends boolean or 1/0.
      let isActive = 1;
      if (c.isActive === false || c.isActive === 0) isActive = 0;

      let prevEmission: { block_reward: unknown; block_time: unknown; network_hashrate: unknown } | null = null;
      try {
        const pr = await client.query(
          'SELECT block_reward, block_time, network_hashrate FROM mining_coins WHERE id = $1',
          [id]
        );
        prevEmission = pr.rows[0] || null;
      } catch {
        prevEmission = null;
      }

      // 2. UPSERT Logic
      await client.query(`
        INSERT INTO mining_coins (
          id, name, symbol, description, color, algorithm,
          network_hashrate, block_reward, block_time, price_usd, difficulty,
          multiplier, min_proportion, usdc_rate, is_active, target_daily_usd, show_in_exchange
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          description = EXCLUDED.description,
          color = EXCLUDED.color,
          algorithm = EXCLUDED.algorithm,
          network_hashrate = EXCLUDED.network_hashrate,
          block_reward = EXCLUDED.block_reward,
          block_time = EXCLUDED.block_time,
          price_usd = EXCLUDED.price_usd,
          difficulty = EXCLUDED.difficulty,
          multiplier = EXCLUDED.multiplier,
          min_proportion = EXCLUDED.min_proportion,
          usdc_rate = EXCLUDED.usdc_rate,
          is_active = EXCLUDED.is_active,
          target_daily_usd = EXCLUDED.target_daily_usd,
          show_in_exchange = EXCLUDED.show_in_exchange
      `, [
        id, name, symbol, desc, color, algo,
        netHash, blockRew, blockTime, price, diff,
        mult, minProp, usdcRate, isActive ? 1 : 0, targetDaily,
        c.showInExchange ? 1 : 0
      ]);

      const oldY = prevEmission
        ? spotYieldPerHashForCoin(
            id,
            Number(prevEmission.block_reward),
            Number(prevEmission.block_time),
            Number(prevEmission.network_hashrate)
          )
        : null;
      const newY = spotYieldPerHashForCoin(id, blockRew, blockTime, netHash);
      if (
        oldY === null ||
        !Number.isFinite(oldY) ||
        !Number.isFinite(newY) ||
        Math.abs(oldY - newY) > SPOT_YIELD_EPS
      ) {
        await client.query(
          'INSERT INTO mining_yield_history (coin_id, yield_per_hash, block_reward, network_hashrate, effective_at) VALUES ($1, $2, $3, $4, $5)',
          [id, newY, blockRew, netHash, Date.now()]
        );
      }

      // 3. Deactivation Logic: Turn OFF Rigs
      if (isActive === 0) {
        console.log(`[Mining] Coin ${symbol} (${id}) deactivated. Turning off associated rigs...`);
        // Turn off racks mining this coin
        await client.query(`
          UPDATE placed_racks 
          SET is_on = 0 
          WHERE selected_coin_id = $1
        `, [id]);
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[SaveMiningCoin] Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const emailStr = typeof email === 'string' ? email : '';
  const passwordStr = typeof password === 'string' ? password : '';
  const present = validateLoginFieldsPresent(email, password);
  if (!present.ok) return res.status(400).json({ error: present.error });
  const emailCheck = validateLoginEmail(emailStr);
  if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });
  const passwordCheck = validateLoginPassword(passwordStr);
  if (!passwordCheck.ok) return res.status(400).json({ error: passwordCheck.error });
  try {
    const normalizedEmail = emailStr.trim().toLowerCase();
    let u = await findUserByEmail(normalizedEmail);

    if (!u) {
      await bcrypt.compare(passwordStr, '$2b$10$abcdefghijklmnopqrstuvwxyz123456');
      return res.status(401).json({ error: 'E-mail ou palavra-passe incorretos.' });
    }

    if (u.is_blocked) return res.status(403).json({ error: 'Este usuário está bloqueado.' });

    if (!u.password) {
      const hashedPassword = await bcrypt.hash(passwordStr, 10);
      await updateUserPasswordHash(u.id, hashedPassword);
      u = { ...u, password: hashedPassword };
    }

    let isMatch = false;
    const pwd = String(u.password ?? '');
    if (pwd && (pwd.startsWith('$2a$') || pwd.startsWith('$2b$'))) {
      try {
        isMatch = await bcrypt.compare(passwordStr, pwd);
      } catch (bcError) {
        console.error('[Login] bcrypt:', bcError.message || bcError);
      }
    } else if (pwd === passwordStr) {
      isMatch = true;
      const hashedPassword = await bcrypt.hash(passwordStr, 10);
      await updateUserPasswordHash(u.id, hashedPassword);
      u = { ...u, password: hashedPassword };
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'E-mail ou palavra-passe incorretos.' });
    }

    const currentIp = getClientIp(req);
    try {
      await recordLoginIp(u.id, currentIp);
      u = { ...u, registration_ip: u.registration_ip ?? currentIp };
    } catch (ipErr) {
      console.error('[Login] Erro ao registrar histórico de IP:', ipErr.message);
    }

    const referralCode = await ensureUserReferralCode(
      u.id,
      String(u.username ?? ''),
      u.referral_code as string | null | undefined
    );
    u = { ...u, referral_code: referralCode };

    const sid = crypto.randomUUID();
    const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
    await insertSession(sid, u.id, Date.now(), expiresAt);

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${30 * 24 * 3600}`);
    try {
      await issueJwtAuthCookies(res, u.id, req);
    } catch (jwtErr) {
      console.error('[Login] JWT cookies:', jwtErr);
    }

    let adminPerms = null;
    try {
      if (u.admin_permissions) adminPerms = JSON.parse(String(u.admin_permissions));
    } catch (pe) {
      console.error('[Login] Failed to parse admin_permissions:', pe);
    }
    adminPerms = normalizeAdminPermissionsForApi(!!u.is_admin, adminPerms);

    const userLvlIds = await listUserAccessLevelIds(u.id, u.access_level_id);

    res.json({
      id: String(u.id),
      email: u.email,
      username: u.username,
      isAdmin: !!u.is_admin,
      isSuperAdmin: resolveIsSuperAdminFromUserRow({
        is_super_admin: u.is_super_admin,
        is_admin: u.is_admin,
        email: u.email
      }),
      isBlocked: !!u.is_blocked,
      adminPermissions: adminPerms,
      polygonWallet: u.polygon_wallet,
      accessLevelId: u.access_level_id,
      accessLevelIds: userLvlIds,
      referralCode: u.referral_code,
      referredBy: u.referred_by
    });
  } catch (e) {
    console.error('[Login]', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.get('/api/session', async (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  let isImpersonating = false;
  let targetUserId = req.userId;
  try {
    let sidSession: Record<string, unknown> | null = null;
    if (sid) {
      const s = await findSessionRow(sid);
      if (s && Number(s.expires_at) >= Date.now()) {
        sidSession = s;
        isImpersonating = !!s.original_user_id;
        if (!targetUserId) targetUserId = s.user_id;
      }
    }
    if (!targetUserId) return res.status(401).json({ error: 'No session', code: 'AUTH_REQUIRED' });

    const parsePositiveUserId = (raw: unknown): number | null => {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };

    let uid = parsePositiveUserId(targetUserId);
    let u = uid != null ? await findUserById(uid) : undefined;

    /** JWT pode apontar para um id órfão após restore/migração; cookie `sid` pode ainda refletir outro utilizador válido. */
    if (!u && sidSession) {
      const sidUid = parsePositiveUserId(sidSession.user_id);
      if (sidUid != null && sidUid !== uid) {
        const u2 = await findUserById(sidUid);
        if (u2) {
          u = u2;
          uid = sidUid;
        }
      }
    }

    if (!u) {
      clearAuthCookies(res);
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.append('Set-Cookie', `sid=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
      return res.status(401).json({
        error: 'Sessão inválida ou conta já não existe. Inicie sessão novamente.',
        code: 'USER_NOT_FOUND'
      });
    }

    const userLvlIds = await listUserAccessLevelIds(u.id, u.access_level_id);
    let adminPerms = null;
    try {
      if (u.admin_permissions) adminPerms = JSON.parse(u.admin_permissions);
    } catch (pe) {
      console.error('[Session] Failed to parse admin_permissions:', pe);
    }
    adminPerms = normalizeAdminPermissionsForApi(!!u.is_admin, adminPerms);
    res.json({
      id: u.id,
      username: u.username,
      email: u.email,
      isAdmin: !!u.is_admin,
      isSuperAdmin: resolveIsSuperAdminFromUserRow({
        is_super_admin: u.is_super_admin,
        is_admin: u.is_admin,
        email: u.email
      }),
      adminPermissions: adminPerms,
      isBlocked: !!u.is_blocked,
      polygonWallet: u.polygon_wallet,
      accessLevelId: u.access_level_id,
      accessLevelIds: userLvlIds,
      referralCode: u.referral_code,
      referredBy: u.referred_by,
      isImpersonating
    });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/auth/refresh', async (req, res) => handleJwtRefresh(req, res, parseCookies));

app.post('/api/logout', async (req, res) => {
  const sid = parseCookies(req).sid;
  let uid = req.userId;
  try {
    if (!uid && sid) {
      uid = await findSessionUserIdIgnoringExpiry(sid);
    }
    if (uid) await revokeJwtRefreshForUser(uid);
    if (sid) await deleteSessionBySessionId(sid);
  } catch (e) {
    console.error('[Logout]', e.message);
  }
  clearAuthCookies(res);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `sid=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
  res.json({ ok: true });
});

app.post('/api/session', async (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  let uid = req.userId;
  try {
    if (!uid && sid) {
      uid = await findActiveSessionUserId(sid);
    }
    if (!uid) return res.status(401).json({ error: 'No session', code: 'AUTH_REQUIRED' });
    const { polygonWallet } = req.body || {};
    await updateUserPolygonAndAccess(uid, polygonWallet);
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.get('/api/load-game', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Sessão inválida' });

  try {
    const uid = req.userId;
    await computeProgressForUser(db, uid, Date.now());

    const [
      gsRow,
      stockRows,
      boxRows,
      batRows,
      rackRows,
      coinRows,
      workshopRows,
      dailyRows,
      claimedRows,
      u
    ] = await Promise.all([
      prisma.game_states.findUnique({ where: { user_id: uid } }),
      prisma.stock.findMany({ where: { user_id: uid } }),
      prisma.unopened_boxes.findMany({ where: { user_id: uid } }),
      prisma.stored_batteries.findMany({ where: { user_id: uid } }),
      prisma.placed_racks.findMany({ where: { user_id: uid } }),
      prisma.coin_balances.findMany({ where: { user_id: uid } }),
      prisma.workshop_slots.findMany({ where: { user_id: uid }, orderBy: { slot_index: 'asc' } }),
      prisma.daily_actions.findMany({ where: { user_id: uid } }),
      prisma.player_claimed_boxes.findMany({ where: { user_id: uid }, select: { box_id: true } }),
      prisma.users.findUnique({
        where: { id: uid },
        select: { referred_by: true, username: true, email: true }
      })
    ]);

    if (!u) {
      return res.status(404).json({ error: 'Utilizador não encontrado' });
    }

    const nowMs = Date.now();
    const gs =
      gsRow ||
      ({
        usdc: 0,
        start_time: BigInt(nowMs),
        claimed_referrals: 0,
        referral_bonus_claimed: 0,
        last_updated_at: BigInt(nowMs),
        black_market_balance: 0
      } as NonNullable<typeof gsRow>);

    const stock: Record<string, number> = {};
    stockRows.forEach((r) => {
      if (!isValidSaveGameItemId(r.item_id)) return;
      stock[r.item_id] = r.qty;
    });
    const unopenedBoxes: Record<string, number> = {};
    boxRows.forEach((r) => {
      unopenedBoxes[r.box_id] = r.qty;
    });
    const storedBatteries = batRows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      currentCharge: r.current_charge,
      powerCapacityWh: (r as { power_capacity_wh?: number | null }).power_capacity_wh != null
        ? Number((r as { power_capacity_wh?: number | null }).power_capacity_wh)
        : null,
      displayName: (r as { display_name?: string | null }).display_name != null ? String((r as { display_name?: string | null }).display_name) : null,
      imageUrl: (r as { image_url?: string | null }).image_url != null ? String((r as { image_url?: string | null }).image_url) : null,
      workshopSlotIndex:
        (r as { workshop_slot_index?: number | null }).workshop_slot_index != null
          ? Number((r as { workshop_slot_index?: number | null }).workshop_slot_index)
          : null,
      workshopComponentSlotId:
        (r as { workshop_component_slot_id?: string | null }).workshop_component_slot_id != null
          ? String((r as { workshop_component_slot_id?: string | null }).workshop_component_slot_id)
          : null
    }));

    const racks: Array<{
      id: string;
      itemId: string;
      slots: unknown[];
      multiplierSlots: unknown[];
      wiringId: string | null;
      batteryId: string | null;
      currentCharge: number;
      isOn: boolean;
      selectedCoinId: string | null;
      roomId: string;
      slotIndex: number;
      batteryCatalogItemId?: string | null;
      batteryPowerCapacityWh?: number | null;
      batteryDisplayName?: string | null;
      batteryImageUrl?: string | null;
    }> = [];
    const rackIds = rackRows.map((r) => r.id);
    if (rackIds.length > 0) {
      const [slotsList, multiList] = await Promise.all([
        prisma.rack_slots.findMany({
          where: { rack_id: { in: rackIds } },
          orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }]
        }),
        prisma.rack_multiplier_slots.findMany({
          where: { rack_id: { in: rackIds } },
          orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }]
        })
      ]);
      const slotsMap = new Map<string, unknown[]>();
      const multipliersMap = new Map<string, unknown[]>();
      slotsList.forEach((s) => {
        if (!slotsMap.has(s.rack_id)) slotsMap.set(s.rack_id, []);
        slotsMap.get(s.rack_id)![s.slot_index] = s.machine_item_id;
      });
      multiList.forEach((m) => {
        if (!multipliersMap.has(m.rack_id)) multipliersMap.set(m.rack_id, []);
        multipliersMap.get(m.rack_id)![m.slot_index] = m.multiplier_item_id;
      });
      for (const r of rackRows) {
        racks.push({
          id: r.id,
          itemId: r.item_id,
          slots: slotsMap.get(r.id) || [],
          multiplierSlots: multipliersMap.get(r.id) || [],
          wiringId: r.wiring_id,
          batteryId: r.battery_id,
          currentCharge: r.current_charge,
          isOn: !!r.is_on,
          selectedCoinId: r.selected_coin_id,
          roomId: normalizePlacedRackRoomId(r.room_id),
          slotIndex: r.slot_index || 0,
          batteryCatalogItemId: (r as { battery_catalog_item_id?: string | null }).battery_catalog_item_id ?? null,
          batteryPowerCapacityWh:
            (r as { battery_power_capacity_wh?: number | null }).battery_power_capacity_wh != null
              ? Number((r as { battery_power_capacity_wh?: number | null }).battery_power_capacity_wh)
              : null,
          batteryDisplayName: (r as { battery_display_name?: string | null }).battery_display_name ?? null,
          batteryImageUrl: (r as { battery_image_url?: string | null }).battery_image_url ?? null
        });
      }
    }

    const workshopSlots = [null, null, null, null, null, null];
    workshopRows.forEach((w) => {
      if (w.slot_index >= 0 && w.slot_index < 6) {
        workshopSlots[w.slot_index] = {
          id: `ws_${uid}_${w.slot_index}`,
          itemId: w.item_id,
          internalSlots: safeWorkshopJsonObject(w.internal_state, 'workshop_slots.internal_state', uid),
          currentCharge: w.current_charge ?? 0,
          slotCharges: safeWorkshopJsonObject(w.slot_charges, 'workshop_slots.slot_charges', uid),
          slotItemIds: safeWorkshopJsonObject(w.slot_item_ids, 'workshop_slots.slot_item_ids', uid)
        };
      }
    });

    try {
      await enrichWorkshopSlotsSlotItemIdsFromChargingHistory(db, String(u.email || ''), workshopSlots);
    } catch (e) {
      console.warn('[load-game] enrich workshop slotItemIds:', e instanceof Error ? e.message : String(e));
    }

    const coinBalances: Record<string, number> = {};
    coinRows.forEach((c) => {
      coinBalances[c.coin_id] = c.amount;
    });

    const dailyActions: Record<string, number> = {};
    dailyRows.forEach((r) => {
      dailyActions[r.action_key] = Number(r.last_performed_at);
    });

    res.json({
      gameState: {
        usdc: gs.usdc,
        startTime: Number(gs.start_time),
        lastUpdatedAt: Number(gs.last_updated_at),
        claimedReferrals: gs.claimed_referrals,
        referralBonusClaimed: !!gs.referral_bonus_claimed,
        blackMarketBalance: gs.black_market_balance,
        dailyActions
      },
      stock,
      unopenedBoxes,
      storedBatteries,
      placedRacks: racks,
      workshopSlots,
      coinBalances,
      claimedBoxes: claimedRows.map((r) => r.box_id)
    });

  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

async function markServerUpdate(uid) {
  try {
    await prisma.game_states.updateMany({
      where: { user_id: uid },
      data: { server_updated_at: BigInt(Date.now()) }
    });
  } catch (e) { console.error('Failed to mark server update', e); }
}

app.put('/api/users/block', isAdmin, async (req, res) => {
  const { email, blocked } = req.body;
  try {
    const em = String(email || '').trim();
    await prisma.users.updateMany({
      where: { email: { equals: em, mode: 'insensitive' } },
      data: { is_blocked: blocked ? 1 : 0 }
    });
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.put('/api/user', async (req, res) => {
  const u = req.body;
  const normalizedEmail = String(u.email || '')
    .toLowerCase()
    .trim();
  console.log(`[UserUpdate] Payload received for email: ${normalizedEmail}, userId: ${req.userId}`);
  try {
    let uid;
    if (req.userId) {
      // Check if admin
      const actor = await prisma.users.findUnique({
        where: { id: req.userId },
        select: { is_admin: true }
      });
      const isAdmin = actor?.is_admin;

      if (isAdmin) {
        let resolvedAdminTarget = false;
        if (u.id != null && String(u.id).trim() !== '') {
          const idNum = parseInt(String(u.id).trim(), 10);
          if (Number.isFinite(idNum) && idNum > 0) {
            const idRow = await prisma.users.findUnique({ where: { id: idNum }, select: { id: true } });
            if (idRow) {
              uid = idNum;
              resolvedAdminTarget = true;
            }
          }
        }
        if (!resolvedAdminTarget) {
          if (!normalizedEmail) {
            return res.status(400).json({ error: 'ID ou email do utilizador a editar é obrigatório.' });
          }
          const byEmail = await prisma.users.findFirst({
            where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
            select: { id: true }
          });
          if (!byEmail) {
            return res.status(404).json({ error: 'Utilizador não encontrado para este email. Não foi criada conta nova (evita erros de digitação).' });
          }
          uid = byEmail.id;
        }
      } else {
        uid = req.userId;
      }
    } else {
      // Se não estiver logado, permitimos apenas se for uma "finalização de cadastro"
      // ou seja, o usuário existe no DB (pré-criado) mas não tem senha ainda.
      if (!u.email) {
        return res.status(400).json({ error: 'Email é obrigatório para o registro.' });
      }
      const existingRes = await db.query('SELECT password FROM users WHERE email = $1', [normalizedEmail]);
      const existing = existingRes.rows[0];
      if (existing && existing.password) {
        return res.status(403).json({ error: 'Este email já está cadastrado. Por favor, faça login.' });
      }
      if (!existing) {
        const ev = assertPublicSignupEmailAllowed(normalizedEmail);
        if (!ev.ok) {
          return res.status(400).json({ ok: false, error: ev.error });
        }
      }
      if (!normalizedEmail.includes('@') || normalizedEmail.length > SIGNUP_EMAIL_MAX_TOTAL) {
        return res.status(400).json({ error: 'E-mail inválido.' });
      }
      uid = await getUserIdByEmail(normalizedEmail, getClientIp(req));
    }

    const hasPassword = typeof u.password === 'string' && u.password.trim().length > 0;

    if (req.userId) {
      const actRes = await db.query(
        'SELECT COALESCE(is_admin,0) AS is_admin, COALESCE(is_super_admin,0) AS is_super_admin, email FROM users WHERE id = $1',
        [req.userId]
      );
      const actorIsAdmin = !!actRes.rows[0]?.is_admin;
      const actorIsSuper = actRes.rows[0]
        ? resolveIsSuperAdminFromUserRow(actRes.rows[0])
        : false;
      if (actorIsAdmin) {
        const tgtRes = await db.query(
          'SELECT COALESCE(is_admin,0) AS is_admin, COALESCE(is_super_admin,0) AS is_super_admin, LOWER(TRIM(COALESCE(email, \'\'))) AS cur_email FROM users WHERE id = $1',
          [uid]
        );
        const targetIsAdmin = !!tgtRes.rows[0]?.is_admin;
        const targetIsSuperAdmin = tgtRes.rows[0]
          ? resolveIsSuperAdminFromUserRow(tgtRes.rows[0])
          : false;
        const curEmail = String(tgtRes.rows[0]?.cur_email || '');
        const nextEmail = String(normalizedEmail || '').trim().toLowerCase();
        const emailChanging = nextEmail !== curEmail;
        const editingOther = Number(req.userId) !== Number(uid);
        if (targetIsAdmin && editingOther && !actorIsSuper && emailChanging) {
          return res.status(403).json({
            error: 'Apenas super administradores podem alterar o email de outras contas administrador.'
          });
        }
        if (hasPassword && editingOther && targetIsSuperAdmin && !actorIsSuper) {
          return res.status(403).json({
            error: 'Apenas super administradores podem alterar a senha de contas super administrador.'
          });
        }
      }
    }

    let allowAccessLevelFromBody = !req.userId;
    if (req.userId) {
      const gateRes = await db.query('SELECT COALESCE(is_admin,0) AS a FROM users WHERE id = $1', [req.userId]);
      allowAccessLevelFromBody = !!gateRes.rows[0]?.a;
    }
    let accessLevelIdForUpdate = u.accessLevelId ?? null;
    if (!allowAccessLevelFromBody) {
      const curLv = await db.query('SELECT access_level_id FROM users WHERE id = $1', [uid]);
      accessLevelIdForUpdate = curLv.rows[0]?.access_level_id ?? null;
    } else if (u.accessLevelId != null && String(u.accessLevelId).trim() !== '') {
      const al = validateOptionalAccessLevelId(u.accessLevelId);
      if (al && typeof al === 'object' && 'error' in al) {
        return res.status(400).json({ error: (al as { error: string }).error });
      }
      if (typeof al === 'string') {
        accessLevelIdForUpdate = al;
      }
    }

    let usernameForUpdate: unknown = u.username;
    if (!req.userId) {
      const userVu = validateSignupUsername(u.username);
      if (!userVu.ok) {
        return res.status(400).json({ error: userVu.error });
      }
      usernameForUpdate = userVu.username;
    } else if (typeof u.username === 'string' && u.username.trim() !== '') {
      usernameForUpdate = u.username.trim();
    }

    if (hasPassword) {
      const pv = validateSignupPassword(u.password, true);
      if (!pv.ok) {
        return res.status(400).json({ error: pv.error });
      }
    }

    const polygonWalletInBody =
      u && typeof u === 'object' && Object.prototype.hasOwnProperty.call(u, 'polygonWallet');
    let polygonForUpdate: string | null | undefined = undefined;
    if (polygonWalletInBody) {
      const pwc = validateOptionalPolygonWallet(u.polygonWallet);
      if (pwc && typeof pwc === 'object' && 'error' in pwc) {
        return res.status(400).json({ error: (pwc as { error: string }).error });
      }
      polygonForUpdate = typeof pwc === 'string' ? pwc : null;
    }

    const refVal = validateOptionalReferralCodeInput(u.referredBy);
    if (!refVal.ok) {
      return res.status(400).json({ error: refVal.error });
    }
    const referredByForUpdate = refVal.code;

    let accessLevelIdsValidated: string[] | null = null;
    if (allowAccessLevelFromBody && Array.isArray(u.accessLevelIds)) {
      const av = validateAccessLevelIdsArray(u.accessLevelIds);
      if (!av.ok) {
        return res.status(400).json({ error: av.error });
      }
      accessLevelIdsValidated = av.ids;
    }

    const passwordHash = hasPassword ? await bcrypt.hash(u.password, 10) : null;
    const clientIpReferral = getClientIp(req);

    await prisma.$transaction(async (tx) => {
      await executeUserPutCoreTransaction(tx, {
        uid: Number(uid),
        usernameForUpdate: String(usernameForUpdate ?? ''),
        normalizedEmail,
        passwordHash,
        polygonForUpdate:
          polygonForUpdate === undefined
            ? undefined
            : polygonForUpdate == null || polygonForUpdate === ''
              ? null
              : String(polygonForUpdate),
        accessLevelIdForUpdate:
          accessLevelIdForUpdate == null || accessLevelIdForUpdate === ''
            ? null
            : String(accessLevelIdForUpdate),
        referredByForUpdate:
          referredByForUpdate == null || referredByForUpdate === ''
            ? null
            : String(referredByForUpdate),
        allowAccessLevelFromBody,
        accessLevelIdsValidated,
        clientIpReferral
      });
    });

    console.log(`[UserUpdate] Success for uid: ${uid}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[UserUpdate] Error:', e);
    if (e instanceof IpLimitError) {
      return res.status(403).json({
        error: e.message,
        code: 'IP_LIMIT_REACHED',
        accounts: e.existingAccounts
      });
    }
    if (e instanceof EmailPolicyError) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    if (e.existingAccounts) {
      return res.status(403).json({
        error: e.message,
        code: 'IP_LIMIT_REACHED',
        accounts: e.existingAccounts
      });
    }
    if (e.code === 'EMAIL_POLICY') {
      return res.status(400).json({ ok: false, error: e.message });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return res.status(409).json({
        error: 'Este e-mail ou nome de utilizador já está em uso.',
        code: 'DUPLICATE'
      });
    }
    sendInternalErrorSafeMessageOrPrisma(
      res,
      '[UserUpdate]',
      e,
      'Erro interno no servidor durante o registro.'
    );
  }
});

async function deleteUserByEmail(email, client) {
  const dbClient = client || await db.connect();
  const wasOwner = !client;

  try {
    if (wasOwner) await dbClient.query('BEGIN');

    const trimmed = String(email || '').trim();
    if (!trimmed) {
      if (wasOwner) await dbClient.query('ROLLBACK');
      return { ok: false, error: 'Email inválido.' };
    }
    const lower = trimmed.toLowerCase();
    // Emails na BD podem ter maiúsculas diferentes; comparar sempre em minúsculas.
    let userRes = await dbClient.query(
      'SELECT id, username, polygon_wallet, email FROM users WHERE lower(trim(email::text)) = $1',
      [lower]
    );
    // Duas contas com o mesmo e-mail ignorando maiúsculas: desambiguar pelo valor exacto vindo do painel.
    if (userRes.rowCount > 1) {
      const exactRes = await dbClient.query(
        'SELECT id, username, polygon_wallet, email FROM users WHERE lower(trim(email::text)) = $1 AND email = $2',
        [lower, trimmed]
      );
      if (exactRes.rowCount === 1) {
        userRes = exactRes;
      } else {
        throw new Error(
          'Existem várias contas com o mesmo e-mail (só difere maiúsculas). Corrige os e-mails na base de dados ou remove por ID.'
        );
      }
    }

    if (userRes.rowCount === 0) {
      if (wasOwner) await dbClient.query('ROLLBACK');
      return { ok: false, error: 'Utilizador não encontrado.' };
    }

    const { id: uid, username, polygon_wallet: wallet } = userRes.rows[0];

    // FKs sem ON DELETE CASCADE (bloqueiam DELETE em users se não limpar antes)
    await dbClient.query('DELETE FROM support_ticket_replies WHERE admin_user_id = $1', [uid]);
    await dbClient.query('DELETE FROM support_tickets WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM p2p_market_trade_history WHERE buyer_id = $1 OR seller_id = $1', [uid]);
    await dbClient.query('UPDATE sessions SET original_user_id = NULL WHERE original_user_id = $1', [uid]);
    try {
      await dbClient.query('UPDATE partner_youtube_submissions SET reviewed_by = NULL WHERE reviewed_by = $1', [uid]);
      await dbClient.query('UPDATE partner_youtube_creator_profiles SET updated_by = NULL WHERE updated_by = $1', [uid]);
      await dbClient.query('UPDATE partner_youtube_manual_allowlist SET added_by = NULL WHERE added_by = $1', [uid]);
      await dbClient.query('DELETE FROM partner_youtube_manual_allowlist WHERE user_id = $1', [uid]);
    } catch (partnerErr) {
      const code = partnerErr && typeof partnerErr === 'object' && 'code' in partnerErr ? (partnerErr as { code?: string }).code : '';
      if (code !== '42P01') throw partnerErr;
    }

    // Delete in child-to-parent order
    await dbClient.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM referrals WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM player_news_submissions WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM admin_upgrade_purchases WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM season_purchases WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM user_rig_rooms WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM stock WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM unopened_boxes WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM stored_batteries WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM coin_balances WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM coin_withdrawals WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM withdrawal_requests WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM user_history_ips WHERE user_id = $1', [uid]);

    // Handle racks and slots
    await dbClient.query('DELETE FROM rack_slots WHERE rack_id IN (SELECT id FROM placed_racks WHERE user_id = $1)', [uid]);
    await dbClient.query('DELETE FROM rack_multiplier_slots WHERE rack_id IN (SELECT id FROM placed_racks WHERE user_id = $1)', [uid]);
    await dbClient.query('DELETE FROM placed_racks WHERE user_id = $1', [uid]);

    await dbClient.query('DELETE FROM player_listings WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM workshop_slots WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM daily_actions WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM promo_code_redemptions WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM player_claimed_boxes WHERE user_id = $1', [uid]);
    await dbClient.query('DELETE FROM game_states WHERE user_id = $1', [uid]);

    // Handle tables linked by other identifiers
    if (username) await dbClient.query('DELETE FROM wheel_players WHERE username = $1', [username]);
    if (wallet) await dbClient.query('DELETE FROM nft_items WHERE owner_address = $1', [wallet]);

    // Finally delete the user
    await dbClient.query('DELETE FROM users WHERE id = $1', [uid]);

    if (wasOwner) await dbClient.query('COMMIT');
    return { ok: true };
  } catch (e) {
    if (wasOwner) await dbClient.query('ROLLBACK');
    throw e;
  } finally {
    if (wasOwner) dbClient.release();
  }
}

app.delete('/api/user/:email', isAdmin, async (req, res) => {
  try {
    const trimmed = String(req.params.email || '').trim();
    const lower = trimmed.toLowerCase();
    if (!lower) {
      return res.status(400).json({ ok: false, error: 'Email inválido.' });
    }
    if (!req.isSuperAdmin) {
      const admChk = await db.query(
        'SELECT id, COALESCE(is_admin,0) AS is_admin FROM users WHERE lower(trim(email::text)) = $1',
        [lower]
      );
      const actorId = Number(req.userId);
      const blocksOtherAdmin = admChk.rows.some(
        (row) => !!row.is_admin && Number(row.id) !== actorId
      );
      if (blocksOtherAdmin) {
        return res.status(403).json({
          ok: false,
          error: 'Apenas super administradores podem excluir outras contas administrador.'
        });
      }
    }
    const result = await deleteUserByEmail(req.params.email, null);
    res.json(result);
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin/bulk-delete', isAdmin, async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'Emails array required' });

  console.log(`[Admin] Bulk deleting ${emails.length} users started...`);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const email of emails) {
      await deleteUserByEmail(email, client);
    }
    await client.query('COMMIT');
    console.log(`[Admin] Bulk deleting ${emails.length} users finished successfully.`);
    res.json({ ok: true, count: emails.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[Admin] Bulk delete failed:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

app.post('/api/admin/bulk-gift', isAdmin, async (req, res) => {
  const { emails, gift } = req.body;
  if (!Array.isArray(emails) || !gift) return res.status(400).json({ error: 'Emails and gift object required' });

  const { type, id, qty } = gift; // type: 'usdc' | 'item' | 'box' | 'coin'
  const amount = parseFloat(qty) || 0;
  if (amount <= 0 && type !== 'item') return res.status(400).json({ error: 'Invalid quantity' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const email of emails) {
      const userRes = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (userRes.rowCount === 0) continue;
      const uid = userRes.rows[0].id;

      if (type === 'usdc') {
        await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [amount, uid]);
        // REFERRAL COMMISSION (DEPOSIT)
        await processReferralCommission(client, uid, amount, 'deposit');
      } else if (type === 'item') {
        await client.query('INSERT INTO stock (user_id, item_id, qty) VALUES ($1, $2, $3) ON CONFLICT (user_id, item_id) DO UPDATE SET qty = stock.qty + $3', [uid, String(id), Math.max(1, parseInt(String(amount), 10))]);
      } else if (type === 'box') {
        await client.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, $3) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + $3', [uid, String(id), Math.max(1, parseInt(String(amount), 10))]);
      } else if (type === 'coin') {
        await client.query('INSERT INTO coin_balances (user_id, coin_id, amount) VALUES ($1, $2, $3) ON CONFLICT (user_id, coin_id) DO UPDATE SET amount = coin_balances.amount + $3', [uid, id, amount]);
      }
    }
    await client.query('COMMIT');
    console.log(`[Admin] Bulk gifting finished successfully.`);
    res.json({ ok: true, count: emails.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[Admin] Bulk gift failed:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally { client.release(); }
});

/** Evita 500 em GET /api/game-state quando JSON da oficina na BD está truncado ou inválido. */
function safeWorkshopJsonObject(raw: unknown, label: string, userId: unknown): Record<string, unknown> {
  if (raw == null || raw === '') return {};
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v as Record<string, unknown>;
  } catch {
    console.warn(`[GameState] JSON inválido em ${label} (user ${userId})`);
    return {};
  }
}

function normalizeJsonSafeNumbers<T>(value: T): T {
  if (typeof value === 'bigint') {
    const num = Number(value);
    return (Number.isFinite(num) ? num : 0) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonSafeNumbers(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeJsonSafeNumbers(entry);
    }
    return normalized as T;
  }
  return value;
}

function sendJsonBigIntSafe(res: express.Response, value: unknown): void {
  const normalized = normalizeJsonSafeNumbers(value);
  const body = JSON.stringify(normalized, (_key, entry) => {
    if (typeof entry === 'bigint') {
      const num = Number(entry);
      return Number.isFinite(num) ? num : 0;
    }
    return entry;
  });
  res.type('application/json').send(body);
}

// --- GAME STATE ---
app.get('/api/game-state/:email', async (req, res) => {
  let email = req.params.email;
  let uid;

  if (email === 'me' || !email) {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
    uid = req.userId;
  } else {
    // Se for admin pedindo outro email
    const isAdminUser = await checkIsAdmin(req.userId);
    if (!isAdminUser) {
      if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
      uid = req.userId; // Força o próprio UID se não for admin
    } else {
      uid = await getUserIdByEmail(email, req.ip, { allowAnyDomain: true });
    }
  }

  const isAdminEdit = req.headers['x-admin-edit'] === '1';

  try {
    const u = await prisma.users.findUnique({ where: { id: uid } });
    if (!u) return res.status(404).json({ error: 'User not found' });

    const now = Date.now();
    console.log(`[GameState] Start for ${uid} at ${now}`);
    const t0 = performance.now();

    const progressRes = await computeProgressForUser(db, uid, now, !isAdminEdit);
    const t1 = performance.now();
    console.log(`[GameState] computeProgress took ${(t1 - t0).toFixed(2)}ms`);

    // Falha em computeProgress (timeout, deadlock, etc.): a transacção faz rollback — a BD
    // mantém o último estado persistido. Não bloquear o GET com 500; servir snapshot e
    // offline vazio neste pedido (o próximo sync volta a tentar aplicar progressão).
    let offlineMined: Record<string, number> = {};
    if (!progressRes.ok) {
      const safeMsg = sanitizeApiMessage(progressRes.error, 240);
      console.warn(
        `[GameState] computeProgress failed uid=${uid}: ${safeMsg} — serving snapshot without offline apply for this request`
      );
    } else {
      offlineMined = progressRes.offlineMined || {};
    }

    console.log(`[GameState] Starting parallel Prisma reads...`);
    const [
      gsRow,
      stockRows,
      unopenedRows,
      storedBatRows,
      rackRows,
      workshopRows,
      coinBalRows,
      dailyRows,
      listingRows,
      claimedRows
    ] = await Promise.all([
      prisma.game_states.findUnique({ where: { user_id: uid } }),
      prisma.stock.findMany({ where: { user_id: uid } }),
      prisma.unopened_boxes.findMany({ where: { user_id: uid } }),
      prisma.stored_batteries.findMany({ where: { user_id: uid } }),
      prisma.placed_racks.findMany({ where: { user_id: uid } }),
      prisma.workshop_slots.findMany({ where: { user_id: uid }, orderBy: { slot_index: 'asc' } }),
      prisma.coin_balances.findMany({ where: { user_id: uid } }),
      prisma.daily_actions.findMany({ where: { user_id: uid } }),
      prisma.player_listings.findMany({ where: { user_id: uid } }),
      prisma.player_claimed_boxes.findMany({ where: { user_id: uid }, select: { box_id: true } })
    ]);

    const t2 = performance.now();
    console.log(`[GameState] Prisma reads took ${(t2 - t1).toFixed(2)}ms`);

    const gs =
      gsRow ||
      ({
        usdc: 0,
        start_time: BigInt(now),
        claimed_referrals: 0,
        referral_bonus_claimed: 0,
        last_updated_at: BigInt(now),
        black_market_balance: 0,
        server_updated_at: BigInt(0)
      } as NonNullable<typeof gsRow>);

    const stock: Record<string, number> = {};
    stockRows.forEach((r) => {
      if (!isValidSaveGameItemId(r.item_id)) return;
      stock[r.item_id] = r.qty;
    });

    const unopenedBoxes: Record<string, number> = {};
    unopenedRows.forEach((r) => {
      unopenedBoxes[r.box_id] = r.qty;
    });

    const storedBatteries = storedBatRows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      currentCharge: r.current_charge,
      powerCapacityWh: r.power_capacity_wh != null ? Number(r.power_capacity_wh) : null,
      displayName: r.display_name != null ? String(r.display_name) : null,
      imageUrl: r.image_url != null ? String(r.image_url) : null,
      workshopSlotIndex: r.workshop_slot_index != null ? Number(r.workshop_slot_index) : null,
      workshopComponentSlotId:
        r.workshop_component_slot_id != null ? String(r.workshop_component_slot_id) : null
    }));

    const coinBalances: Record<string, number> = {};
    coinBalRows.forEach((c) => {
      coinBalances[c.coin_id] = c.amount;
    });

    const dailyActions: Record<string, number> = {};
    dailyRows.forEach((r) => {
      dailyActions[r.action_key] = Number(r.last_performed_at);
    });

    const sellerLabel = u.username || u.email || '';
    const playerListings = listingRows.map((r) => {
      const q = Math.max(1, parseInt(String(r.qty ?? 1), 10) || 1);
      const unit = Number(r.price);
      return {
        id: r.id,
        sellerName: sellerLabel,
        itemId: r.item_id,
        price: unit,
        lineTotal: unit * q,
        expiresAt: Number(r.expires_at),
        isPlayer: !!r.is_player,
        qty: q,
        status: r.status
      };
    });

    const claimedBoxes = claimedRows.map((r) => r.box_id);

    const placedRacks: Array<{
      id: string;
      itemId: string;
      slots: unknown[];
      multiplierSlots: unknown[];
      wiringId: string | null;
      batteryId: string | null;
      currentCharge: number;
      isOn: boolean;
      selectedCoinId: string | null;
      roomId: string;
      slotIndex: number;
      batteryCatalogItemId?: string | null;
      batteryPowerCapacityWh?: number | null;
      batteryDisplayName?: string | null;
      batteryImageUrl?: string | null;
    }> = [];
    if (rackRows.length > 0) {
      const rackIds = rackRows.map((r) => r.id);

      const [slotsList, multipliersList] = await Promise.all([
        prisma.rack_slots.findMany({
          where: { rack_id: { in: rackIds } },
          orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }]
        }),
        prisma.rack_multiplier_slots.findMany({
          where: { rack_id: { in: rackIds } },
          orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }]
        })
      ]);

      const slotsMap = new Map<string, unknown[]>();
      const multipliersMap = new Map<string, unknown[]>();

      slotsList.forEach((s) => {
        if (!slotsMap.has(s.rack_id)) slotsMap.set(s.rack_id, []);
        slotsMap.get(s.rack_id)![s.slot_index] = s.machine_item_id;
      });

      multipliersList.forEach((m) => {
        if (!multipliersMap.has(m.rack_id)) multipliersMap.set(m.rack_id, []);
        multipliersMap.get(m.rack_id)![m.slot_index] = m.multiplier_item_id;
      });

      for (const r of rackRows) {
        placedRacks.push({
          id: r.id,
          itemId: r.item_id,
          slots: slotsMap.get(r.id) || [],
          multiplierSlots: multipliersMap.get(r.id) || [],
          wiringId: r.wiring_id,
          batteryId: r.battery_id,
          currentCharge: r.current_charge,
          isOn: !!r.is_on,
          selectedCoinId: r.selected_coin_id,
          batteryCatalogItemId: (r as { battery_catalog_item_id?: string | null }).battery_catalog_item_id ?? null,
          batteryPowerCapacityWh:
            (r as { battery_power_capacity_wh?: number | null }).battery_power_capacity_wh != null
              ? Number((r as { battery_power_capacity_wh?: number | null }).battery_power_capacity_wh)
              : null,
          batteryDisplayName: (r as { battery_display_name?: string | null }).battery_display_name ?? null,
          batteryImageUrl: (r as { battery_image_url?: string | null }).battery_image_url ?? null,
          roomId: normalizePlacedRackRoomId(r.room_id),
          slotIndex: r.slot_index || 0
        });
      }
    }

    if (placedRacks.length > 0) {
      try {
        const recovered = await recoverOrphanRackBatteryStorageRows(db, uid, placedRacks);
        if (recovered.length > 0) {
          const seen = new Set(storedBatteries.map((b) => b.id));
          for (const row of recovered) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            storedBatteries.push({
              id: row.id,
              itemId: row.item_id,
              currentCharge: row.current_charge,
              workshopSlotIndex: null,
              workshopComponentSlotId: null
            });
          }
          console.warn(
            `[GameState] Recuperada(s) ${recovered.length} instância(s) de bateria em armazém (UUID sem linha; carga preservada) uid=${uid}`
          );
        }
      } catch (eRec) {
        console.error(
          `[GameState] Falha ao recuperar baterias órfãs uid=${uid}:`,
          eRec instanceof Error ? eRec.message : String(eRec)
        );
      }
    }

    const workshopSlots = [null, null, null, null, null, null];
    workshopRows.forEach((w) => {
      if (w.slot_index >= 0 && w.slot_index < 6) {
        workshopSlots[w.slot_index] = {
          id: `ws_${uid}_${w.slot_index}`,
          itemId: w.item_id,
          internalSlots: safeWorkshopJsonObject(w.internal_state, 'workshop_slots.internal_state', uid),
          currentCharge: w.current_charge ?? 0,
          slotCharges: safeWorkshopJsonObject(w.slot_charges, 'workshop_slots.slot_charges', uid),
          slotItemIds: safeWorkshopJsonObject(w.slot_item_ids, 'workshop_slots.slot_item_ids', uid),
          installedAt: Number(w.installed_at ?? 0)
        };
      }
    });

    try {
      await enrichWorkshopSlotsSlotItemIdsFromChargingHistory(db, String(u.email || ''), workshopSlots);
    } catch (e) {
      console.warn('[game-state] enrich workshop slotItemIds:', e instanceof Error ? e.message : String(e));
    }

    const nftRoomIdsForGet = await resolveNftAutoArmario1OnlyRoomIds(db);
    const hadNftAutoViolations = placedRacks.some(
      (r) =>
        nftRoomIdsForGet.has(normalizePlacedRackRoomId(r.roomId)) &&
        r.itemId &&
        String(r.itemId).trim() !== NFT_AUTO_ALLOWED_CHASSIS_ID
    );
    if (hadNftAutoViolations) {
      const fixClient = await db.connect();
      const fixLogs = [];
      try {
        await fixClient.query('BEGIN');
        await fixClient.query("SET statement_timeout = '20s'");
        await fixClient.query('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', [uid]);
        const ch = {
          placedRacks: placedRacks.map((r) => ({
            ...r,
            slots: [...(r.slots || [])],
            multiplierSlots: [...(r.multiplierSlots || [])]
          })),
          stock: { ...stock },
          storedBatteries: storedBatteries.map((b) => ({ ...b }))
        };
        await sanitizePlacedRacksNftAutoRoom(fixClient, uid, ch, fixLogs);
        await persistStockStoredBatteriesPlacedRacks(fixClient, uid, {
          stock: ch.stock,
          storedBatteries: ch.storedBatteries,
          placedRacks: ch.placedRacks
        }, fixLogs);
        const fixNow = Date.now();
        await fixClient.query(
          'UPDATE game_states SET server_updated_at = $1, last_updated_at = $1 WHERE user_id = $2',
          [fixNow, uid]
        );
        await fixClient.query('COMMIT');
        for (const ev of fixLogs) {
          await appendGameActivityLog(db, uid, ev.action, ev.meta);
        }
        placedRacks.length = 0;
        placedRacks.push(...ch.placedRacks);
        for (const k of Object.keys(stock)) delete stock[k];
        for (const [k, v] of Object.entries(ch.stock)) stock[k] = v;
        storedBatteries.length = 0;
        storedBatteries.push(...ch.storedBatteries);
        gs.server_updated_at = fixNow;
      } catch (eFix) {
        try {
          await fixClient.query('ROLLBACK');
        } catch {
          /* no active txn */
        }
        console.error(`[GameState] NFT AUTO room DB cleanup failed for user ${uid}:`, eFix?.message || eFix);
      } finally {
        fixClient.release();
      }
    }

    // Prisma devolve BigInt em campos schema BigInt — nunca passar BigInt cru a `res.json()` (falha de serialização).
    const serverUpdatedAtNum = Number(gs.server_updated_at ?? 0);

    sendJsonBigIntSafe(res, {
      usdc: gs.usdc,
      startTime: Number(gs.start_time),
      lastUpdatedAt: Number(gs.last_updated_at ?? 0),
      claimedReferrals: gs.claimed_referrals,
      referralBonusClaimed: !!gs.referral_bonus_claimed,
      blackMarketBalance: gs.black_market_balance || 0,
      dailyActions,
      stock,
      unopenedBoxes,
      storedBatteries,
      placedRacks,
      coinBalances,
      playerListings,
      workshopSlots,
      claimedBoxes,
      serverUpdatedAt: Number.isFinite(serverUpdatedAtNum) ? serverUpdatedAtNum : 0,
      offlineMined
    });
    const t3 = performance.now();
    console.log(`[GameState] Total processing took ${(t3 - t0).toFixed(2)}ms`);
  } catch (e) {
    sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/game-state', e, 'Erro ao carregar o estado do jogo.');
  }
});

const RACK_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

async function validatePlacedRacksForSave(dbq, racks, userId) {
  if (!Array.isArray(racks)) return { ok: false, error: 'placedRacks inválido.' };
  if (racks.length > 350) return { ok: false, error: 'Número de rigs excede o permitido.' };
  const storedBattCatalogByInstanceId = new Map<string, string>();
  const ownedStoredBatteryIds = new Set<string>();
  const uidNum = Number(userId);
  const catalogBatteryRows = await prisma.upgrades.findMany({
    where: { type: 'battery' },
    select: { id: true }
  });
  const catalogBatteryIds = new Set(catalogBatteryRows.map((x) => x.id));
  const fallbackBatteryCatalogId = String(
    catalogBatteryRows.find((x) => x.id === 'small_battery')?.id ||
      catalogBatteryRows[0]?.id ||
      ''
  ).trim();

  const refreshOwnedStoredBatteryIds = async () => {
    ownedStoredBatteryIds.clear();
    if (!Number.isFinite(uidNum) || uidNum <= 0) return;
    try {
      const idRows = await dbq.query('SELECT id FROM stored_batteries WHERE user_id = $1', [uidNum]);
      for (const row of idRows.rows || []) {
        const rid = String(row.id ?? '').trim();
        if (rid) ownedStoredBatteryIds.add(rid);
      }
    } catch (e) {
      console.warn(
        '[validatePlacedRacksForSave] owned stored_batteries ids:',
        e instanceof Error ? e.message : String(e)
      );
    }
  };

  const mergeStoredBatteryRowIntoMap = (row: { id?: unknown; item_id?: unknown }) => {
    const iid = String(row.id ?? '').trim();
    if (!iid) return;
    const rawItem = String(row.item_id ?? '').trim();
    if (rawItem && catalogBatteryIds.has(rawItem)) {
      storedBattCatalogByInstanceId.set(iid, rawItem);
      return;
    }
    if (fallbackBatteryCatalogId) {
      storedBattCatalogByInstanceId.set(iid, fallbackBatteryCatalogId);
      return;
    }
    if (rawItem) {
      storedBattCatalogByInstanceId.set(iid, rawItem);
      return;
    }
    storedBattCatalogByInstanceId.set(iid, iid);
  };

  if (Number.isFinite(uidNum) && uidNum > 0) {
    try {
      const sb = await dbq.query('SELECT id, item_id FROM stored_batteries WHERE user_id = $1', [uidNum]);
      for (const row of sb.rows || []) {
        mergeStoredBatteryRowIntoMap(row);
      }
    } catch (e) {
      console.warn('[validatePlacedRacksForSave] stored_batteries:', e instanceof Error ? e.message : String(e));
    }
  }
  const isRackBatteryInstanceUuidLocal = (bid: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(bid || '').trim());
  try {
    const recovered = await recoverOrphanRackBatteryStorageRows(dbq, uidNum, racks);
    if (recovered.length > 0) {
      console.warn(
        `[validatePlacedRacksForSave] recuperada(s) ${recovered.length} bateria(s) órfã(s) em stored_batteries user=${userId}`
      );
      const sb2 = await dbq.query('SELECT id, item_id FROM stored_batteries WHERE user_id = $1', [uidNum]);
      storedBattCatalogByInstanceId.clear();
      for (const row of sb2.rows || []) {
        mergeStoredBatteryRowIntoMap(row);
      }
    }
  } catch (eRec) {
    console.warn(
      '[validatePlacedRacksForSave] recoverOrphanRackBatteryStorageRows:',
      eRec instanceof Error ? eRec.message : String(eRec)
    );
  }
  await refreshOwnedStoredBatteryIds();
  const nftRoomIds = await resolveNftAutoArmario1OnlyRoomIds(dbq);
  const upgradeIds = new Set();
  const coinIds = new Set();
  for (const r of racks) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'Rig inválida.' };
    if (typeof r.id !== 'string' || !RACK_ID_RE.test(r.id)) return { ok: false, error: 'ID de rig inválido.' };
    if (r.itemId != null && r.itemId !== '' && !RACK_ID_RE.test(String(r.itemId))) return { ok: false, error: 'Chassi inválido.' };
    const roomNft = normalizePlacedRackRoomId(r.roomId);
    if (nftRoomIds.has(roomNft) && r.itemId && String(r.itemId).trim() !== NFT_AUTO_ALLOWED_CHASSIS_ID) {
      return { ok: false, error: 'Na sala NFTs AUTO só é permitido o chassis Rack H1 NFT Collection.' };
    }
    if (r.wiringId && !RACK_ID_RE.test(String(r.wiringId))) return { ok: false, error: 'Fiação inválida.' };
    if (r.batteryId != null && String(r.batteryId).trim() !== '' && !RACK_ID_RE.test(String(r.batteryId))) {
      return { ok: false, error: 'Bateria inválida.' };
    }
    if (r.slots != null && !Array.isArray(r.slots)) return { ok: false, error: 'Slots inválidos.' };
    if (r.slots && r.slots.length > 128) return { ok: false, error: 'Demasiados slots de máquina.' };
    if (r.multiplierSlots != null && !Array.isArray(r.multiplierSlots)) return { ok: false, error: 'Slots de multiplicador inválidos.' };
    if (r.multiplierSlots && r.multiplierSlots.length > 64) return { ok: false, error: 'Demasiados multiplicadores.' };
    if (r.itemId) upgradeIds.add(String(r.itemId));
    if (r.wiringId) upgradeIds.add(String(r.wiringId));
    if (r.batteryId != null && String(r.batteryId).trim() !== '') {
      const bidRaw = String(r.batteryId).trim();
      if (ownedStoredBatteryIds.has(bidRaw)) {
        const fromStore = storedBattCatalogByInstanceId.get(bidRaw);
        if (fromStore && catalogBatteryIds.has(fromStore)) {
          upgradeIds.add(fromStore);
        } else if (fallbackBatteryCatalogId) {
          upgradeIds.add(fallbackBatteryCatalogId);
        }
      } else if (catalogBatteryIds.has(bidRaw)) {
        // Legado: `placed_racks.battery_id` = id de catálogo (pré UUID-only no cliente).
        upgradeIds.add(bidRaw);
      } else if (isRackBatteryInstanceUuidLocal(bidRaw) && fallbackBatteryCatalogId) {
        upgradeIds.add(fallbackBatteryCatalogId);
      } else {
        return {
          ok: false,
          error:
            'Referência de bateria inválida numa rig (dados desatualizados). Recarregue a página (F5) e tente de novo.'
        };
      }
    }
    for (const s of r.slots || []) {
      if (!s) continue;
      if (!RACK_ID_RE.test(String(s))) return { ok: false, error: 'Peça inválida num slot.' };
      upgradeIds.add(String(s));
    }
    for (const s of r.multiplierSlots || []) {
      if (!s) continue;
      if (!RACK_ID_RE.test(String(s))) return { ok: false, error: 'Peça inválida num slot de multiplicador.' };
      upgradeIds.add(String(s));
    }
    if (r.selectedCoinId) {
      if (!RACK_ID_RE.test(String(r.selectedCoinId))) return { ok: false, error: 'Moeda selecionada inválida.' };
      coinIds.add(String(r.selectedCoinId));
    }
  }
  if (upgradeIds.size > 0) {
    const ids = [...upgradeIds];
    try {
      const chk = await prisma.upgrades.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (chk.length !== ids.length) {
        const have = new Set(chk.map((x) => x.id));
        const missing = ids.filter((id) => !have.has(id));
        console.warn(
          '[validatePlacedRacksForSave] Equipamento com ids fora do catálogo (save permitido, legado):',
          missing.slice(0, 24).join(', ')
        );
      }
    } catch (e) {
      console.warn(
        '[validatePlacedRacksForSave] Falha Prisma ao verificar upgrades (não bloqueia save):',
        e instanceof Error ? e.message : String(e)
      );
    }
  }
  if (coinIds.size > 0) {
    const cids = [...coinIds];
    const cres = await prisma.mining_coins.findMany({ where: { id: { in: cids } }, select: { id: true } });
    if (cres.length !== coinIds.size) {
      return { ok: false, error: 'Moeda inválida numa rig.' };
    }
  }
  return { ok: true };
}

async function handleSaveGamePost(req, res) {
  const { changes, adminOverride, targetEmail } = req.body;
  if (!req.userId || !changes) return res.status(400).json({ error: 'Missing fields' });
  try {
    let uid = req.userId;
    const saveActivityLogs = [];

    // Security: Only allow adminOverride if user is actually admin
    let effectiveAdminOverride = false;
    if (adminOverride) {
      const adminActor = await prisma.users.findUnique({
        where: { id: req.userId },
        select: { is_admin: true }
      });
      if (adminActor?.is_admin) {
        effectiveAdminOverride = true;
        // If admin provided a targetEmail, switch context to that user
        if (targetEmail) {
          const te = String(targetEmail).trim().toLowerCase();
          const tRows = await prisma.$queryRaw<Array<{ id: number }>>`
            SELECT id FROM users WHERE lower(trim(email::text)) = ${te} LIMIT 1
          `;
          if (tRows[0]) uid = tRows[0].id;
        }
      }
    }

    let finalServerUpdatedAt = Date.now();
    let nftAutoSanitized = false;
    let nftAutoSyncPayload: {
      placedRacks: unknown;
      stock: Record<string, number>;
      storedBatteries: Array<{ id: string; itemId: string; currentCharge: number }>;
    } | null = null;

    await prisma.$transaction(
      async (tx) => {
        const client = prismaTxToPoolLikeClient(tx);
        await client.query("SET LOCAL statement_timeout = '20s'");

        // LOCK ORDER FIX: Always lock the primary user record first to avoid deadlocks
        await client.query('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', [uid]);

        const saveDomainRaw = String(req.headers['x-game-save-domain'] || '')
          .trim()
          .toLowerCase();
        const saveDomain: '' | 'inventory' | 'servers' | 'workshop' =
          saveDomainRaw === 'inventory' || saveDomainRaw === 'servers' || saveDomainRaw === 'workshop'
            ? (saveDomainRaw as 'inventory' | 'servers' | 'workshop')
            : '';
        if (saveDomain) {
          if (effectiveAdminOverride) {
            throw new HttpControlledError(400, {
              error: 'Gravação por domínio (X-Game-Save-Domain) não combina com adminOverride.'
            });
          }
          if (saveDomain === 'inventory' && changes.stock == null && changes.storedBatteries == null) {
            throw new HttpControlledError(400, {
              error: 'Domínio inventory: envie stock e/ou storedBatteries no corpo.'
            });
          }
          if (saveDomain === 'servers' && changes.placedRacks == null) {
            throw new HttpControlledError(400, { error: 'Domínio servers: envie placedRacks.' });
          }
          if (saveDomain === 'workshop' && changes.workshopSlots == null) {
            throw new HttpControlledError(400, { error: 'Domínio workshop: envie workshopSlots.' });
          }
          await mergeSaveGameSlicePayload(client, Number(uid), saveDomain, changes as Record<string, unknown>);
        }

        // Re-read revision *inside* the transaction so stock-affecting APIs (ex.: cancelar
        // listagem P2P) cannot be overwritten by a save whose optimistic check ran before
        // they committed.
        const dbGsRes = await client.query('SELECT server_updated_at FROM game_states WHERE user_id = $1', [uid]);
        const dbServerUpdatedAt = Number(dbGsRes.rows[0]?.server_updated_at || 0);
        if (!effectiveAdminOverride && changes.lastLoadTime && dbServerUpdatedAt > Number(changes.lastLoadTime)) {
          throw new HttpControlledError(200, { forceReload: true });
        }

        nftAutoSanitized = false;
        if (changes.placedRacks) {
          if (!Array.isArray(changes.placedRacks)) {
            throw new HttpControlledError(400, { error: 'placedRacks inválido.' });
          }
          // [] é truthy: evita apagar todas as rigs quando o cliente envia estado incompleto.
          if (!effectiveAdminOverride && changes.placedRacks.length === 0) {
            const prCountRes = await client.query('SELECT COUNT(*)::int AS c FROM placed_racks WHERE user_id = $1', [uid]);
            const prCount = Number(prCountRes.rows[0]?.c ?? 0);
            if (prCount > 0) {
              console.warn(`[SaveGame] Rejeitado placedRacks vazio (servidor tem ${prCount} rig(s)) userId=${uid}`);
              throw new HttpControlledError(409, {
                error:
                  'O estado enviado não inclui nenhuma rig, mas o servidor ainda guarda o teu equipamento. Recarrega a página (F5) para sincronizar.',
                forceReload: true
              });
            }
          }
          nftAutoSanitized = await sanitizePlacedRacksNftAutoRoom(client, uid, changes, saveActivityLogs);
          const rackVal = await validatePlacedRacksForSave(client, changes.placedRacks, uid);
          if (!rackVal.ok) {
            throw new HttpControlledError(400, { error: rackVal.error });
          }
        }

        // ---------------------------------

        const gs = changes.gameState || changes;
        finalServerUpdatedAt = Date.now();
    if (gs) {
      const startTime = gs.startTime || Date.now();
      const lastUpdate = gs.lastUpdatedAt || Date.now();
      await client.query(`
        INSERT INTO game_states (user_id, start_time, last_updated_at, server_updated_at, claimed_referrals, referral_bonus_claimed, black_market_balance)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) DO UPDATE SET
          start_time = EXCLUDED.start_time,
          last_updated_at = GREATEST(COALESCE(game_states.last_updated_at, 0), COALESCE(EXCLUDED.last_updated_at, 0)),
          server_updated_at = EXCLUDED.server_updated_at,
          claimed_referrals = EXCLUDED.claimed_referrals,
          referral_bonus_claimed = EXCLUDED.referral_bonus_claimed,
          black_market_balance = EXCLUDED.black_market_balance`,
        [uid, startTime, lastUpdate, finalServerUpdatedAt, gs.claimedReferrals || 0, gs.referralBonusClaimed ? 1 : 0, gs.blackMarketBalance || 0]);

      if (effectiveAdminOverride) {
        if (gs.usdc !== undefined) {
          await client.query('UPDATE game_states SET usdc = $1 WHERE user_id = $2', [gs.usdc, uid]);
        }
        if (changes.coinBalances) {
          const coinIds = Object.keys(changes.coinBalances);
          const amounts = Object.values(changes.coinBalances);
          if (coinIds.length > 0) {
            await client.query(`
               INSERT INTO coin_balances (user_id, coin_id, amount) 
               SELECT $1, unnest($2::text[]), unnest($3::numeric[])
               ON CONFLICT (user_id, coin_id) DO UPDATE SET amount = EXCLUDED.amount`,
              [uid, coinIds, amounts]);
          }
        }
      }
      if (gs.dailyActions) {
        if (typeof gs.dailyActions !== 'object' || Array.isArray(gs.dailyActions)) {
          throw new HttpControlledError(400, {
            error:
              'O formato dos dados diários (oficina) está incorrecto. Recarregue a página (F5).'
          });
        }
        const dv = validateDailyActionsForSave(gs.dailyActions, effectiveAdminOverride, Date.now());
        if (!dv.ok) {
          throw new HttpControlledError(400, { error: dv.error });
        }
        if (dv.keys.length > 0) {
          await client.query(`
            INSERT INTO daily_actions (user_id, action_key, last_performed_at) 
            SELECT $1, unnest($2::text[]), unnest($3::numeric[])
            ON CONFLICT (user_id, action_key) DO UPDATE SET last_performed_at = EXCLUDED.last_performed_at`,
            [uid, dv.keys, dv.vals]);
        }
      }
    }





    if (changes.stock !== undefined && changes.stock !== null) {
      if (typeof changes.stock !== 'object' || Array.isArray(changes.stock)) {
        throw new HttpControlledError(400, {
          error: 'O inventário foi enviado num formato inválido. Recarregue a página (F5).'
        });
      }
      const sv = await validateStockForSave(client, changes.stock);
      if (!sv.ok) {
        const samplesJson = JSON.stringify(sv.samples || []).slice(0, 900);
        console.warn(
          `[SaveGame] stock_validation_fail userId=${uid} reason=${sv.reason} sampleCount=${(sv.samples || []).length} keyCount=${Object.keys(changes.stock).length} samples=${samplesJson}`
        );
        throw new HttpControlledError(400, { error: sv.error });
      }
      if (sv.itemIds.length > 0) {
        await client.query(`
          INSERT INTO stock (user_id, item_id, qty) 
          SELECT $1, unnest($2::text[]), unnest($3::int[])
          ON CONFLICT (user_id, item_id) DO UPDATE SET qty = EXCLUDED.qty`,
          [uid, sv.itemIds, sv.qtys]);
      }
    }

    if (changes.unopenedBoxes !== undefined && changes.unopenedBoxes !== null) {
      if (typeof changes.unopenedBoxes !== 'object' || Array.isArray(changes.unopenedBoxes)) {
        throw new HttpControlledError(400, {
          error: 'A lista de caixas foi enviada num formato inválido. Recarregue a página (F5).'
        });
      }
      const bv = await validateUnopenedBoxesForSave(client, changes.unopenedBoxes);
      if (!bv.ok) {
        throw new HttpControlledError(400, { error: bv.error });
      }
      if (bv.boxIds.length > 0) {
        await client.query(`
          INSERT INTO unopened_boxes (user_id, box_id, qty) 
          SELECT $1, unnest($2::text[]), unnest($3::int[])
          ON CONFLICT (user_id, box_id) DO UPDATE SET qty = EXCLUDED.qty`,
          [uid, bv.boxIds, bv.qtys]);
      }
    }

    /** Antes de apagar linhas do armazém, captura `item_id`/snapshots das instâncias ainda montadas na rig. */
    let preMountBatterySnapSave = new Map<string, StoredBatteryRowSnap>();
    if (Array.isArray(changes.placedRacks) && changes.placedRacks.length > 0) {
      const mountedIdsSave = collectMountedBatteryInstanceIdsFromPlacedRacks(changes.placedRacks);
      if (mountedIdsSave.length > 0) {
        preMountBatterySnapSave = await loadStoredBatteryRowsForIds(client, uid, mountedIdsSave);
      }
    }

    if (changes.storedBatteries) {
      if (!Array.isArray(changes.storedBatteries)) {
        throw new HttpControlledError(400, {
          error: 'O armazém de baterias foi enviado num formato inválido. Recarregue a página (F5).'
        });
      }
      changes.storedBatteries = sanitizeStoredBatteriesForSavePayload(
        changes.storedBatteries,
        changes.workshopSlots,
        changes.placedRacks
      );
      const batVal = await validateStoredBatteriesForSave(client, uid, changes.storedBatteries);
      if (!batVal.ok) {
        throw new HttpControlledError(400, { error: batVal.error });
      }
      const incomingIds = changes.storedBatteries.map((b) => b.id);
      const batRm = await validateStoredBatteryWarehouseRemovalAllowed(
        client,
        uid,
        incomingIds,
        { placedRacks: changes.placedRacks, workshopSlots: changes.workshopSlots },
        effectiveAdminOverride
      );
      if (!batRm.ok) {
        throw new StoredBatterySaveGuardError(batRm.error);
      }
      // Nota: [] é válido quando todas as instâncias sairam do armazém (rigs/carregadores),
      // desde que cada id retirado do armazém apareça montada nas rigs ou oficina (validação acima).
      if (incomingIds.length > 0) {
        await client.query(
          'DELETE FROM stored_batteries WHERE user_id = $1 AND NOT (id = ANY($2::text[])) AND workshop_slot_index IS NULL',
          [uid, incomingIds]
        );
      } else {
        await client.query('DELETE FROM stored_batteries WHERE user_id = $1 AND workshop_slot_index IS NULL', [uid]);
      }
      if (changes.storedBatteries.length > 0) {
        const bIds = changes.storedBatteries.map(b => b.id);
        const bItemIds = changes.storedBatteries.map(b => b.itemId);
        const bCharges = changes.storedBatteries.map(b => b.currentCharge || 0);
        const upStoredSave = await fetchBatteryUpgradeRowsByIds(client, bItemIds);
        const bPowers = bItemIds.map((cid) => {
          const u = upStoredSave.get(String(cid));
          return u?.power_capacity != null && Number.isFinite(Number(u.power_capacity)) ? Number(u.power_capacity) : null;
        });
        const bNames = bItemIds.map((cid) => {
          const n = upStoredSave.get(String(cid))?.name;
          return n != null && String(n).trim() !== '' ? String(n).trim().slice(0, 500) : null;
        });
        const bImgs = bItemIds.map((cid) => {
          const im = upStoredSave.get(String(cid))?.image;
          return im != null && String(im).trim() !== '' ? String(im).trim().slice(0, 2048) : null;
        });
        await client.query(`
          INSERT INTO stored_batteries (id, user_id, item_id, current_charge, power_capacity_wh, display_name, image_url, workshop_slot_index, workshop_component_slot_id)
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::numeric[]), unnest($5::float8[]), unnest($6::text[]), unnest($7::text[]), NULL::int, NULL::text
          ON CONFLICT (id) DO UPDATE SET
            current_charge = EXCLUDED.current_charge,
            item_id = EXCLUDED.item_id,
            power_capacity_wh = COALESCE(EXCLUDED.power_capacity_wh, stored_batteries.power_capacity_wh),
            display_name = COALESCE(NULLIF(BTRIM(EXCLUDED.display_name), ''), stored_batteries.display_name),
            image_url = COALESCE(NULLIF(BTRIM(EXCLUDED.image_url), ''), stored_batteries.image_url),
            workshop_slot_index = stored_batteries.workshop_slot_index,
            workshop_component_slot_id = stored_batteries.workshop_component_slot_id`,
          [uid, bIds, bItemIds, bCharges, bPowers, bNames, bImgs]);
      }
    }

    if (changes.placedRacks) {
      const ts = new Date().toISOString();
      const prevRacksRes = await client.query(
        `SELECT id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id,
                COALESCE(NULLIF(BTRIM(room_id::text), ''), 'room_initial') AS room_id, slot_index,
                battery_catalog_item_id, battery_power_capacity_wh, battery_display_name, battery_image_url
         FROM placed_racks WHERE user_id = $1`,
        [uid]
      );
      const prevMap = new Map(prevRacksRes.rows.map((row) => [row.id, row]));
      const nextIdSet = new Set(changes.placedRacks.map((r) => r.id));

      for (const row of prevRacksRes.rows) {
        if (!nextIdSet.has(row.id)) {
          const [slots, multis] = await Promise.all([
            client.query('SELECT slot_index, machine_item_id FROM rack_slots WHERE rack_id = $1 ORDER BY slot_index', [row.id]),
            client.query('SELECT slot_index, multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = $1 ORDER BY slot_index', [row.id])
          ]);
          const dismantledParts = {
            chassis: row.item_id,
            wiring: row.wiring_id,
            battery: row.battery_id,
            miners: slots.rows.filter((s) => s.machine_item_id).map((s) => ({ slot: s.slot_index, id: s.machine_item_id })),
            multipliers: multis.rows.filter((m) => m.multiplier_item_id).map((m) => ({ slot: m.slot_index, id: m.multiplier_item_id }))
          };
          console.log(`[RackDismantle] ts=${ts} userId=${uid} rackId=${row.id} parts=${JSON.stringify(dismantledParts)}`);
          saveActivityLogs.push({ action: 'rack_dismantle', meta: { rackId: row.id, parts: dismantledParts } });
        }
      }
      for (const r of changes.placedRacks) {
        if (!prevMap.has(r.id)) {
          console.log(`[RackPlace] ts=${ts} userId=${uid} rackId=${r.id} itemId=${r.itemId} room=${r.roomId ?? ''} slotIndex=${r.slotIndex ?? 0}`);
          saveActivityLogs.push({
            action: 'rack_place',
            meta: { rackId: r.id, itemId: r.itemId, room: r.roomId ?? '', slotIndex: r.slotIndex ?? 0 }
          });
        }
      }

      const prevSlotsRes = await client.query(
        `SELECT s.rack_id, s.slot_index, s.machine_item_id
         FROM rack_slots s
         INNER JOIN placed_racks pr ON pr.id = s.rack_id AND pr.user_id = $1
         ORDER BY s.rack_id, s.slot_index`,
        [uid]
      );
      const prevMultRes = await client.query(
        `SELECT s.rack_id, s.slot_index, s.multiplier_item_id
         FROM rack_multiplier_slots s
         INNER JOIN placed_racks pr ON pr.id = s.rack_id AND pr.user_id = $1
         ORDER BY s.rack_id, s.slot_index`,
        [uid]
      );
      const prevMachSig = (rackId) =>
        prevSlotsRes.rows
          .filter((x) => x.rack_id === rackId)
          .sort((a, b) => a.slot_index - b.slot_index)
          .map((x) => String(x.machine_item_id || ''))
          .join('|');
      const prevMultiSig = (rackId) =>
        prevMultRes.rows
          .filter((x) => x.rack_id === rackId)
          .sort((a, b) => a.slot_index - b.slot_index)
          .map((x) => String(x.multiplier_item_id || ''))
          .join('|');
      let miningUpdateLogs = 0;
      for (const r of changes.placedRacks) {
        if (!prevMap.has(r.id)) continue;
        const prow = prevMap.get(r.id) as Record<string, unknown> | undefined;
        if (!prow) continue;
        const changed = [];
        if (String(prow.item_id || '') !== String(r.itemId || '')) changed.push('chassis');
        if (String(prow.wiring_id || '') !== String(r.wiringId || '')) changed.push('wiring');
        if (String(prow.battery_id || '') !== String(r.batteryId || '')) changed.push('battery');
        if (Number(prow.is_on) !== (r.isOn ? 1 : 0)) changed.push('power');
        if (Number(prow.current_charge || 0) !== Number(r.currentCharge || 0)) changed.push('charge');
        if (String(prow.selected_coin_id || '') !== String(r.selectedCoinId || '')) changed.push('coin');
        if (String(prow.room_id || '') !== String(normalizePlacedRackRoomId(r.roomId))) changed.push('room');
        if (Number(prow.slot_index || 0) !== Number(r.slotIndex || 0)) changed.push('slot');
        const nextMach = Array.isArray(r.slots) ? r.slots.map((x) => String(x || '')).join('|') : '';
        const nextMult = Array.isArray(r.multiplierSlots) ? r.multiplierSlots.map((x) => String(x || '')).join('|') : '';
        if (prevMachSig(r.id) !== nextMach) changed.push('miners');
        if (prevMultiSig(r.id) !== nextMult) changed.push('multipliers');
        if (changed.length > 0 && miningUpdateLogs < 48) {
          saveActivityLogs.push({ action: 'mining_rack_update', meta: { rackId: r.id, changed } });
          miningUpdateLogs++;
        }
      }

      const currentRackIds = changes.placedRacks.map(r => r.id);
      if (currentRackIds.length > 0) {
        // Optimized range delete
        const removedRacksQuery = 'SELECT id FROM placed_racks WHERE user_id = $1 AND NOT (id = ANY($2::text[]))';
        await client.query(`DELETE FROM rack_slots WHERE rack_id IN (${removedRacksQuery})`, [uid, currentRackIds]);
        await client.query(`DELETE FROM rack_multiplier_slots WHERE rack_id IN (${removedRacksQuery})`, [uid, currentRackIds]);
        await client.query('DELETE FROM placed_racks WHERE user_id = $1 AND NOT (id = ANY($2::text[]))', [uid, currentRackIds]);
      } else {
        await client.query('DELETE FROM rack_slots WHERE rack_id IN (SELECT id FROM placed_racks WHERE user_id = $1)', [uid]);
        await client.query('DELETE FROM rack_multiplier_slots WHERE rack_id IN (SELECT id FROM placed_racks WHERE user_id = $1)', [uid]);
        await client.query('DELETE FROM placed_racks WHERE user_id = $1', [uid]);
      }

      if (changes.placedRacks.length > 0) {
        const catalogIdsForUpgradesSave = new Set<string>();
        for (const r of changes.placedRacks) {
          const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
          if (!bid) continue;
          const prow = prevMap.get(r.id) as Record<string, unknown> | undefined;
          let cat: string | null = null;
          if (isRackBatteryInstanceUuid(bid)) {
            const inst = preMountBatterySnapSave.get(bid);
            cat = inst?.item_id != null ? String(inst.item_id).trim() : null;
            if (!cat && prow && String(prow.battery_id || '') === bid) {
              cat = prow.battery_catalog_item_id != null ? String(prow.battery_catalog_item_id).trim() : null;
            }
          } else {
            cat = bid;
          }
          if (cat) catalogIdsForUpgradesSave.add(cat);
        }
        const upgradeByCatalogSave = await fetchBatteryUpgradeRowsByIds(client, [...catalogIdsForUpgradesSave]);

        const rIds = changes.placedRacks.map(r => r.id);
        const rItems = changes.placedRacks.map(r => r.itemId);
        const rWirings = changes.placedRacks.map(r => r.wiringId || null);
        const rBatteries = changes.placedRacks.map(r => r.batteryId || null);
        const rCharges = changes.placedRacks.map(r => r.currentCharge || 0);
        const rOns = changes.placedRacks.map(r => r.isOn ? 1 : 0);
        const rCoins = changes.placedRacks.map(r => r.selectedCoinId || null);
        const rRooms = changes.placedRacks.map((r) => normalizePlacedRackRoomId(r.roomId));
        const rSlotIdxs = changes.placedRacks.map(r => r.slotIndex || 0);

        const rBatCats: (string | null)[] = [];
        const rBatPows: (number | null)[] = [];
        const rBatNames: (string | null)[] = [];
        const rBatImgs: (string | null)[] = [];
        for (const r of changes.placedRacks) {
          const prow = prevMap.get(r.id) as Record<string, unknown> | undefined;
          const prevBatt: PrevPlacedRackBattRow | null = prow
            ? {
                battery_id: prow.battery_id != null ? String(prow.battery_id) : null,
                battery_catalog_item_id: prow.battery_catalog_item_id != null ? String(prow.battery_catalog_item_id) : null,
                battery_power_capacity_wh:
                  prow.battery_power_capacity_wh != null ? Number(prow.battery_power_capacity_wh) : null,
                battery_display_name: prow.battery_display_name != null ? String(prow.battery_display_name) : null,
                battery_image_url: prow.battery_image_url != null ? String(prow.battery_image_url) : null
              }
            : null;
          const snap = buildRackBatteryPersistSnapshot(r.batteryId, preMountBatterySnapSave, upgradeByCatalogSave, prevBatt);
          rBatCats.push(snap.catalogItemId);
          rBatPows.push(snap.powerWh);
          rBatNames.push(
            snap.displayName != null && snap.displayName.trim() !== '' ? snap.displayName.trim().slice(0, 500) : null
          );
          rBatImgs.push(snap.imageUrl != null && snap.imageUrl.trim() !== '' ? snap.imageUrl.trim().slice(0, 2048) : null);
        }

        await client.query(`
          INSERT INTO placed_racks (
            id, user_id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id, room_id, slot_index,
            battery_catalog_item_id, battery_power_capacity_wh, battery_display_name, battery_image_url
          )
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::text[]), unnest($5::text[]), unnest($6::numeric[]), unnest($7::int[]), unnest($8::text[]), unnest($9::text[]), unnest($10::int[]),
                 unnest($11::text[]), unnest($12::float8[]), unnest($13::text[]), unnest($14::text[])
          ON CONFLICT (id) DO UPDATE SET
            item_id = EXCLUDED.item_id, wiring_id = EXCLUDED.wiring_id, battery_id = EXCLUDED.battery_id,
            current_charge = EXCLUDED.current_charge, is_on = EXCLUDED.is_on, selected_coin_id = EXCLUDED.selected_coin_id,
            room_id = EXCLUDED.room_id, slot_index = EXCLUDED.slot_index,
            battery_catalog_item_id = EXCLUDED.battery_catalog_item_id,
            battery_power_capacity_wh = EXCLUDED.battery_power_capacity_wh,
            battery_display_name = EXCLUDED.battery_display_name,
            battery_image_url = EXCLUDED.battery_image_url`,
          [
            uid,
            rIds,
            rItems,
            rWirings,
            rBatteries,
            rCharges,
            rOns,
            rCoins,
            rRooms,
            rSlotIdxs,
            rBatCats,
            rBatPows,
            rBatNames,
            rBatImgs
          ]);

        // Bulk Delete existing slots for updated racks
        await client.query('DELETE FROM rack_slots WHERE rack_id = ANY($1)', [rIds]);
        await client.query('DELETE FROM rack_multiplier_slots WHERE rack_id = ANY($1)', [rIds]);

        const allSlotsRackId = [];
        const allSlotsIdx = [];
        const allSlotsItem = [];

        const allMultiRackId = [];
        const allMultiIdx = [];
        const allMultiItem = [];

        for (const r of changes.placedRacks) {
          if (r.slots) {
            for (let i = 0; i < r.slots.length; i++) {
              if (r.slots[i]) {
                allSlotsRackId.push(r.id);
                allSlotsIdx.push(i);
                allSlotsItem.push(r.slots[i]);
              }
            }
          }
          if (r.multiplierSlots) {
            for (let i = 0; i < r.multiplierSlots.length; i++) {
              if (r.multiplierSlots[i]) {
                allMultiRackId.push(r.id);
                allMultiIdx.push(i);
                allMultiItem.push(r.multiplierSlots[i]);
              }
            }
          }
        }

        if (allSlotsRackId.length > 0) {
          await client.query(`INSERT INTO rack_slots (rack_id, slot_index, machine_item_id) SELECT unnest($1::text[]), unnest($2::int[]), unnest($3::text[])`, [allSlotsRackId, allSlotsIdx, allSlotsItem]);
        }
        if (allMultiRackId.length > 0) {
          await client.query(`INSERT INTO rack_multiplier_slots (rack_id, slot_index, multiplier_item_id) SELECT unnest($1::text[]), unnest($2::int[]), unnest($3::text[])`, [allMultiRackId, allMultiIdx, allMultiItem]);
        }
      }
    }

    if (changes.workshopSlots) {
      const wVal = await validateWorkshopSlotsPayloadForSave(client, changes.workshopSlots, {
        adminOverride: effectiveAdminOverride
      });
      if (!wVal.ok) {
        throw new HttpControlledError(400, { error: wVal.error });
      }
      const workshopNorm = wVal.normalized;

      const existingSlotsRes = await client.query(
        'SELECT slot_index, item_id, installed_at, current_charge, slot_charges, slot_item_ids FROM workshop_slots WHERE user_id = $1',
        [uid]
      );
      const existingSlots: Record<number, Record<string, unknown>> = {};
      existingSlotsRes.rows.forEach((r) => {
        let parsed_slot_item_ids: Record<string, string> = {};
        if (r.slot_item_ids) {
          try {
            const raw = r.slot_item_ids;
            const o = typeof raw === 'string' ? JSON.parse(raw as string) : raw;
            if (o && typeof o === 'object' && !Array.isArray(o)) {
              for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
                if (typeof v === 'string' && v.trim()) parsed_slot_item_ids[k] = v.trim();
              }
            }
          } catch {
            parsed_slot_item_ids = {};
          }
        }
        existingSlots[r.slot_index] = { ...r, parsed_slot_item_ids };
      });

      const workshopItemIds = workshopNorm.map((w) => w?.itemId).filter((id): id is string => !!id);
      const slotRefIds: string[] = [];
      for (const w of workshopNorm) {
        if (w?.slotItemIds) {
          for (const sid of Object.values(w.slotItemIds)) {
            if (typeof sid === 'string' && sid) slotRefIds.push(sid);
          }
        }
      }
      for (const row of Object.values(existingSlots)) {
        const p = row?.parsed_slot_item_ids as Record<string, string> | undefined;
        if (!p) continue;
        for (const v of Object.values(p)) {
          if (typeof v === 'string' && v.trim()) slotRefIds.push(v.trim());
        }
      }
      const existingItemIds = Object.values(existingSlots)
        .map((s) => s.item_id)
        .filter((id): id is string => typeof id === 'string' && !!id);
      const allWorkshopTargetIds = [...new Set([...workshopItemIds, ...existingItemIds, ...slotRefIds])];

      const workshopUpgradesMap = new Map();
      if (allWorkshopTargetIds.length > 0) {
        const upRes = await client.query(
          'SELECT id, type, category, base_production, power_capacity FROM upgrades WHERE id = ANY($1::text[])',
          [allWorkshopTargetIds]
        );
        upRes.rows.forEach((u) => workshopUpgradesMap.set(u.id, u));
      }

      const capSlotCharges = (charges: Record<string, number>, slotItemIds: Record<string, string> | null) => {
        if (!slotItemIds) return { ...charges };
        const out = { ...charges };
        for (const key of Object.keys(out)) {
          const iid = slotItemIds[key];
          if (!iid) continue;
          const defB = workshopUpgradesMap.get(String(iid));
          const maxB = Number(defB?.power_capacity);
          if (Number.isFinite(maxB) && maxB >= 0 && out[key] > maxB) out[key] = maxB;
        }
        return out;
      };

      const wsUserIds = [];
      const wsSlotIdxs = [];
      const wsItemIds = [];
      const wsInternalStates = [];
      const wsCharges = [];
      const wsSlotCharges = [];
      const wsSlotItemIds = [];
      const wsInstalledAts = [];

      for (let i = 0; i < workshopNorm.length; i++) {
        const w = workshopNorm[i];
        const existing = existingSlots[i];

        if (w && w.itemId) {
          const defStruct = workshopUpgradesMap.get(String(w.itemId));
          const maxCapStruct = Number(defStruct?.power_capacity);

          // Só limpar bancada interna quando o jogador troca o modelo na BD — não quando é a
          // primeira persistência (linha inexistente ou slot vazio), senão o save apaga as
          // baterias que já vinham no payload do cliente.
          const hadItemInDb =
            !!existing &&
            existing.item_id != null &&
            String(String(existing.item_id).trim()) !== '';
          const structureIdChanged =
            hadItemInDb && String(existing.item_id) !== String(w.itemId);
          const isFirstPersistOfSlot = !hadItemInDb;

          let finalCharge = w.currentCharge || 0;
          let finalSlotCharges: Record<string, number> = w.slotCharges ? { ...w.slotCharges } : {};
          let internalPayload =
            w.internalSlots && Object.keys(w.internalSlots).length ? { ...w.internalSlots } : {};
          let slotItemIdsPayload: Record<string, string> | null =
            w.slotItemIds && Object.keys(w.slotItemIds).length ? { ...w.slotItemIds } : null;
          let validInstalledAt = Date.now();

          if (isFirstPersistOfSlot || structureIdChanged) {
            console.log(`[WorkshopPlace] ts=${new Date().toISOString()} userId=${uid} slotIndex=${i} itemId=${w.itemId}`);
            saveActivityLogs.push({ action: 'workshop_place', meta: { slotIndex: i, itemId: w.itemId } });
          }
          if (structureIdChanged && !effectiveAdminOverride) {
            finalCharge = 0;
            finalSlotCharges = {};
            internalPayload = {};
            slotItemIdsPayload = null;
          } else if (hadItemInDb && String(existing.item_id) === String(w.itemId)) {
            if (existing.slot_charges) {
              try {
                const dbSlotCharges =
                  typeof existing.slot_charges === 'string'
                    ? JSON.parse(existing.slot_charges as string)
                    : existing.slot_charges;
                for (const [sid, dbVal] of Object.entries(dbSlotCharges as Record<string, unknown>)) {
                  if (finalSlotCharges[sid] !== undefined && Number(dbVal) > Number(finalSlotCharges[sid])) {
                    finalSlotCharges[sid] = Number(dbVal);
                  }
                }
              } catch (e) {
                console.warn(
                  `[SaveGame] Error parsing existing slot_charges for slot ${i}:`,
                  e instanceof Error ? e.message : String(e)
                );
              }
            }
            if (Number(existing.current_charge) > finalCharge) {
              finalCharge = Number(existing.current_charge);
            }
            validInstalledAt = Number(existing.installed_at || Date.now());

            const dbSlotItemMap = (existing as { parsed_slot_item_ids?: Record<string, string> })
              .parsed_slot_item_ids;
            if (dbSlotItemMap && Object.keys(dbSlotItemMap).length > 0 && Object.keys(internalPayload).length > 0) {
              const merged: Record<string, string> = { ...(slotItemIdsPayload || {}) };
              let touched = false;
              for (const k of Object.keys(internalPayload)) {
                if (!merged[k] && dbSlotItemMap[k]) {
                  merged[k] = String(dbSlotItemMap[k]);
                  touched = true;
                }
              }
              if (touched && Object.keys(merged).length > 0) slotItemIdsPayload = merged;
            }
          }

          if (Number.isFinite(maxCapStruct) && maxCapStruct > 0) {
            finalCharge = Math.min(finalCharge, maxCapStruct);
          }
          finalSlotCharges = capSlotCharges(finalSlotCharges, slotItemIdsPayload);

          wsUserIds.push(uid);
          wsSlotIdxs.push(i);
          wsItemIds.push(w.itemId);
          wsInternalStates.push(Object.keys(internalPayload).length ? JSON.stringify(internalPayload) : null);
          wsCharges.push(finalCharge);
          wsSlotCharges.push(JSON.stringify(finalSlotCharges));
          wsSlotItemIds.push(slotItemIdsPayload ? JSON.stringify(slotItemIdsPayload) : null);
          wsInstalledAts.push(validInstalledAt);
        } else {
          if (existing && existing.item_id) {
            console.log(
              `[WorkshopDismantle] ts=${new Date().toISOString()} userId=${uid} slotIndex=${i} itemId=${existing.item_id}`
            );
            saveActivityLogs.push({ action: 'workshop_dismantle', meta: { slotIndex: i, itemId: existing.item_id } });
            const itemDef = workshopUpgradesMap.get(String(existing.item_id));
            if (itemDef && String(itemDef.type).toLowerCase() === 'charger') {
              if (Number(existing.current_charge) > 0.001) {
                throw Object.assign(new Error('Não é possível remover um carregador com carga.'), {
                  workshopClientError: true
                });
              }
            }
          }
          await client.query('UPDATE workshop_slots SET item_id = NULL, installed_at = 0 WHERE user_id = $1 AND slot_index = $2', [uid, i]);
        }
      }

      if (wsUserIds.length > 0) {
        await client.query(
          `
          INSERT INTO workshop_slots (user_id, slot_index, item_id, internal_state, current_charge, slot_charges, slot_item_ids, installed_at)
          SELECT unnest($1::int[]), unnest($2::int[]), unnest($3::text[]), unnest($4::text[]), unnest($5::numeric[]), unnest($6::text[]), unnest($7::text[]), unnest($8::numeric[])
          ON CONFLICT (user_id, slot_index) DO UPDATE SET
            item_id = EXCLUDED.item_id, internal_state = EXCLUDED.internal_state, current_charge = EXCLUDED.current_charge,
            slot_charges = EXCLUDED.slot_charges, slot_item_ids = EXCLUDED.slot_item_ids, installed_at = EXCLUDED.installed_at`,
          [wsUserIds, wsSlotIdxs, wsItemIds, wsInternalStates, wsCharges, wsSlotCharges, wsSlotItemIds, wsInstalledAts]
        );
        await refreshStoredBatteriesWorkshopLinkage(client, uid, workshopNorm);
      }
    }




    if (changes.claimedBoxes) {
      if (changes.claimedBoxes.length > 0) {
        await client.query(`
          INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) 
          SELECT $1, unnest($2::text[]), $3
          ON CONFLICT (user_id, box_id) DO NOTHING`,
          [uid, changes.claimedBoxes, Date.now()]);
      }
    }
    if (nftAutoSanitized && changes.placedRacks) {
      const stockRows = await client.query('SELECT item_id, qty FROM stock WHERE user_id = $1', [uid]);
      const stockObj = {};
      stockRows.rows.forEach((r) => {
        stockObj[r.item_id] = r.qty;
      });
      const batRows = await client.query(
        'SELECT id, item_id, current_charge, workshop_slot_index, workshop_component_slot_id FROM stored_batteries WHERE user_id = $1',
        [uid]
      );
      const bats = batRows.rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        currentCharge: Number(r.current_charge) || 0,
        workshopSlotIndex: r.workshop_slot_index != null ? Number(r.workshop_slot_index) : null,
        workshopComponentSlotId:
          r.workshop_component_slot_id != null ? String(r.workshop_component_slot_id) : null
      }));
      nftAutoSyncPayload = { placedRacks: changes.placedRacks, stock: stockObj, storedBatteries: bats };
    }
    },
    { timeout: 24000, maxWait: 5000 }
    );
    for (const ev of saveActivityLogs) {
      await appendGameActivityLog(db, uid, ev.action, ev.meta);
    }
    const savePayload: {
      ok: boolean;
      serverUpdatedAt: number;
      nftAutoSanitized?: boolean;
      placedRacks?: unknown;
      stock?: unknown;
      storedBatteries?: unknown;
    } = { ok: true, serverUpdatedAt: finalServerUpdatedAt };
    if (nftAutoSyncPayload) {
      savePayload.nftAutoSanitized = true;
      savePayload.placedRacks = nftAutoSyncPayload.placedRacks;
      savePayload.stock = nftAutoSyncPayload.stock;
      savePayload.storedBatteries = nftAutoSyncPayload.storedBatteries;
    }
    res.json(savePayload);
  } catch (e) {
    if (respondIfHttpControlledError(res, e)) return;
    if (e instanceof StoredBatterySaveGuardError) {
      return res.status(409).json({ error: e.message, forceReload: true });
    }
    const err = e as { workshopClientError?: boolean; message?: string };
    if (err && err.workshopClientError && typeof err.message === 'string') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[SaveGame] CRITICAL ERROR:', e);
    sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao guardar.');
  }
}

app.post('/api/save-game', handleSaveGamePost);

/** Gravação só de estoque + baterias no armazém (mesma transação que /api/save-game + merge na BD). */
app.post('/api/game/save-inventory', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
  const b = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const nested = b.changes && typeof b.changes === 'object' && !Array.isArray(b.changes) ? (b.changes as Record<string, unknown>) : null;
  const stock = nested != null ? nested.stock : b.stock;
  const storedBatteries = nested != null ? nested.storedBatteries : b.storedBatteries;
  const lastLoadTime = nested != null ? nested.lastLoadTime : b.lastLoadTime;
  if (stock === undefined && storedBatteries === undefined) {
    return res.status(400).json({ error: 'Envie stock e/ou storedBatteries (corpo plano ou changes).' });
  }
  (req.headers as Record<string, string | undefined>)['x-game-save-domain'] = 'inventory';
  req.body = {
    changes: { lastLoadTime, stock, storedBatteries },
    adminOverride: false
  };
  return handleSaveGamePost(req, res);
});

/** Gravação só de rigs/salas (placed_racks + slots). */
app.post('/api/game/save-servers', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
  const b = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const nested = b.changes && typeof b.changes === 'object' && !Array.isArray(b.changes) ? (b.changes as Record<string, unknown>) : null;
  const placedRacks = nested != null ? nested.placedRacks : b.placedRacks;
  const stock = nested != null ? nested.stock : b.stock;
  const storedBatteries = nested != null ? nested.storedBatteries : b.storedBatteries;
  const lastLoadTime = nested != null ? nested.lastLoadTime : b.lastLoadTime;
  if (placedRacks == null) {
    return res.status(400).json({ error: 'Envie placedRacks (corpo plano ou changes).' });
  }
  (req.headers as Record<string, string | undefined>)['x-game-save-domain'] = 'servers';
  const srvChanges: Record<string, unknown> = { lastLoadTime, placedRacks };
  if (stock !== undefined) srvChanges.stock = stock;
  if (storedBatteries !== undefined) srvChanges.storedBatteries = storedBatteries;
  req.body = {
    changes: srvChanges,
    adminOverride: false
  };
  return handleSaveGamePost(req, res);
});

/** Gravação só da oficina (workshop_slots). */
app.post('/api/game/save-workshop', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
  const b = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const nested = b.changes && typeof b.changes === 'object' && !Array.isArray(b.changes) ? (b.changes as Record<string, unknown>) : null;
  const workshopSlots = nested != null ? nested.workshopSlots : b.workshopSlots;
  const stock = nested != null ? nested.stock : b.stock;
  const storedBatteries = nested != null ? nested.storedBatteries : b.storedBatteries;
  const lastLoadTime = nested != null ? nested.lastLoadTime : b.lastLoadTime;
  if (workshopSlots == null) {
    return res.status(400).json({ error: 'Envie workshopSlots (corpo plano ou changes).' });
  }
  (req.headers as Record<string, string | undefined>)['x-game-save-domain'] = 'workshop';
  const wsChanges: Record<string, unknown> = { lastLoadTime, workshopSlots };
  if (stock !== undefined) wsChanges.stock = stock;
  if (storedBatteries !== undefined) wsChanges.storedBatteries = storedBatteries;
  req.body = {
    changes: wsChanges,
    adminOverride: false
  };
  return handleSaveGamePost(req, res);
});

// --- BACKUP SETTINGS API ---
app.get('/api/admin/backup-settings', isAdmin, async (req, res) => {
  try {
    const s = await getSettingsRecord(['auto_backup_enabled', 'auto_backup_interval']);
    const en = s.auto_backup_enabled;
    res.json({
      enabled: en === '1' || en === 'true',
      intervalMinutes: parseInt(s.auto_backup_interval || '60', 10)
    });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin/backup-settings', isAdmin, async (req, res) => {
  const { enabled, intervalMinutes } = req.body;
  try {
    await upsertSettingsEntries([
      { key: 'auto_backup_enabled', value: enabled ? 'true' : 'false' },
      { key: 'auto_backup_interval', value: String(intervalMinutes) }
    ]);

    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

// Start scheduler (give DB a moment to be ready if needed, though db.query usually handles pool)
setTimeout(async () => {
  // Only run background tasks on the designated worker
  if (WORKER_ROLE === 'BACKGROUND' || WORKER_ROLE === 'ALL') {
    startScheduledSqlBackups(backupModel);
    startSecurityThreatObserverBackgroundScan(backupModel, { intervalMs: 120_000 });
    await ensureAdminPermissionsColumn();
    await ensureSystemNewsAdColumns();
  }
}, 5000); // 5s startup delay

app.get('/api/admin/recall-scan', isAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    const totalUsersRes = await client.query('SELECT COUNT(*) as count FROM users');
    const totalUsers = parseInt(totalUsersRes.rows[0].count);

    const racks = await client.query(`
      SELECT u.id as user_id, u.username, COUNT(pr.id) as racks_count
      FROM users u
      LEFT JOIN placed_racks pr ON u.id = pr.user_id
      GROUP BY u.id, u.username
      HAVING COUNT(pr.id) > 0
    `);

    const summary = [];
    for (const row of racks.rows) {
      let totalItems = parseInt(row.racks_count);
      const rackIdsRes = await client.query('SELECT id, wiring_id, battery_id FROM placed_racks WHERE user_id = $1', [row.user_id]);
      for (const rack of rackIdsRes.rows) {
        if (rack.wiring_id) totalItems++;
        if (rack.battery_id) totalItems++;
        const slotsCount = await client.query('SELECT COUNT(*) FROM rack_slots WHERE rack_id = $1 AND machine_item_id IS NOT NULL', [rack.id]);
        totalItems += parseInt(slotsCount.rows[0].count);
        const multiCount = await client.query('SELECT COUNT(*) FROM rack_multiplier_slots WHERE rack_id = $1 AND multiplier_item_id IS NOT NULL', [rack.id]);
        totalItems += parseInt(multiCount.rows[0].count);
      }
      summary.push({
        userId: row.user_id,
        username: row.username,
        racksCount: parseInt(row.racks_count),
        totalItems: totalItems
      });
    }

    res.json({ ok: true, summary, totalUsersChecked: totalUsers });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

app.post('/api/admin/recall-all-players-items', isAdmin, async (req, res) => {
  const client = await db.connect();
  console.log('[RecallAll] Iniciando processo robusto de recolhimento global...');
  const report = { steps: [], finalStatus: 'pending', totalItemsMoved: 0, racksProcessed: 0, retries: 0 };

  try {
    const scanRigs = async (c) => {
      const racks = await c.query('SELECT id, user_id, item_id, wiring_id, battery_id FROM placed_racks');
      const data = [];
      for (const r of racks.rows) {
        const components = [];
        if (r.item_id) components.push(r.item_id);
        if (r.wiring_id) components.push(r.wiring_id);
        if (r.battery_id) components.push(r.battery_id);
        const slots = await c.query('SELECT machine_item_id FROM rack_slots WHERE rack_id = $1', [r.id]);
        slots.rows.forEach(s => { if (s.machine_item_id) components.push(s.machine_item_id); });
        const multi = await c.query('SELECT multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = $1', [r.id]);
        multi.rows.forEach(m => { if (m.multiplier_item_id) components.push(m.multiplier_item_id); });
        data.push({ rackId: r.id, userId: r.user_id, components });
      }
      return data;
    };

    let attempts = 0;
    const MAX_ATTEMPTS = 3;
    let itemsStillInstalled = true;

    while (itemsStillInstalled && attempts < MAX_ATTEMPTS) {
      attempts++;
      report.steps.push("Iniciando tentativa " + attempts + "...");
      const currentMap = await scanRigs(client);

      if (currentMap.length === 0) {
        report.steps.push('Tudo limpo: Nenhum item instalado detectado.');
        itemsStillInstalled = false;
        break;
      }

      report.steps.push("Levantamento concluido: " + currentMap.length + " rigs identificadas.");

      await client.query('BEGIN');
      try {
        let batchMoved = 0;
        for (const entry of currentMap) {
          for (const itemId of entry.components) {
            await client.query(`
              INSERT INTO stock (user_id, item_id, qty) 
              VALUES ($1, $2, 1) 
              ON CONFLICT (user_id, item_id) 
              DO UPDATE SET qty = stock.qty + 1
            `, [entry.userId, itemId]);
            batchMoved++;
          }
        }
        report.totalItemsMoved += batchMoved;
        report.racksProcessed = Math.max(report.racksProcessed, currentMap.length);

        await client.query('DELETE FROM rack_slots WHERE rack_id IN (SELECT id FROM placed_racks)');
        await client.query('DELETE FROM rack_multiplier_slots WHERE rack_id IN (SELECT id FROM placed_racks)');
        await client.query('DELETE FROM placed_racks');

        await client.query('COMMIT');
        report.steps.push("Tentativa " + attempts + ": " + batchMoved + " itens movidos para estoque.");
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      const verifyMap = await scanRigs(client);
      if (verifyMap.length === 0) {
        report.steps.push('Verificacao concluida: Todas as instalacoes foram removidas.');
        itemsStillInstalled = false;
      } else {
        report.steps.push("Aviso: " + verifyMap.length + " instalacoes ainda detectadas após a tentativa " + attempts + ".");
        report.retries++;
      }
    }

    report.finalStatus = itemsStillInstalled ? 'incomplete' : 'success';
    report.steps.push(itemsStillInstalled ? 'Encerrado com itens pendentes após 3 tentativas.' : 'Finalizado com sucesso total e verificado.');
    res.json({ ok: report.finalStatus === 'success', report });

  } catch (e) {
    console.error('[RecallAll] Erro critico no fluxo:', e);
    sendInternalErrorShapeOrPrisma(
      res,
      'RecallAll',
      e,
      { ok: false, report },
      'Erro no fluxo. Consulta o relatório em anexo.'
    );
  } finally {
    client.release();
  }
});

// --- ADMIN STATS ---
app.post('/api/admin/impersonate', isAdmin, async (req, res) => {
  const { targetEmail } = req.body;
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  const adminId = req.userId;
  if (!sid || !adminId) return res.status(400).json({ error: 'Sessão necessária para personificação' });
  try {
    const sRes = await db.query('SELECT user_id FROM sessions WHERE session_id = $1', [sid]);
    if (!sRes.rows[0]) return res.status(400).json({ error: 'Sessão inválida' });
    const targetId = await getUserIdByEmail(targetEmail, req.ip, { allowAnyDomain: true });
    if (!targetId || targetId === adminId) return res.status(400).json({ error: 'Invalid target' });
    await db.query('UPDATE sessions SET user_id = $1, original_user_id = $2 WHERE session_id = $3', [targetId, adminId, sid]);
    clearAuthCookies(res);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/admin/stop-impersonate', async (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  try {
    const sRow = await prisma.sessions.findUnique({
      where: { session_id: sid },
      select: { original_user_id: true }
    });
    const originalUid = sRow?.original_user_id;
    if (!originalUid) return res.status(400).json({ error: 'Not impersonating' });
    await prisma.sessions.update({
      where: { session_id: sid },
      data: { user_id: originalUid, original_user_id: null }
    });
    await issueJwtAuthCookies(res, originalUid, req);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/stats/top-deposits', async (req, res) => {
  try {
    const resRows = await db.query('SELECT u.username, u.email, COALESCE(gs.total_usdc_deposited, 0) AS total FROM game_states gs JOIN users u ON u.id = gs.user_id ORDER BY total DESC LIMIT 10');
    res.json(resRows.rows.map(r => ({ username: r.username, email: r.email, totalUsdcDeposited: r.total })));
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/stats/top-withdrawals', async (req, res) => {
  try {
    const resRows = await db.query('SELECT u.username, u.email, COALESCE(gs.total_crypto_withdrawn, 0) AS total FROM game_states gs JOIN users u ON u.id = gs.user_id ORDER BY total DESC LIMIT 10');
    res.json(resRows.rows.map(r => ({ username: r.username, email: r.email, totalCryptoWithdrawn: r.total })));
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/admin/security/stats', isAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    // 1. Multi-accounts by registration_ip
    const multiAccountsRes = await client.query(`
      SELECT registration_ip, COUNT(*) as account_count, 
             array_agg(username) as usernames, 
             array_agg(email) as emails,
             array_agg(id) as ids
      FROM users 
      WHERE registration_ip IS NOT NULL
      GROUP BY registration_ip
      HAVING COUNT(*) > 1
      ORDER BY account_count DESC
    `);

    // 2. Multi-accounts by user_history_ips (more robust)
    const historyMultiAccountsRes = await client.query(`
      SELECT ip, COUNT(DISTINCT user_id) as user_count,
             array_agg(DISTINCT u.username) as usernames,
             array_agg(DISTINCT u.email) as emails
      FROM user_history_ips h
      JOIN users u ON h.user_id = u.id
      GROUP BY ip
      HAVING COUNT(DISTINCT user_id) > 1
      ORDER BY user_count DESC
    `);

    // 3. Suspected Auto-Referrals (Same IP between referrer and referred)
    const suspectedAutoRefsRes = await client.query(`
      SELECT 
        u1.id as referrer_id, u1.username as referrer_username, u1.registration_ip as referrer_ip,
        u2.id as referred_id, u2.username as referred_username, u2.registration_ip as referred_ip
      FROM referrals r
      JOIN users u1 ON r.user_id = u1.id
      JOIN users u2 ON r.referred_username = u2.username
      WHERE u1.registration_ip = u2.registration_ip
      OR EXISTS (
        SELECT 1 FROM user_history_ips h1 
        JOIN user_history_ips h2 ON h1.ip = h2.ip
        WHERE h1.user_id = u1.id AND h2.user_id = u2.id
      )
    `);

    // 4. Admin Access Logs (Unauthorized attempts)
    const accessLogsRes = await client.query(`
      SELECT * FROM admin_access_logs 
      ORDER BY created_at DESC 
      LIMIT 100
    `);

    // 5. IP Blacklist (+ utilizadores com mesmo IP em registo ou histórico de login)
    const blPrisma = await prisma.ip_blacklist.findMany({ orderBy: { added_at: 'desc' } });
    const blRows = blPrisma.map((r) => ({
      ip: r.ip,
      reason: r.reason,
      added_at: Number(r.added_at)
    })) as Array<{ ip?: unknown; reason?: unknown; added_at?: unknown }>;
    const ipKeys = [
      ...new Set(
        blRows
          .map((r) => String(r.ip ?? '').trim())
          .filter((x) => x.length > 0)
      )
    ];
    type LinkedUser = { id: number; username: string; email: string; vias: string[] };
    const linkedByIpNorm = new Map<string, LinkedUser[]>();
    if (ipKeys.length > 0) {
      const linkRes = await client.query(
        `WITH ips AS (SELECT DISTINCT unnest($1::text[]) AS raw_ip)
         SELECT lower(trim(ips.raw_ip::text)) AS ip_norm, u.id, u.username::text AS username, u.email::text AS email, 'registro'::text AS via
         FROM ips
         INNER JOIN users u ON u.registration_ip IS NOT NULL
           AND lower(trim(u.registration_ip::text)) = lower(trim(ips.raw_ip::text))
         UNION ALL
         SELECT lower(trim(ips.raw_ip::text)), u.id, u.username::text, u.email::text, 'hist_login'::text
         FROM ips
         INNER JOIN user_history_ips h ON lower(trim(h.ip::text)) = lower(trim(ips.raw_ip::text))
         INNER JOIN users u ON u.id = h.user_id`,
        [ipKeys]
      );
      for (const row of linkRes.rows as Array<{
        ip_norm?: string;
        id?: unknown;
        username?: string;
        email?: string;
        via?: string;
      }>) {
        const k = String(row.ip_norm || '').trim().toLowerCase();
        if (!k) continue;
        if (!linkedByIpNorm.has(k)) linkedByIpNorm.set(k, []);
        const arr = linkedByIpNorm.get(k);
        const idNum = Number(row.id);
        let ex = arr.find((x) => x.id === idNum);
        if (!ex) {
          ex = {
            id: idNum,
            username: String(row.username || ''),
            email: String(row.email || ''),
            vias: []
          };
          arr.push(ex);
        }
        const via = String(row.via || '');
        if (via && !ex.vias.includes(via)) ex.vias.push(via);
      }
    }
    const blacklistOut = blRows.map((row) => {
      const ipStr = String(row.ip ?? '').trim();
      const norm = ipStr.trim().toLowerCase();
      return {
        ...row,
        linkedUsers: linkedByIpNorm.get(norm) || []
      };
    });

    res.json({
      multiAccounts: multiAccountsRes.rows,
      historyMultiAccounts: historyMultiAccountsRes.rows,
      suspectedAutoReferrals: suspectedAutoRefsRes.rows,
      accessLogs: accessLogsRes.rows,
      blacklist: blacklistOut
    });
  } catch (e) {
    console.error('Security Stats Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

app.post('/api/admin/security/blacklist', isAdmin, async (req, res) => {
  const { ip, reason } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP requerido' });
  try {
    const ipStr = String(ip);
    const at = BigInt(Date.now());
    await prisma.ip_blacklist.upsert({
      where: { ip: ipStr },
      create: { ip: ipStr, reason: reason || 'Banned by Admin', added_at: at },
      update: { reason: reason || 'Banned by Admin' }
    });
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.delete('/api/admin/security/blacklist/:ip', isAdmin, async (req, res) => {
  const { ip } = req.params;
  try {
    await prisma.ip_blacklist.deleteMany({ where: { ip: String(ip) } });
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/admin/user-activity', isAdmin, async (req, res) => {
  try {
    const rawQ = String(req.query.email || req.query.q || '').trim().toLowerCase();
    const uidParsed = parseInt(String(req.query.userId || ''), 10);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '80'), 10) || 80));

    let uid = null;
    if (rawQ) {
      const uRows = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM users
        WHERE lower(trim(email::text)) = ${rawQ} OR lower(trim(username::text)) = ${rawQ}
        LIMIT 1
      `;
      if (!uRows[0]) {
        return res.status(404).json({ error: 'Utilizador não encontrado (email ou username).' });
      }
      uid = uRows[0].id;
    } else if (Number.isFinite(uidParsed) && uidParsed > 0) {
      uid = uidParsed;
    } else {
      return res.status(400).json({ error: 'Indique email, username ou userId válido' });
    }

    const logs = await listGameActivityLogsMongo(Number(uid), limit);
    const mongoOk = !!getGenesisMongo();
    res.json({
      logs: logs.map((r) => ({
        id: r.id,
        action: r.action,
        meta: r.meta,
        createdAt: r.createdAt
      })),
      ...(mongoOk
        ? {}
        : {
            activityLogNote:
              'MONGODB_URI não está definido: o histórico de atividade de jogo só existe no MongoDB. Configure a URI e a coleção genesis_logs.game_activity_logs.'
          })
    });
  } catch (e) {
    console.error('[AdminUserActivity]', e);
    res.status(500).json({ error: 'Falha ao carregar atividade' });
  }
});


// --- ADMIN MARKET ---
app.get('/api/admin/market/listings', isAdmin, async (req, res) => {
  try {
    const listings = await prisma.player_listings.findMany({
      orderBy: [{ status: 'asc' }, { item_id: 'asc' }]
    });
    const sellerIds = [...new Set(listings.map((l) => l.user_id))];
    type SellerRow = Prisma.usersGetPayload<{
      select: { id: true; username: true; email: true };
    }>;
    const sellers: SellerRow[] =
      sellerIds.length === 0
        ? []
        : await prisma.users.findMany({
            where: { id: { in: sellerIds } },
            select: { id: true, username: true, email: true }
          });
    const sellerMap = new Map(sellers.map((u) => [u.id, u]));
    res.json(
      listings.map((l) => {
        const su = sellerMap.get(l.user_id);
        const q = Math.max(1, parseInt(String(l.qty ?? 1), 10) || 1);
        const unit = Number(l.price);
        return {
          id: l.id,
          sellerId: l.user_id,
          sellerName: (su?.username || su?.email) ?? '',
          itemId: l.item_id,
          price: unit,
          qty: q,
          lineTotal: unit * q,
          status: l.status,
          expiresAt: Number(l.expires_at),
          reservedBy: l.reserved_by,
          reservedUntil: l.reserved_until != null ? Number(l.reserved_until) : undefined
        };
      })
    );
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

// --- PROMO CODES ---
app.get('/api/admin/promo-codes', isAdmin, async (req, res) => {
  try {
    const resRows = await db.query('SELECT * FROM promo_codes ORDER BY created_at DESC');
    const enriched = await Promise.all(resRows.rows.map(async p => {
      const redsRes = await db.query('SELECT COUNT(*) FROM promo_code_redemptions WHERE code = $1', [p.code]);
      const lastRedsRes = await db.query(`
        SELECT r.redeemed_at, u.username as user_name 
        FROM promo_code_redemptions r 
        JOIN users u ON r.user_id = u.id 
        WHERE r.code = $1 
        ORDER BY r.redeemed_at DESC LIMIT 5
  `, [p.code]);
      return {
        ...p,
        lootBoxId: p.loot_box_id,
        upgradeId: p.upgrade_id,
        adminUpgradeId: p.admin_upgrade_id,
        isActive: !!p.is_active,
        createdAt: Number(p.created_at),
        expiresAt:
          p.expires_at != null && Number.isFinite(Number(p.expires_at)) && Number(p.expires_at) > 0
            ? Number(p.expires_at)
            : undefined,
        redemptionsCount: parseInt(redsRes.rows[0].count),
        lastRedemptions: lastRedsRes.rows.map(r => ({ userName: r.user_name, redeemedAt: Number(r.redeemed_at) }))
      };
    }));
    res.json(enriched);
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.get('/api/admin/loot-box-redemptions/:lootBoxId', isAdmin, async (req, res) => {
  try {
    const { lootBoxId } = req.params;
    const resRows = await db.query(`
      SELECT r.code, p.type, u.username, r.redeemed_at
      FROM promo_codes p
      JOIN promo_code_redemptions r ON p.code = r.code
      JOIN users u ON r.user_id = u.id
      WHERE p.loot_box_id = $1
      ORDER BY r.redeemed_at DESC
  `, [lootBoxId]);

    res.json(resRows.rows.map(r => ({
      code: r.code,
      type: r.type,
      username: r.username,
      redeemedAt: Number(r.redeemed_at)
    })));
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/admin/promo-codes', isAdmin, async (req, res) => {
  const { code, lootBoxId, upgradeId, adminUpgradeId, type, expiresAt } = req.body || {};
  if (!code || (!lootBoxId && !upgradeId && !adminUpgradeId)) return res.status(400).json({ error: 'Faltam campos (é necessário uma caixa, um upgrade ou um pacote)' });
  const now = Date.now();
  let expMs: number | null = null;
  if (expiresAt != null && expiresAt !== '') {
    const n = typeof expiresAt === 'number' ? expiresAt : parseInt(String(expiresAt), 10);
    if (Number.isFinite(n) && n > now) {
      const max = now + 10 * 365 * 24 * 60 * 60 * 1000;
      expMs = Math.min(Math.floor(n), Math.floor(max));
    }
  }
  try {
    await db.query(
      `INSERT INTO promo_codes (code, loot_box_id, upgrade_id, admin_upgrade_id, type, is_active, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7)
       ON CONFLICT (code) DO UPDATE SET
         loot_box_id = EXCLUDED.loot_box_id,
         upgrade_id = EXCLUDED.upgrade_id,
         admin_upgrade_id = EXCLUDED.admin_upgrade_id,
         type = EXCLUDED.type,
         expires_at = COALESCE(EXCLUDED.expires_at, promo_codes.expires_at)`,
      [code, lootBoxId || null, upgradeId || null, adminUpgradeId || null, type || 'per_player', now, expMs]
    );
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/admin/promo-codes/bulk-delete', isAdmin, async (req, res) => {
  const raw = (req.body as { codes?: unknown })?.codes;
  if (!Array.isArray(raw) || raw.length === 0) {
    return res.status(400).json({ error: 'Lista de códigos vazia ou inválida.' });
  }
  const codes = raw
    .map((c) => String(c || '').trim().toUpperCase())
    .filter((c) => /^[A-Z0-9_-]{4,40}$/.test(c));
  if (codes.length === 0) {
    return res.status(400).json({ error: 'Nenhum código válido para apagar.' });
  }
  if (codes.length > 2000) {
    return res.status(400).json({ error: 'Máximo 2000 códigos por pedido.' });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM promo_code_redemptions WHERE code = ANY($1::text[])', [codes]);
    const del = await client.query('DELETE FROM promo_codes WHERE code = ANY($1::text[])', [codes]);
    await client.query('COMMIT');
    res.json({ ok: true, deleted: del.rowCount ?? 0 });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    client.release();
  }
});

app.delete('/api/admin/promo-codes/:code', isAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    await db.query('DELETE FROM promo_code_redemptions WHERE code = $1', [code]);
    await db.query('DELETE FROM promo_codes WHERE code = $1', [code]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.put('/api/admin/promo-codes/:code/toggle', isAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const { isActive } = req.body;
    await db.query('UPDATE promo_codes SET is_active = $1 WHERE code = $2', [isActive ? 1 : 0, code]);
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

// O backend agora é apenas API. O frontend é servido separadamente.

app.post('/api/admin/ranking-exclusion', isAdmin, async (req, res) => {
  const { email, excluded } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email inválido' });
  try {
    const uid = await getUserIdByEmail(email, req.ip, { allowAnyDomain: true });
    await db.query('UPDATE users SET ranking_excluded = $1 WHERE id = $2', [excluded ? 1 : 0, uid]);
    dashboardStatsCache = null;
    lastDashboardFetch = 0;
    res.json({ ok: true });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

// --- GEMINI PROXY ENDPOINTS ---

app.post('/api/gemini/generate-news', async (req, res) => {
  const { totalProduction } = req.body;
  if (!genAI) return res.json({ fallback: true });

  try {
    const formattedProd = totalProduction < 0.01
      ? Number(totalProduction).toFixed(8)
      : Number(totalProduction).toFixed(1);

    const prompt = `
      Você é um noticiário financeiro cyberpunk satírico.
      A moeda fictícia é o "Nanit".
      A taxa de produção atual do jogador é ${formattedProd} Nanits / segundo.
      Gere UMA manchete curta(max 100 caracteres) e engraçada sobre o mercado de cripto, tecnologia ou hackers.
      Pode ser sobre o valor subindo, caindo, ou rumores absurdos.
      Use português do Brasil.
    `;

    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });
    const text = response.text?.trim();
    res.json({ text });
  } catch (e) {
    console.error('[Gemini News Error]', e.message);
    res.json({ fallback: true });
  }
});

app.post('/api/gemini/fortune', async (req, res) => {
  const { prizeLabel } = req.body;
  if (!genAI) return res.json({ text: "O destino é incerto, mas a sorte sorri para os corajosos." });

  try {
    const prompt = `
      Você é uma vidente mística ciberpunk.
      O usuário acabou de ganhar um prêmio na roleta: "${prizeLabel}".
      Gere uma frase curta(max 1 frase), enigmática e divertida sobre o que esse prêmio significa para o futuro dele.
      Use um tom místico, tecnológico e levemente irônico.
    `;

    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    const text = response.text?.trim();
    res.json({ text });
  } catch (e) {
    console.error('[Gemini Fortune Error]', e.message);
    res.json({ text: "O futuro está nebuloso neste momento." });
  }
});


// --- MINING COINS MANAGEMENT ---

app.get('/api/mining/coins', async (req, res) => {
  try {
    const query = 'SELECT * FROM mining_coins ORDER BY name ASC';
    const r = await db.query(query);
    const rows = r.rows;

    // Map DB fields to Frontend fields (snake_case to camelCase)
    const coins = rows.map((c) => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      networkHashrate: Number(c.network_hashrate),
      blockReward: c.block_reward,
      blockTime: c.block_time,
      priceUSD: c.price_usd,
      algorithm: c.algorithm || 'Unknown',
      difficulty: c.difficulty || 1,
      multiplier: c.multiplier || 1,
      color: c.color || '#ffffff',
      description: c.description,
      minProportion: c.min_proportion,
      isActive: c.is_active,
      usdcRate: c.usdc_rate,
      showInExchange: c.show_in_exchange === 1,
      targetDailyUSD: Number(c.target_daily_usd) || 0,
      realNetworkHashrate: miningRuntimeStats.globalNetworkHashrates.get(String(c.id)) || 0
    }));

    let liveById: Record<string, number | null> = {};
    let liveErr: string | null = null;
    try {
      liveById = await fetchLiveUsdByMiningCoinRowIds(rows);
    } catch (e) {
      liveErr = e instanceof Error ? e.message : String(e);
      console.warn('[GET /api/mining/coins] live USD prices:', liveErr);
    }

    const enriched = coins.map((c, i) => {
      const row = rows[i];
      const id = String(row.id ?? '').trim();
      const live = id ? liveById[id] ?? null : null;
      const dbP = Number(row.price_usd ?? 0);
      return {
        ...c,
        livePriceUsd: live,
        displayPriceUsd: typeof live === 'number' && Number.isFinite(live) ? live : dbP
      };
    });

    if (String(req.query.legacy ?? '') === '1') {
      res.json(enriched);
    } else {
      res.json({
        coins: enriched,
        economy: MINING_ECONOMY_PUBLIC_META,
        livePricesError: liveErr
      });
    }
  } catch (e) {
    console.error(e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/mining/coins', isAdmin, async (req, res) => {
  const c = req.body;

  if (!c.name || !c.symbol) return res.status(400).json({ error: 'Name and Symbol are required' });

  const parseMiningNumeric = (v, fallback) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v === null || v === undefined) return fallback;
    let s = String(v).trim().replace(/\s/g, '');
    if (!s) return fallback;
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && (!hasDot || s.lastIndexOf(',') > s.lastIndexOf('.'))) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  };

  try {
    const id = c.id || crypto.randomUUID();
    const networkHashrate = Math.max(0, parseMiningNumeric(c.networkHashrate, 1_000_000)) || 1_000_000;
    const blockReward = roundMiningEconomyField8Decimals(Math.max(0, parseMiningNumeric(c.blockReward, 0)));
    const blockTime = MINING_BLOCK_TIME_SECONDS_FIXED;
    const priceUSD = roundMiningEconomyField8Decimals(
      (() => {
        const p = parseMiningNumeric(c.priceUSD, NaN);
        return Number.isFinite(p) && p >= 0 ? p : 1;
      })()
    );
    const usdcRateRaw = parseMiningNumeric(c.usdcRate, NaN);
    const usdcRate = roundMiningEconomyField8Decimals(
      Number.isFinite(usdcRateRaw) && usdcRateRaw >= 0 ? usdcRateRaw : priceUSD
    );
    const difficulty = roundMiningEconomyField8Decimals(Math.max(1, parseMiningNumeric(c.difficulty, 1)));
    const multiplier = roundMiningEconomyField8Decimals(Math.max(1, parseMiningNumeric(c.multiplier, 1)));
    const minProportion = roundMiningEconomyField8Decimals(Math.max(0, parseMiningNumeric(c.minProportion, 0)));
    const targetDailyUSD = roundMiningEconomyField8Decimals(Math.max(0, parseMiningNumeric(c.targetDailyUSD, 0)));
    const isActive = c.isActive === false || c.isActive === 0 ? 0 : 1;
    const showInEx = c.showInExchange ? 1 : 0;

    let prevEmission: { block_reward: number; block_time: number; network_hashrate: number } | null = null;
    try {
      const prevRow = await prisma.mining_coins.findUnique({
        where: { id },
        select: { block_reward: true, block_time: true, network_hashrate: true }
      });
      prevEmission = prevRow || null;
    } catch {
      prevEmission = null;
    }

    const oldY = prevEmission
      ? spotYieldPerHashForCoin(
          id,
          Number(prevEmission.block_reward),
          Number(prevEmission.block_time),
          Number(prevEmission.network_hashrate)
        )
      : null;
    const newY = spotYieldPerHashForCoin(id, blockReward, blockTime, networkHashrate);
    const emissionChanged =
      oldY === null ||
      !Number.isFinite(oldY) ||
      !Number.isFinite(newY) ||
      Math.abs(oldY - newY) > SPOT_YIELD_EPS;

    await prisma.mining_coins.upsert({
      where: { id },
      create: {
        id,
        name: String(c.name),
        symbol: String(c.symbol || ''),
        description: String(c.description || ''),
        network_hashrate: networkHashrate,
        block_reward: blockReward,
        block_time: blockTime,
        price_usd: priceUSD,
        algorithm: String(c.algorithm || ''),
        difficulty,
        multiplier,
        color: String(c.color || '#ffffff'),
        min_proportion: minProportion,
        is_active: isActive,
        usdc_rate: usdcRate,
        show_in_exchange: showInEx,
        target_daily_usd: targetDailyUSD
      },
      update: {
        name: String(c.name),
        symbol: String(c.symbol || ''),
        description: String(c.description || ''),
        network_hashrate: networkHashrate,
        block_reward: blockReward,
        block_time: blockTime,
        price_usd: priceUSD,
        algorithm: String(c.algorithm || ''),
        difficulty,
        multiplier,
        color: String(c.color || '#ffffff'),
        min_proportion: minProportion,
        is_active: isActive,
        usdc_rate: usdcRate,
        show_in_exchange: showInEx,
        target_daily_usd: targetDailyUSD
      }
    });

    if (emissionChanged) {
      await prisma.mining_yield_history.create({
        data: {
          coin_id: id,
          yield_per_hash: newY,
          block_reward: blockReward,
          network_hashrate: networkHashrate,
          effective_at: BigInt(Date.now())
        }
      });
    }

    if (isActive === 0) {
      await prisma.placed_racks.updateMany({
        where: { selected_coin_id: id },
        data: { is_on: 0 }
      });
    }

    res.json({ ok: true, id });
  } catch (e) {
    console.error('Failed to save mining coin:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.delete('/api/mining/coins/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM mining_coins WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});


/** Redefinição por email: envia link sem exigir carteira (resposta uniforme para não enumerar contas). */
app.post('/api/request-password-reset', passwordResetRequestLimiter, async (req, res) => {
  const raw = req.body && req.body.email != null ? String(req.body.email).trim() : '';
  const genericOk = {
    ok: true,
    message: 'Se existir uma conta com este email, enviámos um link para redefinir a senha.'
  };
  if (!raw || raw.length > EMAIL_ADDRESS_MAX_LENGTH) {
    return res.status(400).json({ error: 'Indique um email válido.' });
  }
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRx.test(raw)) {
    return res.status(400).json({ error: 'Indique um email válido.' });
  }
  try {
    const row = await prisma.users.findFirst({
      where: { email: { equals: raw, mode: 'insensitive' } },
      select: { email: true }
    });
    if (!row) {
      return res.json(genericOk);
    }
    const email = row.email;
    const timestamp = Date.now();
    const resetPayload = JSON.stringify({ email, expiry: timestamp + 60 * 60 * 1000 });
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(resetPayload).digest('hex');
    const resetToken = Buffer.from(resetPayload).toString('base64') + '.' + signature;

    void sendResetEmail(email, resetToken, { validityMinutes: 60 }).catch((mailErr: unknown) => {
      console.error('[request-password-reset] envio SMTP:', mailErr instanceof Error ? mailErr.message : mailErr);
    });
    return res.json(genericOk);
  } catch (e) {
    console.error('[request-password-reset]', e.message || e);
    return res.json(genericOk);
  }
});

// PASSWORD RECOVERY BY WALLET (legado; o fluxo principal é por email)
app.post('/api/verify-recovery-wallet', passwordResetRequestLimiter, async (req, res) => {
  const { email, walletAddress } = req.body;
  if (!email || !walletAddress) return res.status(400).json({ error: 'Dados incompletos' });

  const emailNorm = String(email).trim().toLowerCase();
  const emailCheck = validateLoginEmail(emailNorm);
  if (!emailCheck.ok) {
    return res.status(400).json({ error: emailCheck.error });
  }
  const walletStr = String(walletAddress).trim();
  const wv = validateOptionalPolygonWallet(walletStr);
  if (wv && typeof wv === 'object' && 'error' in wv) {
    return res.status(400).json({ error: (wv as { error: string }).error });
  }

  /** Resposta uniforme — evita enumeração de emails / estado da conta. */
  const recoveryDenied = {
    ok: false,
    error: 'Não foi possível verificar a recuperação com os dados indicados.'
  };

  try {
    const r = await db.query('SELECT email, username, polygon_wallet FROM users WHERE lower(email) = lower($1)', [emailNorm]);
    if (r.rows.length === 0) return res.status(403).json(recoveryDenied);

    const user = r.rows[0];
    const accountEmail = String(user.email || emailNorm);
    const storedWallet = user.polygon_wallet;

    if (!storedWallet) {
      return res.status(403).json(recoveryDenied);
    }

    // Case-insensitive comparison
    if (storedWallet.toLowerCase() !== walletStr.toLowerCase()) {
      return res.status(403).json(recoveryDenied);
    }

    // Success - Generate simple temporary token
    const timestamp = Date.now();
    const resetPayload = JSON.stringify({ email: accountEmail, walletAddress: walletStr, expiry: timestamp + 600000 }); // 10 mins
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(resetPayload).digest('hex');
    const resetToken = Buffer.from(resetPayload).toString('base64') + '.' + signature;

    res.json({ ok: true, resetToken });

    sendResetEmail(accountEmail, resetToken, { validityMinutes: 10 }).catch(err => {
      console.error('[Mailer Error] Falha ao enviar e-mail:', err.message);
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.post('/api/reset-password-secure', async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'Dados incompletos' });
  const pv = validateSignupPassword(newPassword, true);
  if (!pv.ok) return res.status(400).json({ error: pv.error });

  try {
    const [payloadB64, signature] = resetToken.split('.');
    if (!payloadB64 || !signature) return res.status(400).json({ error: 'Token inválido' });

    const expectedSig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(Buffer.from(payloadB64, 'base64').toString()).digest('hex');
    if (signature !== expectedSig) return res.status(403).json({ error: 'Token manipulado ou inválido' });

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    if (Date.now() > payload.expiry) return res.status(403).json({ error: 'Sessão de recuperação expirada' });

    const email = payload.email;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Token inválido' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = $1 WHERE lower(email) = lower($2)', [hashedPassword, email]);
    res.json({ ok: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao redefinir senha.' });
  }
});

// Bloqueia sondagens a ficheiros sensíveis antes do static/SPA (404 genérico, sem corpo de segredos).
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const p = (req.path || '').toLowerCase();
  if (p.startsWith('/.env')) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).type('text/plain').send('Not Found');
  }
  if (p.startsWith('/.git') || p === '/.svn' || p === '/.hg') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).type('text/plain').send('Not Found');
  }
  next();
});

app.use(express.static(path.join(__dirname, '../frontend/dist')));

// --- EXCHANGE ---
app.get('/api/exchange-settings', async (req, res) => {
  try {
    const s = await getSettingsRecord(['exchange_min_usdc', 'exchange_fee_percent']);
    const min = s.exchange_min_usdc != null && s.exchange_min_usdc !== '' ? Number(s.exchange_min_usdc) : 0.1;
    const fee = s.exchange_fee_percent != null && s.exchange_fee_percent !== '' ? Number(s.exchange_fee_percent) : 0;

    console.log('[API] GET Exchange Settings:', { min, fee }); // DEBUG LOG
    res.set('Cache-Control', 'no-store');
    res.json({
      minExchangeAmount: min,
      exchangeFeePercent: fee
    });
  } catch (e) { sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e); }
});

app.post('/api/exchange-settings', isAdmin, async (req, res) => {
  const { minExchangeAmount, exchangeFeePercent } = req.body;

  const min = Math.max(0, Number(minExchangeAmount) || 0);
  const fee = Math.max(0, Math.min(100, Number(exchangeFeePercent) || 0));

  try {
    console.log('[API] Saving Exchange Settings:', { min, fee }); // DEBUG LOG
    await upsertSettingsEntries([
      { key: 'exchange_min_usdc', value: String(min) },
      { key: 'exchange_fee_percent', value: String(fee) }
    ]);
    console.log('[API] Exchange Settings Saved Successfully'); // DEBUG LOG
    res.json({ ok: true });
  } catch (e) {
    console.error('[API] Exchange Settings Save Error:', e); // DEBUG LOG
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/exchange/sell', async (req, res) => {
  const { coinId, percentage } = req.body || {};
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });

  const cid = typeof coinId === 'string' ? coinId.trim() : '';
  if (!cid || !/^[a-zA-Z0-9_-]{1,80}$/.test(cid)) {
    return res.status(400).json({ error: 'Moeda inválida.' });
  }

  const pct = Number(percentage);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 1) {
    return res.status(400).json({ error: 'Percentual inválido (use entre 0 e 1, ex.: 0.5).' });
  }

  const exSet = await getSettingsRecord(['exchange_min_usdc', 'exchange_fee_percent']);
  const minUsdc = Math.max(0, Number(exSet.exchange_min_usdc)) || 0.1;
  const feePercent = Math.max(0, Math.min(100, Number(exSet.exchange_fee_percent) || 0));

  const client = await db.connect();
  try {
    const uid = req.userId;

    await client.query('BEGIN');

    const coinRes = await client.query(
      `SELECT id, name, usdc_rate, COALESCE(show_in_exchange, 1) AS sx, is_active
       FROM mining_coins WHERE id = $1`,
      [cid]
    );
    const coinDef = coinRes.rows[0];
    if (!coinDef || !coinDef.is_active) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Moeda não encontrada ou inativa.' });
    }
    if (Number(coinDef.sx) === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta moeda não está disponível no desk de câmbio.' });
    }

    const rate = Number(coinDef.usdc_rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Taxa USDC da moeda indisponível.' });
    }

    const balRes = await client.query(
      'SELECT amount FROM coin_balances WHERE user_id = $1 AND coin_id = $2 FOR UPDATE',
      [uid, cid]
    );
    const balance = Number(balRes.rows[0]?.amount) || 0;

    if (balance <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const sellAmount = balance * pct;
    if (!Number.isFinite(sellAmount) || sellAmount <= 0 || sellAmount > balance + 1e-12) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Valor de troca inválido.' });
    }

    const grossUsdc = sellAmount * rate;
    if (!Number.isFinite(grossUsdc) || grossUsdc < minUsdc) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Valor mínimo para troca é $${minUsdc.toFixed(2)} USDC` });
    }

    const feeAmount = grossUsdc * (feePercent / 100);
    const netUsdc = grossUsdc - feeAmount;
    if (!Number.isFinite(netUsdc) || netUsdc <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Valor líquido inválido após taxas.' });
    }

    const updCoin = await client.query(
      'UPDATE coin_balances SET amount = amount - $1 WHERE user_id = $2 AND coin_id = $3 AND amount >= $1 RETURNING amount',
      [sellAmount, uid, cid]
    );
    if (updCoin.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [netUsdc, uid]);

    await client.query('COMMIT');

    const finalGs = await client.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    const finalBal = await client.query('SELECT amount FROM coin_balances WHERE user_id = $1 AND coin_id = $2', [uid, cid]);

    console.log('[ExchangeSell] userId=%s coinId=%s coinName=%s pct=%s soldAmount=%s grossUsdc=%s feeUsdc=%s netUsdc=%s',
      uid, cid, coinDef.name, String(pct), sellAmount, grossUsdc.toFixed(8), feeAmount.toFixed(8), netUsdc.toFixed(8));
    await appendGameActivityLog(db, uid, 'exchange_sell', {
      coinId: cid,
      coinName: coinDef.name,
      pct: Number(pct),
      soldAmount: Number(sellAmount),
      netUsdc: Number(netUsdc.toFixed(8))
    });

    res.json({
      ok: true,
      soldAmount: sellAmount,
      netUsdc,
      feeUsdc: feeAmount,
      newUsdc: finalGs.rows[0]?.usdc || 0,
      newCoinBalance: finalBal.rows[0]?.amount || 0
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (rbErr) { /* ignore */ }
    console.error('[ExchangeSell]', e.message);
    res.status(500).json({ error: 'Erro ao processar troca.' });
  } finally {
    client.release();
  }
});

// --- WITHDRAWALS ---
app.post('/api/withdraw', async (req, res) => {
  const { coinId, amount, walletAddress } = req.body;
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (!coinId || !amount || amount <= 0 || !walletAddress) return res.status(400).json({ error: 'Dados incompletos' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const uid = req.userId;

    // 1. Verificar saldo
    const balRes = await client.query('SELECT amount FROM coin_balances WHERE user_id = $1 AND coin_id = $2 FOR UPDATE', [uid, coinId]);
    const balance = Number(balRes.rows[0]?.amount) || 0;

    if (balance < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    // 2. Buscar taxa/valor mínimo de USDC para conversão informativa
    const coinRes = await client.query('SELECT usdc_rate, symbol FROM mining_coins WHERE id = $1', [coinId]);
    const coin = coinRes.rows[0];
    if (!coin) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Moeda não encontrada' });
    }

    const amountUsdc = amount * (coin.usdc_rate || 0);

    // 3. Buscar taxa do token nas configurações
    const withdrawTokensRaw = await getSettingValue('web3_withdraw_tokens');
    let withdrawTokens = [];
    try {
      withdrawTokens = withdrawTokensRaw
        ? typeof withdrawTokensRaw === 'string'
          ? JSON.parse(withdrawTokensRaw)
          : withdrawTokensRaw
        : [];
    } catch (parseErr) {
      console.error('[Withdraw] Settings parse error:', parseErr);
      withdrawTokens = [];
    }

    const tokenCfg = withdrawTokens.find(t => t.name === coin.symbol);
    if (!tokenCfg) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `A moeda ${coin.symbol} não está configurada para saques no painel administrativo.` });
    }

    const feePercent = Number(tokenCfg?.feePercent) || 0;
    const feeAmount = amount * (feePercent / 100);
    const netAmount = amount - feeAmount;

    // 4. Deduzir saldo
    await client.query('UPDATE coin_balances SET amount = amount - $1 WHERE user_id = $2 AND coin_id = $3', [amount, uid, coinId]);

    // 5. Criar solicitação
    const requestId = crypto.randomUUID();
    await client.query(`
      INSERT INTO withdrawal_requests (id, user_id, coin_id, amount_crypto, amount_usdc, fee_amount, net_amount, wallet_address, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
    `, [requestId, uid, coinId, amount, amountUsdc, feeAmount, netAmount, walletAddress, Date.now()]);

    await client.query('COMMIT');
    res.json({ ok: true, requestId, message: 'Solicitação de saque enviada com sucesso!' });

  } catch (e) {
    if (client) await client.query('ROLLBACK');
    console.error('[Withdraw] Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    if (client) client.release();
  }
});

app.get('/api/admin/withdrawals', isAdmin, async (req, res) => {
  try {
    const query = `
      SELECT w.*, u.username, u.email, c.symbol as coin_symbol
      FROM withdrawal_requests w
      JOIN users u ON w.user_id = u.id
      JOIN mining_coins c ON w.coin_id = c.id
      ORDER BY w.created_at DESC
    `;
    const result = await db.query(query);
    res.json(result.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      email: r.email,
      coinId: r.coin_id,
      coinSymbol: r.coin_symbol,
      amountCrypto: Number(r.amount_crypto),
      amountUsdc: Number(r.amount_usdc),
      feeAmount: Number(r.fee_amount || 0),
      netAmount: Number(r.net_amount) > 0 ? Number(r.net_amount) : (Number(r.amount_crypto) - Number(r.fee_amount || 0)),
      walletAddress: r.wallet_address,
      status: r.status,
      txHash: r.tx_hash,
      createdAt: Number(r.created_at),
      processedAt: r.processed_at ? Number(r.processed_at) : null
    })));
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

app.post('/api/admin/withdrawals/status', isAdmin, async (req, res) => {
  const { requestId, status } = req.body;
  if (!requestId || !['completed', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Dados inválidos' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Buscar a solicitação
    const reqRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [requestId]);
    const withdrawReq = reqRes.rows[0];

    if (!withdrawReq) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Solicitação não encontrada' });
    }

    if (withdrawReq.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta solicitação já foi processada' });
    }

    // 2. Se rejeitado, estornar saldo
    if (status === 'rejected') {
      await client.query(`
        INSERT INTO coin_balances (user_id, coin_id, amount)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, coin_id)
        DO UPDATE SET amount = coin_balances.amount + EXCLUDED.amount
      `, [withdrawReq.user_id, withdrawReq.coin_id, withdrawReq.amount_crypto]);
    }

    // 3. Atualizar status
    await client.query('UPDATE withdrawal_requests SET status = $1, processed_at = $2, tx_hash = $3 WHERE id = $4', [status, Date.now(), req.body.txHash || null, requestId]);

    await client.query('COMMIT');
    res.json({ ok: true, message: `Solicitação ${status === 'completed' ? 'marcada como concluída' : 'rejeitada e estornada'}.` });

  } catch (e) {
    if (client) await client.query('ROLLBACK');
    console.error('[AdminWithdrawStatus] Error:', e);
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  } finally {
    if (client) client.release();
  }
});

// Depósitos pendentes: todos os processos (API só / cluster); o crédito continua idempotente com lock por tx.
setInterval(sweepPendingDepositsOnce, 90000);
setTimeout(sweepPendingDepositsOnce, 8000);

// Admin Ranking Endpoint
app.get('/api/admin/ranking', isAdmin, async (req, res) => {
  try {
    const coinsRes = await db.query('SELECT id, name, symbol FROM mining_coins');

    // Intelligent Retrieval: Local Memory (Background Worker) vs DB Cache (API Worker)
    let stats = getGlobalNetworkStats();
    if (!stats || !stats.ranking || stats.ranking.length === 0) {
      try {
        const cacheRes = await db.query("SELECT value FROM app_cache WHERE key = 'network_stats'");
        if (cacheRes.rows.length > 0) {
          stats = cacheRes.rows[0].value;
        }
      } catch (e) { console.warn('Cache read failed:', e.message); }
    }

    res.json({
      timestamp: Date.now(),
      ranking: stats && stats.ranking ? stats.ranking : [],
      coins: coinsRes.rows
    });
  } catch (e) {
    sendInternalErrorOrPrisma(res, req.originalUrl || 'api', e);
  }
});

const startServer = async () => {
  try {
    await initGenesisStackServices().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[GenesisStack] Redis/Mongo opcionais:', msg);
    });
    try {
      await connectPrisma();
      console.log('[Prisma] ligado ao Postgres ($connect).');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[Prisma] $connect falhou — confirme DATABASE_URL:', msg);
    }

    // Initialization tasks should only run on the Background worker (or ALL)
    if (WORKER_ROLE === 'BACKGROUND' || WORKER_ROLE === 'ALL') {
      await initDb();

      // Fix: Sync sequences to prevent PK violations (users_pkey)
      try {
        await db.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users)); `);
        console.log('[DB] Users sequence synchronized.');
      } catch (e) {
        console.warn('[DB] Failed to sync users sequence (might be first run):', e.message);
      }

      await ensureMiningCoinsTable()
      await ensureUpgrades();

      async function ensureWorkshopTimestampColumn() {
        try {
          const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='workshop_slots' AND column_name='installed_at'");
          if (res.rowCount === 0) {
            console.log("[Migration] Adding 'installed_at' column to workshop_slots...");
            await db.query("ALTER TABLE workshop_slots ADD COLUMN installed_at BIGINT DEFAULT 0");
          }
        } catch (e) {
          console.warn("[Migration] ensureWorkshopTimestampColumn failed:", e.message);
        }
      }
      await ensureWorkshopTimestampColumn(); // Add schema migration

      await ensureMiningCoins(); // Add data seeding
      await ensureTotalSoldColumn();
      await ensureUsdcDefault();
      await ensureUserLevels(); // Restore levels (Moved from top-level)
      await ensureStockItemIdsSane();
      await ensureStoredBatteriesIntegrity(db);

      async function ensureShowInExchangeColumn() {
        try {
          const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='mining_coins' AND column_name='show_in_exchange'");
          if (res.rowCount === 0) {
            console.log("[Migration] Adding 'show_in_exchange' column to mining_coins...");
            await db.query("ALTER TABLE mining_coins ADD COLUMN show_in_exchange SMALLINT DEFAULT 1");
          }
        } catch (e) {
          console.warn("[Migration] ensureShowInExchangeColumn failed:", e.message);
        }
      }
      await ensureShowInExchangeColumn();

      // await ensureMiningYieldHistory(); // DISABLED: Using new dynamic logic
      console.log('[DB] PostgreSQL initialized');
    }

    await ensureP2pMarketListingSchema();
    await ensureAdminSuperAdminSchema();
    await ensureSecurityThreatObserverSchema();
    await ensureSupportTicketSchema();
    await ensurePartnerYoutubeSchema();
  } catch (e) {
    console.error('[DB] Failed to initialize PostgreSQL:', e);
  }

  // Pedidos `/img/*` não servidos pelo static acima não devem cair no SPA (HTML 200 quebra <img> / fundos CSS).
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = req.path || '';
    if (p !== '/img' && !p.startsWith('/img/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text/plain').send('Not Found');
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  marketWss = wss;
  const wssAdminDash = new WebSocketServer({ noServer: true });
  adminDashboardWss = wssAdminDash;
  const wssPlayerGame = new WebSocketServer({ noServer: true });
  playerGameHeaderWss = wssPlayerGame;
  const ADMIN_DASH_WS_PUSH_MS = 4000;
  const PLAYER_GAME_WS_PUSH_MS = 3500;

  httpServer.on('upgrade', (req, socket, head) => {
    const pathOnly = (req.url || '').split('?')[0];
    if (pathOnly === '/ws/market') {
      try {
        const ipKey = getClientIp(req);
        const cur = marketWsConnectionsByIp.get(ipKey) || 0;
        if (cur >= marketWsMaxPerIp) {
          socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        marketWsConnectionsByIp.set(ipKey, cur + 1);
        try {
          wss.handleUpgrade(req, socket, head, (ws) => {
            ws.isAlive = true;
            ws.on('pong', () => { ws.isAlive = true; });
            ws.on('close', () => {
              const n = marketWsConnectionsByIp.get(ipKey) || 0;
              if (n <= 1) marketWsConnectionsByIp.delete(ipKey);
              else marketWsConnectionsByIp.set(ipKey, n - 1);
            });
            ws.send(JSON.stringify({ type: 'market', event: 'hello' }));
          });
        } catch {
          const n = marketWsConnectionsByIp.get(ipKey) || 0;
          if (n <= 1) marketWsConnectionsByIp.delete(ipKey);
          else marketWsConnectionsByIp.set(ipKey, n - 1);
          try { socket.destroy(); } catch (_) { /* ignore */ }
          return;
        }
      } catch (e) {
        try { socket.destroy(); } catch (_) { /* ignore */ }
      }
      return;
    }
    if (pathOnly === '/ws/admin-dashboard') {
      void (async () => {
        try {
          const uid = await resolveAdminUserIdFromWsUpgradeRequest(req);
          if (!uid) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          wssAdminDash.handleUpgrade(req, socket, head, (ws) => {
            ws.isAlive = true;
            ws.on('pong', () => { ws.isAlive = true; });
            const sendStats = async () => {
              if (ws.readyState !== 1) return;
              try {
                const data = await computeAdminDashboardStatsUncached();
                ws.send(JSON.stringify({ type: 'admin_dashboard', event: 'stats', data }));
              } catch (e) {
                console.warn('[AdminDashWs] push:', e.message);
              }
            };
            void sendStats();
            const tick = setInterval(sendStats, ADMIN_DASH_WS_PUSH_MS);
            ws.on('close', () => clearInterval(tick));
          });
        } catch (e) {
          try { socket.destroy(); } catch (_) { /* ignore */ }
        }
      })();
      return;
    }
    if (pathOnly === '/ws/player-game') {
      void (async () => {
        try {
          const uid = await resolveSessionUserIdFromWsUpgradeRequest(req);
          if (!uid) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          wssPlayerGame.handleUpgrade(req, socket, head, (ws) => {
            ws.isAlive = true;
            ws.on('pong', () => {
              ws.isAlive = true;
            });
            const push = async () => {
              if (ws.readyState !== 1) return;
              try {
                const data = await computePlayerGameHeaderSnapshot(uid);
                ws.send(JSON.stringify({ type: 'player_game', event: 'tick', data }));
              } catch (e) {
                console.warn('[PlayerGameWs] push:', e instanceof Error ? e.message : String(e));
              }
            };
            void push();
            const tick = setInterval(push, PLAYER_GAME_WS_PUSH_MS);
            ws.on('close', () => clearInterval(tick));
          });
        } catch (e) {
          try {
            socket.destroy();
          } catch (_) {
            /* ignore */
          }
        }
      })();
      return;
    }
    try { socket.destroy(); } catch (_) { /* ignore */ }
  });

  const wsPingMs = 45000;
  setInterval(() => {
    for (const w of [marketWss, adminDashboardWss, playerGameHeaderWss]) {
      if (!w) continue;
      for (const c of w.clients) {
        if (!c.isAlive) {
          try { c.terminate(); } catch (_) { /* ignore */ }
          continue;
        }
        c.isAlive = false;
        try { c.ping(); } catch (_) { /* ignore */ }
      }
    }
  }, wsPingMs);

  httpServer.listen(desiredPort, '0.0.0.0', () => {
    console.log(`Server running on port ${desiredPort} (HTTP + /ws/market + /ws/admin-dashboard + /ws/player-game)`);
    setInterval(async () => {
      try {
        const activeRes = await db.query('SELECT COUNT(DISTINCT user_id) as count FROM sessions WHERE expires_at > $1', [Date.now()]);
        const totalRes = await db.query('SELECT COUNT(*) as count FROM users');
        // console.log(`[Stats] Online: ${ activeRes.rows[0]?.count || 0 } | Total: ${ totalRes.rows[0]?.count || 0 } `);
      } catch (e) { /* ignore */ }
    }, 60000);
  });
};

if (cluster.isWorker) {
  process.on('message', (msg: unknown) => {
    const m = msg as { type?: string; payload?: unknown } | null;
    if (m && m.type === 'market_ws_broadcast' && m.payload) {
      marketWsBroadcastLocal(m.payload);
    }
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void disconnectPrisma()
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        process.exit(0);
      });
  });
}

startServer();
