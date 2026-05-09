import crypto from 'node:crypto';
import type { PoolClient } from 'pg';

type ChangesStoredBattery = {
  id: string;
  itemId: string;
  currentCharge: number;
  powerCapacityWh?: number | null;
  displayName?: string | null;
  imageUrl?: string | null;
  workshopSlotIndex?: number | null;
  workshopComponentSlotId?: string | null;
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
    workshopComponentSlotId:
      r.workshop_component_slot_id != null ? String(r.workshop_component_slot_id) : null
  }));
}

export async function returnRackBatteryToChangesOnNftSanitize(
  client: PoolClient,
  uid: number | string,
  rack: { batteryId?: unknown; currentCharge?: unknown },
  stock: Record<string, number>,
  changes: GameStateLike
): Promise<void> {
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
      if (!changes.storedBatteries!.some((x) => x.id === br.rows[0].id)) {
        const row0 = br.rows[0];
        changes.storedBatteries!.push({
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
      changes.storedBatteries!.push({
        id: crypto.randomUUID(),
        itemId: s,
        currentCharge: charge
      });
    }
    return;
  }
  stock[s] = Math.floor((Number(stock[s]) || 0) + 1);
}
