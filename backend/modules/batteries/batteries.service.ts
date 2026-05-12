import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { normalizeKnown1000WhBatteryCatalogId } from './batteries.catalog.js';

type ChangesStoredBattery = {
  id: string;
  itemId: string;
  displayName?: string | null;
  imageUrl?: string | null;
};

type GameStateLike = {
  storedBatteries?: ChangesStoredBattery[];
  stock?: Record<string, number>;
};

export async function ensureStoredBatteriesArrayFromDb(
  client: PoolClient,
  uid: number | string,
  changes: GameStateLike
): Promise<void> {
  if (Array.isArray(changes.storedBatteries)) return;
  const ext = await client.query(
    'SELECT id, item_id, display_name, image_url FROM stored_batteries WHERE user_id = $1',
    [uid]
  );
  changes.storedBatteries = ext.rows.map((r) => ({
    id: r.id,
    itemId: normalizeKnown1000WhBatteryCatalogId(r.item_id),
    displayName: r.display_name != null ? String(r.display_name) : null,
    imageUrl: r.image_url != null ? String(r.image_url) : null
  }));
}

export async function returnRackBatteryToChangesOnNftSanitize(
  client: PoolClient,
  uid: number | string,
  rack: { batteryId?: unknown },
  stock: Record<string, number>,
  changes: GameStateLike
): Promise<void> {
  const bid = rack.batteryId;
  if (bid == null || String(bid).trim() === '') return;
  const s = String(bid).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
  if (isUuid) {
    const br = await client.query(
      'SELECT id, item_id, display_name, image_url FROM stored_batteries WHERE id = $1 AND user_id = $2',
      [s, uid]
    );
    if (br.rows[0]) {
      await ensureStoredBatteriesArrayFromDb(client, uid, changes);
      if (!changes.storedBatteries!.some((x) => x.id === br.rows[0].id)) {
        const row0 = br.rows[0];
        changes.storedBatteries!.push({
          id: row0.id,
          itemId: normalizeKnown1000WhBatteryCatalogId(row0.item_id),
          displayName: row0.display_name != null ? String(row0.display_name) : null,
          imageUrl: row0.image_url != null ? String(row0.image_url) : null
        });
      }
      return;
    }
  }
  const catalogId = normalizeKnown1000WhBatteryCatalogId(s);
  const u = await client.query('SELECT type FROM upgrades WHERE id = $1', [catalogId]);
  const row = u.rows[0];
  if (row && row.type === 'battery') {
    await ensureStoredBatteriesArrayFromDb(client, uid, changes);
    changes.storedBatteries!.push({
      id: crypto.randomUUID(),
      itemId: catalogId
    });
    return;
  }
  stock[catalogId] = Math.floor((Number(stock[catalogId]) || 0) + 1);
}
