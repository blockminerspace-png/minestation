import crypto from 'node:crypto';
import type { Application, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { parseIdempotencyKey } from '../../validation/roletaValidation.js';
import {
  attachIntentFingerprint,
  GAME_INTENT_IDEM_FP_KEY,
  stripIntentFingerprint
} from '../../lib/gameIntentIdempotencyPrisma.js';
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
  applyPlaceRackFromStock,
  applyRackMinerEquip,
  applyRackMinerUnequip,
  applyRemoveRackToStock,
  applyRackAuxEquip,
  applyRackAuxUnequip,
  placeRackIntentFingerprint,
  rackBatteryCatalogHintsFromPlacedRacks,
  type RackAuxApplyFn,
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

function resolveRackAuxIdempotencyKey(raw: unknown): string {
  const parsed = parseIdempotencyKey(raw);
  if (parsed) return parsed;
  return `srv_${crypto.randomUUID()}`;
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

function toPrismaJsonSafe(value: unknown): object {
  return JSON.parse(JSON.stringify(value ?? {})) as object;
}

async function runRackAuxMutation(
  deps: ServersRackAuxIntentDeps,
  args: {
    userId: number;
    rackId: string;
    idem: string;
    scope: string;
    clientStateVersion: number | null;
    requestFingerprint?: string | null;
    apply: RackAuxApplyFn;
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { pool, prisma, appendGameActivityLog, validatePlacedRacksForSave, sanitizePlacedRacksNftAutoRoom } = deps;
  const { userId, rackId, idem, scope, clientStateVersion, requestFingerprint, apply } = args;

  const replay = await readIdempotencyReplay(prisma, userId, scope, idem);
  if (replay) {
    const b = replay.body as Record<string, unknown>;
    if (requestFingerprint) {
      const prevFp = typeof b[GAME_INTENT_IDEM_FP_KEY] === 'string' ? String(b[GAME_INTENT_IDEM_FP_KEY]) : '';
      if (prevFp && prevFp !== requestFingerprint) {
        console.warn(JSON.stringify({ event: 'servers_rack_intent_idem_mismatch', userId, scope }));
        return {
          status: 409,
          body: {
            error: 'Mesma chave de idempotência com pedido diferente.',
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            forceReload: true
          }
        };
      }
    }
    return { status: replay.httpStatus, body: stripIntentFingerprint(b) as Record<string, unknown> };
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
      const b2 = replay2.body as Record<string, unknown>;
      if (requestFingerprint) {
        const prevFp2 = typeof b2[GAME_INTENT_IDEM_FP_KEY] === 'string' ? String(b2[GAME_INTENT_IDEM_FP_KEY]) : '';
        if (prevFp2 && prevFp2 !== requestFingerprint) {
          return {
            status: 409,
            body: {
              error: 'Mesma chave de idempotência com pedido diferente.',
              code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
              forceReload: true
            }
          };
        }
      }
      return { status: replay2.httpStatus, body: stripIntentFingerprint(b2) as Record<string, unknown> };
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
    if (process.env.GPU_DUP_DEBUG === '1') {
      console.log(
        JSON.stringify({
          event: '[GPU_DUP_DEBUG][game_state_get]',
          userId,
          scope,
          rackId,
          dbVersion,
          clientStateVersion
        })
      );
    }

    // Same `pg` client: não usar Promise.all — queries em paralelo corrompem o fluxo do driver.
    const stock = await loadUserStock(client, userId);
    const storedBatteries = await loadUserStoredBatteries(client, userId);
    const placedRacks = await loadUserPlacedRacksWithSlots(client, userId);
    const upgradesRows = await loadUpgradesWithCompat(client);

    const upgrades: RackAuxUpgradeRow[] = upgradesRows.map((u) => ({
      id: u.id,
      type: u.type,
      category: u.category,
      powerCapacity: u.powerCapacity,
      name: u.name ?? null,
      image: null,
      slotsCapacity: u.slotsCapacity,
      aiSlotsCapacity: u.aiSlotsCapacity,
      isActive: u.isActive,
      compatibleRacks: Array.isArray(u.compatibleRacks) ? u.compatibleRacks : []
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

    const rackHints = rackBatteryCatalogHintsFromPlacedRacks(prev.placedRacks);
    if (process.env.GPU_DUP_DEBUG === '1') {
      const rackPrev = prev.placedRacks.find((r) => r.id === rackId);
      console.log(
        JSON.stringify({
          event: '[GPU_DUP_DEBUG][unequip_prev]',
          userId,
          scope,
          rackId,
          stockSnapshot: Object.fromEntries(
            Object.entries(prev.stock).filter(([, v]) => Number(v) > 0)
          ),
          rackSlots: rackPrev?.slots ?? null
        })
      );
    }
    const out = apply(prev, upgrades, rackHints);
    if (!out.ok) {
      await client.query('ROLLBACK');
      return { status: 400, body: { ok: false, error: out.error } };
    }
    if (process.env.GPU_DUP_DEBUG === '1') {
      const rackOut = out.placedRacks.find((r) => r.id === rackId);
      console.log(
        JSON.stringify({
          event: '[GPU_DUP_DEBUG][unequip_out]',
          userId,
          scope,
          rackId,
          stockSnapshot: Object.fromEntries(
            Object.entries(out.stock).filter(([, v]) => Number(v) > 0)
          ),
          rackSlots: rackOut?.slots ?? null
        })
      );
    }

    const rackVal = await validatePlacedRacksForSave(client, out.placedRacks, userId);
    if (!rackVal.ok) {
      await client.query('ROLLBACK');
      return { status: 400, body: { ok: false, error: rackVal.error || 'Validação de rigs falhou.' } };
    }

    await persistStockStoredBatteriesPlacedRacks(client, userId, {
      stock: out.stock,
      storedBatteries: out.storedBatteries,
      placedRacks: out.placedRacks,
      stockMode: 'snapshot'
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
    if (requestFingerprint) {
      attachIntentFingerprint(body, requestFingerprint);
    }
    try {
      await writeIdempotencySuccess(prisma, userId, scope, idem, 200, toPrismaJsonSafe(body));
    } catch (e) {
      console.warn('[servers/racks/aux] idempotency replay write failed after commit:', e instanceof Error ? e.message : String(e));
    }
    try {
      await appendGameActivityLog(pool, userId, 'rack_aux_intent', {
        rackId,
        scope,
        ok: true,
        source: 'intent_api'
      });
    } catch (e) {
      console.warn('[servers/racks/aux] activity log failed after commit:', e instanceof Error ? e.message : String(e));
    }
    const bodyOut = requestFingerprint ? (stripIntentFingerprint(body) as Record<string, unknown>) : body;
    return { status: 200, body: bodyOut };
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
  const kind = String(body.kind || body.type || body.slotId || '').trim().toLowerCase();
  if (kind === 'battery') {
    const sid =
      body.storedBatteryId != null
        ? String(body.storedBatteryId).trim()
        : body.batteryInstanceId != null
          ? String(body.batteryInstanceId).trim()
          : '';
    const cid =
      body.catalogItemId != null
        ? String(body.catalogItemId).trim()
        : body.itemId != null
          ? String(body.itemId).trim()
          : body.batteryUpgradeId != null
            ? String(body.batteryUpgradeId).trim()
            : '';
    if (sid) return { kind: 'battery', battery: { mode: 'from_warehouse', storedBatteryId: sid } };
    if (cid) return { kind: 'battery', battery: { mode: 'from_stock', catalogItemId: cid } };
    return null;
  }
  if (kind === 'wiring') {
    const cid =
      body.catalogItemId != null ? String(body.catalogItemId).trim() : body.itemId != null ? String(body.itemId).trim() : '';
    if (!cid) return null;
    return { kind: 'wiring', catalogItemId: cid };
  }
  if (kind === 'multiplier') {
    const cid =
      body.catalogItemId != null ? String(body.catalogItemId).trim() : body.itemId != null ? String(body.itemId).trim() : '';
    const idx = Number(body.multiplierSlotIndex);
    if (!cid || !Number.isFinite(idx)) return null;
    return { kind: 'multiplier', catalogItemId: cid, multiplierSlotIndex: idx };
  }
  return null;
}

function parseUnequipInput(body: Record<string, unknown>): RackAuxUnequipInput | null {
  const kind = String(body.kind || body.type || body.slotId || '').trim().toLowerCase();
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
  app.post('/api/servers/racks/place', async (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const catalogItemId = String(body.catalogItemId ?? body.typeId ?? '').trim();
    const roomId = String(body.roomId ?? '').trim();
    const slotRaw = body.slotIndex;
    const slotIndex = typeof slotRaw === 'number' ? slotRaw : parseInt(String(slotRaw ?? ''), 10);
    if (!catalogItemId || !roomId || !Number.isFinite(slotIndex)) {
      return res.status(400).json({ error: 'catalogItemId, roomId e slotIndex são obrigatórios.' });
    }
    const idem = resolveRackAuxIdempotencyKey(body.idempotencyKey);
    const clientStateVersion = parseClientStateVersion(body.clientStateVersion);
    const requestFingerprint = placeRackIntentFingerprint({ catalogItemId, roomId, slotIndex });
    try {
      const r = await runRackAuxMutation(deps, {
        userId,
        rackId: 'place',
        idem,
        scope: 'srv_place_rack',
        clientStateVersion,
        requestFingerprint,
        apply: (prev, upgrades, _rackHints) =>
          applyPlaceRackFromStock(prev, catalogItemId, roomId, slotIndex, upgrades)
      });
      return res.status(r.status).json(r.body);
    } catch (e) {
      console.error('[servers/racks/place]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    }
  });

  app.post('/api/servers/racks/:rackId/remove', async (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    }
    const rackId = String(req.params.rackId || '').trim();
    if (!RACK_ID_RE.test(rackId)) return res.status(400).json({ error: 'Rig inválida.' });

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const idem = resolveRackAuxIdempotencyKey(body.idempotencyKey);
    const clientStateVersion = parseClientStateVersion(body.clientStateVersion);
    try {
      const r = await runRackAuxMutation(deps, {
        userId,
        rackId,
        idem,
        scope: `srv_remove_rack:${rackId}`,
        clientStateVersion,
        apply: (prev, upgrades, rackHints) => applyRemoveRackToStock(prev, rackId, upgrades, rackHints)
      });
      return res.status(r.status).json(r.body);
    } catch (e) {
      console.error('[servers/racks/remove]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    }
  });

  app.post('/api/servers/racks/:rackId/miners/equip', async (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });

    const rackId = String(req.params.rackId || '').trim();
    if (!RACK_ID_RE.test(rackId)) return res.status(400).json({ error: 'Rig inválida.' });

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const catalogItemId = String(body.catalogItemId ?? body.itemId ?? '').trim();
    const slotIndex = typeof body.slotIndex === 'number' ? body.slotIndex : parseInt(String(body.slotIndex ?? ''), 10);
    if (!catalogItemId || !Number.isFinite(slotIndex)) {
      return res.status(400).json({ error: 'catalogItemId e slotIndex são obrigatórios.' });
    }

    const idem = resolveRackAuxIdempotencyKey(body.idempotencyKey);
    const clientStateVersion = parseClientStateVersion(body.clientStateVersion);
    try {
      const r = await runRackAuxMutation(deps, {
        userId,
        rackId,
        idem,
        scope: `rack_miner_equip:${rackId}:${Math.floor(slotIndex)}`,
        clientStateVersion,
        apply: (prev, upgrades) => applyRackMinerEquip(prev, rackId, slotIndex, catalogItemId, upgrades)
      });
      return res.status(r.status).json(r.body);
    } catch (e) {
      console.error('[servers/racks/miners/equip]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    }
  });

  app.post('/api/servers/racks/:rackId/miners/unequip', async (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });

    const rackId = String(req.params.rackId || '').trim();
    if (!RACK_ID_RE.test(rackId)) return res.status(400).json({ error: 'Rig inválida.' });

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const slotIndex = typeof body.slotIndex === 'number' ? body.slotIndex : parseInt(String(body.slotIndex ?? ''), 10);
    if (!Number.isFinite(slotIndex)) return res.status(400).json({ error: 'slotIndex é obrigatório.' });

    const idem = resolveRackAuxIdempotencyKey(body.idempotencyKey);
    const clientStateVersion = parseClientStateVersion(body.clientStateVersion);
    try {
      const r = await runRackAuxMutation(deps, {
        userId,
        rackId,
        idem,
        scope: `rack_miner_unequip:${rackId}:${Math.floor(slotIndex)}`,
        clientStateVersion,
        apply: (prev) => applyRackMinerUnequip(prev, rackId, slotIndex)
      });
      return res.status(r.status).json(r.body);
    } catch (e) {
      console.error('[servers/racks/miners/unequip]', e);
      return sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    }
  });

  const commonEquip = async (req: Request, res: Response, rackId: string) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });

    if (!RACK_ID_RE.test(rackId)) return res.status(400).json({ error: 'Rig inválida.' });

    const idem = resolveRackAuxIdempotencyKey((req.body as { idempotencyKey?: unknown })?.idempotencyKey);
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
      apply: (prev, upgrades, rackHints) => applyRackAuxEquip(prev, rackId, input, upgrades, rackHints)
    });
    return res.status(r.status).json(r.body);
  };

  const commonUnequip = async (req: Request, res: Response, rackId: string) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });

    if (!RACK_ID_RE.test(rackId)) return res.status(400).json({ error: 'Rig inválida.' });

    const idem = resolveRackAuxIdempotencyKey((req.body as { idempotencyKey?: unknown })?.idempotencyKey);
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
      apply: (prev, upgrades, rackHints) => applyRackAuxUnequip(prev, rackId, input, upgrades, rackHints)
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
