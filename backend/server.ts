import './loadEnv.js';
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
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);





import db from './db.js';
import { startMiningYieldCron, computeProgressForUser, sanitizeApiMessage } from './dist/cron/miningScheduler.js';
import { miningRuntimeStats } from './dist/cron/miningRuntimeStats.js';
import { UI_DISPLAY_LABEL_KEY_SET } from './dist/config/uiDisplayLabelKeys.js';
import { initDb } from './db.pg.js';
import { sendResetEmail } from './dist/utils/mailer.js';
import {
  getJwtAuthConfig,
  createResolveAuthMiddleware,
  issueJwtAuthCookies,
  handleJwtRefresh,
  revokeJwtRefreshForUser,
  clearAuthCookies
} from './dist/src/auth/index.js';
import { registerDeviceFingerprintAdminRoutes } from './dist/controllers/deviceFingerprintAdminController.js';
import { registerP2pMarketRoutes } from './dist/controllers/p2pMarketController.js';
import {
  registerLootBoxPlayerRoutes,
  registerLootBoxAdminRoutes
} from './dist/controllers/lootBoxController.js';
import { registerRoletaPlayerRoutes } from './dist/controllers/roletaController.js';
import { registerPromoRedeemRoutes } from './dist/controllers/promoRedeemController.js';
import { runBulkRoomBattery, isValidRoomId } from './dist/lib/roomBatteryBulk.js';
import {
  loadUserStock,
  loadUserStoredBatteries,
  loadUserPlacedRacksWithSlots,
  loadUpgradesWithCompat,
  persistStockStoredBatteriesPlacedRacks
} from './dist/lib/serverRoomPersistence.js';
import * as backupModel from './dist/models/backupModel.js';
import { getPgRestoreSpawnOptions } from './dist/config/database.js';
import { getPgRestorePath } from './dist/config/pgRestore.js';
import { registerBackupRoutes, startScheduledSqlBackups } from './dist/controllers/backupController.js';
import { computePlayerGameHeaderSnapshot } from './dist/lib/playerGameHeaderSnapshot.js';
import {
  validateStockForSave,
  validateUnopenedBoxesForSave,
  validateDailyActionsForSave,
  validateStoredBatteriesForSave,
  validateWorkshopSlotsPayloadForSave
} from './dist/lib/saveGameEconomyValidate.js';

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

/** Painel admin — sub-aba "Textos da interface"; incluir em todas as listas de permissões (array). */
function ensureAdminSettingsLabelsInPermissions(permissions) {
  if (!Array.isArray(permissions)) return permissions;
  if (permissions.includes('settings:labels')) return permissions;
  return [...permissions, 'settings:labels'];
}

/** Resposta API: admins em formato array/objeto recebem sempre `settings:labels` (compat. front antigo + DB). */
function normalizeAdminPermissionsForApi(isAdmin, perms) {
  if (!isAdmin || perms == null) return perms;
  if (Array.isArray(perms)) return ensureAdminSettingsLabelsInPermissions(perms);
  if (typeof perms === 'object') return { ...perms, 'settings:labels': true };
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

// --- ADVANCED REFERRAL COMMISSION LOGIC ---
const processReferralCommission = async (client, userId, amount, type) => {
  try {
    // 1. Find the referrer
    const refRes = await client.query(`
      SELECT r.user_id as referrer_id, u.access_level_id
      FROM referrals r
      JOIN users u ON r.user_id = u.id
      WHERE r.referred_username = (SELECT username FROM users WHERE id = $1)
    `, [userId]);

    if (refRes.rowCount === 0) return;
    const { referrer_id, access_level_id } = refRes.rows[0];
    const alId = access_level_id || 'normal';

    // 2. Find the assigned model
    const modelRes = await client.query(`
      SELECT m.* 
      FROM referral_models m
      JOIN access_level_referral_models a ON m.id = a.referral_model_id
      WHERE a.access_level_id = $1 AND m.is_active = 1
    `, [alId]);

    const model = modelRes.rows[0];
    if (!model) return;

    let commissionPercent = 0;
    if (type === 'deposit') commissionPercent = model.deposit_commission_percent || 0;
    else if (type === 'hardware') commissionPercent = model.hardware_commission_percent || 0;
    else if (type === 'black_market') commissionPercent = model.black_market_commission_percent || 0;

    if (commissionPercent > 0) {
      const commissionAmount = (amount * commissionPercent) / 100;
      if (commissionAmount > 0) {
        console.log(`[ReferralCommission] Awarding ${commissionAmount} USDC to referrer ${referrer_id} (${type} commission ${commissionPercent}%)`);
        await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [commissionAmount, referrer_id]);
      }
    }
  } catch (err) {
    console.error('[ReferralCommission] Error processing commission:', err);
  }
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

const getClientIp = (req) => {
  const cf = req.headers['cf-connecting-ip'];
  if (cf && typeof cf === 'string') return cf.split(',')[0].trim();
  const tci = req.headers['true-client-ip'];
  if (tci && typeof tci === 'string') return tci.split(',')[0].trim();
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

const isIpFromUser = async (ip) => {
  try {
    const res = await db.query('SELECT 1 FROM user_history_ips WHERE ip = $1 LIMIT 1', [ip]);
    return res.rowCount > 0;
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
    const uRes = await db.query('SELECT is_admin FROM users WHERE id = $1', [uid]);
    return !!uRes.rows[0]?.is_admin;
  } catch (e) {
    console.error('[checkIsAdmin] Error:', e);
    return false;
  }
};

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
  ['https://test.genesisdao.tech'].forEach(add);
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
    `[CORS] URL pública (.env): ${primary} | origens permitidas: ${ALLOWED_CORS_ORIGINS.size} (FRONTEND_URL, PUBLIC_URL, SITE_URL, CORS_ALLOWED_ORIGINS, test.genesisdao.tech)`
  );
}

/** Eventos de jogo para auditoria no admin (não falha o fluxo principal). */
async function appendGameActivityLog(q, userId, action, meta) {
  if (!userId || !action) return;
  const safeAction = String(action).slice(0, 120);
  let metaJson = '{}';
  try {
    metaJson = JSON.stringify(meta == null ? {} : meta);
  } catch {
    metaJson = '{}';
  }
  const ts = Date.now();
  try {
    await q.query(
      `INSERT INTO game_activity_logs (user_id, action, meta, created_at) VALUES ($1, $2, $3::jsonb, $4)`,
      [userId, safeAction, metaJson, ts]
    );
  } catch (e) {
    console.warn('[GameActivityLog]', e.message);
  }
}

/** WebSocket: métricas do painel admin (KPIs; cookie de sessão). */
let adminDashboardWss: WebSocketServer | null = null;
/** WebSocket: cabeçalho do jogo (tokens, USDC, hashrate) para jogador com sessão válida. */
let playerGameHeaderWss: WebSocketServer | null = null;
/** WebSocket: atualizações do mercado P2P (clientes ligam em /ws/market). */
let marketWss: WebSocketServer | null = null;
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
    // Optimization: Skip logging for frequent polling endpoints to reduce I/O
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

  if (req.userId) {
    if (await checkIsAdmin(req.userId)) {
      const uRes = await db.query('SELECT admin_permissions FROM users WHERE id = $1', [req.userId]);
      req.adminPermissions = uRes.rows[0]?.admin_permissions ? JSON.parse(uRes.rows[0].admin_permissions) : null;
      return next();
    }
    await logAccess(`User ID ${req.userId} attempted admin access without permissions`);
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const sid = parseCookies(req).sid;
  if (!sid) {
    // Audit log for unauthorized admin access
    const fromUser = await isIpFromUser(ip);
    await logAccess(`No session cookie provided. IsKnownUser: ${fromUser}`);

    // SECURITY: Auto-ban logic for unknown crawlers could be added here, 
    // but per user rules, we preserve registered users.
    return res.status(401).json({ error: 'Não autenticado' });
  }

  try {
    const sRes = await db.query('SELECT user_id, expires_at FROM sessions WHERE session_id = $1', [sid]);
    const s = sRes.rows[0];
    if (!s) {
      console.warn(`[isAdmin] Blocked (IP: ${ip}): Session ${sid} not found in DB`);
      await logAccess(`Invalid session ID: ${sid}`);
      return res.status(401).json({ error: 'Sessão inválida' });
    }
    if (Number(s.expires_at) < Date.now()) {
      console.warn(`[isAdmin] Blocked (IP: ${ip}): Session ${sid} expired`);
      await logAccess(`Expired session: ${sid}`);
      return res.status(401).json({ error: 'Sessão expirada' });
    }

    const uRes = await db.query('SELECT is_admin, admin_permissions FROM users WHERE id = $1', [s.user_id]);
    const row = uRes.rows[0];
    if (!row || !row.is_admin) {
      console.warn(`[isAdmin] Blocked (IP: ${ip}): User ${s.user_id} is not admin`);
      await logAccess(`User ID ${s.user_id} is not an admin`);
      return res.status(403).json({ error: 'Acesso negado' });
    }

    req.userId = s.user_id;
    req.adminPermissions = row.admin_permissions ? JSON.parse(row.admin_permissions) : null;
    next();
  } catch (e) {
    console.error('[isAdmin] Internal Error:', e);
    res.status(500).json({ error: 'Erro interno' });
  }
};

/** Cookie `sid` + sessão válida + `is_admin` (upgrade WS /ws/admin-dashboard). */
async function resolveAdminUserIdFromWsUpgradeRequest(req) {
  try {
    const sid = parseCookies(req).sid;
    if (!sid) return null;
    const sRes = await db.query('SELECT user_id, expires_at FROM sessions WHERE session_id = $1', [sid]);
    const s = sRes.rows[0];
    if (!s || Number(s.expires_at) < Date.now()) return null;
    if (!(await checkIsAdmin(s.user_id))) return null;
    return s.user_id;
  } catch (e) {
    console.warn('[AdminDashWs] resolve session:', e.message);
    return null;
  }
}

/** Cookie `sid` + sessão válida (qualquer utilizador autenticado) para upgrade WS `/ws/player-game`. */
async function resolveSessionUserIdFromWsUpgradeRequest(req) {
  try {
    const sid = parseCookies(req).sid;
    if (!sid) return null;
    const sRes = await db.query('SELECT user_id, expires_at FROM sessions WHERE session_id = $1', [sid]);
    const s = sRes.rows[0];
    if (!s || Number(s.expires_at) < Date.now()) return null;
    const uid = Number(s.user_id);
    return Number.isFinite(uid) && uid > 0 ? uid : null;
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

// Configure Multer for ad uploads
const adStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, IMG_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'ad-' + uniqueSuffix + ext);
  }
});

const uploadAd = multer({
  storage: adStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Formato de arquivo não permitido'));
  }
});

const SUPPORT_UPLOAD_MAX = 12 * 1024 * 1024;
const SUPPORT_ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov']);
const supportStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, IMG_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uid = req.userId ? String(req.userId) : '0';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `support-${uid}-${uniqueSuffix}${ext}`);
  }
});
const uploadSupport = multer({
  storage: supportStorage,
  limits: { fileSize: SUPPORT_UPLOAD_MAX, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (SUPPORT_ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error('Tipo de ficheiro não permitido (imagens ou vídeo mp4/webm/mov).'));
  }
});
const supportReplyStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, IMG_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uid = req.userId ? String(req.userId) : '0';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `support-reply-${uid}-${uniqueSuffix}${ext}`);
  }
});
const uploadSupportReply = multer({
  storage: supportReplyStorage,
  limits: { fileSize: SUPPORT_UPLOAD_MAX, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (SUPPORT_ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error('Tipo de ficheiro não permitido (imagens ou vídeo mp4/webm/mov).'));
  }
});
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
      const xfHost = req.get('X-Forwarded-Host') || req.get('Host') || req.hostname;
      const hostOnly = String(xfHost).split(':')[0];
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
      "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.applixir.com"],
      "connect-src": ["'self'", "https://cdn.applixir.com", "https://*.googleapis.com", "https://api.etherscan.io"],
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
    const blRes = await db.query('SELECT 1 FROM ip_blacklist WHERE ip = $1', [ip]);
    if (blRes.rowCount > 0) {
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
    if (origin === 'http://149.56.81.30' || origin === 'https://149.56.81.30' || origin.includes('149.56.81.30')) return callback(null, true);
    console.error('CORS blocked origin:', origin);
    // [] = origem negada com resposta preflight válida (evita callback(Error) → next(err) sem cabeçalhos CORS).
    return callback(null, []);
  },
  credentials: true
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

app.use('/api/', limiter);
app.use('/api/login', authLimiter);



app.use(express.json({ limit: '5mb' })); // Reduzido o limite para 5MB por segurança
app.use(express.urlencoded({ limit: '5mb', extended: true }));

const jwtAllowLegacySession =
  process.env.JWT_ALLOW_LEGACY_SESSION !== '0' &&
  process.env.JWT_ALLOW_LEGACY_SID !== '0';
app.use(createResolveAuthMiddleware({ db, parseCookies, allowLegacySession: jwtAllowLegacySession }));

app.use((req, res, next) => {
  const url = req.url || '';
  if (/\/cgi-bin\b/i.test(url)) {
    return res.status(404).end();
  }
  next();
});

// Uploads primeiro (volume em produção); depois assets em img/ vindos da imagem Docker.
app.use('/img', express.static(IMG_UPLOADS_DIR));
app.use('/img', express.static(IMG_DIR));

// --- Moved utilities below ---

// Activity tracking (utilizador já resolvido por JWT ou sessão legacy)
app.use(async (req, res, next) => {
  if (!req.userId) return next();
  try {
    const now = Date.now();
    const ip = getClientIp(req);
    await db.query('UPDATE users SET last_active_at = $1 WHERE id = $2', [now, req.userId]);
    const sid = parseCookies(req).sid;
    if (sid) {
      const seenThrottle = now - 45000;
      await db.query(
        'UPDATE sessions SET last_seen_at = $1 WHERE session_id = $2 AND (last_seen_at < $3 OR last_seen_at = 0)',
        [now, sid, seenThrottle]
      );
    }
    await db.query(`
      INSERT INTO user_history_ips (user_id, ip, last_used_at) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (user_id, ip) DO UPDATE SET last_used_at = $3
    `, [req.userId, ip, now]);
  } catch (e) { /* ignore */ }
  next();
});

registerDeviceFingerprintAdminRoutes(app, { pool: db, isAdmin });
registerP2pMarketRoutes(app, { pool: db, emitMarketWs, processReferralCommission });
registerLootBoxPlayerRoutes(app, {
  pool: db,
  grantAdminUpgradeRewards,
  appendGameActivityLog
});
registerLootBoxAdminRoutes(app, { pool: db, isAdmin });
registerRoletaPlayerRoutes(app, {
  pool: db,
  authenticateToken,
  appendGameActivityLog
});
registerPromoRedeemRoutes(app, {
  pool: db,
  parseCookies,
  grantAdminUpgradeRewards,
  appendGameActivityLog
});
registerBackupRoutes(app, {
  isAdmin,
  pool: db,
  backupModel,
  getPgRestoreSpawnOptions,
  getPgRestorePath
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

// --- DYNAMIC NETWORK HASHRATE & RANKING ---
let globalNetworkStats = {
  hashrates: {},
  activeMiners: 0,
  activeMinersByCoin: {},
  ranking: []
};

startMiningYieldCron(db);


// --- CHARGING HISTORY ENDPOINTS ---

app.get('/api/charging-history', authenticateToken, async (req, res) => {
  try {
    const userRes = await db.query('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const email = userRes.rows[0].email;

    const historyRes = await db.query(
      'SELECT * FROM charging_history WHERE user_email = $1 ORDER BY timestamp DESC LIMIT 100',
      [email]
    );
    res.json(historyRes.rows);
  } catch (e) {
    console.error('[ChargingHistory] Error fetching:', e);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

app.post('/api/charging-history/log', authenticateToken, async (req, res) => {
  const { action, workshop_slot_index, component_slot_id, battery_instance_id, battery_item_id, charge_amount, stock_confirmed, details } = req.body;

  try {
    const userRes = await db.query('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const email = userRes.rows[0].email;

    await db.query(`
      INSERT INTO charging_history (
        user_email, action, workshop_slot_index, component_slot_id, 
        battery_instance_id, battery_item_id, charge_amount, stock_confirmed, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      email, action, workshop_slot_index, component_slot_id,
      battery_instance_id, battery_item_id, charge_amount, !!stock_confirmed, details || {}
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error('[ChargingHistory] Error logging:', e);
    res.status(500).json({ error: 'Erro ao registrar histórico' });
  }
});

// --- Moved middlewares below ---

app.get('/api/admin/wheel/config', isAdmin, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM wheel_prizes');
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/wheel/config', isAdmin, async (req, res) => {
  const items = req.body; // Array of items
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM wheel_prizes'); // Replace all
    for (const item of items) {
      await client.query(
        'INSERT INTO wheel_prizes (id, label, weight, color, item_id) VALUES ($1, $2, $3, $4, $5)',
        [item.id, item.label, item.weight, item.color, item.itemId]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/admin/wheel/players', isAdmin, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM wheel_players ORDER BY added_at DESC');
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/wheel/players', isAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  try {
    await db.query(
      'INSERT INTO wheel_players (username, added_at) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET added_at = $2',
      [username, Date.now()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- MINING RANKING (PUBLIC) ---
app.get('/api/ranking/public', authenticateToken, async (req, res) => {
  const client = await db.connect();
  try {
    const coinsRes = await client.query('SELECT id, name, symbol FROM mining_coins');
    const coinsMap = new Map();
    coinsRes.rows.forEach(c => coinsMap.set(c.id, c));

    const upgradesRes = await client.query('SELECT * FROM upgrades');
    const upgradesMap = new Map();
    upgradesRes.rows.forEach(u => upgradesMap.set(u.id, u));

    const racksRes = await client.query(`
      SELECT pr.*, u.username 
      FROM placed_racks pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.is_on = 1 
      AND pr.wiring_id IS NOT NULL 
      AND pr.battery_id IS NOT NULL
      AND u.is_blocked = 0
      AND u.ranking_excluded = 0
    `);

    const rankingData = new Map();

    for (const rack of racksRes.rows) {
      if (!rack.selected_coin_id) continue;

      const coinId = rack.selected_coin_id;
      if (!coinsMap.has(coinId)) continue;

      const battDef = upgradesMap.get(rack.battery_id);
      const isInfinite = battDef && battDef.power_capacity === -1;

      if (!isInfinite && rack.current_charge <= 0) continue;

      const slotsRes = await client.query('SELECT machine_item_id FROM rack_slots WHERE rack_id = $1', [rack.id]);
      let rackBaseProd = 0;
      slotsRes.rows.forEach(s => {
        if (s.machine_item_id) {
          const up = upgradesMap.get(s.machine_item_id);
          if (up && up.base_production) rackBaseProd += up.base_production;
        }
      });

      if (rackBaseProd === 0) continue;

      const multiRes = await client.query('SELECT multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = $1', [rack.id]);
      let multiplierFactor = 1;
      multiRes.rows.forEach(m => {
        if (m.multiplier_item_id) {
          const up = upgradesMap.get(m.multiplier_item_id);
          if (up && up.multiplier) multiplierFactor += up.multiplier;
        }
      });

      const totalPower = rackBaseProd * multiplierFactor;

      if (!rankingData.has(rack.user_id)) {
        rankingData.set(rack.user_id, {
          user_id: rack.user_id,
          username: rack.username,
          coins: {}
        });
      }

      const uData = rankingData.get(rack.user_id);
      if (!uData.coins[coinId]) uData.coins[coinId] = 0;
      uData.coins[coinId] += totalPower;
    }

    const rankingList = Array.from(rankingData.values());
    res.json({
      timestamp: Date.now(),
      ranking: rankingList,
      coins: Array.from(coinsMap.values())
    });

  } catch (e) {
    console.error('Public Ranking Error:', e);
    res.status(500).json({ error: 'Erro ao obter ranking.' });
  } finally {
    client.release();
  }
});

// --- MINING RANKING ---
app.get('/api/admin/ranking', isAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    // Buscar todas as configurações necessárias
    const coinsRes = await client.query('SELECT id, name, symbol FROM mining_coins');
    const coinsMap = new Map();
    coinsRes.rows.forEach(c => coinsMap.set(c.id, c));

    const upgradesRes = await client.query('SELECT * FROM upgrades');
    const upgradesMap = new Map();
    upgradesRes.rows.forEach(u => upgradesMap.set(u.id, u));

    // 1. Obter todos os usuários (que não estão bloqueados nem excluídos do ranking)
    const usersRes = await client.query('SELECT id, username FROM users WHERE is_blocked = 0 AND ranking_excluded = 0');
    const rankingData = new Map();
    usersRes.rows.forEach(u => {
      rankingData.set(u.id, {
        user_id: u.id,
        username: u.username,
        coins: {}, // Poder de mineração
        balances: {} // Saldo real
      });
    });

    // 2. Buscar racks ativos para calcular PODER de mineração
    const racksRes = await client.query(`
      SELECT pr.* FROM placed_racks pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.is_on = 1 
      AND pr.wiring_id IS NOT NULL 
      AND pr.battery_id IS NOT NULL
      AND u.is_blocked = 0
      AND u.ranking_excluded = 0
    `);

    for (const rack of racksRes.rows) {
      if (!rack.selected_coin_id || !coinsMap.has(rack.selected_coin_id)) continue;

      const battDef = upgradesMap.get(rack.battery_id);
      const isInfinite = battDef && battDef.power_capacity === -1;
      if (!isInfinite && rack.current_charge <= 0) continue;

      const slotsRes = await client.query('SELECT machine_item_id FROM rack_slots WHERE rack_id = $1', [rack.id]);
      let rackBaseProd = 0;
      slotsRes.rows.forEach(s => {
        if (s.machine_item_id) {
          const up = upgradesMap.get(s.machine_item_id);
          if (up && up.base_production) rackBaseProd += up.base_production;
        }
      });
      if (rackBaseProd === 0) continue;

      const multiRes = await client.query('SELECT multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = $1', [rack.id]);
      let multiplierFactor = 1;
      multiRes.rows.forEach(m => {
        if (m.multiplier_item_id) {
          const up = upgradesMap.get(m.multiplier_item_id);
          if (up && up.multiplier) multiplierFactor += up.multiplier;
        }
      });

      const totalRackPower = rackBaseProd * multiplierFactor;
      const userEntry = rankingData.get(rack.user_id);
      if (userEntry) {
        userEntry.coins[rack.selected_coin_id] = (userEntry.coins[rack.selected_coin_id] || 0) + totalRackPower;
      }
    }

    // 3. Buscar saldos de moedas mineráveis
    const coinIdsForBalances = Array.from(coinsMap.keys());
    if (coinIdsForBalances.length > 0) {
      const balancesRes = await client.query('SELECT user_id, coin_id, amount FROM coin_balances WHERE coin_id = ANY($1)', [coinIdsForBalances]);
      balancesRes.rows.forEach(b => {
        const userEntry = rankingData.get(b.user_id);
        if (userEntry) {
          userEntry.balances[b.coin_id] = b.amount;
        }
      });
    }

    // 4. Formatar e filtrar (remover quem não tem nada)
    const result = Array.from(rankingData.values()).filter(u => {
      const hasPower = Object.values(u.coins).some(v => Number(v) > 0);
      const hasBalance = Object.values(u.balances).some(v => Number(v) > 0);
      return hasPower || hasBalance;
    });

    res.json({
      timestamp: Date.now(),
      ranking: result,
      coins: Array.from(coinsMap.values())
    });
  } catch (e) {
    console.error('Admin Ranking Error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message || 'Erro interno no servidor' });
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
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
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
  const treasury = '0x3D9bDA32f0cbA0E84C332Fd0151D434A4840F38a';
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
    const result = await db.query(
      'UPDATE mining_coins SET network_hashrate = $1, block_reward = $2 WHERE id = $3 RETURNING *',
      [networkHashrate, blockReward, coinId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Coin not found' });

    res.json({ ok: true, coin: result.rows[0] });
  } catch (e) {
    console.error('Update Economy Error:', e);
    res.status(500).json({ error: e.message });
  }
});


app.delete('/api/admin/wheel/players/:username', isAdmin, async (req, res) => {
  const { username } = req.params;
  try {
    await db.query('DELETE FROM wheel_players WHERE username = $1', [username]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- WALLET LABELS ---
app.get('/api/wallet-labels', isAdmin, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM wallet_labels');
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/wallet-labels', isAdmin, async (req, res) => {
  const { address, label } = req.body;
  if (!address || !label) return res.status(400).json({ error: 'Missing fields' });
  try {
    await db.query(
      'INSERT INTO wallet_labels (address, label, updated_at) VALUES ($1, $2, $3) ON CONFLICT (address) DO UPDATE SET label = $2, updated_at = $3',
      [address, label, Date.now()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API UTILITIES
const generateReferralCode = (username) => {
  const base = (username || 'user')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 12) || 'user';
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const num = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `${base}-${rand}_${num}`;
};

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

const getUserIdByEmail = async (email, ip = null, opts: { allowAnyDomain?: boolean } = {}) => {
  const allowAnyDomain = !!opts.allowAnyDomain;
  if (!email) throw new Error('Email is required for getUserIdByEmail');
  const normalizedEmail = email.toLowerCase();
  const rowRes = await db.query('SELECT id, username, referral_code FROM users WHERE email = $1', [normalizedEmail]);
  const row = rowRes.rows[0];
  if (row) {
    if (!row.referral_code) {
      let code = generateReferralCode(row.username);
      let tries = 0;
      while (tries < 10) {
        const existsRes = await db.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
        if (existsRes.rowCount === 0) break;
        code = generateReferralCode(row.username);
        tries++;
      }
      await db.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, row.id]);
    }
    return row.id;
  }
  const username = email.split('@')[0];
  let code = generateReferralCode(username);
  let tries = 0;
  while (tries < 10) {
    const existsRes = await db.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
    if (existsRes.rowCount === 0) break;
    code = generateReferralCode(username);
    tries++;
  }
  try {
    if (!allowAnyDomain) {
      const policy = assertPublicSignupEmailAllowed(normalizedEmail);
      if (!policy.ok) {
        const err = new Error(policy.error) as Error & { code?: string };
        err.code = 'EMAIL_POLICY';
        throw err;
      }
    }
    if (ip) {
      const countRes = await db.query('SELECT COUNT(*) FROM users WHERE registration_ip = $1', [ip]);
      if (parseInt(countRes.rows[0].count) >= 3) {
        const existingRes = await db.query('SELECT username, email FROM users WHERE registration_ip = $1 LIMIT 3', [ip]);
        const accounts = existingRes.rows.map(u => `${u.username} (${u.email})`).join(', ');
        const err = new Error('Limite de 3 contas por IP atingido.') as Error & { existingAccounts?: unknown[] };
        err.existingAccounts = existingRes.rows; // Attach for the route handler
        throw err;
      }
    }
    const info = await db.query('INSERT INTO users (username, email, referral_code, is_admin, is_blocked, registration_ip) VALUES ($1, $2, $3, 0, 0, $4) RETURNING id', [username, normalizedEmail, code, ip]);
    const newUid = info.rows[0].id;
    const now = Date.now();

    // Log IP History immediately
    if (ip) {
      await db.query('INSERT INTO user_history_ips (user_id, ip, last_used_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [newUid, ip, now]);
    }

    // Grant Registration Box
    const regBoxes = await db.query("SELECT id FROM loot_boxes WHERE trigger = 'registration'");
    for (const box of regBoxes.rows) {
      await db.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1', [newUid, box.id]);
      await db.query('INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [newUid, box.id, now]);
    }

    // Initialize Game State
    try {
      await db.query(`
        INSERT INTO game_states (user_id, usdc, start_time, last_updated_at, claimed_referrals, referral_bonus_claimed, black_market_balance)
        VALUES ($1, 0, $2, $2, 0, 0, 0)
        ON CONFLICT (user_id) DO NOTHING
      `, [newUid, Date.now()]);
    } catch (gsErr) {
      console.error('Failed to create game state:', gsErr);
    }

    return newUid;
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      const retryRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (retryRes.rows[0]) return retryRes.rows[0].id;
    }
    throw err;
  }
};

// --- ADMIN UPGRADES (BUNDLES) ---

/**
 * Common logic to grant rewards from an AdminUpgrade package.
 * Works for both Shop Purchases and Promo Code redemptions.
 */
async function grantAdminUpgradeRewards(userId, upgradeId, client) {
  // Validate Upgrade
  const upRes = await client.query('SELECT * FROM admin_upgrades WHERE id = $1', [upgradeId]);
  if (upRes.rows.length === 0) throw new Error('Upgrade não encontrado');
  const upgrade = upRes.rows[0];

  // 1. Grant USDC (GameStates - HIGHEST LOCK PRIORITY)
  if (upgrade.grant_usdc > 0) {
    await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [upgrade.grant_usdc, userId]);
  }

  // 2. Grant Coins (CoinBalances - SECOND PRIORITY)
  const coins = await client.query('SELECT * FROM admin_upgrade_coins WHERE upgrade_id=$1', [upgrade.id]);
  for (const c of coins.rows) {
    await client.query(`INSERT INTO coin_balances (user_id, coin_id, amount) VALUES ($1,$2,$3) ON CONFLICT (user_id, coin_id) DO UPDATE SET amount = coin_balances.amount + $3`, [userId, c.coin_id, c.amount]);
  }

  // 3. Grant Items
  const items = await client.query('SELECT * FROM admin_upgrade_items WHERE upgrade_id=$1', [upgrade.id]);
  for (const it of items.rows) {
    await client.query(`INSERT INTO stock (user_id, item_id, qty) VALUES ($1,$2,$3) ON CONFLICT (user_id, item_id) DO UPDATE SET qty = stock.qty + $3`, [userId, it.item_id, it.qty]);
  }

  // 4. Grant Boxes
  const boxes = await client.query('SELECT * FROM admin_upgrade_boxes WHERE upgrade_id=$1', [upgrade.id]);
  for (const b of boxes.rows) {
    await client.query(`INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1,$2,$3) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + $3`, [userId, b.box_id, b.qty]);
  }

  // 5. Grant Passes
  const passes = await client.query('SELECT * FROM admin_upgrade_passes WHERE upgrade_id=$1', [upgrade.id]);
  for (const p of passes.rows) {
    const seasonRes = await client.query('SELECT season_id FROM season_passes WHERE id=$1', [p.pass_id]);
    if (seasonRes.rows.length > 0) {
      const seasonId = seasonRes.rows[0].season_id;
      await client.query(`INSERT INTO season_purchases (user_id, pass_id, season_id, purchased_at) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, pass_id) DO NOTHING`, [userId, p.pass_id, seasonId, Date.now()]);

      // Grant Season/Pass Rewards
      await grantPassRewards(userId, p.pass_id, seasonId, client);
    }
  }

  // 6. Grant Access Level
  if (upgrade.grant_access_level_id) {
    await client.query('UPDATE users SET access_level_id = $1 WHERE id = $2', [upgrade.grant_access_level_id, userId]);
    await client.query('INSERT INTO user_access_levels (user_id, access_level_id, granted_at) VALUES ($1,$2,$3) ON CONFLICT (user_id, access_level_id) DO NOTHING', [userId, upgrade.grant_access_level_id, Date.now()]);
  }

  // 7. Grant Loot Box Reward (Trigger based)
  const boxRewards = await client.query('SELECT id FROM loot_boxes WHERE trigger = $1', [upgradeId]);
  for (const box of boxRewards.rows) {
    await client.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1', [userId, box.id]);
  }

  // 8. Special Case: Genesis Bundle Rig Room
  // ID do Pacote Genesis: 53f0c699-0471-4e65-a147-17064e3aafe0
  // ID da Sala Genesis: room_1765936323521
  if (upgradeId === '53f0c699-0471-4e65-a147-17064e3aafe0') {
    await client.query(`
      INSERT INTO user_rig_rooms (user_id, room_id, purchased_at, unlocked_slots)
      VALUES ($1, $2, $3, 0)
      ON CONFLICT (user_id, room_id) DO NOTHING
    `, [userId, 'room_1765936323521', Date.now()]);
  }

  return upgrade;
}

/**
 * Grants item/currency rewards directly associated with a Season Pass.
 * Now supports direct items and currencies via season_pass_rewards table.
 * Maintains legacy support for trigger-based loot boxes.
 */
async function grantPassRewards(userId, passId, seasonId, client) {
  console.log(`[SeasonReward] ===== STARTING REWARD GRANT =====`);
  console.log(`[SeasonReward] User ID: ${userId}, Pass ID: ${passId}, Season ID: ${seasonId}`);

  try {
    // 1. Grant Direct Rewards (Items/Currency)
    console.log(`[SeasonReward] Querying rewards for pass ${passId}...`);
    const rewardsRes = await client.query('SELECT * FROM season_pass_rewards WHERE pass_id = $1', [passId]);
    console.log(`[SeasonReward] Found ${rewardsRes.rows.length} direct rewards`);

    if (rewardsRes.rows.length === 0) {
      console.log(`[SeasonReward] WARNING: No direct rewards configured for pass ${passId}`);
    }

    // Sort rewards to enforce locking order: USDC -> Coins -> Items
    const usdcRewards = rewardsRes.rows.filter(r => r.type === 'currency' && r.coin_id === 'usdc');
    const coinRewards = rewardsRes.rows.filter(r => r.type === 'currency' && r.coin_id !== 'usdc');
    const itemRewards = rewardsRes.rows.filter(r => r.type === 'item');

    // 1. Grant USDC (GameStates - HIGHEST PRIORITY)
    for (const reward of usdcRewards) {
      console.log(`[SeasonReward] Granting USDC ${reward.qty} to user ${userId}`);
      await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [reward.qty, userId]);
    }

    // 2. Grant Coins (CoinBalances - SECOND PRIORITY)
    for (const reward of coinRewards) {
      console.log(`[SeasonReward] Granting COIN ${reward.coin_id} (qty: ${reward.qty}) to user ${userId}`);
      await client.query(
        `INSERT INTO coin_balances (user_id, coin_id, amount) VALUES ($1, $2, $3) 
               ON CONFLICT (user_id, coin_id) DO UPDATE SET amount = coin_balances.amount + $3`,
        [userId, reward.coin_id, reward.qty]
      );
    }

    // 3. Grant Items (Stock - LOWEST PRIORITY)
    for (const reward of itemRewards) {
      console.log(`[SeasonReward] Granting ITEM ${reward.item_id} (qty: ${reward.qty}) to user ${userId}`);
      try {
        await client.query(
          `INSERT INTO stock (user_id, item_id, qty) VALUES ($1, $2, $3) 
               ON CONFLICT (user_id, item_id) DO UPDATE SET qty = stock.qty + $3`,
          [userId, reward.item_id, reward.qty]
        );
        console.log(`[SeasonReward] ✅ Successfully granted ${reward.qty}x ${reward.item_id}`);
      } catch (itemErr) {
        console.error(`[SeasonReward] ❌ FAILED to grant item ${reward.item_id}:`, itemErr.message);
        throw itemErr; // Propagate error to rollback transaction
      }
    }

    console.log(`[SeasonReward] ===== REWARD GRANT COMPLETE =====`);

    // 2. Legacy Support: Grant Loot Boxes based on Trigger
    console.log(`[SeasonReward] Checking for legacy loot boxes...`);
    const boxRewards = await client.query(
      'SELECT id FROM loot_boxes WHERE LOWER(trigger) = LOWER($1) OR LOWER(trigger) = LOWER($2)',
      [passId.trim(), 'season:' + seasonId.trim()]
    );
    console.log(`[SeasonReward] Found ${boxRewards.rows.length} legacy boxes`);

    for (const box of boxRewards.rows) {
      console.log(`[SeasonReward] Granting Legacy BOX ${box.id} to user ${userId} for pass ${passId}/season ${seasonId}`);
      await client.query(
        'INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1',
        [userId, box.id]
      );
    }

    console.log(`[SeasonReward] ===== REWARD GRANT COMPLETED =====`);
  } catch (err) {
    console.error('[SeasonReward] ❌❌❌ CRITICAL ERROR granting rewards:', err);
    console.error('[SeasonReward] Error details:', err.message);
    console.error('[SeasonReward] Stack:', err.stack);
    throw err; // IMPORTANT: Propagate error to rollback the entire transaction
  }
}

app.get('/api/admin-upgrades', async (req, res) => {
  try {
    let isAdminUser = false;
    let userRoomIds = [];
    if (req.userId) {
      const uRes = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
      if (uRes.rows[0]?.is_admin) isAdminUser = true;

      const userRooms = await db.query('SELECT room_id FROM user_rig_rooms WHERE user_id = $1', [req.userId]);
      userRoomIds = userRooms.rows.map(r => r.room_id);
    }

    const query = isAdminUser ? 'SELECT * FROM admin_upgrades ORDER BY created_at DESC' : 'SELECT * FROM admin_upgrades WHERE is_active = 1 ORDER BY created_at DESC';
    const upsRes = await db.query(query);
    const itemsRes = await db.query('SELECT * FROM admin_upgrade_items');
    const boxesRes = await db.query('SELECT * FROM admin_upgrade_boxes');
    const passesRes = await db.query('SELECT * FROM admin_upgrade_passes');
    const coinsRes = await db.query('SELECT * FROM admin_upgrade_coins');
    const visibilityRes = await db.query('SELECT * FROM admin_upgrade_visibility');

    const itemsMap = itemsRes.rows.reduce((acc, r) => { (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push({ itemId: r.item_id, qty: r.qty }); return acc; }, {});
    const boxesMap = boxesRes.rows.reduce((acc, r) => { (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push({ boxId: r.box_id, qty: r.qty }); return acc; }, {});
    const passesMap = passesRes.rows.reduce((acc, r) => { (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push(r.pass_id); return acc; }, {});
    const coinsMap = coinsRes.rows.reduce((acc, r) => { (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push({ coinId: r.coin_id, amount: r.amount }); return acc; }, {});
    const visibilityMap = visibilityRes.rows.reduce((acc, r) => { (acc[r.upgrade_id] = acc[r.upgrade_id] || []).push(r.access_level_id); return acc; }, {});

    const list = upsRes.rows.map(u => ({
      id: u.id,
      name: u.name,
      description: u.description,
      priceUsdc: u.price_usdc,
      grantUsdc: u.grant_usdc,
      grantAccessLevelId: u.grant_access_level_id,
      isActive: !!u.is_active,
      items: itemsMap[u.id] || [],
      boxes: boxesMap[u.id] || [],
      passes: passesMap[u.id] || [],
      coins: coinsMap[u.id] || [],
      visibleToAccessLevelIds: visibilityMap[u.id] || [],
      alreadyOwned: (u.id === '53f0c699-0471-4e65-a147-17064e3aafe0' && userRoomIds.includes('room_1765936323521'))
    }));
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.delete('/api/admin-upgrades/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Check for existing purchases
    const check = await client.query('SELECT 1 FROM admin_upgrade_purchases WHERE upgrade_id = $1 LIMIT 1', [id]);
    if (check.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).send('Este upgrade já foi comprado por usuários e não pode ser excluído.');
    }

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
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.post('/api/admin-upgrades/purchase', async (req, res) => {
  const { upgradeId } = req.body;
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (!upgradeId) return res.status(400).json({ error: 'Missing fields' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Validate User & Balance
    const uRes = await client.query('SELECT u.id, gs.usdc, u.access_level_id FROM users u JOIN game_states gs ON gs.user_id = u.id WHERE u.id = $1', [req.userId]);
    if (uRes.rows.length === 0) throw new Error('Usuário não encontrado');
    const user = uRes.rows[0];

    // Validate Upgrade
    const upRes = await client.query('SELECT * FROM admin_upgrades WHERE id = $1', [upgradeId]);
    if (upRes.rows.length === 0) throw new Error('Upgrade não encontrado');
    const upgrade = upRes.rows[0];

    if (!upgrade.is_active) throw new Error('Upgrade inativo/expirado');

    // Check duplicate
    const check = await client.query('SELECT 1 FROM admin_upgrade_purchases WHERE user_id = $1 AND upgrade_id = $2', [user.id, upgrade.id]);
    if (check.rows.length > 0) throw new Error('Você já possui este upgrade');

    // Check if user already has this access level (e.g. Founder)
    if (upgrade.grant_access_level_id && user.access_level_id === upgrade.grant_access_level_id) {
      throw new Error(`Você já possui o nível de acesso ${upgrade.grant_access_level_id}`);
    }

    // Special check for Genesis Bundle vs Sala Gênesis
    if (upgradeId === '53f0c699-0471-4e65-a147-17064e3aafe0') {
      const roomCheck = await client.query('SELECT 1 FROM user_rig_rooms WHERE user_id = $1 AND room_id = $2', [user.id, 'room_1765936323521']);
      if (roomCheck.rows.length > 0) {
        throw new Error('Você já possui a Sala Gênesis deste pacote.');
      }
    }

    // Check Balance
    if (user.usdc < upgrade.price_usdc) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Saldo insuficiente', missing: upgrade.price_usdc - user.usdc });
    }

    // Deduct
    await client.query('UPDATE game_states SET usdc = usdc - $1 WHERE user_id = $2', [upgrade.price_usdc, user.id]);

    // Record Purchase
    await client.query('INSERT INTO admin_upgrade_purchases (user_id, upgrade_id, purchased_at) VALUES ($1,$2,$3)', [user.id, upgrade.id, Date.now()]);

    // Grant all rewards using the helper
    await grantAdminUpgradeRewards(user.id, upgrade.id, client);

    // Get final balance
    const final = await client.query('SELECT usdc FROM game_states WHERE user_id = $1', [user.id]);

    await client.query('COMMIT');
    res.json({ ok: true, newUsdc: final.rows[0].usdc });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Purchase error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally { client.release(); }
});

/** Caminhos de imagem relativos sem `/` inicial quebram no SPA; normaliza na API. */
function normalizePublicAssetUrl(u) {
  if (u == null || typeof u !== 'string') return u;
  const s = u.trim();
  if (!s) return undefined;
  if (/^data:/i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return s;
  if (s.startsWith('/')) return s;
  if (/[.](png|jpe?g|gif|webp|ico|svg)(\?|$)/i.test(s) || /^img\//i.test(s)) {
    return `/${s.replace(/^\/+/, '')}`;
  }
  return s;
}

// --- UPGRADES ---
app.get('/api/upgrades', async (req, res) => {
  try {
    let isAdminUser = false;
    if (req.userId) {
      const uRes = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
      if (uRes.rows[0]?.is_admin) isAdminUser = true;
    }

    const query = isAdminUser ? 'SELECT * FROM upgrades' : 'SELECT * FROM upgrades WHERE is_active = 1';
    const rowsRes = await db.query(query);
    const rows = rowsRes.rows;
    const compatRowsRes = await db.query('SELECT * FROM upgrade_compat_racks');
    const compatRows = compatRowsRes.rows;

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
      totalSold: r.total_sold ?? 0,
      image: normalizePublicAssetUrl(r.image) ?? undefined,
      layout: r.layout ? (() => { try { return JSON.parse(r.layout); } catch { return undefined; } })() : undefined,
      compatibleRacks: compatMap[r.id] || [],
      rewardWh: r.reward_wh ?? 0,
      sellInHardwareMarket: r.sell_in_hardware_market !== 0,
      sellInBlackMarket: r.sell_in_black_market !== 0,
      isActive: r.is_active !== 0
    }));
    res.json(upgrades);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
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
    res.status(500).json({ error: e.message || 'Erro interno ao salvar upgrades.' });
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

  const client = await db.connect();
  try {
    const uid = req.userId;

    const hwDis = await client.query("SELECT value FROM settings WHERE key = 'hardware_market_enabled'");
    if (hwDis.rows[0] && hwDis.rows[0].value !== '1') {
      return res.status(403).json({ error: 'Mercado de hardware pausado.' });
    }

    const upgradeIds = Object.keys(cart);
    const upgradesRes = await client.query(
      `SELECT id, base_cost, name, sell_in_hardware_market, status, max_global_stock, total_sold,
              COALESCE(is_active, 1) AS ia
       FROM upgrades WHERE id = ANY($1::text[])`,
      [upgradeIds]
    );
    if (upgradesRes.rows.length !== upgradeIds.length) {
      return res.status(400).json({ error: 'Um ou mais itens do carrinho não existem.' });
    }

    let totalCost = 0;
    const itemsToBuy = [];
    const limitedItemsToUpdate = [];

    for (const [id, rawQty] of Object.entries(cart)) {
      const qty = Number(rawQty);
      const u = upgradesRes.rows.find(x => x.id === id);
      if (!u) return res.status(400).json({ error: `Item inválido: ${id}` });
      if (Number(u.ia) === 0) {
        return res.status(400).json({ error: `Item indisponível: ${u.name}` });
      }
      if (u.sell_in_hardware_market === 0) {
        return res.status(400).json({ error: `Item não disponível para venda: ${u.name}` });
      }

      if (u.status === 'limited') {
        const available = (Number(u.max_global_stock) || 0) - (Number(u.total_sold) || 0);
        if (available < qty) {
          return res.status(400).json({ error: `Estoque insuficiente para ${u.name}. Restam ${available}.` });
        }
        limitedItemsToUpdate.push({ id: u.id, qty });
      }

      const unit = Number(u.base_cost);
      if (!Number.isFinite(unit) || unit < 0 || unit > 1e12) {
        return res.status(400).json({ error: 'Preço de item inválido.' });
      }
      const cost = unit * qty;
      if (!Number.isFinite(cost) || cost < 0 || cost > 1e15) {
        return res.status(400).json({ error: 'Valor de compra inválido.' });
      }
      totalCost += cost;
      itemsToBuy.push({ id, qty, name: u.name });
    }

    await client.query('BEGIN');

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
        throw new Error(`Falha de concorrência: estoque esgotado para o item ${lim.id}.`);
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
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('[BuyUpgrades] Error:', e);
    res.status(500).json({ error: e.message || 'Erro ao processar compra' });
  } finally {
    client.release();
  }
});

app.post('/api/upload-image', (req, res) => {
  const { dataUrl, originalName } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'Missing dataUrl' });
  }
  const match = dataUrl.match(/^data:(image\/png|image\/gif|image\/jpeg);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Only PNG/GIF/JPEG data URLs are allowed' });
  }
  const mime = match[1];
  const b64 = match[2];
  const ext = mime === 'image/png' ? '.png' : (mime === 'image/gif' ? '.gif' : '.jpg');
  const safeBase = (originalName || 'image').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'image';
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeBase}${ext}`;
  const filePath = path.join(IMG_UPLOADS_DIR, filename);
  try {
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
  } catch (e) {
    return res.status(500).json({ error: 'Failed to write file' });
  }
  return res.json({ path: `/img/${filename}` });
});

async function fetchMonetizationSettingsObject() {
  const applixirEnabledRes = await db.query("SELECT value FROM settings WHERE key = 'applixir_enabled'");
  const applixirSiteIdRes = await db.query("SELECT value FROM settings WHERE key = 'applixir_site_id'");
  const applixirZoneIdRes = await db.query("SELECT value FROM settings WHERE key = 'applixir_zone_id'");
  const applixirAccountIdRes = await db.query("SELECT value FROM settings WHERE key = 'applixir_account_id'");
  const applixirRewardMsgRes = await db.query("SELECT value FROM settings WHERE key = 'applixir_reward_message'");
  const applixirCallbackSecretRes = await db.query("SELECT value FROM settings WHERE key = 'applixir_callback_secret'");
  const ezoicEnabledRes = await db.query("SELECT value FROM settings WHERE key = 'ezoic_enabled'");
  const ezoicPubIdRes = await db.query("SELECT value FROM settings WHERE key = 'ezoic_publisher_id'");
  const ezoicAppIdRes = await db.query("SELECT value FROM settings WHERE key = 'ezoic_app_id'");
  const ezoicPlaceholderIdRes = await db.query("SELECT value FROM settings WHERE key = 'ezoic_placeholder_id'");
  return {
    applixirEnabled: (applixirEnabledRes.rows[0]?.value === '1'),
    applixirSiteId: applixirSiteIdRes.rows[0]?.value || '',
    applixirZoneId: applixirZoneIdRes.rows[0]?.value || '',
    applixirAccountId: applixirAccountIdRes.rows[0]?.value || '',
    applixirRewardMessage: applixirRewardMsgRes.rows[0]?.value || 'Parabéns! Você ganhou {reward} W/h',
    applixirCallbackSecret: applixirCallbackSecretRes.rows[0]?.value || '',
    ezoicEnabled: (ezoicEnabledRes.rows[0]?.value === '1'),
    ezoicPublisherId: ezoicPubIdRes.rows[0]?.value || '',
    ezoicAppId: ezoicAppIdRes.rows[0]?.value || '',
    ezoicPlaceholderId: ezoicPlaceholderIdRes.rows[0]?.value || ''
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
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/monetization-settings', isAdmin, async (req, res) => {
  try {
    const settings = await fetchMonetizationSettingsObject();
    res.setHeader('Cache-Control', 'no-store');
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/monetization-settings', isAdmin, async (req, res) => {
  const {
    applixirEnabled, applixirSiteId, applixirZoneId, applixirAccountId, applixirRewardMessage, applixirCallbackSecret,
    ezoicEnabled, ezoicPublisherId, ezoicAppId, ezoicPlaceholderId
  } = req.body || {};

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const stmt = 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
    await client.query(stmt, ['applixir_enabled', applixirEnabled ? '1' : '0']);
    await client.query(stmt, ['applixir_site_id', String(applixirSiteId || '')]);
    await client.query(stmt, ['applixir_zone_id', String(applixirZoneId || '')]);
    await client.query(stmt, ['applixir_account_id', String(applixirAccountId || '')]);
    await client.query(stmt, ['applixir_reward_message', typeof applixirRewardMessage === 'string' ? applixirRewardMessage : 'Parabéns! Você ganhou {reward} W/h']);
    await client.query(stmt, ['applixir_callback_secret', typeof applixirCallbackSecret === 'string' ? applixirCallbackSecret : '']);

    await client.query(stmt, ['ezoic_enabled', ezoicEnabled ? '1' : '0']);
    await client.query(stmt, ['ezoic_publisher_id', String(ezoicPublisherId || '')]);
    await client.query(stmt, ['ezoic_app_id', String(ezoicAppId || '')]);
    await client.query(stmt, ['ezoic_placeholder_id', String(ezoicPlaceholderId || '')]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});


// Applixir S2S Callback
app.get('/api/applixir-callback', async (req, res) => {
  const { userId, secretKey } = req.query;
  try {
    const dbSecretRes = await db.query("SELECT value FROM settings WHERE key = 'applixir_callback_secret'");
    const dbSecret = dbSecretRes.rows[0]?.value || '';

    if (secretKey !== dbSecret) return res.status(403).send('Invalid Secret');
    if (!userId) return res.status(400).send('Missing userId');

    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!userRes.rows[0]) return res.status(404).send('User not found');

    const wsIdx = Number(req.query.custom);
    if (Number.isInteger(wsIdx) && wsIdx >= 0 && wsIdx <= 5) {
      const rowRes = await db.query('SELECT item_id FROM workshop_slots WHERE user_id = $1 AND slot_index = $2', [userId, wsIdx]);
      const row = rowRes.rows[0];
      if (row && row.item_id) {
        const nowCb = new Date();
        const startOfDay = new Date(Date.UTC(nowCb.getUTCFullYear(), nowCb.getUTCMonth(), nowCb.getUTCDate())).getTime();
        const actionKey = `reward_ad_slot_${wsIdx}`;
        const actionRes = await db.query('SELECT last_performed_at FROM daily_actions WHERE user_id = $1 AND action_key = $2', [userId, actionKey]);
        const lastPerformed = actionRes.rows[0]?.last_performed_at;
        if (!lastPerformed || Number(lastPerformed) < startOfDay) {
          const upgRes = await db.query('SELECT power_capacity FROM upgrades WHERE id = $1', [row.item_id]);
          const maxCap = upgRes.rows[0]?.power_capacity || 1000;

          await db.query('UPDATE workshop_slots SET current_charge = $1 WHERE user_id = $2 AND slot_index = $3', [maxCap, userId, wsIdx]);
          await db.query(
            'INSERT INTO daily_actions (user_id, action_key, last_performed_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, action_key) DO UPDATE SET last_performed_at = EXCLUDED.last_performed_at',
            [userId, actionKey, Date.now()]
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
    res.status(500).json({ error: e.message });
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

    const msgRes = await client.query("SELECT value FROM settings WHERE key = 'applixir_reward_message'");
    const rewardMsg = msgRes.rows[0]?.value || 'Parabéns! Sua estação foi totalmente carregada.';

    res.json({ ok: true, newCharge: maxCap, rewardMsg });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
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
  const web3Res = await db.query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
  return web3Res.rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
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
    res.status(500).json({ error: 'Erro ao validar transação: ' + e.message });
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
    const resArr = await db.query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
    const settings = resArr.rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});

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
    res.status(500).json({ error: e.message });
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
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const stmt = 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
    await client.query(stmt, ['web3_deposit_wallet', typeof depositWallet === 'string' ? depositWallet : '']);
    await client.query(stmt, ['web3_payout_wallet', typeof payoutWallet === 'string' ? payoutWallet : '']);
    await client.query(stmt, ['web3_deposit_token_contract', typeof depositTokenContract === 'string' ? depositTokenContract : '']);
    await client.query(stmt, ['web3_deposit_token_contract_bnb', typeof depositTokenContractBnb === 'string' ? depositTokenContractBnb : '']);
    await client.query(stmt, ['web3_deposit_token_contract_base', typeof depositTokenContractBase === 'string' ? depositTokenContractBase : '']);
    await client.query(stmt, ['web3_min_deposit_usdc', typeof minDepositUsdc === 'number' ? String(minDepositUsdc) : '']);
    await client.query(stmt, ['web3_withdraw_token_name', typeof withdrawTokenName === 'string' ? withdrawTokenName : '']);
    await client.query(stmt, ['web3_withdraw_token_contract', typeof withdrawTokenContract === 'string' ? withdrawTokenContract : '']);
    await client.query(stmt, ['web3_withdraw_tokens', Array.isArray(withdrawTokens) ? JSON.stringify(withdrawTokens) : '[]']);
    const to01 = (v) => {
      if (v === true || v === 1 || v === '1') return '1';
      if (v === false || v === 0 || v === '0' || v == null || v === '') return '0';
      if (typeof v === 'string' && v.toLowerCase() === 'true') return '1';
      if (typeof v === 'string' && v.toLowerCase() === 'false') return '0';
      return v ? '1' : '0';
    };
    // Só gravar flags se vierem no JSON; caso contrário JSON.stringify no cliente omite undefined e apagaria o bloqueio.
    if (Object.prototype.hasOwnProperty.call(body, 'depositPolygonDisabled')) {
      await client.query(stmt, ['web3_deposit_polygon_disabled', to01(depositPolygonDisabled)]);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'depositBnbDisabled')) {
      await client.query(stmt, ['web3_deposit_bnb_disabled', to01(depositBnbDisabled)]);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'depositBaseDisabled')) {
      await client.query(stmt, ['web3_deposit_base_disabled', to01(depositBaseDisabled)]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
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
    const hwRes = await db.query("SELECT value FROM settings WHERE key = 'hardware_market_enabled'");
    const bkRes = await db.query("SELECT value FROM settings WHERE key = 'black_market_enabled'");
    const hw = row ? Number(row.hardware_market_enabled) !== 0 : (hwRes.rows[0] ? hwRes.rows[0].value === '1' : true);
    const bk = row ? Number(row.black_market_enabled) !== 0 : (bkRes.rows[0] ? bkRes.rows[0].value === '1' : true);

    let tax = NaN;
    if (row && row.market_tax_percent != null && row.market_tax_percent !== '') {
      tax = Number(row.market_tax_percent);
    }
    if (!Number.isFinite(tax)) {
      const taxRes = await db.query("SELECT value FROM settings WHERE key = 'market_tax_percent'");
      tax = taxRes.rows[0] ? Number(taxRes.rows[0].value) : 0;
    }
    if (!Number.isFinite(tax)) tax = 0;
    tax = Math.min(100, Math.max(0, tax));

    let band = 20;
    if (row && row.black_market_price_band_percent != null && row.black_market_price_band_percent !== '') {
      const b = Number(row.black_market_price_band_percent);
      if (Number.isFinite(b)) band = Math.min(200, Math.max(0, b));
    } else {
      const bandRes = await db.query("SELECT value FROM settings WHERE key = 'black_market_price_band_percent'");
      if (bandRes.rows[0]) {
        const b = Number(bandRes.rows[0].value);
        if (Number.isFinite(b)) band = Math.min(200, Math.max(0, b));
      }
    }

    res.json({
      hardwareMarketEnabled: hw,
      blackMarketEnabled: bk,
      marketTaxPercent: tax,
      blackMarketPriceBandPercent: band
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/economy-settings', isAdmin, async (req, res) => {
  const { hardwareMarketEnabled, blackMarketEnabled, marketTaxPercent, blackMarketPriceBandPercent } = req.body || {};
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const stmt = 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
    await client.query(stmt, ['hardware_market_enabled', hardwareMarketEnabled ? '1' : '0']);
    await client.query(stmt, ['black_market_enabled', blackMarketEnabled ? '1' : '0']);
    const tax = Math.min(100, Math.max(0, Number(marketTaxPercent) || 0));
    await client.query(stmt, ['market_tax_percent', String(tax)]);
    let band = Number(blackMarketPriceBandPercent);
    if (!Number.isFinite(band)) {
      const prev = await client.query(
        'SELECT black_market_price_band_percent FROM economy_settings WHERE id = 1'
      );
      const prevRow = prev.rows[0];
      const prevBand = prevRow && prevRow.black_market_price_band_percent != null
        ? Number(prevRow.black_market_price_band_percent)
        : NaN;
      band = Number.isFinite(prevBand) ? prevBand : 20;
    }
    if (!Number.isFinite(band)) band = 20;
    band = Math.min(200, Math.max(0, band));
    await client.query(stmt, ['black_market_price_band_percent', String(band)]);
    await client.query(`
      INSERT INTO economy_settings (id, black_market_enabled, hardware_market_enabled, market_tax_percent, black_market_price_band_percent)
      VALUES (1, $1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        black_market_enabled = EXCLUDED.black_market_enabled,
        hardware_market_enabled = EXCLUDED.hardware_market_enabled,
        market_tax_percent = EXCLUDED.market_tax_percent,
        black_market_price_band_percent = EXCLUDED.black_market_price_band_percent`,
      [blackMarketEnabled ? 1 : 0, hardwareMarketEnabled ? 1 : 0, tax, band]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/nfts', async (req, res) => {
  const contract = req.query.contract;
  const owner = req.query.owner;
  try {
    const contractsRes = await db.query("SELECT value FROM settings WHERE key = 'web3_nft_contracts'");
    let allowed = [];
    try { allowed = contractsRes.rows[0]?.value ? JSON.parse(contractsRes.rows[0].value) : []; } catch { allowed = []; }
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
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/nfts/receive', isAdmin, async (req, res) => {
  const { contract, tokenId, toAddress } = req.body || {};
  try {
    const contractsRowRes = await db.query("SELECT value FROM settings WHERE key = 'web3_nft_contracts'");
    let allowed = [];
    try { allowed = contractsRowRes.rows[0]?.value ? JSON.parse(contractsRowRes.rows[0].value) : []; } catch { allowed = []; }
    if (!contract || !tokenId || !toAddress) return res.status(400).json({ error: 'Missing fields' });
    if (!allowed.some(c => c.toLowerCase() === contract.toLowerCase())) return res.status(403).json({ error: 'Contract not allowed' });

    await db.query(`
      INSERT INTO nft_items (contract_address, token_id, owner_address, metadata) 
      VALUES ($1,$2,$3,COALESCE((SELECT metadata FROM nft_items WHERE contract_address=$1 AND token_id=$2), NULL))
      ON CONFLICT (contract_address, token_id) DO UPDATE SET owner_address = $3`,
      [contract, tokenId, toAddress]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/nfts/send', async (req, res) => {
  const { contract, tokenId, fromAddress, toAddress } = req.body || {};
  try {
    const contractsRowRes = await db.query("SELECT value FROM settings WHERE key = 'web3_nft_contracts'");
    let allowed = [];
    try { allowed = contractsRowRes.rows[0]?.value ? JSON.parse(contractsRowRes.rows[0].value) : []; } catch { allowed = []; }
    if (!contract || !tokenId || !fromAddress || !toAddress) return res.status(400).json({ error: 'Missing fields' });
    if (!allowed.some(c => c.toLowerCase() === contract.toLowerCase())) return res.status(403).json({ error: 'Contract not allowed' });

    const rowRes = await db.query('SELECT owner_address FROM nft_items WHERE contract_address = $1 AND token_id = $2', [contract, tokenId]);
    const row = rowRes.rows[0];
    if (!row || row.owner_address !== fromAddress) return res.status(400).json({ error: 'Not owner' });
    await db.query('UPDATE nft_items SET owner_address = $1 WHERE contract_address = $2 AND token_id = $3', [toAddress, contract, tokenId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- ACCESS LEVELS ---
app.get('/api/access-levels', async (req, res) => {
  try {
    const rowsRes = await db.query('SELECT * FROM access_levels');
    const levels = rowsRes.rows.map(r => ({
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.status(500).json({ error: e.message });
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
  const ext = await client.query('SELECT id, item_id, current_charge FROM stored_batteries WHERE user_id = $1', [uid]);
  changes.storedBatteries = ext.rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    currentCharge: Number(r.current_charge) || 0
  }));
}

async function returnRackBatteryToChangesOnNftSanitize(client, uid, rack, stock, changes) {
  const bid = rack.batteryId;
  if (bid == null || String(bid).trim() === '') return;
  const s = String(bid).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
  if (isUuid) {
    const br = await client.query(
      'SELECT id, item_id, current_charge FROM stored_batteries WHERE id = $1 AND user_id = $2',
      [s, uid]
    );
    if (br.rows[0]) {
      await ensureStoredBatteriesArrayFromDb(client, uid, changes);
      if (!changes.storedBatteries.some((x) => x.id === br.rows[0].id)) {
        changes.storedBatteries.push({
          id: br.rows[0].id,
          itemId: br.rows[0].item_id,
          currentCharge: Number(br.rows[0].current_charge) || 0
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

    const rackVal = await validatePlacedRacksForSave(client, out.next.placedRacks);
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
    console.error('[server-room/bulk-batteries]', e);
    res.status(500).json({ error: e.message || 'Erro interno' });
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
    res.status(500).json({ error: e.message || 'Erro interno' });
  } finally {
    client.release();
  }
});

// --- RIG ROOMS ---
app.get('/api/rig-rooms', async (req, res) => {
  try {
    const rowsRes = await db.query('SELECT * FROM rig_rooms ORDER BY sort_order ASC, name ASC');
    const list = rowsRes.rows.map(r => ({
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.get('/api/my-rig-rooms/:email', async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
    const email = String(req.params.email || '').trim().toLowerCase();
    if (!email || email.length > 254 || /[\x00-\x1f<>]/.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }
    const uidRes = await db.query('SELECT id FROM users WHERE lower(trim(email::text)) = $1', [email]);
    if (!uidRes.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
    const uid = uidRes.rows[0].id;
    if (Number(uid) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const urowRes = await db.query('SELECT access_level_id FROM users WHERE id = $1', [uid]);
    const urow = urowRes.rows[0];
    const currentLvlId = urow?.access_level_id || null;

    // Get all user's access levels
    const userLvlsRes = await db.query('SELECT access_level_id FROM user_access_levels WHERE user_id = $1', [uid]);
    const userLvlIds = userLvlsRes.rows.map(l => l.access_level_id);
    // Include current level just in case it's not in the new table yet (safety)
    if (currentLvlId && !userLvlIds.includes(currentLvlId)) {
      userLvlIds.push(currentLvlId);
    }

    // Get user's purchased season passes
    const passPurchRes = await db.query('SELECT pass_id FROM season_purchases WHERE user_id = $1', [uid]);
    const userPassIds = passPurchRes.rows.map(p => p.pass_id);

    const racksRoomRes = await db.query(
      `SELECT DISTINCT
         CASE
           WHEN room_id IS NULL OR BTRIM(COALESCE(room_id, '')) = '' OR BTRIM(room_id) = 'main' THEN 'room_initial'
           ELSE BTRIM(room_id)
         END AS room_id
       FROM placed_racks WHERE user_id = $1`,
      [uid]
    );
    const roomIdsWithPlacedRacks = new Set(racksRoomRes.rows.map((row) => row.room_id));

    const rowsRes = await db.query(`
      SELECT 
        rr.id, rr.name, rr.initial_capacity, rr.max_capacity, rr.base_slot_price, rr.slot_price_increase_percent, 
        rr.allowed_levels, rr.allowed_season_pass_ids, rr.is_active, rr.sort_order, 
        urr.purchased_at, urr.unlocked_slots 
      FROM rig_rooms rr 
      LEFT JOIN user_rig_rooms urr ON urr.room_id = rr.id AND urr.user_id = $1 
      ORDER BY rr.sort_order ASC`, [uid]);
    const list = rowsRes.rows.map(r => ({
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
      owned: !!r.purchased_at,
      unlockedSlots: r.unlocked_slots || 0,
      nftAutoArmario1Only: isNftAutoArmario1OnlyRoomRowFromDb(r)
    })).filter(r => {
      // Accessibility checks
      const allowedLvl = Array.isArray(r.allowedLevels) ? r.allowedLevels : [];
      const allowedSeason = Array.isArray(r.allowedSeasonPassIds) ? r.allowedSeasonPassIds : [];

      const levelOk = allowedLvl.length === 0 || allowedLvl.some(lvl => userLvlIds.includes(lvl));
      const seasonOk = allowedSeason.length === 0 || allowedSeason.some(passId => userPassIds.includes(passId));

      const hasRacksHere = roomIdsWithPlacedRacks.has(r.id);
      return r.owned || hasRacksHere || (levelOk && seasonOk);
    });
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});
// --- LOOT BOXES (catálogo público + compra/abertura: dist/controllers/lootBoxController.js) ---
app.post('/api/loot-boxes', isAdmin, async (req, res) => {
  let boxes;
  let replaceCatalog = false;
  if (Array.isArray(req.body)) {
    // Legado: array sozinho = upsert sem desativar o resto (evita apagar catálogo por saves parciais).
    boxes = req.body;
    replaceCatalog = false;
  } else if (req.body && typeof req.body === 'object' && Array.isArray(req.body.boxes)) {
    boxes = req.body.boxes;
    replaceCatalog = req.body.replaceCatalog === true;
  } else {
    return res.status(400).json({ error: 'Body inválido: use { boxes: [], replaceCatalog?: boolean } ou um array (legado).' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const validBoxes = boxes.filter(
      (b) => b && b.id && typeof b.name === 'string' && String(b.name).trim()
    );
    const validIncomingIds = validBoxes.map((b) => String(b.id));

    const triggersWithoutItemList = new Set(['roleta_code']);
    for (const b of validBoxes) {
      const active = b.isActive !== false;
      const trig = String(b.trigger || 'shop');
      const nItems = Array.isArray(b.items) ? b.items.filter((it) => it && it.id).length : 0;
      if (active && !triggersWithoutItemList.has(trig) && nItems === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Caixa "${String(b.name).trim()}" (${b.id}): não pode ficar ativa sem prémios. Adicione itens ou desative a caixa. (Exceção: gatilho roleta por código.)`
        });
      }
      if (active && (trig === 'shop' || trig === 'shop_once' || trig === 'special')) {
        const p = Number(b.price);
        if (!Number.isFinite(p) || p <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Caixa "${String(b.name).trim()}" (${b.id}): preço USDC inválido para venda na loja (use número > 0).`
          });
        }
      }
    }

    for (const b of validBoxes) {
      // UPSERT the Box (rows stay in DB; removals are handled via is_active below)
      await client.query(`
        INSERT INTO loot_boxes (id, name, description, price, trigger, icon, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          price = EXCLUDED.price,
          trigger = EXCLUDED.trigger,
          icon = EXCLUDED.icon,
          is_active = EXCLUDED.is_active
      `, [b.id, b.name.trim(), b.description || '', b.price || 0, b.trigger || 'shop', b.icon || '🎁', b.isActive === false ? 0 : 1]);

      await client.query('DELETE FROM loot_box_items WHERE box_id = $1', [b.id]);

      if (Array.isArray(b.items)) {
        for (const it of b.items) {
          if (!it.id) continue;
          await client.query(`
            INSERT INTO loot_box_items (box_id, item_type, item_id, min_qty, max_qty, probability)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [b.id, it.type || 'item', it.id, it.minQty || 1, it.maxQty || 1, it.probability || 0]);
        }
      }
    }

    // Só alinha “removidas da lista” no painel principal quando replaceCatalog=true (salvar catálogo completo).
    if (replaceCatalog) {
      if (boxes.length === 0) {
        await client.query('UPDATE loot_boxes SET is_active = 0');
      } else if (validIncomingIds.length > 0) {
        await client.query(
          'UPDATE loot_boxes SET is_active = 0 WHERE NOT (id = ANY($1::text[]))',
          [validIncomingIds]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /api/loot-boxes] Fail:', e);
    res.status(500).json({ error: 'Falha ao processar banco de dados: ' + e.message });
  } finally { client.release(); }
});

// --- SYSTEM NEWS ---
app.get('/api/news', async (req, res) => {
  const client = await db.connect();
  try {
    const expRowRes = await client.query('SELECT value FROM settings WHERE key = $1', ['news_post_expire_days']);
    const expRow = expRowRes.rows[0];
    const expDays = expRow ? Number(expRow.value) || 0 : 0;
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
  } catch (e) { res.status(500).json({ error: e.message }); } finally { client.release(); }
});

app.post('/api/news', isAdmin, async (req, res) => {
  const { id, text, link, duration, authorName, adType, imageUrl } = req.body;
  try {
    await db.query('INSERT INTO system_news (id,text,link,active,duration,author_name,created_at,ad_type,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET text = $2, link = $3, duration = $5, author_name = $6, ad_type = $8, image_url = $9',
      [id, text, link ?? null, 1, duration ?? null, authorName ?? 'Admin', Date.now(), adType ?? 'horizontal', imageUrl ?? null]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/news/:id', isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM system_news WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/news-fee', async (req, res) => {
  try {
    const resRow = await db.query('SELECT value FROM settings WHERE key = $1', ['news_post_fee_usdc']);
    const row = resRow.rows[0];
    res.json({ feeUsdc: row ? Number(row.value) || 0 : 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/news-fee', isAdmin, async (req, res) => {
  const { feeUsdc } = req.body || {};
  const val = isFinite(Number(feeUsdc)) ? Number(feeUsdc) : 0;
  try {
    await db.query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2', ['news_post_fee_usdc', String(val)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/news-expire-days', async (req, res) => {
  try {
    const resRow = await db.query('SELECT value FROM settings WHERE key = $1', ['news_post_expire_days']);
    const row = resRow.rows[0];
    res.json({ days: row ? Number(row.value) || 0 : 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/news-expire-days', isAdmin, async (req, res) => {
  const { days } = req.body || {};
  const val = Math.max(0, Math.floor(Number(days) || 0));
  try {
    await db.query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2', ['news_post_expire_days', String(val)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const r = await db.query(
      `SELECT id, category, title, body, amount_usdc, link_url, sort_order, created_at, updated_at
       FROM transparency_entries
       ORDER BY sort_order ASC, id ASC`
    );
    res.json(r.rows.map((row) => mapTransparencyEntryRow(row)));
  } catch (e) {
    console.error('[GET /api/transparency]', e);
    res.status(500).json([]);
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
    const now = Date.now();
    const ins = await db.query(
      `INSERT INTO transparency_entries (category, title, body, amount_usdc, link_url, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, category, title, body, amount_usdc, link_url, sort_order, created_at, updated_at`,
      [String(category), t, b || null, amt, link || null, sort, now, now]
    );
    res.json(mapTransparencyEntryRow(ins.rows[0]));
  } catch (e) {
    console.error('[POST /api/admin/transparency]', e);
    res.status(500).json({ error: 'Erro ao criar registro' });
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
    const ex = await db.query('SELECT id FROM transparency_entries WHERE id = $1', [id]);
    if (!ex.rows[0]) return res.status(404).json({ error: 'Registro não encontrado' });

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
    const now = Date.now();

    const cur = await db.query(
      'SELECT category, title, body, amount_usdc, link_url, sort_order FROM transparency_entries WHERE id = $1',
      [id]
    );
    const c = cur.rows[0];
    const nextCat = category != null ? String(category) : c.category;
    const nextTitle = t !== null ? t : c.title;
    const nextBody = bodyVal !== undefined ? bodyVal : c.body;
    const nextAmt = amtVal !== undefined ? amtVal : c.amount_usdc;
    const nextLink = linkVal !== undefined ? linkVal : c.link_url;
    const nextSort = sortVal !== undefined ? sortVal : c.sort_order;

    const upd = await db.query(
      `UPDATE transparency_entries
       SET category = $1, title = $2, body = $3, amount_usdc = $4, link_url = $5, sort_order = $6, updated_at = $7
       WHERE id = $8
       RETURNING id, category, title, body, amount_usdc, link_url, sort_order, created_at, updated_at`,
      [nextCat, nextTitle, nextBody, nextAmt, nextLink, nextSort, now, id]
    );
    res.json(mapTransparencyEntryRow(upd.rows[0]));
  } catch (e) {
    console.error('[PUT /api/admin/transparency/:id]', e);
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

app.delete('/api/admin/transparency/:id', isAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const r = await db.query('DELETE FROM transparency_entries WHERE id = $1 RETURNING id', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/admin/transparency/:id]', e);
    res.status(500).json({ error: 'Erro ao remover' });
  }
});

// --- UI DISPLAY LABELS (textos do jogo editáveis pelo admin) ---
app.get('/api/display-labels', async (req, res) => {
  try {
    const r = await db.query('SELECT key, value FROM ui_display_labels ORDER BY key');
    const obj = {};
    for (const row of r.rows) {
      const k = row.key != null ? String(row.key).trim() : '';
      const v = row.value != null ? String(row.value).trim() : '';
      if (k && v) obj[k] = v.slice(0, 200);
    }
    res.json(obj);
  } catch (e) {
    console.error('[GET /api/display-labels]', e);
    res.json({});
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

// AD IMAGE UPLOAD
app.post('/api/admin/upload-ad', isAdmin, (req, res) => {
  console.log('[Upload] Starting upload process...');
  uploadAd.single('image')(req, res, (err) => {
    if (err) {
      console.error('[Upload] Multer Error:', err);
      return res.status(400).json({ error: 'Erro no upload: ' + err.message });
    }
    if (!req.file) {
      console.log('[Upload] No file received');
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    console.log('[Upload] Success:', req.file.filename);
    const imageUrl = `/img/${req.file.filename}`;
    res.json({ ok: true, imageUrl });
  });
});

app.get('/api/player-news/pending', isAdmin, async (req, res) => {
  try {
    const rowsRes = await db.query('SELECT p.id, p.user_id, p.text, p.link, p.status, p.created_at, u.username, u.email FROM player_news_submissions p JOIN users u ON u.id = p.user_id WHERE p.status = $1 ORDER BY p.created_at DESC', ['pending']);
    res.json(rowsRes.rows.map(r => ({ id: r.id, userId: r.user_id, username: r.username, email: r.email, text: r.text, link: r.link ?? undefined, status: r.status, createdAt: r.created_at })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/player-news/submit', async (req, res) => {
  const { email, text, link } = req.body || {};
  if (!email || !text) return res.status(400).json({ error: 'Missing fields' });
  const client = await db.connect();
  try {
    const uid = await getUserIdByEmail(email, req.ip);
    const urowRes = await client.query('SELECT access_level_id FROM users WHERE id = $1', [uid]);
    const urow = urowRes.rows[0];
    const lvlRes = urow?.access_level_id ? await client.query('SELECT * FROM access_levels WHERE id = $1', [urow.access_level_id]) : { rows: [] };
    const lvl = lvlRes.rows[0];
    if (!lvl || !lvl.is_active) return res.status(400).json({ error: 'Access level inactive' });
    if (!lvl.news_posting_enabled) return res.status(403).json({ error: 'Posting disabled for level' });

    const feeRowRes = await client.query('SELECT value FROM settings WHERE key = $1', ['news_post_fee_usdc']);
    const fee = feeRowRes.rows[0] ? Number(feeRowRes.rows[0].value) || 0 : 0;

    const gsRes = await client.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    const bal = gsRes.rows[0]?.usdc ?? 0;

    if (bal < fee) return res.status(400).json({ error: 'Insufficient USDC', missing: fee - bal });

    await client.query('BEGIN');
    if (fee > 0) await client.query('UPDATE game_states SET usdc = usdc - $1 WHERE user_id = $2', [fee, uid]);
    await client.query('DELETE FROM player_news_submissions WHERE user_id = $1', [uid]);
    await client.query('INSERT INTO player_news_submissions (id,user_id,text,link,status,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), uid, text, link ?? null, 'pending', Date.now()]);
    await client.query('COMMIT');

    const finalGsRes = await client.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    const newBal = finalGsRes.rows[0]?.usdc ?? 0;
    res.json({ ok: true, newUsdc: newBal });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- SUPORTE (tickets com anexos foto/vídeo) ---
app.post('/api/support/submit', authenticateToken, (req, res, next) => {
  uploadSupport.array('files', 5)(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Erro no upload';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, async (req, res) => {
  const uid = req.userId;
  if (!uid) return res.status(401).json({ error: 'Não autenticado' });
  const subjectRaw = req.body?.subject != null ? String(req.body.subject) : '';
  const messageRaw = req.body?.message != null ? String(req.body.message) : '';
  const subject = subjectRaw.trim().slice(0, 180);
  const message = messageRaw.trim().slice(0, 8000);
  if (subject.length < 3) return res.status(400).json({ error: 'Assunto demasiado curto (mín. 3 caracteres).' });
  if (message.length < 10) return res.status(400).json({ error: 'Mensagem demasiado curta (mín. 10 caracteres).' });
  const files = Array.isArray(req.files) ? req.files : [];
  const attachments = [];
  for (const f of files) {
    if (!f || !f.filename) continue;
    const ext = path.extname(f.filename).toLowerCase();
    if (!SUPPORT_ALLOWED_EXT.has(ext)) continue;
    attachments.push({
      url: `/img/${f.filename}`,
      originalName: String(f.originalname || f.filename).slice(0, 200),
      mime: String(f.mimetype || '').slice(0, 120),
    });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.query(
      `INSERT INTO support_tickets (id, user_id, subject, message, attachments, status, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'open', $6)`,
      [id, uid, subject, message, JSON.stringify(attachments), now]
    );
    await appendGameActivityLog(db, uid, 'support_ticket_submit', { ticketId: id, attachmentCount: attachments.length });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('[POST /api/support/submit]', e);
    res.status(500).json({ error: 'Erro ao registar o pedido.' });
  }
});

app.get('/api/support/my-tickets', authenticateToken, async (req, res) => {
  const uid = req.userId;
  if (!uid) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const rowsRes = await db.query(
      `SELECT t.id, t.subject, t.status, t.created_at,
              (SELECT COUNT(*)::int FROM support_ticket_replies r WHERE r.ticket_id = t.id) AS admin_reply_count,
              COALESCE((SELECT MAX(r.created_at) FROM support_ticket_replies r WHERE r.ticket_id = t.id), 0) AS last_admin_at,
              COALESCE((SELECT MAX(p.created_at) FROM support_ticket_player_replies p WHERE p.ticket_id = t.id), 0) AS last_player_at
       FROM support_tickets t
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT 100`,
      [uid]
    );
    const tickets = rowsRes.rows.map((r) => {
      const createdAt = Number(r.created_at) || 0;
      const lastAdmin = Number(r.last_admin_at) || 0;
      const lastPlayer = Number(r.last_player_at) || 0;
      const lastActivityAt = Math.max(createdAt, lastAdmin, lastPlayer);
      return {
        id: r.id,
        subject: r.subject,
        status: r.status,
        createdAt,
        adminReplyCount: r.admin_reply_count ?? 0,
        lastActivityAt,
      };
    });
    res.json({ tickets });
  } catch (e) {
    console.error('[GET /api/support/my-tickets]', e);
    res.status(500).json({ error: 'Erro ao listar pedidos.' });
  }
});

app.get('/api/support/tickets/:ticketId', authenticateToken, async (req, res) => {
  const uid = req.userId;
  if (!uid) return res.status(401).json({ error: 'Não autenticado' });
  const ticketId = String(req.params.ticketId || '').trim().slice(0, 80);
  if (!ticketId) return res.status(400).json({ error: 'Pedido inválido.' });
  try {
    const tRes = await db.query(
      `SELECT id, user_id, subject, message, attachments, status, created_at FROM support_tickets WHERE id = $1`,
      [ticketId]
    );
    const t = tRes.rows[0];
    if (!t || Number(t.user_id) !== Number(uid)) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    const adminRes = await db.query(
      `SELECT r.id, r.message, r.attachments, r.created_at, u.username AS admin_username
       FROM support_ticket_replies r
       JOIN users u ON u.id = r.admin_user_id
       WHERE r.ticket_id = $1
       ORDER BY r.created_at ASC`,
      [ticketId]
    );
    const playerRes = await db.query(
      `SELECT id, message, attachments, created_at FROM support_ticket_player_replies WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticketId]
    );
    res.json({
      ticket: {
        id: t.id,
        subject: t.subject,
        message: t.message,
        attachments: Array.isArray(t.attachments) ? t.attachments : [],
        status: t.status,
        createdAt: Number(t.created_at) || 0,
      },
      adminReplies: adminRes.rows.map((r) => ({
        id: r.id,
        adminUsername: r.admin_username,
        message: r.message,
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
        createdAt: Number(r.created_at) || 0,
      })),
      playerReplies: playerRes.rows.map((r) => ({
        id: r.id,
        message: r.message,
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
        createdAt: Number(r.created_at) || 0,
      })),
    });
  } catch (e) {
    console.error('[GET /api/support/tickets/:ticketId]', e);
    res.status(500).json({ error: 'Erro ao carregar o pedido.' });
  }
});

app.post('/api/support/tickets/:ticketId/reply', authenticateToken, (req, res, next) => {
  uploadSupport.array('files', 5)(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Erro no upload';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, async (req, res) => {
  const uid = req.userId;
  if (!uid) return res.status(401).json({ error: 'Não autenticado' });
  const ticketId = String(req.params.ticketId || '').trim().slice(0, 80);
  if (!ticketId) return res.status(400).json({ error: 'Pedido inválido.' });
  const messageRaw = req.body?.message != null ? String(req.body.message) : '';
  const message = messageRaw.trim().slice(0, 8000);
  const files = Array.isArray(req.files) ? req.files : [];
  if (message.length < 3 && files.length === 0) {
    return res.status(400).json({ error: 'Escreve uma mensagem (mín. 3 caracteres) ou anexa ficheiros.' });
  }
  const attachments = [];
  for (const f of files) {
    if (!f || !f.filename) continue;
    const ext = path.extname(f.filename).toLowerCase();
    if (!SUPPORT_ALLOWED_EXT.has(ext)) continue;
    attachments.push({
      url: `/img/${f.filename}`,
      originalName: String(f.originalname || f.filename).slice(0, 200),
      mime: String(f.mimetype || '').slice(0, 120),
    });
  }
  try {
    const tRes = await db.query(
      `SELECT id, user_id, status FROM support_tickets WHERE id = $1`,
      [ticketId]
    );
    const t = tRes.rows[0];
    if (!t || Number(t.user_id) !== Number(uid)) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    if (String(t.status) !== 'open') {
      return res.status(403).json({
        error: 'Este pedido está arquivado. Só podes ver a conversa. Abre um novo pedido para falar connosco de novo.',
      });
    }
    const replyId = crypto.randomUUID();
    const now = Date.now();
    await db.query(
      `INSERT INTO support_ticket_player_replies (id, ticket_id, user_id, message, attachments, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [replyId, ticketId, uid, message, JSON.stringify(attachments), now]
    );
    await appendGameActivityLog(db, uid, 'support_ticket_player_reply', {
      ticketId,
      replyId,
      attachmentCount: attachments.length,
    });
    res.json({ ok: true, id: replyId });
  } catch (e) {
    console.error('[POST /api/support/tickets/:ticketId/reply]', e);
    res.status(500).json({ error: 'Erro ao enviar a mensagem.' });
  }
});

app.get('/api/admin/support-tickets', isAdmin, async (req, res) => {
  try {
    const limit = Math.min(300, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
    const rowsRes = await db.query(
      `SELECT t.id, t.user_id, t.subject, t.message, t.attachments, t.status, t.created_at,
              u.username, u.email
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC
       LIMIT $1`,
      [limit]
    );
    const ids = rowsRes.rows.map((r) => r.id);
    const repliesByTicket = {};
    const playerRepliesByTicket = {};
    if (ids.length > 0) {
      const repRes = await db.query(
        `SELECT r.id, r.ticket_id, r.admin_user_id, r.message, r.attachments, r.created_at,
                au.username AS admin_username
         FROM support_ticket_replies r
         JOIN users au ON au.id = r.admin_user_id
         WHERE r.ticket_id = ANY($1::text[])
         ORDER BY r.created_at ASC`,
        [ids]
      );
      for (const row of repRes.rows) {
        const tid = row.ticket_id;
        if (!repliesByTicket[tid]) repliesByTicket[tid] = [];
        const att = Array.isArray(row.attachments) ? row.attachments : [];
        repliesByTicket[tid].push({
          id: row.id,
          adminUserId: row.admin_user_id,
          adminUsername: row.admin_username,
          message: row.message,
          attachments: att,
          createdAt: Number(row.created_at) || 0,
        });
      }
      const prRes = await db.query(
        `SELECT id, ticket_id, message, attachments, created_at
         FROM support_ticket_player_replies
         WHERE ticket_id = ANY($1::text[])
         ORDER BY created_at ASC`,
        [ids]
      );
      for (const row of prRes.rows) {
        const tid = row.ticket_id;
        if (!playerRepliesByTicket[tid]) playerRepliesByTicket[tid] = [];
        playerRepliesByTicket[tid].push({
          id: row.id,
          message: row.message,
          attachments: Array.isArray(row.attachments) ? row.attachments : [],
          createdAt: Number(row.created_at) || 0,
        });
      }
    }
    const rows = rowsRes.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      email: r.email,
      subject: r.subject,
      message: r.message,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      status: r.status,
      createdAt: Number(r.created_at) || 0,
      replies: repliesByTicket[r.id] || [],
      playerReplies: playerRepliesByTicket[r.id] || [],
    }));
    res.json({ tickets: rows });
  } catch (e) {
    console.error('[GET /api/admin/support-tickets]', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/support-tickets/status', isAdmin, async (req, res) => {
  const { id, status } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório.' });
  const st = status === 'archived' ? 'archived' : 'open';
  try {
    const r = await db.query('UPDATE support_tickets SET status = $1 WHERE id = $2 RETURNING id', [st, id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Ticket não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/support-tickets/status]', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/support-tickets/reply', isAdmin, (req, res, next) => {
  uploadSupportReply.array('files', 5)(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Erro no upload';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, async (req, res) => {
  const adminId = req.userId;
  if (!adminId) return res.status(401).json({ error: 'Não autenticado' });
  const ticketIdRaw = req.body?.ticketId != null ? String(req.body.ticketId) : '';
  const ticketId = ticketIdRaw.trim().slice(0, 80);
  if (!ticketId) return res.status(400).json({ error: 'ticketId obrigatório.' });
  const messageRaw = req.body?.message != null ? String(req.body.message) : '';
  const message = messageRaw.trim().slice(0, 8000);
  const files = Array.isArray(req.files) ? req.files : [];
  if (message.length < 3 && files.length === 0) {
    return res.status(400).json({ error: 'Escreva uma mensagem (mín. 3 caracteres) ou anexe ficheiros.' });
  }
  const attachments = [];
  for (const f of files) {
    if (!f || !f.filename) continue;
    const ext = path.extname(f.filename).toLowerCase();
    if (!SUPPORT_ALLOWED_EXT.has(ext)) continue;
    attachments.push({
      url: `/img/${f.filename}`,
      originalName: String(f.originalname || f.filename).slice(0, 200),
      mime: String(f.mimetype || '').slice(0, 120),
    });
  }
  try {
    const tRes = await db.query('SELECT id, user_id FROM support_tickets WHERE id = $1', [ticketId]);
    const t = tRes.rows[0];
    if (!t) return res.status(404).json({ error: 'Ticket não encontrado.' });
    const replyId = crypto.randomUUID();
    const now = Date.now();
    await db.query(
      `INSERT INTO support_ticket_replies (id, ticket_id, admin_user_id, message, attachments, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [replyId, ticketId, adminId, message, JSON.stringify(attachments), now]
    );
    await appendGameActivityLog(db, t.user_id, 'support_ticket_admin_reply', {
      ticketId,
      replyId,
      adminUserId: adminId,
      attachmentCount: attachments.length,
    });
    res.json({ ok: true, id: replyId });
  } catch (e) {
    console.error('[POST /api/admin/support-tickets/reply]', e);
    res.status(500).json({ error: 'Erro ao registar a resposta.' });
  }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.get('/api/season-purchases/:email', async (req, res) => {
  const email = String(req.params.email || '').toLowerCase();
  try {
    const uidRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!uidRes.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
    const uid = uidRes.rows[0].id;
    const rowsRes = await db.query('SELECT pass_id, season_id, purchased_at FROM season_purchases WHERE user_id = $1', [uid]);
    const list = rowsRes.rows.map(r => ({ passId: r.pass_id, seasonId: r.season_id, purchasedAt: r.purchased_at }));
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/season-pass/purchase', async (req, res) => {
  const { passId } = req.body || {};
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (!passId) return res.status(400).json({ error: 'Missing fields' });
  const client = await db.connect();
  try {
    const uid = req.userId;
    const passRes = await client.query('SELECT * FROM season_passes WHERE id = $1', [passId]);
    const pass = passRes.rows[0];
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (!pass.is_active) return res.status(400).json({ error: 'Pass inactive' });
    const alreadyRes = await client.query('SELECT 1 FROM season_purchases WHERE user_id = $1 AND pass_id = $2', [uid, passId]);
    if (alreadyRes.rowCount > 0) return res.status(400).json({ error: 'Already purchased' });
    const gsRes = await client.query('SELECT usdc FROM game_states WHERE user_id = $1', [uid]);
    const bal = gsRes.rows[0]?.usdc ?? 0;
    const price = pass.price_usdc ?? 0;
    if (bal < price) return res.status(400).json({ error: 'Insufficient USDC', missing: price - bal });
    const now = Date.now();
    await client.query('BEGIN');
    await client.query('UPDATE game_states SET usdc = usdc - $1 WHERE user_id = $2', [price, uid]);
    await client.query('INSERT INTO season_purchases (user_id, pass_id, season_id, purchased_at) VALUES ($1, $2, $3, $4)', [uid, passId, pass.season_id, now]);

    // GRANT SEASON/PASS REWARDS
    console.log(`[Purchase] Granting rewards for user ${uid}, pass ${passId}...`);
    await grantPassRewards(uid, passId, pass.season_id, client);

    console.log(`[Purchase] About to COMMIT transaction for user ${uid}, pass ${passId}`);
    await client.query('COMMIT');
    console.log(`[Purchase] ✅ Transaction COMMITTED successfully`);

    // VERIFICATION: Check if items are actually in stock
    console.log(`[Purchase] VERIFICATION: Checking if items are in stock...`);
    const rewardsCheck = await db.query('SELECT * FROM season_pass_rewards WHERE pass_id = $1', [passId]);
    if (rewardsCheck.rows.length > 0) {
      for (const reward of rewardsCheck.rows) {
        if (reward.type === 'item' && reward.item_id) {
          const stockCheck = await db.query('SELECT qty FROM stock WHERE user_id = $1 AND item_id = $2', [uid, reward.item_id]);
          if (stockCheck.rows.length > 0) {
            console.log(`[Purchase] ✅ VERIFIED: ${reward.item_id} is in stock (qty: ${stockCheck.rows[0].qty})`);
          } else {
            console.error(`[Purchase] ❌❌❌ CRITICAL: ${reward.item_id} NOT FOUND in stock for user ${uid}!`);
          }
        }
      }
    }
    console.log(`[Purchase] VERIFICATION COMPLETE`);

    res.json({ ok: true, newUsdc: bal - price });
  } catch (e) {
    console.error(`[Purchase] ❌ ERROR during purchase, rolling back:`, e.message);
    await client.query('ROLLBACK');
    console.log(`[Purchase] Transaction ROLLED BACK`);
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.post('/api/season-pass/grant', isAdmin, async (req, res) => {
  const { email, passId } = req.body || {};
  if (!email || !passId) return res.status(400).json({ error: 'Missing fields' });
  try {
    const uid = await getUserIdByEmail(email, req.ip, { allowAnyDomain: true });
    const passRes = await db.query('SELECT * FROM season_passes WHERE id = $1', [passId]);
    const pass = passRes.rows[0];
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    const alreadyRes = await db.query('SELECT 1 FROM season_purchases WHERE user_id = $1 AND pass_id = $2', [uid, passId]);
    if (alreadyRes.rowCount > 0) return res.status(400).json({ error: 'Already purchased' });
    const now = Date.now();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO season_purchases (user_id, pass_id, season_id, purchased_at) VALUES ($1,$2,$3,$4)', [uid, passId, pass.season_id, now]);

      // GRANT SEASON/PASS REWARDS
      await grantPassRewards(uid, passId, pass.season_id, client);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const offset = (page - 1) * limit;

    let whereConditions = [];
    let params = [];
    let paramIdx = 1;

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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.status(500).json({ error: e.message });
  }
});

// --- ADVANCED REFERRALS ---
app.get('/api/admin/referral-models', isAdmin, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM referral_models ORDER BY id ASC');
    res.json(rows.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/referral-models/:id', isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM referral_models WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/access-level-referral-assignments', isAdmin, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM access_level_referral_models');
    res.json(rows.rows.reduce((acc, r) => {
      acc[r.access_level_id] = r.referral_model_id;
      return acc;
    }, {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/update-permissions', isAdmin, async (req, res) => {
  const { email, isAdmin: targetIsAdmin, permissions } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });

  try {
    let permsJson = null;
    if (targetIsAdmin) {
      if (Array.isArray(permissions)) {
        permsJson = JSON.stringify(ensureAdminSettingsLabelsInPermissions(permissions));
      } else if (permissions && typeof permissions === 'object') {
        const o = { ...permissions };
        o['settings:labels'] = true;
        permsJson = JSON.stringify(o);
      } else {
        permsJson = JSON.stringify(ensureAdminSettingsLabelsInPermissions([]));
      }
    } else if (permissions != null) {
      permsJson = JSON.stringify(permissions);
    }
    await db.query(
      'UPDATE users SET is_admin = $1, admin_permissions = $2 WHERE email = $3',
      [targetIsAdmin ? 1 : 0, permsJson, email]
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
    res.status(500).json({ error: e.message });
  }
});


// --- REFERRALS ---
app.get('/api/referrals/:email', async (req, res) => {
  try {
    const email = String(req.params.email || '').toLowerCase();
    const uidRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!uidRes.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
    const uid = uidRes.rows[0].id;
    const rowsRes = await db.query('SELECT referred_username FROM referrals WHERE user_id = $1 ORDER BY id ASC', [uid]);
    res.json(rowsRes.rows.map(r => r.referred_username));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/referrals/claim-code', async (req, res) => {
  const { code } = req.body || {};
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (!code) return res.status(400).json({ error: 'Parâmetros inválidos' });
  const client = await db.connect();
  try {
    const uid = req.userId;
    const currentRes = await client.query('SELECT username, referred_by FROM users WHERE id = $1', [uid]);
    const current = currentRes.rows[0];
    if (!current) return res.status(400).json({ error: 'Usuário não encontrado' });
    if (current.referred_by) return res.status(400).json({ error: 'Código já vinculado' });

    const referrerRes = await client.query('SELECT id FROM users WHERE referral_code = $1', [code]);
    const referrer = referrerRes.rows[0];
    if (!referrer) return res.status(400).json({ error: 'Código inválido' });
    if (referrer.id === uid) return res.status(400).json({ error: 'Você não pode usar seu próprio código' });

    await client.query('BEGIN');
    await client.query('UPDATE users SET referred_by = $1 WHERE id = $2', [code, uid]);
    await client.query('INSERT INTO referrals (user_id, referred_username) VALUES ($1, $2) ON CONFLICT DO NOTHING', [referrer.id, current.username]);

    // Grant Referee Reward (Receiver) - AUTOMATICALLY when claiming code
    const gsRes = await client.query('SELECT referral_bonus_claimed FROM game_states WHERE user_id = $1', [uid]);
    if (gsRes.rows[0] && !gsRes.rows[0].referral_bonus_claimed) {
      const receiverBoxes = await client.query("SELECT id FROM loot_boxes WHERE trigger = 'referral_receiver'");
      const now = Date.now();
      for (const box of receiverBoxes.rows) {
        await client.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1', [uid, box.id]);
        await client.query('INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [uid, box.id, now]);
      }
      await client.query('UPDATE game_states SET referral_bonus_claimed = 1 WHERE user_id = $1', [uid]);
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    if (client) await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

app.post('/api/referrals/claim-reward', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });

  const client = await db.connect();
  try {
    const uid = req.userId;
    // count total referrals
    const refCountRes = await client.query('SELECT COUNT(*) as total FROM referrals WHERE user_id = $1', [uid]);
    const totalReferrals = parseInt(refCountRes.rows[0].total) || 0;

    // get current claimed count from game_states
    const gsRes = await client.query('SELECT claimed_referrals FROM game_states WHERE user_id = $1', [uid]);
    const claimedCount = gsRes.rows[0]?.claimed_referrals || 0;

    if (totalReferrals <= claimedCount) {
      return res.status(400).json({ error: 'Não há prêmios disponíveis para resgate no momento.' });
    }

    const senderBoxes = await client.query("SELECT id FROM loot_boxes WHERE trigger = 'referral_sender'");
    if (senderBoxes.rows.length === 0) {
      return res.status(404).json({ error: 'Configuração de prêmio de indicação não encontrada.' });
    }

    await client.query('BEGIN');

    // Grant ONE box for the next available referral
    for (const box of senderBoxes.rows) {
      await client.query(`
        INSERT INTO unopened_boxes (user_id, box_id, qty) 
        VALUES ($1, $2, 1) 
        ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1
      `, [uid, box.id]);
    }

    // Increment claimed count
    await client.query('UPDATE game_states SET claimed_referrals = claimed_referrals + 1 WHERE user_id = $1', [uid]);

    await client.query('COMMIT');
    res.json({ ok: true });

  } catch (e) {
    if (client) await client.query('ROLLBACK');
    console.error('[ClaimReward] Error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

app.get('/api/wheel/config', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM wheel_prizes ORDER BY id ASC');
    const items = r.rows.map(row => ({
      id: row.id,
      label: row.label,
      color: row.color,
      weight: Number(row.weight),
      itemId: row.item_id // Optional link
    }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin Routes for Wheel
app.get('/api/admin/wheel/config', isAdmin, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM wheel_prizes ORDER BY id ASC');
    const items = r.rows.map(row => ({
      id: row.id,
      label: row.label,
      color: row.color,
      weight: Number(row.weight),
      itemId: row.item_id
    }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- MINING COINS ---
app.get('/api/mining-coins', async (req, res) => {
  const client = await db.connect();
  try {
    const resDb = await client.query('SELECT * FROM mining_coins ORDER BY name ASC');
    client.release();

    const coins = resDb.rows.map(r => {
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
    res.json(coins);
  } catch (e) { if (client) client.release(); res.status(500).json({ error: e.message }); }
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

      const netHash = parseFloat(c.networkHashrate) || 0;
      const blockRew = parseFloat(c.blockReward) || 0;
      const blockTime = parseFloat(c.blockTime) || 60;
      const price = parseFloat(c.priceUSD) || 0;
      const diff = parseFloat(c.difficulty) || 1;
      const mult = parseFloat(c.multiplier) || 1;
      const minProp = parseFloat(c.minProportion) || 0;
      const usdcRate = parseFloat(c.usdcRate) || price; // Default to price equals rate
      const targetDaily = parseFloat(c.targetDailyUSD) || 0; // New Field

      // Check isActive. Frontend sends boolean or 1/0.
      let isActive = 1;
      if (c.isActive === false || c.isActive === 0) isActive = 0;

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
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const normalizedEmail = (email || '').toLowerCase();
    const uRes = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    let u = uRes.rows[0];

    if (!u) {
      await bcrypt.compare(password, '$2b$10$abcdefghijklmnopqrstuvwxyz123456');
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    if (u.is_blocked) return res.status(403).json({ error: 'Este usuário está bloqueado.' });

    if (!u.password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, u.id]);
      u.password = hashedPassword;
    }

    let isMatch = false;
    if (u.password && (u.password.startsWith('$2a$') || u.password.startsWith('$2b$'))) {
      try {
        isMatch = await bcrypt.compare(password, u.password);
      } catch (bcError) {
        console.error('[Login] bcrypt:', bcError.message || bcError);
      }
    } else {
      if (u.password === password) {
        isMatch = true;
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, u.id]);
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciais inválidas (Senha incorreta).' });
    }

    // SINCRONIZAÇÃO E LOG DE IP
    const currentIp = getClientIp(req);

    try {
      if (!u.registration_ip) {
        await db.query('UPDATE users SET registration_ip = $1 WHERE id = $2', [currentIp, u.id]);
        u.registration_ip = currentIp;
      }
      // Registrar no histórico de IPs
      await db.query(`
        INSERT INTO user_history_ips (user_id, ip, last_used_at) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (user_id, ip) DO UPDATE SET last_used_at = $3
      `, [u.id, currentIp, Date.now()]);
    } catch (ipErr) {
      console.error('[Login] Erro ao registrar histórico de IP:', ipErr.message);
      // Não bloqueia o login se falhar apenas o registro de IP
    }

    if (!u.referral_code) {
      let code = generateReferralCode(u.username);
      await db.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, u.id]);
      u.referral_code = code;
    }
    const sid = crypto.randomUUID();
    const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
    await db.query('INSERT INTO sessions (session_id,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)', [sid, u.id, Date.now(), expiresAt]);

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${30 * 24 * 3600}`);
    try {
      await issueJwtAuthCookies(db, res, u.id, req);
    } catch (jwtErr) {
      console.error('[Login] JWT cookies:', jwtErr);
    }

    let adminPerms = null;
    try {
      if (u.admin_permissions) adminPerms = JSON.parse(u.admin_permissions);
    } catch (pe) {
      console.error('[Login] Failed to parse admin_permissions:', pe);
    }
    adminPerms = normalizeAdminPermissionsForApi(!!u.is_admin, adminPerms);

    const userLvlsRes = await db.query('SELECT access_level_id FROM user_access_levels WHERE user_id = $1', [u.id]);
    const userLvlIds = userLvlsRes.rows.map((l) => l.access_level_id);
    if (u.access_level_id && !userLvlIds.includes(u.access_level_id)) {
      userLvlIds.push(u.access_level_id);
    }

    res.json({
      id: String(u.id),
      email: u.email,
      username: u.username,
      isAdmin: !!u.is_admin,
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
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/session', async (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  let isImpersonating = false;
  let targetUserId = req.userId;
  try {
    if (sid) {
      const sRes = await db.query('SELECT user_id, expires_at, original_user_id FROM sessions WHERE session_id = $1', [sid]);
      const s = sRes.rows[0];
      if (s && Number(s.expires_at) >= Date.now()) {
        isImpersonating = !!s.original_user_id;
        if (!targetUserId) targetUserId = s.user_id;
      }
    }
    if (!targetUserId) return res.status(401).json({ error: 'No session', code: 'AUTH_REQUIRED' });

    const uRes = await db.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
    const u = uRes.rows[0];
    if (!u) return res.status(404).json({ error: 'User not found' });

    const userLvlsRes = await db.query('SELECT access_level_id FROM user_access_levels WHERE user_id = $1', [u.id]);
    const userLvlIds = userLvlsRes.rows.map(l => l.access_level_id);
    if (u.access_level_id && !userLvlIds.includes(u.access_level_id)) {
      userLvlIds.push(u.access_level_id);
    }
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
      adminPermissions: adminPerms,
      isBlocked: !!u.is_blocked,
      polygonWallet: u.polygon_wallet,
      accessLevelId: u.access_level_id,
      accessLevelIds: userLvlIds,
      referralCode: u.referral_code,
      referredBy: u.referred_by,
      isImpersonating
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/refresh', async (req, res) => handleJwtRefresh(req, res, db, parseCookies));

app.post('/api/logout', async (req, res) => {
  const sid = parseCookies(req).sid;
  let uid = req.userId;
  try {
    if (!uid && sid) {
      const r = await db.query('SELECT user_id FROM sessions WHERE session_id = $1', [sid]);
      uid = r.rows[0]?.user_id;
    }
    if (uid) await revokeJwtRefreshForUser(db, uid);
    if (sid) await db.query('DELETE FROM sessions WHERE session_id = $1', [sid]);
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
      const sRes = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sid]);
      const s = sRes.rows[0];
      if (!s || Number(s.expires_at) < Date.now()) return res.status(401).json({ error: 'No session', code: 'AUTH_REQUIRED' });
      uid = s.user_id;
    }
    if (!uid) return res.status(401).json({ error: 'No session', code: 'AUTH_REQUIRED' });
    const { polygonWallet, accessLevelId } = req.body;
    if (polygonWallet !== undefined) await db.query('UPDATE users SET polygon_wallet = $1 WHERE id = $2', [polygonWallet, uid]);
    if (accessLevelId !== undefined) {
      await db.query('UPDATE users SET access_level_id = $1 WHERE id = $2', [accessLevelId, uid]);
      await db.query('INSERT INTO user_access_levels (user_id, access_level_id, granted_at) VALUES ($1,$2,$3) ON CONFLICT (user_id, access_level_id) DO NOTHING', [uid, accessLevelId, Date.now()]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/load-game', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Sessão inválida' });

  try {
    const uid = req.userId;
    await computeProgressForUser(db, uid, Date.now());

    // Pegar tudo do DB
    const gsRes = await db.query('SELECT * FROM game_states WHERE user_id = $1', [uid]);
    const stockRes = await db.query('SELECT item_id, qty FROM stock WHERE user_id = $1', [uid]);
    const boxRes = await db.query('SELECT box_id, qty FROM unopened_boxes WHERE user_id = $1', [uid]);
    const batRes = await db.query('SELECT id, item_id, current_charge FROM stored_batteries WHERE user_id = $1', [uid]);
    const rackRes = await db.query('SELECT * FROM placed_racks WHERE user_id = $1', [uid]);
    const coinRes = await db.query('SELECT coin_id, amount FROM coin_balances WHERE user_id = $1', [uid]);
    const workshopRes = await db.query('SELECT * FROM workshop_slots WHERE user_id = $1 ORDER BY slot_index', [uid]);
    const dailyRes = await db.query('SELECT action_key, last_performed_at FROM daily_actions WHERE user_id = $1', [uid]);
    const claimedRes = await db.query('SELECT box_id FROM player_claimed_boxes WHERE user_id = $1', [uid]);
    const userRefRes = await db.query('SELECT referred_by, username FROM users WHERE id = $1', [uid]);
    const u = userRefRes.rows[0];

    const gs = gsRes.rows[0] || { usdc: 0, start_time: Date.now(), claimed_referrals: 0, referral_bonus_claimed: 0, last_updated_at: Date.now() };

    const stock = {};
    stockRes.rows.forEach(r => { stock[r.item_id] = r.qty; });
    const unopenedBoxes = {};
    boxRes.rows.forEach(r => { unopenedBoxes[r.box_id] = r.qty; });
    const storedBatteries = batRes.rows.map(r => ({ id: r.id, itemId: r.item_id, currentCharge: r.current_charge }));

    // Racks e Slots
    const racks = [];
    for (const r of rackRes.rows) {
      const slotsRes = await db.query('SELECT slot_index, machine_item_id FROM rack_slots WHERE rack_id = $1 ORDER BY slot_index', [r.id]);
      const multiRes = await db.query('SELECT slot_index, multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = $1 ORDER BY slot_index', [r.id]);

      // Map to array by index
      const slots = [];
      slotsRes.rows.forEach(s => slots[s.slot_index] = s.machine_item_id);
      const multiplierSlots = [];
      multiRes.rows.forEach(m => multiplierSlots[m.slot_index] = m.multiplier_item_id);

      racks.push({
        id: r.id,
        itemId: r.item_id,
        slots,
        multiplierSlots,
        wiringId: r.wiring_id,
        batteryId: r.battery_id,
        currentCharge: r.current_charge,
        isOn: !!r.is_on,
        selectedCoinId: r.selected_coin_id,
        roomId: normalizePlacedRackRoomId(r.room_id),
        slotIndex: r.slot_index || 0
      });
    }

    const workshopSlots = [null, null, null, null, null, null];
    workshopRes.rows.forEach(w => {
      if (w.slot_index >= 0 && w.slot_index < 6) {
        workshopSlots[w.slot_index] = {
          id: `ws_${uid}_${w.slot_index}`,
          itemId: w.item_id,
          internalSlots: w.internal_state ? JSON.parse(w.internal_state) : {},
          currentCharge: w.current_charge ?? 0,
          slotCharges: w.slot_charges ? JSON.parse(w.slot_charges) : {},
          slotItemIds: w.slot_item_ids ? JSON.parse(w.slot_item_ids) : {}
        };
      }
    });

    const coinBalances = {};
    coinRes.rows.forEach(c => { coinBalances[c.coin_id] = c.amount; });

    const dailyActions = {};
    dailyRes.rows.forEach(r => { dailyActions[r.action_key] = Number(r.last_performed_at); });

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
      claimedBoxes: claimedRes.rows.map(r => r.box_id)
    });


    // Check for missing Referral Reward (Retroactive Fix)
    // If user has referrer but bonus not claimed, grant it now
    if (u && u.referred_by && gs && !gs.referral_bonus_claimed) {
      // Async background fix - don't block response? Or block to ensure consistency?
      // Blocking is safer for UI sync.
      try {
        const receiverBoxes = await db.query("SELECT id FROM loot_boxes WHERE trigger = 'referral_receiver'");
        for (const box of receiverBoxes.rows) {
          await db.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1', [uid, box.id]);
          await db.query('INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [uid, box.id, Date.now()]);
        }
        await db.query('UPDATE game_states SET referral_bonus_claimed = 1 WHERE user_id = $1', [uid]);
        console.log(`[Retro Fix] Granted referral box to ${u.username}`);
      } catch (err) {
        console.error(`[Retro Fix] Failed for user ${uid}:`, err);
      }
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

async function markServerUpdate(uid) {
  try {
    await db.query('UPDATE game_states SET server_updated_at = $1 WHERE user_id = $2', [Date.now(), uid]);
  } catch (e) { console.error('Failed to mark server update', e); }
}

app.put('/api/users/block', isAdmin, async (req, res) => {
  const { email, blocked } = req.body;
  try {
    await db.query('UPDATE users SET is_blocked = $1 WHERE email = $2', [blocked ? 1 : 0, email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/user', async (req, res) => {
  const u = req.body;
  const normalizedEmail = (u.email || '').toLowerCase();
  console.log(`[UserUpdate] Payload received for email: ${normalizedEmail}, userId: ${req.userId}`);
  const client = await db.connect();
  try {
    let uid;
    if (req.userId) {
      // Check if admin
      const uAdminRes = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
      const isAdmin = uAdminRes.rows[0]?.is_admin;

      if (isAdmin) {
        let resolvedAdminTarget = false;
        if (u.id != null && String(u.id).trim() !== '') {
          const idNum = parseInt(String(u.id).trim(), 10);
          if (Number.isFinite(idNum) && idNum > 0) {
            const idRow = await db.query('SELECT id FROM users WHERE id = $1', [idNum]);
            if (idRow.rows[0]) {
              uid = idNum;
              resolvedAdminTarget = true;
            }
          }
        }
        if (!resolvedAdminTarget) {
          if (!normalizedEmail) {
            return res.status(400).json({ error: 'ID ou email do utilizador a editar é obrigatório.' });
          }
          const byEmail = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
          if (!byEmail.rows[0]) {
            return res.status(404).json({ error: 'Utilizador não encontrado para este email. Não foi criada conta nova (evita erros de digitação).' });
          }
          uid = byEmail.rows[0].id;
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
      uid = await getUserIdByEmail(normalizedEmail, req.ip);
    }

    await client.query('BEGIN');

    // Update User
    const hasPassword = typeof u.password === 'string' && u.password.trim().length > 0;
    if (hasPassword) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      await client.query('UPDATE users SET username=$1, email=$2, password=$3, polygon_wallet=$4, access_level_id=$5, referred_by=$6 WHERE id = $7',
        [u.username, normalizedEmail, hashedPassword, u.polygonWallet ?? null, u.accessLevelId ?? null, u.referredBy ?? null, uid]);
    } else {
      await client.query('UPDATE users SET username=$1, email=$2, polygon_wallet=$3, access_level_id=$4, referred_by=$5 WHERE id = $6',
        [u.username, normalizedEmail, u.polygonWallet ?? null, u.accessLevelId ?? null, u.referredBy ?? null, uid]);
    }

    if (u.accessLevelId) {
      await client.query('INSERT INTO user_access_levels (user_id, access_level_id, granted_at) VALUES ($1,$2,$3) ON CONFLICT (user_id, access_level_id) DO NOTHING', [uid, u.accessLevelId, Date.now()]);
    }

    if (Array.isArray(u.accessLevelIds)) {
      // Sincronizar múltiplos níveis
      await client.query('DELETE FROM user_access_levels WHERE user_id = $1', [uid]);
      for (const alid of u.accessLevelIds) {
        await client.query('INSERT INTO user_access_levels (user_id, access_level_id, granted_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [uid, alid, Date.now()]);
      }
      // Garantir que o nível primário esteja incluído se definido
      if (u.accessLevelId) {
        await client.query('INSERT INTO user_access_levels (user_id, access_level_id, granted_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [uid, u.accessLevelId, Date.now()]);
      }
    }

    // Handle Referral
    if (u.referredBy) {
      // Find referrer (Case insensitive)
      const refRes = await client.query('SELECT id, access_level_id FROM users WHERE LOWER(referral_code) = LOWER($1)', [u.referredBy]);
      const ref = refRes.rows[0];

      if (ref && u.username) {
        // PREVENÇÃO DE AUTO-INDICAÇÃO: Verificar IP de registro e histórico
        const referrerRes = await client.query('SELECT registration_ip FROM users WHERE id = $1', [ref.id]);
        const referrerRegIp = referrerRes.rows[0]?.registration_ip;

        // Verificar se o IP atual já foi usado pelo indicador no histórico
        const historyCheck = await client.query('SELECT 1 FROM user_history_ips WHERE user_id = $1 AND ip = $2', [ref.id, req.ip]);

        if ((referrerRegIp && referrerRegIp === req.ip) || historyCheck.rowCount > 0) {
          console.warn(`[Referral] Bloqueada tentativa de auto-indicação. IP ${req.ip} vinculado ao indicador ID: ${ref.id}`);
          throw new Error('Auto-indicação não permitida. Você não pode usar seu próprio código de indicação em contas do mesmo IP.');
        } else {
          // Link referral (Idempotent)
          const refInsert = await client.query('INSERT INTO referrals (user_id, referred_username) VALUES ($1, $2) ON CONFLICT (user_id, referred_username) DO NOTHING', [ref.id, u.username]);

          if (refInsert.rowCount > 0) {
            // Check for Advanced Referral Model
            const alId = ref.access_level_id || 'normal';
            const modelRes = await client.query(`
              SELECT m.* 
              FROM referral_models m
              JOIN access_level_referral_models a ON m.id = a.referral_model_id
              WHERE a.access_level_id = $1 AND m.is_active = 1
            `, [alId]);
            const model = modelRes.rows[0];

            if (model) {
              console.log(`[Referral] Using Advanced Model: ${model.name} for Access Level: ${alId}`);

              // Grant Referrer Rewards
              if (model.sender_reward_usdc > 0) {
                await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [model.sender_reward_usdc, ref.id]);
              }
              if (model.sender_loot_box_id) {
                await client.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1', [ref.id, model.sender_loot_box_id]);
              }

              // Grant Referee Rewards
              if (model.receiver_reward_usdc > 0) {
                await client.query('UPDATE game_states SET usdc = COALESCE(usdc, 0) + $1 WHERE user_id = $2', [model.receiver_reward_usdc, uid]);
              }
              if (model.receiver_loot_box_id) {
                await client.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1', [uid, model.receiver_loot_box_id]);
                await client.query('INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [uid, model.receiver_loot_box_id, Date.now()]);
              }

              await client.query('UPDATE game_states SET claimed_referrals = claimed_referrals + 1 WHERE user_id = $1', [ref.id]);
              await client.query('UPDATE game_states SET referral_bonus_claimed = 1 WHERE user_id = $1', [uid]);

            } else {
              // FALLBACK: Grant Referrer Reward (Sender) - Using triggers
              const senderBoxes = await client.query("SELECT id FROM loot_boxes WHERE trigger = 'referral_sender'");
              for (const box of senderBoxes.rows) {
                await client.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1', [ref.id, box.id]);
              }
              await client.query('UPDATE game_states SET claimed_referrals = claimed_referrals + 1 WHERE user_id = $1', [ref.id]);

              // FALLBACK: Grant Referee Reward (Receiver) - Using triggers
              const gsRes = await client.query('SELECT referral_bonus_claimed FROM game_states WHERE user_id = $1', [uid]);
              if (gsRes.rows[0] && !gsRes.rows[0].referral_bonus_claimed) {
                const receiverBoxes = await client.query("SELECT id FROM loot_boxes WHERE trigger = 'referral_receiver'");
                const now = Date.now();
                for (const box of receiverBoxes.rows) {
                  await client.query('INSERT INTO unopened_boxes (user_id, box_id, qty) VALUES ($1, $2, 1) ON CONFLICT (user_id, box_id) DO UPDATE SET qty = unopened_boxes.qty + 1', [uid, box.id]);
                  await client.query('INSERT INTO player_claimed_boxes (user_id, box_id, claimed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [uid, box.id, now]);
                }
                await client.query('UPDATE game_states SET referral_bonus_claimed = 1 WHERE user_id = $1', [uid]);
              }
            }
          }
        }
      }
    }

    await client.query('COMMIT');
    console.log(`[UserUpdate] Success for uid: ${uid}`);
    res.json({ ok: true });
  } catch (e) {
    if (client) await client.query('ROLLBACK');
    console.error('[UserUpdate] Error:', e);
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
    const errorMessage = e.message || 'Erro interno no servidor durante o registro.';
    res.status(500).json({ error: errorMessage, stack: process.env.NODE_ENV === 'development' ? e.stack : undefined });
  } finally {
    if (client) client.release();
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
    const result = await deleteUserByEmail(req.params.email, null);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

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
    const uRes = await db.query('SELECT * FROM users WHERE id = $1', [uid]);
    const u = uRes.rows[0];
    if (!u) return res.status(404).json({ error: 'User not found' });

    const now = Date.now();
    console.log(`[GameState] Start for ${uid} at ${now}`);
    const t0 = performance.now();

    const progressRes = await computeProgressForUser(db, uid, now, !isAdminEdit);
    const t1 = performance.now();
    console.log(`[GameState] computeProgress took ${(t1 - t0).toFixed(2)}ms`);

    if (!progressRes.ok) {
      const safeMsg = sanitizeApiMessage(progressRes.error, 240);
      console.warn(`[GameState] computeProgress failed uid=${uid}: ${safeMsg}`);
      return res.status(500).json({ error: safeMsg });
    }

    const offlineMined = progressRes.offlineMined || {};

    // OPTIMIZATION: Parallelize independent DB queries
    console.log(`[GameState] Starting Parallel DB Queries...`);
    const [
      gsRes,
      stockRes,
      unopenedBoxesRes,
      storedBatteriesRes,
      placedRacksRes,
      workshopSlotsRes,
      coinBalancesRes,
      dailyActionsRes,
      playerListingsRes,
      claimedBoxesRes
    ] = await Promise.all([
      db.query('SELECT * FROM game_states WHERE user_id = $1', [uid]),
      db.query('SELECT item_id, qty FROM stock WHERE user_id = $1', [uid]),
      db.query('SELECT box_id, qty FROM unopened_boxes WHERE user_id = $1', [uid]),
      db.query('SELECT id, item_id, current_charge FROM stored_batteries WHERE user_id = $1', [uid]),
      db.query('SELECT * FROM placed_racks WHERE user_id = $1', [uid]),
      db.query('SELECT * FROM workshop_slots WHERE user_id = $1 ORDER BY slot_index', [uid]),
      db.query('SELECT coin_id, amount FROM coin_balances WHERE user_id = $1', [uid]),
      db.query('SELECT action_key, last_performed_at FROM daily_actions WHERE user_id = $1', [uid]),
      db.query('SELECT l.*, u.username, u.email FROM player_listings l JOIN users u ON l.user_id = u.id WHERE l.user_id = $1', [uid]),
      db.query('SELECT box_id FROM player_claimed_boxes WHERE user_id = $1', [uid])
    ]);

    const t2 = performance.now();
    console.log(`[GameState] DB Queries took ${(t2 - t1).toFixed(2)}ms`);

    const gs = gsRes.rows[0] || { usdc: 0, start_time: now, claimed_referrals: 0, referral_bonus_claimed: 0, last_updated_at: now, black_market_balance: 0, server_updated_at: 0 };

    const stock = {};
    stockRes.rows.forEach(r => { stock[r.item_id] = r.qty; });

    const unopenedBoxes = {};
    unopenedBoxesRes.rows.forEach(r => { unopenedBoxes[r.box_id] = r.qty; });

    const storedBatteries = storedBatteriesRes.rows.map(r => ({ id: r.id, itemId: r.item_id, currentCharge: r.current_charge }));

    const coinBalances = {};
    coinBalancesRes.rows.forEach(c => { coinBalances[c.coin_id] = c.amount; });

    const dailyActions = {};
    dailyActionsRes.rows.forEach(r => { dailyActions[r.action_key] = Number(r.last_performed_at); });

    const playerListings = playerListingsRes.rows.map(r => {
      const q = Math.max(1, parseInt(String(r.qty ?? 1), 10) || 1);
      const unit = Number(r.price);
      return {
        id: r.id,
        sellerName: r.username || r.email,
        itemId: r.item_id,
        price: unit,
        lineTotal: unit * q,
        expiresAt: r.expires_at,
        isPlayer: !!r.is_player,
        qty: q,
        status: r.status
      };
    });

    const claimedBoxes = claimedBoxesRes.rows.map(r => r.box_id);

    // OPTIMIZATION: Bulk fetch rack slots to avoid N+1 problem
    const placedRacks = [];
    const rackRows = placedRacksRes.rows;
    if (rackRows.length > 0) {
      const rackIds = rackRows.map(r => r.id);

      const [slotsRes, multipliersRes] = await Promise.all([
        db.query('SELECT rack_id, slot_index, machine_item_id FROM rack_slots WHERE rack_id = ANY($1) ORDER BY slot_index', [rackIds]),
        db.query('SELECT rack_id, slot_index, multiplier_item_id FROM rack_multiplier_slots WHERE rack_id = ANY($1) ORDER BY slot_index', [rackIds])
      ]);

      const slotsMap = new Map();
      const multipliersMap = new Map();

      slotsRes.rows.forEach(s => {
        if (!slotsMap.has(s.rack_id)) slotsMap.set(s.rack_id, []);
        slotsMap.get(s.rack_id)[s.slot_index] = s.machine_item_id;
      });

      multipliersRes.rows.forEach(m => {
        if (!multipliersMap.has(m.rack_id)) multipliersMap.set(m.rack_id, []);
        multipliersMap.get(m.rack_id)[m.slot_index] = m.multiplier_item_id;
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
          roomId: normalizePlacedRackRoomId(r.room_id),
          slotIndex: r.slot_index || 0
        });
      }
    }

    const workshopSlots = [null, null, null, null, null, null];
    workshopSlotsRes.rows.forEach(w => {
      if (w.slot_index >= 0 && w.slot_index < 6) {
        workshopSlots[w.slot_index] = {
          id: `ws_${uid}_${w.slot_index}`,
          itemId: w.item_id,
          internalSlots: w.internal_state ? JSON.parse(w.internal_state) : {},
          currentCharge: w.current_charge ?? 0,
          slotCharges: w.slot_charges ? JSON.parse(w.slot_charges) : {},
          slotItemIds: w.slot_item_ids ? JSON.parse(w.slot_item_ids) : {},
          installedAt: Number(w.installed_at || 0)
        };
      }
    });

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

    res.json({
      usdc: gs.usdc,
      startTime: Number(gs.start_time),
      lastUpdatedAt: Number(gs.last_updated_at),
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
      serverUpdatedAt: gs.server_updated_at || 0,
      offlineMined
    });
    const t3 = performance.now();
    console.log(`[GameState] Total processing took ${(t3 - t0).toFixed(2)}ms`);
  } catch (e) {
    const safe = sanitizeApiMessage(e instanceof Error ? e.message : String(e), 240);
    console.error(`[GameState] Error: ${safe}`);
    res.status(500).json({ error: safe });
  }
});

const RACK_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

async function validatePlacedRacksForSave(dbq, racks) {
  if (!Array.isArray(racks)) return { ok: false, error: 'placedRacks inválido.' };
  if (racks.length > 350) return { ok: false, error: 'Número de rigs excede o permitido.' };
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
    if (r.batteryId && !RACK_ID_RE.test(String(r.batteryId))) return { ok: false, error: 'Bateria inválida.' };
    if (r.slots != null && !Array.isArray(r.slots)) return { ok: false, error: 'Slots inválidos.' };
    if (r.slots && r.slots.length > 128) return { ok: false, error: 'Demasiados slots de máquina.' };
    if (r.multiplierSlots != null && !Array.isArray(r.multiplierSlots)) return { ok: false, error: 'Slots de multiplicador inválidos.' };
    if (r.multiplierSlots && r.multiplierSlots.length > 64) return { ok: false, error: 'Demasiados multiplicadores.' };
    if (r.itemId) upgradeIds.add(String(r.itemId));
    if (r.wiringId) upgradeIds.add(String(r.wiringId));
    if (r.batteryId) upgradeIds.add(String(r.batteryId));
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
    const chk = await dbq.query('SELECT id FROM upgrades WHERE id = ANY($1::text[])', [[...upgradeIds]]);
    if (chk.rowCount !== upgradeIds.size) {
      const have = new Set(chk.rows.map((x) => x.id));
      const missing = [...upgradeIds].filter((id) => !have.has(id));
      return { ok: false, error: `Item desconhecido no equipamento: ${missing.slice(0, 4).join(', ')}` };
    }
  }
  if (coinIds.size > 0) {
    const cres = await dbq.query('SELECT id FROM mining_coins WHERE id = ANY($1::text[])', [[...coinIds]]);
    if (cres.rowCount !== coinIds.size) {
      return { ok: false, error: 'Moeda inválida numa rig.' };
    }
  }
  return { ok: true };
}

app.post('/api/save-game', async (req, res) => {
  const { changes, adminOverride, targetEmail } = req.body;
  if (!req.userId || !changes) return res.status(400).json({ error: 'Missing fields' });
  const client = await db.connect();
  try {
    let uid = req.userId;
    const saveActivityLogs = [];

    // Security: Only allow adminOverride if user is actually admin
    let effectiveAdminOverride = false;
    if (adminOverride) {
      const uAdminRes = await client.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
      if (uAdminRes.rows[0]?.is_admin) {
        effectiveAdminOverride = true;
        // If admin provided a targetEmail, switch context to that user
        if (targetEmail) {
          const tUserRes = await client.query('SELECT id FROM users WHERE email = $1', [targetEmail]);
          if (tUserRes.rows[0]) {
            uid = tUserRes.rows[0].id;
          }
        }
      }
    }

    await client.query('BEGIN');
    await client.query("SET statement_timeout = '20s'");

    // LOCK ORDER FIX: Always lock the primary user record first to avoid deadlocks
    await client.query('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', [uid]);

    // Re-read revision *inside* the transaction so stock-affecting APIs (ex.: cancelar
    // listagem P2P) cannot be overwritten by a save whose optimistic check ran before
    // they committed.
    const dbGsRes = await client.query('SELECT server_updated_at FROM game_states WHERE user_id = $1', [uid]);
    const dbServerUpdatedAt = Number(dbGsRes.rows[0]?.server_updated_at || 0);
    if (!effectiveAdminOverride && changes.lastLoadTime && dbServerUpdatedAt > Number(changes.lastLoadTime)) {
      await client.query('ROLLBACK');
      return res.json({ forceReload: true });
    }

    let nftAutoSanitized = false;
    if (changes.placedRacks) {
      if (!Array.isArray(changes.placedRacks)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'placedRacks inválido.' });
      }
      // [] é truthy: evita apagar todas as rigs quando o cliente envia estado incompleto.
      if (!effectiveAdminOverride && changes.placedRacks.length === 0) {
        const prCountRes = await client.query('SELECT COUNT(*)::int AS c FROM placed_racks WHERE user_id = $1', [uid]);
        const prCount = Number(prCountRes.rows[0]?.c ?? 0);
        if (prCount > 0) {
          console.warn(`[SaveGame] Rejeitado placedRacks vazio (servidor tem ${prCount} rig(s)) userId=${uid}`);
          await client.query('ROLLBACK');
          return res.status(409).json({
            error:
              'O estado enviado não inclui nenhuma rig, mas o servidor ainda guarda o teu equipamento. Recarrega a página (F5) para sincronizar.',
            forceReload: true,
          });
        }
      }
      nftAutoSanitized = await sanitizePlacedRacksNftAutoRoom(client, uid, changes, saveActivityLogs);
      const rackVal = await validatePlacedRacksForSave(client, changes.placedRacks);
      if (!rackVal.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: rackVal.error });
      }
    }

    // ---------------------------------


    const gs = changes.gameState || changes;
    const finalServerUpdatedAt = Date.now();
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
          await client.query('ROLLBACK');
          return res.status(400).json({
            error:
              'O formato dos dados diários (oficina) está incorrecto. Recarregue a página (F5).'
          });
        }
        const dv = validateDailyActionsForSave(gs.dailyActions, effectiveAdminOverride, Date.now());
        if (!dv.ok) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: dv.error });
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
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'O inventário foi enviado num formato inválido. Recarregue a página (F5).'
        });
      }
      const sv = await validateStockForSave(client, changes.stock);
      if (!sv.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: sv.error });
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
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'A lista de caixas foi enviada num formato inválido. Recarregue a página (F5).'
        });
      }
      const bv = await validateUnopenedBoxesForSave(client, changes.unopenedBoxes);
      if (!bv.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: bv.error });
      }
      if (bv.boxIds.length > 0) {
        await client.query(`
          INSERT INTO unopened_boxes (user_id, box_id, qty) 
          SELECT $1, unnest($2::text[]), unnest($3::int[])
          ON CONFLICT (user_id, box_id) DO UPDATE SET qty = EXCLUDED.qty`,
          [uid, bv.boxIds, bv.qtys]);
      }
    }

    if (changes.storedBatteries) {
      if (!Array.isArray(changes.storedBatteries)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'O armazém de baterias foi enviado num formato inválido. Recarregue a página (F5).'
        });
      }
      const batVal = await validateStoredBatteriesForSave(client, uid, changes.storedBatteries);
      if (!batVal.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: batVal.error });
      }
      // Nota: [] é válido quando todas as instâncias sairam do armazém (rigs/carregadores).
      const incomingIds = changes.storedBatteries.map(b => b.id);
      if (incomingIds.length > 0) {
        await client.query('DELETE FROM stored_batteries WHERE user_id = $1 AND NOT (id = ANY($2::text[]))', [uid, incomingIds]);
      } else {
        await client.query('DELETE FROM stored_batteries WHERE user_id = $1', [uid]);
      }
      if (changes.storedBatteries.length > 0) {
        const bIds = changes.storedBatteries.map(b => b.id);
        const bItemIds = changes.storedBatteries.map(b => b.itemId);
        const bCharges = changes.storedBatteries.map(b => b.currentCharge || 0);
        await client.query(`
          INSERT INTO stored_batteries (id, user_id, item_id, current_charge) 
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::numeric[])
          ON CONFLICT (id) DO UPDATE SET current_charge = EXCLUDED.current_charge, item_id = EXCLUDED.item_id`,
          [uid, bIds, bItemIds, bCharges]);
      }
    }

    if (changes.placedRacks) {
      const ts = new Date().toISOString();
      const prevRacksRes = await client.query(
        `SELECT id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id,
                COALESCE(NULLIF(BTRIM(room_id::text), ''), 'room_initial') AS room_id, slot_index
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
        const rIds = changes.placedRacks.map(r => r.id);
        const rItems = changes.placedRacks.map(r => r.itemId);
        const rWirings = changes.placedRacks.map(r => r.wiringId || null);
        const rBatteries = changes.placedRacks.map(r => r.batteryId || null);
        const rCharges = changes.placedRacks.map(r => r.currentCharge || 0);
        const rOns = changes.placedRacks.map(r => r.isOn ? 1 : 0);
        const rCoins = changes.placedRacks.map(r => r.selectedCoinId || null);
        const rRooms = changes.placedRacks.map((r) => normalizePlacedRackRoomId(r.roomId));
        const rSlotIdxs = changes.placedRacks.map(r => r.slotIndex || 0);

        await client.query(`
          INSERT INTO placed_racks (id, user_id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id, room_id, slot_index)
          SELECT unnest($2::text[]), $1, unnest($3::text[]), unnest($4::text[]), unnest($5::text[]), unnest($6::numeric[]), unnest($7::int[]), unnest($8::text[]), unnest($9::text[]), unnest($10::int[])
          ON CONFLICT (id) DO UPDATE SET
            item_id = EXCLUDED.item_id, wiring_id = EXCLUDED.wiring_id, battery_id = EXCLUDED.battery_id,
            current_charge = EXCLUDED.current_charge, is_on = EXCLUDED.is_on, selected_coin_id = EXCLUDED.selected_coin_id,
            room_id = EXCLUDED.room_id, slot_index = EXCLUDED.slot_index`,
          [uid, rIds, rItems, rWirings, rBatteries, rCharges, rOns, rCoins, rRooms, rSlotIdxs]);

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
        await client.query('ROLLBACK');
        return res.status(400).json({ error: wVal.error });
      }
      const workshopNorm = wVal.normalized;

      const existingSlotsRes = await client.query(
        'SELECT slot_index, item_id, installed_at, current_charge, slot_charges FROM workshop_slots WHERE user_id = $1',
        [uid]
      );
      const existingSlots: Record<number, Record<string, unknown>> = {};
      existingSlotsRes.rows.forEach((r) => {
        existingSlots[r.slot_index] = r;
      });

      const workshopItemIds = workshopNorm.map((w) => w?.itemId).filter(Boolean);
      const slotRefIds: string[] = [];
      for (const w of workshopNorm) {
        if (w?.slotItemIds) slotRefIds.push(...Object.values(w.slotItemIds));
      }
      const existingItemIds = Object.values(existingSlots)
        .map((s) => s.item_id)
        .filter((id) => !!id);
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

          const isNewOrChanged =
            !existing || !existing.item_id || String(existing.item_id) !== String(w.itemId);

          let finalCharge = w.currentCharge || 0;
          let finalSlotCharges: Record<string, number> = w.slotCharges ? { ...w.slotCharges } : {};
          let internalPayload =
            w.internalSlots && Object.keys(w.internalSlots).length ? { ...w.internalSlots } : {};
          let slotItemIdsPayload: Record<string, string> | null =
            w.slotItemIds && Object.keys(w.slotItemIds).length ? { ...w.slotItemIds } : null;
          let validInstalledAt = Date.now();

          if (isNewOrChanged) {
            console.log(`[WorkshopPlace] ts=${new Date().toISOString()} userId=${uid} slotIndex=${i} itemId=${w.itemId}`);
            saveActivityLogs.push({ action: 'workshop_place', meta: { slotIndex: i, itemId: w.itemId } });
            if (!effectiveAdminOverride) {
              finalCharge = 0;
              finalSlotCharges = {};
              internalPayload = {};
              slotItemIdsPayload = null;
            }
          } else if (existing && existing.item_id === w.itemId) {
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
    let nftAutoSyncPayload = null;
    if (nftAutoSanitized && changes.placedRacks) {
      const stockRows = await client.query('SELECT item_id, qty FROM stock WHERE user_id = $1', [uid]);
      const stockObj = {};
      stockRows.rows.forEach((r) => {
        stockObj[r.item_id] = r.qty;
      });
      const batRows = await client.query('SELECT id, item_id, current_charge FROM stored_batteries WHERE user_id = $1', [uid]);
      const bats = batRows.rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        currentCharge: Number(r.current_charge) || 0
      }));
      nftAutoSyncPayload = { placedRacks: changes.placedRacks, stock: stockObj, storedBatteries: bats };
    }
    await client.query('COMMIT');
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
    await client.query('ROLLBACK');
    const err = e as { workshopClientError?: boolean; message?: string };
    if (err && err.workshopClientError && typeof err.message === 'string') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[SaveGame] CRITICAL ERROR:', e);
    res.status(500).json({ error: (e as Error)?.message || 'Erro ao guardar.' });
  } finally { client.release(); }
});

// --- BACKUP SETTINGS API ---
app.get('/api/admin/backup-settings', isAdmin, async (req, res) => {
  try {
    const enabledRes = await db.query("SELECT value FROM settings WHERE key = 'auto_backup_enabled'");
    const intervalRes = await db.query("SELECT value FROM settings WHERE key = 'auto_backup_interval'");

    res.json({
      enabled: enabledRes.rows[0]?.value === '1' || enabledRes.rows[0]?.value === 'true',
      intervalMinutes: parseInt(intervalRes.rows[0]?.value || '60')
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/backup-settings', isAdmin, async (req, res) => {
  const { enabled, intervalMinutes } = req.body;
  try {
    await db.query("INSERT INTO settings (key, value) VALUES ('auto_backup_enabled', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [enabled ? 'true' : 'false']);
    await db.query("INSERT INTO settings (key, value) VALUES ('auto_backup_interval', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(intervalMinutes)]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start scheduler (give DB a moment to be ready if needed, though db.query usually handles pool)
setTimeout(async () => {
  // Only run background tasks on the designated worker
  if (WORKER_ROLE === 'BACKGROUND' || WORKER_ROLE === 'ALL') {
    startScheduledSqlBackups(backupModel);
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ ok: false, error: 'Erro no fluxo: ' + e.message, report });
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/stop-impersonate', async (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  try {
    const sRes = await db.query('SELECT original_user_id FROM sessions WHERE session_id = $1', [sid]);
    const originalUid = sRes.rows[0]?.original_user_id;
    if (!originalUid) return res.status(400).json({ error: 'Not impersonating' });
    await db.query('UPDATE sessions SET user_id = $1, original_user_id = NULL WHERE session_id = $2', [originalUid, sid]);
    await issueJwtAuthCookies(db, res, originalUid, req);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/top-deposits', async (req, res) => {
  try {
    const resRows = await db.query('SELECT u.username, u.email, COALESCE(gs.total_usdc_deposited, 0) AS total FROM game_states gs JOIN users u ON u.id = gs.user_id ORDER BY total DESC LIMIT 10');
    res.json(resRows.rows.map(r => ({ username: r.username, email: r.email, totalUsdcDeposited: r.total })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/top-withdrawals', async (req, res) => {
  try {
    const resRows = await db.query('SELECT u.username, u.email, COALESCE(gs.total_crypto_withdrawn, 0) AS total FROM game_states gs JOIN users u ON u.id = gs.user_id ORDER BY total DESC LIMIT 10');
    res.json(resRows.rows.map(r => ({ username: r.username, email: r.email, totalCryptoWithdrawn: r.total })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/economy-stats', isAdmin, async (req, res) => {
  try {
    const realNetworkHashrates = Object.fromEntries(miningRuntimeStats.globalNetworkHashrates);
    const activeMinersByCoin = Object.fromEntries(miningRuntimeStats.globalActiveMinersByCoin);

    res.json({
      realActiveMiners: miningRuntimeStats.globalActiveMiners,
      realNetworkHashrates,
      activeMinersByCoin
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

    // 5. IP Blacklist
    const blacklistRes = await client.query(`
      SELECT * FROM ip_blacklist 
      ORDER BY added_at DESC
    `);

    res.json({
      multiAccounts: multiAccountsRes.rows,
      historyMultiAccounts: historyMultiAccountsRes.rows,
      suspectedAutoReferrals: suspectedAutoRefsRes.rows,
      accessLogs: accessLogsRes.rows,
      blacklist: blacklistRes.rows
    });
  } catch (e) {
    console.error('Security Stats Error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/admin/security/blacklist', isAdmin, async (req, res) => {
  const { ip, reason } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP requerido' });
  try {
    await db.query('INSERT INTO ip_blacklist (ip, reason, added_at) VALUES ($1, $2, $3) ON CONFLICT (ip) DO UPDATE SET reason = $2', [ip, reason || 'Banned by Admin', Date.now()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/security/blacklist/:ip', isAdmin, async (req, res) => {
  const { ip } = req.params;
  try {
    await db.query('DELETE FROM ip_blacklist WHERE ip = $1', [ip]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/user-activity', isAdmin, async (req, res) => {
  try {
    const rawQ = String(req.query.email || req.query.q || '').trim().toLowerCase();
    const uidParsed = parseInt(String(req.query.userId || ''), 10);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '80'), 10) || 80));

    let uid = null;
    if (rawQ) {
      const u = await db.query(
        `SELECT id FROM users
         WHERE lower(trim(email::text)) = $1 OR lower(trim(username::text)) = $1`,
        [rawQ]
      );
      if (!u.rows[0]) {
        return res.status(404).json({ error: 'Utilizador não encontrado (email ou username).' });
      }
      uid = u.rows[0].id;
    } else if (Number.isFinite(uidParsed) && uidParsed > 0) {
      uid = uidParsed;
    } else {
      return res.status(400).json({ error: 'Indique email, username ou userId válido' });
    }

    const rows = await db.query(
      `SELECT id, action, meta, created_at FROM game_activity_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [uid, limit]
    );
    res.json({
      logs: rows.rows.map((r) => ({
        id: Number(r.id),
        action: r.action,
        meta: r.meta,
        createdAt: Number(r.created_at)
      }))
    });
  } catch (e) {
    console.error('[AdminUserActivity]', e);
    res.status(500).json({ error: 'Falha ao carregar atividade' });
  }
});


// --- ADMIN MARKET ---
app.get('/api/admin/market/listings', isAdmin, async (req, res) => {
  try {
    const resRows = await db.query('SELECT l.*, u.username, u.email FROM player_listings l JOIN users u ON l.user_id = u.id ORDER BY l.status, l.item_id');
    res.json(resRows.rows.map((l) => {
      const q = Math.max(1, parseInt(String(l.qty ?? 1), 10) || 1);
      const unit = Number(l.price);
      return {
        id: l.id,
        sellerId: l.user_id,
        sellerName: l.username || l.email,
        itemId: l.item_id,
        price: unit,
        qty: q,
        lineTotal: unit * q,
        status: l.status,
        expiresAt: Number(l.expires_at),
        reservedBy: l.reserved_by,
        reservedUntil: l.reserved_until != null ? Number(l.reserved_until) : undefined
      };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
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
        redemptionsCount: parseInt(redsRes.rows[0].count),
        lastRedemptions: lastRedsRes.rows.map(r => ({ userName: r.user_name, redeemedAt: Number(r.redeemed_at) }))
      };
    }));
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/promo-codes', isAdmin, async (req, res) => {
  const { code, lootBoxId, upgradeId, adminUpgradeId, type } = req.body || {};
  if (!code || (!lootBoxId && !upgradeId && !adminUpgradeId)) return res.status(400).json({ error: 'Faltam campos (é necessário uma caixa, um upgrade ou um pacote)' });
  try {
    await db.query('INSERT INTO promo_codes (code, loot_box_id, upgrade_id, admin_upgrade_id, type, is_active, created_at) VALUES ($1,$2,$3,$4,$5,1,$6) ON CONFLICT (code) DO UPDATE SET loot_box_id = $2, upgrade_id = $3, admin_upgrade_id = $4, type = $5',
      [code, lootBoxId || null, upgradeId || null, adminUpgradeId || null, type || 'per_player', Date.now()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/promo-codes/:code', isAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    await db.query('DELETE FROM promo_code_redemptions WHERE code = $1', [code]);
    await db.query('DELETE FROM promo_codes WHERE code = $1', [code]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/promo-codes/:code/toggle', isAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const { isActive } = req.body;
    await db.query('UPDATE promo_codes SET is_active = $1 WHERE code = $2', [isActive ? 1 : 0, code]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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

    // Map DB fields to Frontend fields (snake_case to camelCase)
    const coins = r.rows.map(c => ({
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
    res.json(coins);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
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
    const blockReward = Math.max(0, parseMiningNumeric(c.blockReward, 0));
    const blockTime = (() => {
      const t = parseMiningNumeric(c.blockTime, 60);
      return t > 0 ? t : 60;
    })();
    const priceUSD = (() => {
      const p = parseMiningNumeric(c.priceUSD, NaN);
      return Number.isFinite(p) && p >= 0 ? p : 1;
    })();
    const difficulty = Math.max(1, parseMiningNumeric(c.difficulty, 1));
    const multiplier = Math.max(1, parseMiningNumeric(c.multiplier, 1));
    const minProportion = Math.max(0, parseMiningNumeric(c.minProportion, 0));
    const targetDailyUSD = Math.max(0, parseMiningNumeric(c.targetDailyUSD, 0));

    let prevEmission = null;
    try {
      const prevRes = await db.query(
        'SELECT block_reward, block_time, network_hashrate FROM mining_coins WHERE id = $1',
        [id]
      );
      prevEmission = prevRes.rows[0] || null;
    } catch {
      prevEmission = null;
    }

    await db.query(`
      INSERT INTO mining_coins(
    id, name, symbol, network_hashrate, block_reward, block_time,
    price_usd, algorithm, difficulty, multiplier, color,
    description, min_proportion, is_active, usdc_rate, show_in_exchange, target_daily_usd
  ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT(id) DO UPDATE SET
name = EXCLUDED.name, symbol = EXCLUDED.symbol, network_hashrate = EXCLUDED.network_hashrate,
  block_reward = EXCLUDED.block_reward, block_time = EXCLUDED.block_time, price_usd = EXCLUDED.price_usd,
  algorithm = EXCLUDED.algorithm, difficulty = EXCLUDED.difficulty, multiplier = EXCLUDED.multiplier,
  color = EXCLUDED.color, description = EXCLUDED.description, min_proportion = EXCLUDED.min_proportion,
  is_active = EXCLUDED.is_active, usdc_rate = EXCLUDED.usdc_rate, show_in_exchange = EXCLUDED.show_in_exchange,
  target_daily_usd = EXCLUDED.target_daily_usd
    `, [
      id, c.name, c.symbol, networkHashrate, blockReward, blockTime,
      priceUSD, c.algorithm || '', difficulty, multiplier, c.color || '#ffffff',
      c.description || '', minProportion, (c.isActive === false || c.isActive === 0) ? 0 : 1, priceUSD,
      c.showInExchange ? 1 : 0, targetDailyUSD
    ]);

    // --- YIELD HISTORY RECORDING ---
    // Só gravar nova linha quando a emissão técnica (reward / tempo / rede) muda. Mudar só preço/USDC
    // não altera yield_per_hash; inserir linha extra fazia o integrador usar a taxa errada no intervalo.
    const EPS = 1e-14;
    const emissionChanged =
      !prevEmission ||
      Math.abs(Number(prevEmission.block_reward) - blockReward) > EPS ||
      Math.abs(Number(prevEmission.block_time) - blockTime) > EPS ||
      Math.abs(Number(prevEmission.network_hashrate) - networkHashrate) > EPS;

    if (emissionChanged) {
      const realNetHash = Number(miningRuntimeStats.globalNetworkHashrates.get(String(id)) || 0);
      const floorHash = networkHashrate > 0 ? networkHashrate : 1;
      const effectiveHashrate = Math.max(realNetHash, floorHash);
      const rewardPerSec = blockTime > 0 ? blockReward / blockTime : 0;
      let yieldPerHash = 0;
      if (effectiveHashrate > 0 && Number.isFinite(rewardPerSec)) {
        yieldPerHash = rewardPerSec / effectiveHashrate;
      }

      await db.query(
        'INSERT INTO mining_yield_history (coin_id, yield_per_hash, block_reward, network_hashrate, effective_at) VALUES ($1, $2, $3, $4, $5)',
        [id, yieldPerHash, blockReward, networkHashrate, Date.now()]
      );
    }
    // -------------------------------

    res.json({ ok: true, id });
  } catch (e) {
    console.error('Failed to save mining coin:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/mining/coins/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM mining_coins WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


/** Redefinição por email: envia link sem exigir carteira (resposta uniforme para não enumerar contas). */
app.post('/api/request-password-reset', passwordResetRequestLimiter, async (req, res) => {
  const raw = req.body && req.body.email != null ? String(req.body.email).trim() : '';
  const genericOk = {
    ok: true,
    message: 'Se existir uma conta com este email, enviámos um link para redefinir a senha.'
  };
  if (!raw || raw.length > 254) {
    return res.status(400).json({ error: 'Indique um email válido.' });
  }
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRx.test(raw)) {
    return res.status(400).json({ error: 'Indique um email válido.' });
  }
  try {
    const r = await db.query('SELECT email FROM users WHERE lower(email) = lower($1)', [raw]);
    if (r.rows.length === 0) {
      return res.json(genericOk);
    }
    const email = r.rows[0].email;
    const timestamp = Date.now();
    const resetPayload = JSON.stringify({ email, expiry: timestamp + 60 * 60 * 1000 });
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(resetPayload).digest('hex');
    const resetToken = Buffer.from(resetPayload).toString('base64') + '.' + signature;

    await sendResetEmail(email, resetToken, { validityMinutes: 60 });
    return res.json(genericOk);
  } catch (e) {
    console.error('[request-password-reset]', e.message || e);
    return res.json(genericOk);
  }
});

// PASSWORD RECOVERY BY WALLET (legado; o fluxo principal é por email)
app.post('/api/verify-recovery-wallet', async (req, res) => {
  const { email, walletAddress } = req.body;
  if (!email || !walletAddress) return res.status(400).json({ error: 'Dados incompletos' });

  try {
    const r = await db.query('SELECT username, polygon_wallet FROM users WHERE email = $1', [email]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Email não encontrado.' });

    const user = r.rows[0];
    const storedWallet = user.polygon_wallet;

    if (!storedWallet) {
      return res.status(403).json({ error: 'Esta conta não possui uma carteira vinculada para recuperação.' });
    }

    // Case-insensitive comparison
    if (storedWallet.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(403).json({ error: 'A carteira informada não corresponde à carteira vinculada a esta conta.' });
    }

    // Success - Generate simple temporary token
    const timestamp = Date.now();
    const resetPayload = JSON.stringify({ email, walletAddress, expiry: timestamp + 600000 }); // 10 mins
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(resetPayload).digest('hex');
    const resetToken = Buffer.from(resetPayload).toString('base64') + '.' + signature;

    res.json({ ok: true, resetToken });

    sendResetEmail(email, resetToken, { validityMinutes: 10 }).catch(err => {
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
  if (newPassword.length < 4) return res.status(400).json({ error: 'Senha muito curta' });

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
    const minRes = await db.query('SELECT value FROM settings WHERE key = $1', ['exchange_min_usdc']);
    const feeRes = await db.query('SELECT value FROM settings WHERE key = $1', ['exchange_fee_percent']);

    const min = (minRes.rows.length > 0 && minRes.rows[0].value !== null) ? Number(minRes.rows[0].value) : 0.1;
    const fee = (feeRes.rows.length > 0 && feeRes.rows[0].value !== null) ? Number(feeRes.rows[0].value) : 0;

    console.log('[API] GET Exchange Settings:', { min, fee }); // DEBUG LOG
    res.set('Cache-Control', 'no-store');
    res.json({
      minExchangeAmount: min,
      exchangeFeePercent: fee
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/exchange-settings', isAdmin, async (req, res) => {
  const { minExchangeAmount, exchangeFeePercent } = req.body;

  const min = Math.max(0, Number(minExchangeAmount) || 0);
  const fee = Math.max(0, Math.min(100, Number(exchangeFeePercent) || 0));

  try {
    const client = await db.connect();
    try {
      console.log('[API] Saving Exchange Settings:', { min, fee }); // DEBUG LOG
      await client.query('BEGIN');
      await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['exchange_min_usdc', String(min)]);
      await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['exchange_fee_percent', String(fee)]);
      await client.query('COMMIT');
      console.log('[API] Exchange Settings Saved Successfully'); // DEBUG LOG
      res.json({ ok: true });
    } catch (e) {
      console.error('[API] Exchange Settings Save Error:', e); // DEBUG LOG
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
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

  const client = await db.connect();
  try {
    const uid = req.userId;

    const minRes = await client.query('SELECT value FROM settings WHERE key = $1', ['exchange_min_usdc']);
    const feeRes = await client.query('SELECT value FROM settings WHERE key = $1', ['exchange_fee_percent']);
    const minUsdc = Math.max(0, Number(minRes.rows[0]?.value)) || 0.1;
    const feePercent = Math.max(0, Math.min(100, Number(feeRes.rows[0]?.value) || 0));

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
    const settingsRes = await client.query("SELECT value FROM settings WHERE key = 'web3_withdraw_tokens'");
    let withdrawTokens = [];
    try {
      const rawVal = settingsRes.rows[0]?.value;
      withdrawTokens = rawVal ? (typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal) : [];
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});



// --- NEW RANKING & STATS SYSTEM ---
let isCalculatingRanking = false;

const calculateHashratesAndRanking = async () => {
  if (isCalculatingRanking) {
    console.log('[Mining] Ranking calculation skipped (already running).');
    return;
  }
  isCalculatingRanking = true;
  const start = Date.now();

  const client = await db.connect();
  try {
    // ... (rest of the function remains the same, just wrapping try/finally)
    const activeRes = await client.query(`
      SELECT pr.selected_coin_id, pr.id, pr.user_id, pr.battery_id, pr.current_charge, u.username
      FROM placed_racks pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.is_on = 1 
      AND pr.wiring_id IS NOT NULL 
      AND pr.battery_id IS NOT NULL
      AND u.is_blocked = 0
      AND u.ranking_excluded = 0
  `);

    // Fetch Upgrades
    const upsRes = await client.query('SELECT id, base_production, multiplier, power_capacity FROM upgrades');
    const upsMap = new Map();
    upsRes.rows.forEach(u => upsMap.set(u.id, u));

    // Slots & Multipliers
    const slotRes = await client.query('SELECT rack_id, machine_item_id FROM rack_slots');
    const slotsMap = {};
    slotRes.rows.forEach(s => {
      if (!slotsMap[s.rack_id]) slotsMap[s.rack_id] = [];
      slotsMap[s.rack_id].push(s.machine_item_id);
    });

    const multiRes = await client.query('SELECT rack_id, multiplier_item_id FROM rack_multiplier_slots');
    const multiMap = {};
    multiRes.rows.forEach(m => {
      if (!multiMap[m.rack_id]) multiMap[m.rack_id] = [];
      multiMap[m.rack_id].push(m.multiplier_item_id);
    });

    const coinTotals = {}; // CoinID -> Total Power
    const userStats = new Map(); // UserId -> UStat

    // Process Racks
    for (const rack of activeRes.rows) {
      const cid = String(rack.selected_coin_id);
      if (!cid) continue;

      const batt = upsMap.get(rack.battery_id);
      const isInfinite = batt && batt.power_capacity === -1;

      // CONSISTENCY FIX: If user wants Ranking Logic, we must align with how ranking is usually displayed.
      // Usually ranking shows TOTAL RAW POWER regardless of battery?
      // But for "Active Miners", they must be mining. So charge > 0 makes sense.
      // The user log showed 425 miners. My previous logic showed 425.
      // The issue was frontend getting 0.
      if (!isInfinite && rack.current_charge <= 0.001) continue;

      let base = 0;
      (slotsMap[rack.id] || []).forEach(mid => {
        const u = upsMap.get(mid);
        if (u) base += (u.base_production || 0);
      });
      if (base <= 0) continue;

      let mult = 1;
      (multiMap[rack.id] || []).forEach(mid => {
        const u = upsMap.get(mid);
        if (u) mult += (u.multiplier || 0);
      });

      const power = base * mult;
      coinTotals[cid] = (coinTotals[cid] || 0) + power;

      if (!userStats.has(rack.user_id)) {
        userStats.set(rack.user_id, {
          user_id: rack.user_id,
          username: rack.username,
          coins: {}
        });
      }
      const uStat = userStats.get(rack.user_id);
      uStat.coins[cid] = (uStat.coins[cid] || 0) + power;
    }

    // Build Ranking & Counts
    const activeMinersByCoin = {};
    let totalActiveUsers = 0;
    const rankingList = [];

    userStats.forEach(u => {
      const userCoins = Object.keys(u.coins);
      if (userCoins.length > 0) {
        totalActiveUsers++;
        rankingList.push({
          ...u,
          totalPower: Object.values(u.coins).reduce((a, b) => Number(a) + Number(b), 0)
        });
        userCoins.forEach(cid => {
          if (u.coins[cid] > 0) {
            activeMinersByCoin[cid] = (activeMinersByCoin[cid] || 0) + 1;
          }
        });
      }
    });

    // Sort Ranking
    rankingList.sort((a, b) => b.totalPower - a.totalPower);

    // Update Global State (New)
    const newState = {
      hashrates: coinTotals,
      activeMiners: totalActiveUsers,
      activeMinersByCoin: activeMinersByCoin,
      ranking: rankingList
    };
    globalNetworkStats = newState;

    // Persist to DB for other workers (Critical for Load Balancing)
    await client.query(`
        INSERT INTO app_cache (key, value, updated_at)
        VALUES ('network_stats', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [newState]);

    // Update Legacy Globals (for existing endpoints)
    miningRuntimeStats.globalNetworkHashrates.clear();
    for (const [cid, val] of Object.entries(coinTotals)) {
      miningRuntimeStats.globalNetworkHashrates.set(cid, val);
    }

    miningRuntimeStats.globalActiveMiners = totalActiveUsers;
    miningRuntimeStats.globalActiveMinersByCoin.clear();
    for (const [cid, val] of Object.entries(activeMinersByCoin)) {
      miningRuntimeStats.globalActiveMinersByCoin.set(cid, val);
    }

    const duration = Date.now() - start;
    if (duration > 1000) {
      console.log(`[Mining] Ranking updated in ${duration}ms. Active Users: ${totalActiveUsers}`);
    }

  } catch (e) {
    console.error('Recalc Hashrates Error:', e);
  } finally {
    client.release();
    isCalculatingRanking = false;
  }
};

// Start Timers for New Logic
// Depósitos pendentes: todos os processos (API só / cluster); o crédito continua idempotente com lock por tx.
setInterval(sweepPendingDepositsOnce, 90000);
setTimeout(sweepPendingDepositsOnce, 8000);

if (WORKER_ROLE === 'BACKGROUND' || WORKER_ROLE === 'ALL') {
  // OPTIMIZATION: Increased from 10s to 60s to reduce CPU load
  setInterval(calculateHashratesAndRanking, 60000);
  setTimeout(calculateHashratesAndRanking, 5000);
}

// Admin Ranking Endpoint
app.get('/api/admin/ranking', isAdmin, async (req, res) => {
  try {
    const coinsRes = await db.query('SELECT id, name, symbol FROM mining_coins');

    // Intelligent Retrieval: Local Memory (Background Worker) vs DB Cache (API Worker)
    let stats = globalNetworkStats;
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
    res.status(500).json({ error: e.message });
  }
});

const startServer = async () => {
  try {
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
  } catch (e) {
    console.error('[DB] Failed to initialize PostgreSQL:', e);
  }

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
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.isAlive = true;
          ws.on('pong', () => { ws.isAlive = true; });
          ws.send(JSON.stringify({ type: 'market', event: 'hello' }));
        });
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
                const data = await computePlayerGameHeaderSnapshot(db, uid);
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

startServer();
