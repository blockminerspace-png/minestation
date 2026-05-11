import type { Application, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { PrismaClient } from '@prisma/client';
import { runBulkRoomBattery, isValidRoomId } from './batteries.bulk.js';
import { normalizePlacedRackRoomId } from './batteries.validation.js';
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
import { parseIdempotencyKey } from '../../validation/roletaValidation.js';
import {
  advisoryLockPairFromIntent,
  attachIntentFingerprint,
  GAME_INTENT_IDEM_FP_KEY,
  parseClientStateVersionIntent,
  readGameIntentIdempotencyReplay,
  stableIntentFingerprint,
  stripIntentFingerprint,
  writeGameIntentIdempotencySuccess
} from '../../lib/gameIntentIdempotencyPrisma.js';

export type BatteriesServerRoomDeps = {
  db: Pool;
  prisma: PrismaClient;
  authenticateToken: (req: Request, res: Response, next: () => void) => void;
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

export function bulkRoomBatteryIntentScope(userId: number): string {
  return `bulk_room_batt:${userId}`;
}

export function bulkRoomBatteryIntentFingerprint(parts: {
  roomNorm: string;
  batteryUpgradeId: string;
  smartFill: boolean;
  rigSort: string;
}): string {
  return stableIntentFingerprint({
    room: parts.roomNorm,
    bat: parts.batteryUpgradeId,
    smart: parts.smartFill,
    sort: parts.rigSort
  });
}

export function registerBatteriesServerRoomRoutes(app: Application, deps: BatteriesServerRoomDeps): void {
  const { db, prisma, authenticateToken, appendGameActivityLog, validatePlacedRacksForSave, sanitizePlacedRacksNftAutoRoom } =
    deps;

  app.post('/api/server-room/bulk-batteries', authenticateToken, async (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    const uid = Number(req.userId);
    if (!Number.isFinite(uid) || uid <= 0) return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });

    const body = (req.body || {}) as Record<string, unknown>;
    const idem = parseIdempotencyKey(body.idempotencyKey);
    if (!idem) {
      return res.status(400).json({
        error: 'idempotencyKey inválido ou ausente (8–128 caracteres seguros).',
        code: 'IDEMPOTENCY_KEY_REQUIRED'
      });
    }

    const roomNorm = normalizePlacedRackRoomId(body.roomId);
    if (!isValidRoomId(roomNorm)) return res.status(400).json({ error: 'Sala inválida.' });
    const batteryUpgradeId = body.batteryUpgradeId != null ? String(body.batteryUpgradeId) : '';
    const smart = !!body.smartFill;
    const rigSort = body.rigSort === 'hashrate_desc' ? 'hashrate_desc' : 'slot_asc';
    const runOpts = { smartFill: body.smartFill, rigSort: body.rigSort };
    const fp = bulkRoomBatteryIntentFingerprint({ roomNorm, batteryUpgradeId, smartFill: smart, rigSort });
    const scope = bulkRoomBatteryIntentScope(uid);
    const clientStateVersion = parseClientStateVersionIntent(body.clientStateVersion);

    const replay = await readGameIntentIdempotencyReplay(prisma, uid, scope, idem);
    if (replay) {
      const stored = replay.body as Record<string, unknown>;
      const prevFp = typeof stored[GAME_INTENT_IDEM_FP_KEY] === 'string' ? stored[GAME_INTENT_IDEM_FP_KEY] : '';
      if (prevFp && prevFp !== fp) {
        return res.status(409).json({
          error: 'Mesma chave de idempotência com pedido diferente.',
          code: 'IDEMPOTENCY_PAYLOAD_MISMATCH'
        });
      }
      return res.status(replay.httpStatus).json({
        ...stripIntentFingerprint(stored as Record<string, unknown>),
        idempotentReplay: true
      });
    }

    const client = await db.connect();
    const saveActivityLogs: Array<{ action: string; meta: Record<string, unknown> }> = [];
    try {
      await client.query('BEGIN');
      await client.query("SET statement_timeout = '20s'");
      const [a, b] = advisoryLockPairFromIntent(uid, scope, idem);
      await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [a, b]);

      const replay2 = await readGameIntentIdempotencyReplay(prisma, uid, scope, idem);
      if (replay2) {
        await client.query('ROLLBACK');
        const stored = replay2.body as Record<string, unknown>;
        const prevFp = typeof stored[GAME_INTENT_IDEM_FP_KEY] === 'string' ? stored[GAME_INTENT_IDEM_FP_KEY] : '';
        if (prevFp && prevFp !== fp) {
          return res.status(409).json({
            error: 'Mesma chave de idempotência com pedido diferente.',
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH'
          });
        }
        return res.status(replay2.httpStatus).json({
          ...stripIntentFingerprint(stored as Record<string, unknown>),
          idempotentReplay: true
        });
      }

      const tEnsure = Date.now();
      await client.query(
        `INSERT INTO game_states (user_id, usdc, start_time, claimed_referrals, referral_bonus_claimed, last_updated_at, server_updated_at, black_market_balance)
         VALUES ($1, 0, $2, 0, 0, $2, $2, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid, tEnsure]
      );
      await client.query('SELECT 1 FROM game_states WHERE user_id = $1 FOR UPDATE', [uid]);
      const gsRow = await client.query('SELECT server_updated_at FROM game_states WHERE user_id = $1', [uid]);
      const dbVersion = Number(gsRow.rows[0]?.server_updated_at || 0);
      if (clientStateVersion != null && clientStateVersion !== dbVersion) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'O estado do jogo foi atualizado. Recarregue e tente novamente.',
          code: 'STATE_VERSION_CONFLICT',
          forceReload: true,
          serverStateVersion: dbVersion
        });
      }

      // Same `pg` client inside one transaction: keep queries sequential to avoid driver state corruption.
      const stock = await loadUserStock(client, uid);
      const storedBatteries = await loadUserStoredBatteries(client, uid);
      const placedRacks = await loadUserPlacedRacksWithSlots(client, uid);
      const upgrades = await loadUpgradesWithCompat(client);

      const prev = { stock, storedBatteries, placedRacks };
      // Bulk de sala só pode mexer em baterias do armazém/rig.
      // Baterias que estão em carregadores/oficina ficam fora do payload para não serem "desancoradas" no persist.
      const bulkStoredBatteries = prev.storedBatteries.filter(
        (b) => b.workshopSlotIndex == null && b.workshopComponentSlotId == null
      );
      const prevForBulk = {
        stock: { ...prev.stock },
        storedBatteries: [...bulkStoredBatteries],
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

      const rackVal = await validatePlacedRacksForSave(client, out.next!.placedRacks, uid);
      if (!rackVal.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: rackVal.error });
      }

      await persistStockStoredBatteriesPlacedRacks(
        client,
        uid,
        {
          stock: out.next!.stock,
          storedBatteries: out.next!.storedBatteries,
          placedRacks: out.next!.placedRacks as PlacedRackLoaded[]
        },
        saveActivityLogs
      );

      const finalServerUpdatedAt = Date.now();
      await client.query(
        `UPDATE game_states SET last_updated_at = $1, server_updated_at = $2 WHERE user_id = $3`,
        [finalServerUpdatedAt, finalServerUpdatedAt, uid]
      );
      await client.query('COMMIT');

      const smartFill = !!out.smartFill;
      let activityAction = 'room_battery_remove_all';
      if (smartFill) activityAction = 'room_battery_smart';
      else if (batteryUpgradeId) activityAction = 'room_battery_bulk_equip';

      const responseBody: Record<string, unknown> = {
        ok: true,
        serverUpdatedAt: finalServerUpdatedAt,
        stateVersion: finalServerUpdatedAt,
        stock: out.next!.stock,
        storedBatteries: out.next!.storedBatteries,
        placedRacks: out.next!.placedRacks,
        appliedRigs: out.appliedRigs,
        compatibleRigs: out.compatibleRigs,
        smartFill,
        idempotentReplay: false
      };
      attachIntentFingerprint(responseBody, fp);
      try {
        for (const ev of saveActivityLogs) {
          await appendGameActivityLog(db, uid, ev.action, ev.meta);
        }
        await appendGameActivityLog(db, uid, activityAction, {
          roomId: roomNorm,
          batteryUpgradeId: smartFill ? '' : batteryUpgradeId,
          smartFill,
          rigSort,
          appliedRigs: out.appliedRigs,
          compatibleRigs: out.compatibleRigs,
          ok: true,
          source: 'server_room_api',
          idempotencyKey: idem
        });
      } catch (logError) {
        console.warn(
          '[server-room/bulk-batteries] activity log failed after commit:',
          logError instanceof Error ? logError.message : String(logError)
        );
      }
      try {
        await writeGameIntentIdempotencySuccess(prisma, uid, scope, idem, 200, responseBody);
      } catch (idemError) {
        console.warn(
          '[server-room/bulk-batteries] idempotency replay write failed after commit:',
          idemError instanceof Error ? idemError.message : String(idemError)
        );
      }

      return res.json(stripIntentFingerprint(responseBody));
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (e instanceof StoredBatterySaveGuardError) {
        return res.status(409).json({ error: e.message, forceReload: true, code: 'BATTERY_GUARD' });
      }
      console.error('[server-room/bulk-batteries]', e);
      if (smart) {
        return res.status(400).json({
          error: 'Não foi possível aplicar o preenchimento inteligente nesta sala. Recarregue e tente novamente.',
          code: 'SMART_FILL_FAILED',
          forceReload: true
        });
      }
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro interno.');
    } finally {
      client.release();
    }
  });
}
