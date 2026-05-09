import type { Application, Request, Response } from 'express';
import type { Pool } from 'pg';
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

export type BatteriesServerRoomDeps = {
  db: Pool;
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

export function registerBatteriesServerRoomRoutes(app: Application, deps: BatteriesServerRoomDeps): void {
  const { db, appendGameActivityLog, validatePlacedRacksForSave, sanitizePlacedRacksNftAutoRoom } = deps;

  app.post('/api/server-room/bulk-batteries', async (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
    const uid = Number(req.userId);
    if (!Number.isFinite(uid) || uid <= 0) return res.status(401).json({ error: 'Não autenticado' });
    const body = req.body || {};
    const roomNorm = normalizePlacedRackRoomId(body.roomId);
    if (!isValidRoomId(roomNorm)) return res.status(400).json({ error: 'Sala inválida.' });
    const batteryUpgradeId = body.batteryUpgradeId != null ? String(body.batteryUpgradeId) : '';
    const runOpts = { smartFill: body.smartFill, rigSort: body.rigSort };

    const client = await db.connect();
    const saveActivityLogs: Array<{ action: string; meta: Record<string, unknown> }> = [];
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
        stock: out.next!.stock,
        storedBatteries: out.next!.storedBatteries,
        placedRacks: out.next!.placedRacks,
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
}
