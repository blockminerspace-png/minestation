/**
 * Fluxos HTTP reais contra Postgres (opcional).
 *
 *   cd backend && RUN_BACKEND_PG_INTEGRATION=1 npm run test -- pgIntegration.httpFlows
 *
 * Requer `DATABASE_URL` (via `backend/.env` ou env). Cria dados `pgtest_http_*` e remove no fim.
 *
 * Saque (`/api/withdraw`): só corre com `PG_HTTP_MUTATE_SETTINGS=1` porque faz backup/restauro
 * temporário de `settings.web3_withdraw_tokens` para incluir o símbolo de teste `PGT`.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import pg from 'pg';

import { prisma } from '../config/prisma.js';
import { registerServersRackAuxIntentRoutes } from '../modules/servers/servers.rackAuxIntent.controller.js';
import { registerServersModuleRoutes } from '../modules/servers/servers.controller.js';
import { registerInventoryModuleRoutes } from '../modules/inventory/inventory.controller.js';
import { registerWorkshopIntentRoutes } from '../controllers/workshopIntent.controller.js';
import { registerShopModuleRoutes } from '../modules/shop/shop.controller.js';
import { registerWalletPlayerRoutes } from '../modules/wallet/walletPlayerController.js';
import {
  applyLegacySaveGameFullBarrier,
  neutralizeLegacySaveGameSlicePayload
} from '../lib/legacySaveGamePlayerPolicy.js';
import { runWithdrawRequestIdempotent, withdrawRequestFingerprint } from '../modules/wallet/walletWithdrawRequest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const RUN = String(process.env.RUN_BACKEND_PG_INTEGRATION ?? '').trim() === '1';
const DATABASE_URL = String(process.env.DATABASE_URL ?? '').trim();
const MUTATE_WITHDRAW_SETTINGS = String(process.env.PG_HTTP_MUTATE_SETTINGS ?? '').trim() === '1';

const suffix = crypto.randomUUID().slice(0, 10);
const IDS = {
  chassis: `pgtest_http_chassis_${suffix}`,
  battery: `pgtest_http_battery_${suffix}`,
  charger: `pgtest_http_charger_${suffix}`,
  shopItem: `pgtest_http_hwitem_${suffix}`,
  coin: `pgtest_http_coin_${suffix}`,
  rack: `pgtest_http_rack_${suffix}`
};
/** Instância montada na rig (stock ou armazém) — preenchido no primeiro teste. */
let mountedBatteryId = '';
const email = `pgtest_http_${suffix}@invalid.test`;

function pgtestUserFromHeader(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers['x-pgtest-user-id'];
  const id = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    if (String(req.path || '').startsWith('/api/')) {
      res.status(401).json({ error: 'Cabeçalho x-pgtest-user-id em falta.' });
      return;
    }
  } else {
    (req as Request & { userId?: number }).userId = id;
  }
  next();
}

const authPass: (req: Request, res: Response, next: NextFunction) => void = (_req, _res, next) => next();

async function startTestApp(pool: pg.Pool): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: '400kb' }));
  app.use((req, res, next) => {
    res.setHeader('x-powered-by', 'pgtest');
    next();
  });
  app.use(pgtestUserFromHeader);

  const noopLog = async (): Promise<void> => {};

  registerServersRackAuxIntentRoutes(app, {
    pool,
    prisma,
    appendGameActivityLog: noopLog,
    validatePlacedRacksForSave: async () => ({ ok: true }),
    sanitizePlacedRacksNftAutoRoom: async () => false
  });
  registerServersModuleRoutes(app, { prisma, pool });
  registerInventoryModuleRoutes(app, { authenticateToken: authPass, pool });
  registerWorkshopIntentRoutes(app, { authenticateToken: authPass });
  registerShopModuleRoutes(app, { pool, authenticateToken: authPass });
  registerWalletPlayerRoutes(app, { authenticateToken: authPass, appendGameActivityLog: noopLog });

  app.post('/api/withdraw', async (req, res) => {
    const body = req.body || {};
    const coinId = typeof body.coinId === 'string' ? body.coinId.trim() : '';
    const amount = Number(body.amount);
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';
    const idem =
      typeof body.idempotencyKey === 'string' && /^[a-zA-Z0-9_.:-]{8,128}$/.test(body.idempotencyKey.trim())
        ? body.idempotencyKey.trim()
        : '';
    if (!idem) return res.status(400).json({ error: 'idempotencyKey obrigatório.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    if (!coinId || !Number.isFinite(amount) || amount <= 0 || !walletAddress) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }
    const uid = Number((req as Request & { userId?: number }).userId);
    const client = await pool.connect();
    try {
      const fp = withdrawRequestFingerprint({ coinId, amount, walletAddress });
      const out = await runWithdrawRequestIdempotent(client, {
        userId: uid,
        coinId,
        amount,
        walletAddress,
        idempotencyKey: idem,
        requestFingerprint: fp,
        serverNowMs: Date.now()
      });
      return res.json({
        ok: true,
        requestId: out.requestId,
        message: out.message,
        idempotentReplay: !!out.idempotentReplay
      });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message?: string };
      if (err?.statusCode === 409 && String(err.message || '').includes('idempotência')) {
        return res.status(409).json({ error: err.message, code: 'IDEMPOTENCY_PAYLOAD_MISMATCH', forceReload: true });
      }
      if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
        return res.status(err.statusCode).json({ error: String(err.message || 'erro') });
      }
      return res.status(500).json({ error: 'internal' });
    } finally {
      client.release();
    }
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  };
}

async function fetchJson(
  baseUrl: string,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

describe.skipIf(!RUN || !DATABASE_URL)('PG HTTP flows (RUN_BACKEND_PG_INTEGRATION=1)', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4, connectionTimeoutMillis: 20000 });
  let userId = 0;
  let baseUrl = '';
  let closeApp: () => Promise<void> = async () => {};
  let prevWithdrawTokens: string | null = null;
  /** Prisma `workshop_slots.installed_at` exige coluna na BD (migração); ambientes antigos ficam sem teste de oficina HTTP. */
  let workshopSchemaOk = false;

  beforeAll(async () => {
    await prisma.$connect();
    const colChk = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'workshop_slots' AND column_name = 'installed_at' LIMIT 1`
    );
    workshopSchemaOk = colChk.rowCount > 0;
    const hash = await bcrypt.hash('pgtest_http_x', 8);
    const u = await prisma.users.create({
      data: {
        username: `u_${suffix}`,
        email,
        password: hash,
        is_admin: 0,
        is_super_admin: 0,
        is_blocked: 0,
        polygon_wallet: '0x0000000000000000000000000000000000000001'
      }
    });
    userId = u.id;

    await prisma.mining_coins.upsert({
      where: { id: IDS.coin },
      create: {
        id: IDS.coin,
        name: 'PGTestCoin',
        symbol: 'PGT',
        description: 'pg integration',
        network_hashrate: 1e12,
        block_reward: 1,
        block_time: 60,
        price_usd: 1,
        algorithm: 'test',
        difficulty: 1,
        multiplier: 1,
        color: '#fff',
        min_proportion: 0,
        usdc_rate: 1,
        is_active: 1
      },
      update: { symbol: 'PGT', is_active: 1, usdc_rate: 1 }
    });

    await prisma.upgrades.upsert({
      where: { id: IDS.chassis },
      create: {
        id: IDS.chassis,
        name: 'PG chassis',
        category: 'rack',
        type: 'rack',
        base_cost: 0,
        base_production: 1,
        description: 'pg',
        icon: 'x',
        status: 'active',
        is_nft: 0,
        slots_capacity: 4,
        sell_in_hardware_market: 0,
        is_active: 1
      },
      update: { is_active: 1 }
    });

    await prisma.upgrades.upsert({
      where: { id: IDS.battery },
      create: {
        id: IDS.battery,
        name: 'PG battery',
        category: 'battery',
        type: 'battery',
        base_cost: 0,
        base_production: 0,
        description: 'pg',
        icon: 'x',
        status: 'active',
        is_nft: 0,
        power_capacity: 100,
        sell_in_hardware_market: 0,
        is_active: 1
      },
      update: { is_active: 1 }
    });

    const chargerLayout = JSON.stringify({ slots: [{ type: 'battery', id: 'bat_slot' }] });
    await prisma.upgrades.upsert({
      where: { id: IDS.charger },
      create: {
        id: IDS.charger,
        name: 'PG charger',
        category: 'workshop',
        type: 'charger',
        base_cost: 0,
        base_production: 0,
        description: 'pg',
        icon: 'x',
        status: 'active',
        is_nft: 0,
        layout: chargerLayout,
        sell_in_hardware_market: 0,
        is_active: 1
      },
      update: { layout: chargerLayout, is_active: 1 }
    });

    await prisma.upgrades.upsert({
      where: { id: IDS.shopItem },
      create: {
        id: IDS.shopItem,
        name: 'PG shop item',
        category: 'misc',
        type: 'misc',
        base_cost: 0.01,
        base_production: 0,
        description: 'pg',
        icon: 'x',
        status: 'active',
        is_nft: 0,
        sell_in_hardware_market: 1,
        is_active: 1
      },
      update: { sell_in_hardware_market: 1, base_cost: 0.01, is_active: 1 }
    });

    const now = BigInt(Date.now());
    await prisma.game_states.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        usdc: 100,
        start_time: now,
        claimed_referrals: 0,
        referral_bonus_claimed: 0,
        last_updated_at: now,
        server_updated_at: now,
        black_market_balance: 0
      },
      update: { usdc: 100, server_updated_at: now }
    });

    await pool.query(
      `INSERT INTO placed_racks (id, user_id, item_id, wiring_id, battery_id, current_charge, is_on, selected_coin_id, room_id, slot_index)
       VALUES ($1, $2, $3, NULL, NULL, 0, 0, NULL, 'room_initial', 0)`,
      [IDS.rack, userId, IDS.chassis]
    );

    await prisma.stock.upsert({
      where: { user_id_item_id: { user_id: userId, item_id: IDS.battery } },
      create: { user_id: userId, item_id: IDS.battery, qty: 5 },
      update: { qty: 5 }
    });

    if (workshopSchemaOk) {
      await pool.query(
        `
      INSERT INTO workshop_slots (user_id, slot_index, item_id, internal_state, current_charge, slot_charges, slot_item_ids)
      VALUES ($1, 0, $2, NULL, 0, NULL, NULL)
      ON CONFLICT (user_id, slot_index) DO UPDATE SET
        item_id = EXCLUDED.item_id,
        internal_state = NULL,
        current_charge = 0,
        slot_charges = NULL,
        slot_item_ids = NULL
    `,
        [userId, IDS.charger]
      );
    }

    await prisma.coin_balances.upsert({
      where: { user_id_coin_id: { user_id: userId, coin_id: IDS.coin } },
      create: { user_id: userId, coin_id: IDS.coin, amount: 25 },
      update: { amount: 25 }
    });

    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('hardware_market_enabled', '1')
       ON CONFLICT (key) DO UPDATE SET value = '1'`
    );

    if (MUTATE_WITHDRAW_SETTINGS) {
      const r = await pool.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'web3_withdraw_tokens'`);
      prevWithdrawTokens = r.rows[0]?.value ?? '';
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('web3_withdraw_tokens', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify([{ name: 'PGT', feePercent: 0, minAmount: 0 }])]
      );
    }

    const app = await startTestApp(pool);
    baseUrl = app.baseUrl;
    closeApp = app.close;
  }, 120_000);

  afterAll(async () => {
    await closeApp();
    try {
      await pool.query('DELETE FROM wallet_idempotency WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM wallet_ledger_entries WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM withdrawal_requests WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM shop_checkout_idempotency WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM shop_cart_lines WHERE cart_id IN (SELECT id FROM shop_carts WHERE user_id = $1)', [
        userId
      ]);
      await pool.query('DELETE FROM shop_carts WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM game_servers_intent_idempotency WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM stored_batteries WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM rack_slots WHERE rack_id = $1', [IDS.rack]);
      await pool.query('DELETE FROM placed_racks WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM workshop_slots WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM stock WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM game_states WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.query('DELETE FROM coin_balances WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM mining_coins WHERE id = $1', [IDS.coin]);
      await pool.query('DELETE FROM upgrades WHERE id = ANY($1::text[])', [[IDS.chassis, IDS.battery, IDS.charger, IDS.shopItem]]);
    } catch {
      /* best-effort */
    }
    if (MUTATE_WITHDRAW_SETTINGS && prevWithdrawTokens !== null) {
      await pool.query(`UPDATE settings SET value = $1 WHERE key = 'web3_withdraw_tokens'`, [prevWithdrawTokens]);
    }
    await pool.end();
    await prisma.$disconnect();
  }, 120_000);

  it('equipa / desequipa bateria + idempotência + inventário', async () => {
    await pool.query(`UPDATE placed_racks SET battery_id = NULL, current_charge = 0 WHERE id = $1`, [IDS.rack]);
    await prisma.stock.upsert({
      where: { user_id_item_id: { user_id: userId, item_id: IDS.battery } },
      create: { user_id: userId, item_id: IDS.battery, qty: 3 },
      update: { qty: 3 }
    });
    await prisma.stored_batteries.deleteMany({ where: { user_id: userId } });

    const gs0 = await prisma.game_states.findUnique({
      where: { user_id: userId },
      select: { server_updated_at: true }
    });
    const v0 = Number(gs0?.server_updated_at || 0);
    const idemEquip = `idem_eq_${suffix}_a`;
    const r1 = await fetchJson(baseUrl, `/api/servers/racks/${IDS.rack}/aux/equip`, {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: {
        kind: 'battery',
        catalogItemId: IDS.battery,
        idempotencyKey: idemEquip,
        clientStateVersion: v0
      }
    });
    expect(r1.status).toBe(200);
    const r1j = r1.json as { placedRacks?: { id: string; batteryId?: string | null }[] };
    const rackOut = (r1j.placedRacks || []).find((r) => r.id === IDS.rack);
    const bid = String(rackOut?.batteryId || '').trim();
    expect(bid.length).toBeGreaterThan(10);
    mountedBatteryId = bid;

    const pr = await pool.query<{ battery_id: string | null }>(
      'SELECT battery_id::text FROM placed_racks WHERE id = $1',
      [IDS.rack]
    );
    expect(String(pr.rows[0]?.battery_id || '').trim()).toBe(mountedBatteryId);

    const sb1 = await prisma.stored_batteries.findUnique({ where: { id: mountedBatteryId } });
    if (typeof sb1?.version === 'number' && sb1.version > 0) {
      expect(sb1.version).toBeGreaterThanOrEqual(1);
    }
    const st = String(sb1?.status || '').trim().toUpperCase();
    if (st) expect(st).toBe('EQUIPPED');
    if (sb1?.rack_id) expect(sb1.rack_id).toBe(IDS.rack);

    if (workshopSchemaOk) {
      const srv = await fetchJson(baseUrl, '/api/servers/state', {
        headers: { 'x-pgtest-user-id': String(userId) }
      });
      expect(srv.status).toBe(200);
      const srvJson = srv.json as { placedRacks?: { id: string; batteryId?: string | null }[] };
      const rackDto = (srvJson.placedRacks || []).find((r) => r.id === IDS.rack);
      expect(rackDto?.batteryId).toBe(mountedBatteryId);
    }

    const inv = await fetchJson(baseUrl, '/api/inventory/state', {
      headers: { 'x-pgtest-user-id': String(userId) }
    });
    expect(inv.status).toBe(200);
    const dto = inv.json as {
      fullChargeBatteries?: { id: string }[];
      partialChargeBatteries?: { id: string }[];
    };
    const all = [...(dto.fullChargeBatteries || []), ...(dto.partialChargeBatteries || [])];
    expect(all.some((b) => b.id === mountedBatteryId)).toBe(false);

    const rReplay = await fetchJson(baseUrl, `/api/servers/racks/${IDS.rack}/aux/equip`, {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: {
        kind: 'battery',
        catalogItemId: IDS.battery,
        idempotencyKey: idemEquip,
        clientStateVersion: v0
      }
    });
    expect(rReplay.status).toBe(200);

    // Bateria cheia ao desequipar volta ao stock agregado (sem linha em `stored_batteries`);
    // forçar carga parcial para validar instância no armazém + inventário.
    await pool.query(`UPDATE placed_racks SET current_charge = $2 WHERE id = $1`, [IDS.rack, 50]);

    const idemUnequip = `idem_ue_${suffix}_a`;
    const u1 = await fetchJson(baseUrl, `/api/servers/racks/${IDS.rack}/aux/unequip`, {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: { kind: 'battery', idempotencyKey: idemUnequip }
    });
    expect(u1.status).toBe(200);
    const u1j = u1.json as { storedBatteries?: Array<{ id: string; itemId?: string }> };
    let whFromUnequip = (u1j.storedBatteries || []).find(
      (b) => String(b.itemId || '').trim() === IDS.battery
    );
    if (!whFromUnequip?.id) {
      const rows = await prisma.stored_batteries.findMany({
        where: { user_id: userId, item_id: IDS.battery },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 5
      });
      whFromUnequip = rows[0] ? { id: rows[0].id, itemId: IDS.battery } : undefined;
    }
    expect(whFromUnequip?.id).toBeTruthy();
    mountedBatteryId = String(whFromUnequip!.id);

    const prU = await pool.query<{ battery_id: string | null }>(
      'SELECT battery_id::text FROM placed_racks WHERE id = $1',
      [IDS.rack]
    );
    expect(String(prU.rows[0]?.battery_id || '').trim()).toBe('');

    const sb2 = await prisma.stored_batteries.findUnique({ where: { id: mountedBatteryId } });
    const stU = String(sb2?.status || '').trim().toUpperCase();
    if (stU) expect(stU).toBe('INVENTORY');

    const u2 = await fetchJson(baseUrl, `/api/servers/racks/${IDS.rack}/aux/unequip`, {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: { kind: 'battery', idempotencyKey: idemUnequip }
    });
    expect(u2.status).toBe(200);

    const inv2 = await fetchJson(baseUrl, '/api/inventory/state', {
      headers: { 'x-pgtest-user-id': String(userId) }
    });
    expect(inv2.status).toBe(200);
    const dto2 = inv2.json as {
      fullChargeBatteries?: Array<{ id: string; itemId?: string }>;
      partialChargeBatteries?: Array<{ id: string; itemId?: string }>;
    };
    const all2 = [...(dto2.fullChargeBatteries || []), ...(dto2.partialChargeBatteries || [])];
    const hits = all2.filter((b) => String(b.itemId || '').trim() === IDS.battery);
    expect(hits.length).toBe(1);
    expect(hits[0]?.id).toBe(mountedBatteryId);
  });

  it.skipIf(!workshopSchemaOk)('oficina charge start/stop + mismatch idempotência', async () => {
    expect(mountedBatteryId.length).toBeGreaterThan(0);
    await prisma.stored_batteries.update({
      where: { id: mountedBatteryId },
      data: {
        status: 'INVENTORY',
        location: 'INVENTORY',
        rack_id: null,
        workshop_slot_index: null,
        workshop_component_slot_id: null
      }
    });

    const gs = await prisma.game_states.findUnique({
      where: { user_id: userId },
      select: { server_updated_at: true }
    });
    const cv = Number(gs?.server_updated_at || 0);
    const idem = `idem_ws_${suffix}_chg`;

    const st = await fetchJson(baseUrl, `/api/workshop/batteries/${mountedBatteryId}/charge/start`, {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: {
        benchSlotIndex: 0,
        componentSlotId: 'bat_slot',
        idempotencyKey: idem,
        clientStateVersion: cv
      }
    });
    expect(st.status).toBe(200);

    const sb = await prisma.stored_batteries.findUnique({ where: { id: mountedBatteryId } });
    expect(String(sb?.status || '').toUpperCase()).toBe('CHARGING');

    const inv = await fetchJson(baseUrl, '/api/inventory/state', {
      headers: { 'x-pgtest-user-id': String(userId) }
    });
    expect(inv.status).toBe(200);
    const dto = inv.json as { storedBatteriesFull?: { id: string }[]; storedBatteriesPartial?: { id: string }[] };
    const listed = [...(dto.storedBatteriesFull || []), ...(dto.storedBatteriesPartial || [])];
    expect(listed.some((b) => b.id === mountedBatteryId)).toBe(false);

    const bad = await fetchJson(baseUrl, `/api/workshop/batteries/${mountedBatteryId}/charge/start`, {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: {
        benchSlotIndex: 1,
        componentSlotId: 'bat_slot',
        idempotencyKey: idem,
        clientStateVersion: cv
      }
    });
    expect(bad.status).toBe(409);
    const bj = bad.json as { code?: string };
    expect(bj.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');

    const gs2 = await prisma.game_states.findUnique({
      where: { user_id: userId },
      select: { server_updated_at: true }
    });
    const idemStop = `idem_ws_${suffix}_stop`;
    const sp = await fetchJson(baseUrl, `/api/workshop/batteries/${mountedBatteryId}/charge/stop`, {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: {
        benchSlotIndex: 0,
        componentSlotId: 'bat_slot',
        idempotencyKey: idemStop,
        clientStateVersion: Number(gs2?.server_updated_at || 0)
      }
    });
    expect(sp.status).toBe(200);

    const sb2 = await prisma.stored_batteries.findUnique({ where: { id: mountedBatteryId } });
    const stEnd = String(sb2?.status || '').trim().toUpperCase();
    if (stEnd) expect(stEnd).toBe('INVENTORY');
  });

  it('save legado: barreira + slice neutralizado (sem HTTP save-game)', async () => {
    expect(mountedBatteryId.length).toBeGreaterThan(0);
    const prev = process.env.LEGACY_SAVEGAME_PLAYER_POLICY;
    process.env.LEGACY_SAVEGAME_PLAYER_POLICY = 'reject';
    const changes: Record<string, unknown> = { stock: { x: 1 }, storedBatteries: [], lastLoadTime: 1 };
    const barrier = applyLegacySaveGameFullBarrier({ headers: {}, originalUrl: '/api/save-game' }, changes, userId, false);
    expect(barrier.mode).toBe('reject');

    const ver0 = await prisma.stored_batteries.findUnique({
      where: { id: mountedBatteryId },
      select: { version: true, current_charge: true }
    });
    const client = await pool.connect();
    try {
      const slice: Record<string, unknown> = { stock: { z: 9 }, storedBatteries: [{ id: 'fake' }] };
      await neutralizeLegacySaveGameSlicePayload(client, userId, 'inventory', slice, { headers: {}, originalUrl: '/api/game/save-inventory' }, userId);
      expect(slice.stock).toBeUndefined();
      expect(slice.storedBatteries).toBeUndefined();
    } finally {
      client.release();
    }
    const ver1 = await prisma.stored_batteries.findUnique({
      where: { id: mountedBatteryId },
      select: { version: true, current_charge: true }
    });
    expect(ver1?.version).toBe(ver0?.version);
    expect(ver1?.current_charge).toBe(ver0?.current_charge);
    process.env.LEGACY_SAVEGAME_PLAYER_POLICY = prev;
  });

  it('shop checkout + replay + mismatch', async () => {
    const cart = await prisma.shop_carts.upsert({
      where: { user_id: userId },
      create: { user_id: userId, updated_at: BigInt(Date.now()) },
      update: { updated_at: BigInt(Date.now()) }
    });
    await pool.query('DELETE FROM shop_cart_lines WHERE cart_id = $1::uuid', [cart.id]);
    const lineNow = BigInt(Date.now());
    await prisma.shop_cart_lines.create({
      data: { cart_id: cart.id, product_id: IDS.shopItem, qty: 1, updated_at: lineNow }
    });

    const idem = `idem_shop_${suffix}`;
    const c1 = await fetchJson(baseUrl, '/api/shop/checkout', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: { idempotencyKey: idem }
    });
    expect(c1.status).toBe(200);
    const c1j = c1.json as { ok?: boolean; cached?: boolean };
    expect(c1j.ok).toBe(true);
    expect(c1j.cached).toBeFalsy();

    const c2 = await fetchJson(baseUrl, '/api/shop/checkout', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: { idempotencyKey: idem }
    });
    expect(c2.status).toBe(200);
    const c2j = c2.json as { cached?: boolean };
    expect(c2j.cached).toBe(true);

    await pool.query('DELETE FROM shop_cart_lines WHERE cart_id = $1::uuid', [cart.id]);
    await prisma.shop_cart_lines.create({
      data: { cart_id: cart.id, product_id: IDS.shopItem, qty: 2, updated_at: BigInt(Date.now()) }
    });
    const c3 = await fetchJson(baseUrl, '/api/shop/checkout', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: { idempotencyKey: idem }
    });
    expect(c3.status).toBe(409);
    const c3j = c3.json as { code?: string };
    expect(c3j.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('wallet exchange liquidate replay + mismatch', async () => {
    const idem = `idem_wx_${suffix}`;
    const body = { idempotencyKey: idem, mode: 'PERCENTAGE', percentage: 10, coinId: IDS.coin };
    const w1 = await fetchJson(baseUrl, '/api/wallet/exchange/liquidate', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body
    });
    expect(w1.status).toBe(200);
    const w2 = await fetchJson(baseUrl, '/api/wallet/exchange/liquidate', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body
    });
    expect(w2.status).toBe(200);
    const w2j = w2.json as { idempotentReplay?: boolean };
    expect(w2j.idempotentReplay).toBe(true);

    const w3 = await fetchJson(baseUrl, '/api/wallet/exchange/liquidate', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: { ...body, percentage: 50 }
    });
    expect(w3.status).toBe(409);
  });

  it.skipIf(!MUTATE_WITHDRAW_SETTINGS)('withdraw idempotente (requer PG_HTTP_MUTATE_SETTINGS=1)', async () => {
    await prisma.coin_balances.update({
      where: { user_id_coin_id: { user_id: userId, coin_id: IDS.coin } },
      data: { amount: 10 }
    });
    const idem = `idem_wd_${suffix}`;
    const body = {
      coinId: IDS.coin,
      amount: 2,
      walletAddress: '0x0000000000000000000000000000000000000abc',
      idempotencyKey: idem
    };
    const a = await fetchJson(baseUrl, '/api/withdraw', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body
    });
    expect(a.status).toBe(200);
    const b = await fetchJson(baseUrl, '/api/withdraw', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body
    });
    expect(b.status).toBe(200);
    const bj = b.json as { idempotentReplay?: boolean };
    expect(bj.idempotentReplay).toBe(true);

    const c = await fetchJson(baseUrl, '/api/withdraw', {
      method: 'POST',
      headers: { 'x-pgtest-user-id': String(userId) },
      body: { ...body, amount: 3 }
    });
    expect(c.status).toBe(409);

    const rows = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM withdrawal_requests WHERE user_id = $1`,
      [userId]
    );
    expect(parseInt(rows.rows[0]?.n || '0', 10)).toBe(1);
  });
});
