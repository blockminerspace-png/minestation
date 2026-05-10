import crypto from 'node:crypto';
import type { Application, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { parseIdempotencyKey } from '../../validation/roletaValidation.js';
import {
  loadUserStock,
  loadUserStoredBatteries,
  loadUserPlacedRacksWithSlots,
  loadUpgradesWithCompat,
  persistStockStoredBatteriesPlacedRacks,
  type PlacedRackLoaded
} from '../../lib/serverRoomPersistence.js';
import { StoredBatterySaveGuardError } from '../../lib/saveGameEconomyValidate.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import {
  applyRackAuxEquip,
  applyRackAuxUnequip,
  type RackAuxEquipInput,
  type RackAuxUnequipInput,
  type RackAuxUpgradeRow,
  type StoredBatteryRowLite
} from './servers.rackAuxIntent.service.js';

const RACK_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

export type ServersRackAuxIntentDeps = {
  pool: Pool;
  prisma: PrismaClient;
  appendGameActivityLog: (
    pool: Pool,
    userId: number,
    action: string,
    meta: Record<string, unknown>
  ) => Promise<void>;
  validatePlacedRacksForSave: (
    client: unknown,
    racks: unknown[],
    userId: unknown
  ) => Promise<{ ok: boolean; error?: string }>;
  sanitizePlacedRacksNftAutoRoom: (
    client: unknown,
    uid: number | string,
    prevForBulk: unknown,
    saveActivityLogs: unknown[]
  ) => Promise<boolean>;
};

type ActivityLogEntry = { action: string; meta: Record<string, unknown> };

function advisoryLockPair(userId: number, scope: string, idem: string): [number, number] {
  const h = crypto.createHash('sha256').update(`${userId}\0${scope}\0${idem}`).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

function parseClientStateVersion(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

async function readIdempotencyReplay(
  prisma: PrismaClient,
  userId: number,
  scope: string,
  idem: string
): Promise<{ httpStatus: number; body: unknown } | null> {
  const row = await prisma.game_servers_intent_idempotency.findUnique({
    where: {
      user_id_scope_idempotency_key: {
        user_id: userId,
        scope,
        idempotency_key: idem
      }
    },
    select: { http_status: true, response_json: true }
  });
  if (!row) return null;
  return { httpStatus: row.http_status, body: row.response_json as unknown };
}

async function writeIdempotencySuccess(
  prisma: PrismaClient,
  userId: number,
  scope: string,
  idem: string,
  httpStatus: number,
  body: unknown
): Promise<void> {
  await prisma.game_servers_intent_idempotency.upsert({
    where: {
      user_id_scope_idempotency_key: {
        user_id: userId,
        scope,
        idempotency_key: idem
      }
    },
    create: {
      user_id: userId,
      scope,
      idempotency_key: idem,
      http_status: httpStatus,
      response_json: body as object
    },
    update: {
      http_status: httpStatus,
      response_json: body as object
    }
  });
}

async function runRackAuxMutation(
  deps: ServersRackAuxIntentDeps,
  args: {
    userId: number;
    rackId: string;
    idem: string;
    scope: string;
    clientStateVersion: number | null;
    apply: (prev: {
      stock: Record<string, number>;
      storedBatteries: StoredBatteryRowLite[];
      placedRacks: PlacedRackLoaded[];
    }, upgrades: RackAuxUpgradeRow[]) => ReturnType<typeof applyRackAuxEquip> | ReturnType<typeof applyRackAuxUnequip>;
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { pool, prisma, appendGameActivityLog, validatePlacedRacksForSave, sanitizePlacedRacksNftAutoRoom } = deps;
  const { userId, rackId, idem, scope, clientStateVersion, apply } = args;

  const replay = await readIdempotencyReplay(prisma, userId, scope, idem);
  if (replay) {
    return { status: replay.httpStatus, body: replay.body as Record<string, unknown> };
  }

  const client = await pool.connect();
  const saveActivityLogs: ActivityLogEntry[] = [];
  try {
    await client.query('BEGIN');
    await client.query("SET statement_timeout = '20s'");
    const [a, b] = advisoryLockPair(userId, scope, idem);
    await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [a, b]);

    const replay2 = await readIdempotencyReplay(prisma, userId, scope, idem);
    if (replay2) {
      await client.query('ROLLBACK');
      return { status: replay2.httpStatus, body: replay2.body as Record<string, unknown> };
    }

    const tEnsure = Date.now();
    await client.query(
      `INSERT INTO game_states (user_id, usdc, start_time, claimed_referrals, referral_bonus_claimed, last_updated_at, server_updated_at, black_market_balance)
       VALUES ($1, 0, $2, 0, 0, $2, $2, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, tEnsure]
    );
    await client.query('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', [userId]);
    const gsRow = await client.query('SELECT server_updated_at FROM game_states WHERE user_id = $1', [userId]);
    const dbVersion = Number(gsRow.rows[0]?.server_updated_at || 0);
    if (clientStateVersion != null && clientStateVersion !== dbVersion) {
      await client.query('ROLLBACK');
      return {
        status: 409,
        body: {
          error: 'O estado do jogo foi atualizado. Recarregue e tente novamente.',
          code: 'STATE_VERSION_CONFLICT',
          forceReload: true,
          serverStateVersion: dbVersion
        }
      };
    }

    const [stock, storedBatteries, placedRacks, upgradesRows] = await Promise.all([
      loadUserStock(client, userId),
      loadUserStoredBatteries(client, userId),
      loadUserPlacedRacksWithSlots(client, userId),
      loadUpgradesWithCompat(client)
    ]);

    const upgrades: RackAuxUpgradeRow[] = upgradesRows.map((u) => ({
      id: u.id,
      type: u.type,
      category: u.category,
      powerCapacity: u.powerCapacity,
      name: u.name ?? null,
      image: null
    }));

    const prevForBulk = {
      stock: { ...stock },
      storedBatteries: [...storedBatteries],
      placedRacks: placedRacks.map((r) => ({
        ...r,
        slots: [...(r.slots || [])],
        multiplierSlots: [...(r.multiplierSlots || [])]
      }))
    };
    await sanitizePlacedRacksNftAutoRoom(client, userId, prevForBulk, saveActivityLogs);

    const prev = {
      stock: prevForBulk.stock,
      storedBatteries: prevForBulk.storedBatteries as StoredBatteryRowLite[],
      placedRacks: prevForBulk.placedRacks as PlacedRackLoaded[]
    };

    const out = apply(prev, upgrades);
    if (!out.ok) {
      await client.query('ROLLBACK');
      return { status: 400, body: { ok: false, error: out.error } };
    }

    const rackVal = await validatePlacedRacksForSave(client, out.placedRacks, userId);
    if (!rackVal.ok) {
      await client.query('ROLLBACK');
      return { status: 400, body: { ok: false, error: rackVal.error || 'Validação de rigs falhou.' } };
    }

    await persistStockStoredBatteriesPlacedRacks(client, userId, {
      stock: out.stock,
      storedBatteries: out.storedBatteries,
      placedRacks: out.placedRacks
    }, saveActivityLogs);

    const finalServerUpdatedAt = Date.now();
    await client.query(
      `UPDATE game_states SET last_updated_at = $1, server_updated_at = $2 WHERE user_id = $3`,
      [finalServerUpdatedAt, finalServerUpdatedAt, userId]
    );

    await client.query('COMMIT');

    for (const ev of saveActivityLogs) {
      await appendGameActivityLog(pool, userId, ev.action, ev.meta);
    }

    const body: Record<string, unknown> = {
      ok: true,
      serverUpdatedAt: finalServerUpdatedAt,
      stateVersion: finalServerUpdatedAt,
      stock: out.stock,
      storedBatteries: out.storedBatteries,
      placedRacks: out.placedRacks,
      scope,
      rackId
    };
    await writeIdempotencySuccess(prisma, userId, scope, idem, 200, body);
    await appendGameActivityLog(pool, userId, 'rack_aux_intent', {
      rackId,
      scope,
      ok: true,
      source: 'intent_api'
    });
    return { status: 200, body };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    if (e instanceof StoredBatterySaveGuardError) {
      return { status: 409, body: { ok: false, error: e.message, forceReload: true } };
    }
    throw e;
  } finally {
    client.release();
  }
}

function parseEquipInput(body: Record<string, unknown>): RackAuxEquipInput | null {
  const kind = String(body.kind || '').trim().toLowerCase();
  if (kind === 'battery') {
    const sid = body.storedBatteryId != null ? String(body.storedBatteryId).trim() : '';
    const cid = body.catalogItemId != null ? String(body.catalogItemId).trim() : '';
    if (sid) return { kind: 'battery', battery: { mode: 'from_warehouse', storedBatteryId: sid } };
    if (cid) return { kind: 'battery', battery: { mode: 'from_stock', catalogItemId: cid } };
    return null;
  }
  if (kind === 'wiring') {
    const cid = body.catalogItemId != null ? String(body.catalogItemId).trim() : '';
    if (!cid) return null;
    return { kind: 'wiring', catalogItemId: cid };
  }
  if (kind === 'multiplier') {
    const cid = body.catalogItemId != null ? String(body.catalogItemId).trim() : '';
    const idx = Number(body.multiplierSlotIndex);
    if (!cid || !Number.isFinite(idx)) return null;
    return { kind: 'multiplier', catalogItemId: cid, multiplierSlotIndex: idx };
  }
  return null;
}

function parseUnequipInput(body: Record<string, unknown>): RackAuxUnequipInput | null {
  const kind = String(body.kind || '').trim().toLowerCase();
  if (kind === 'battery') return { kind: 'battery' };
  if (kind === 'wiring') return { kind: 'wiring' };
  if (kind === 'multiplier') {
    const idx = Number(body.multiplierSlotIndex);
    if (!Number.isFinite(idx)) return null;
    return { kind: 'multiplier', multiplierSlotIndex: idx };
  }
  return null;
}

export function registerServersRackAuxIntentRoutes(app: Application, deps: ServersRackAuxIntentDeps): void {
  const commonEquip = async (req: Request, res: Response, rackId: string) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });

    if (!RACK_ID_RE.test(rackId)) return res.status(400).json({ error: 'Rig inválida.' });

    const idem = parseIdempotencyKey((req.body as { idempotencyKey?: unknown })?.idempotencyKey);
    if (!idem) {
      return res.status(400).json({ error: 'idempotencyKey inválido ou ausente (8–128 caracteres seguros).' });
    }
    const clientStateVersion = parseClientStateVersion((req.body as { clientStateVersion?: unknown })?.clientStateVersion);

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const input = parseEquipInput(body);
    if (!input) {
      return res.status(400).json({ error: 'Corpo inválido: kind e campos obrigatórios em falta.' });
    }

    const scope = `rack_aux_equip:${rackId}:${input.kind}`;
    const r = await runRackAuxMutation(deps, {
      userId,
      rackId,
      idem,
      scope,
      clientStateVersion,
      apply: (prev, upgrades) => applyRackAuxEquip(prev, rackId, input, upgrades, null)
    });
    return res.status(r.status).json(r.body);
  };

  const commonUnequip = async (req: Request, res: Response, rackId: string) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });

    if (!RACK_ID_RE.test(rackId)) return res.status(400).json({ error: 'Rig inválida.' });

    const idem = parseIdempotencyKey((req.body as { idempotencyKey?: unknown })?.idempotencyKey);
    if (!idem) {
      return res.status(400).json({ error: 'idempotencyKey inválido ou ausente (8–128 caracteres seguros).' });
    }
    const clientStateVersion = parseClientStateVersion((req.body as { clientStateVersion?: unknown })?.clientStateVersion);

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const input = parseUnequipInput(body);
    if (!input) {
      return res.status(400).json({ error: 'Corpo inválido: kind (e multiplierSlotIndex para multiplicador).' });
    }

    const scope = `rack_aux_unequip:${rackId}:${input.kind}`;
    const r = await runRackAuxMutation(deps, {
      userId,
      rackId,
      idem,
      scope,
      clientStateVersion,
      apply: (prev, upgrades) => applyRackAuxUnequip(prev, rackId, input, upgrades, null)
    });
    return res.status(r.status).json(r.body);
  };

  app.post('/api/servers/racks/:rackId/aux/equip', async (req, res) => {
    const rackId = String(req.params.rackId || '').trim();
    try {
      return await commonEquip(req, res, rackId);
    } catch (e) {
      console.error('[servers/racks/aux/equip]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    }
  });

  app.post('/api/servers/racks/:rackId/aux/unequip', async (req, res) => {
    const rackId = String(req.params.rackId || '').trim();
    try {
      return await commonUnequip(req, res, rackId);
    } catch (e) {
      console.error('[servers/racks/aux/unequip]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    }
  });

  app.post('/api/servers/rigs/:rigId/slots/:slotId/equip-battery', async (req, res) => {
    const rigId = String(req.params.rigId || '').trim();
    const slotId = String(req.params.slotId || '').trim().toLowerCase();
    try {
      if (slotId !== 'battery') {
        return res.status(400).json({ error: 'Use slotId "battery" nesta rota ou POST /api/servers/racks/:rackId/aux/equip.' });
      }
      const b = (req.body && typeof req.body === 'object' ? { ...req.body } : {}) as Record<string, unknown>;
      b.kind = 'battery';
      req.body = b;
      return await commonEquip(req, res, rigId);
    } catch (e) {
      console.error('[servers/rigs/.../equip-battery]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    }
  });

  app.post('/api/servers/rigs/:rigId/slots/:slotId/remove-battery', async (req, res) => {
    const rigId = String(req.params.rigId || '').trim();
    const slotId = String(req.params.slotId || '').trim().toLowerCase();
    try {
      if (slotId !== 'battery') {
        return res.status(400).json({ error: 'Use slotId "battery" nesta rota ou POST /api/servers/racks/:rackId/aux/unequip.' });
      }
      const b = (req.body && typeof req.body === 'object' ? { ...req.body } : {}) as Record<string, unknown>;
      b.kind = 'battery';
      req.body = b;
      return await commonUnequip(req, res, rigId);
    } catch (e) {
      console.error('[servers/rigs/.../remove-battery]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    }
  });
}
