/**
 * Leituras e snapshots para persistir baterias com energia (Wh) e catálogo
 * sem depender só de joins frágeis após a instância sair do armazém.
 */
import type { PoolClient } from 'pg';

export const RACK_BATTERY_INSTANCE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRackBatteryInstanceUuid(batteryId: string | null | undefined): boolean {
  return RACK_BATTERY_INSTANCE_UUID_RE.test(String(batteryId ?? '').trim());
}

export type StoredBatteryRowSnap = {
  id: string;
  item_id: string;
  power_capacity_wh: number | null;
  display_name: string | null;
  image_url: string | null;
};

export async function loadStoredBatteryRowsForIds(
  client: Pick<PoolClient, 'query'>,
  userId: number | string,
  ids: string[]
): Promise<Map<string, StoredBatteryRowSnap>> {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0 || !Array.isArray(ids) || ids.length === 0) return new Map();
  const res = await client.query(
    `SELECT id, item_id, power_capacity_wh, display_name, image_url
       FROM stored_batteries WHERE user_id = $1 AND id = ANY($2::text[])`,
    [uid, ids]
  );
  const m = new Map<string, StoredBatteryRowSnap>();
  for (const row of res.rows as StoredBatteryRowSnap[]) {
    m.set(String(row.id), row);
  }
  return m;
}

export function collectMountedBatteryInstanceIdsFromPlacedRacks(
  racks: Array<{ batteryId?: unknown }> | null | undefined
): string[] {
  if (!Array.isArray(racks) || racks.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of racks) {
    const bid = r?.batteryId != null ? String(r.batteryId).trim() : '';
    if (!bid || !isRackBatteryInstanceUuid(bid) || seen.has(bid)) continue;
    seen.add(bid);
    out.push(bid);
  }
  return out;
}

export type UpgradeBattSnap = {
  id: string;
  power_capacity: number | null;
  name: string;
  image: string | null;
};

export async function fetchBatteryUpgradeRowsByIds(
  client: Pick<PoolClient, 'query'>,
  catalogIds: string[]
): Promise<Map<string, UpgradeBattSnap>> {
  const uniq = [...new Set(catalogIds.map((x) => String(x).trim()).filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const res = await client.query(
    `SELECT id, power_capacity, name, image FROM upgrades
      WHERE id = ANY($1::text[])
        AND (lower(COALESCE(type::text, '')) = 'battery' OR lower(COALESCE(category::text, '')) = 'battery')`,
    [uniq]
  );
  const m = new Map<string, UpgradeBattSnap>();
  for (const row of res.rows as {
    id: string;
    power_capacity: number | null;
    name: string;
    image: string | null;
  }[]) {
    m.set(String(row.id), {
      id: String(row.id),
      power_capacity: row.power_capacity != null ? Number(row.power_capacity) : null,
      name: String(row.name ?? ''),
      image: row.image != null ? String(row.image) : null
    });
  }
  return m;
}

export type RackBatteryPersistCols = {
  catalogItemId: string | null;
  powerWh: number | null;
  displayName: string | null;
  imageUrl: string | null;
};

export type PrevPlacedRackBattRow = {
  battery_id: string | null;
  battery_catalog_item_id?: string | null;
  battery_power_capacity_wh?: number | null;
  battery_display_name?: string | null;
  battery_image_url?: string | null;
};

export function buildRackBatteryPersistSnapshot(
  batteryId: string | null | undefined,
  instanceSnapshot: Map<string, StoredBatteryRowSnap>,
  upgradeByCatalog: Map<string, UpgradeBattSnap>,
  prevRow?: PrevPlacedRackBattRow | null
): RackBatteryPersistCols {
  const bid = batteryId != null ? String(batteryId).trim() : '';
  if (!bid) {
    return { catalogItemId: null, powerWh: null, displayName: null, imageUrl: null };
  }

  let catalogId: string | null = null;
  if (isRackBatteryInstanceUuid(bid)) {
    const inst = instanceSnapshot.get(bid);
    catalogId = inst?.item_id != null ? String(inst.item_id).trim() : null;
    if (!catalogId && prevRow && String(prevRow.battery_id || '') === bid) {
      catalogId =
        prevRow.battery_catalog_item_id != null ? String(prevRow.battery_catalog_item_id).trim() : null;
    }
  } else {
    catalogId = bid;
  }

  if (!catalogId) {
    if (prevRow && String(prevRow.battery_id || '') === bid) {
      return {
        catalogItemId: prevRow.battery_catalog_item_id ?? null,
        powerWh: prevRow.battery_power_capacity_wh ?? null,
        displayName: prevRow.battery_display_name ?? null,
        imageUrl: prevRow.battery_image_url ?? null
      };
    }
    return { catalogItemId: null, powerWh: null, displayName: null, imageUrl: null };
  }

  const u = upgradeByCatalog.get(catalogId);
  const inst = isRackBatteryInstanceUuid(bid) ? instanceSnapshot.get(bid) : undefined;
  const power = u?.power_capacity ?? (inst?.power_capacity_wh != null ? Number(inst.power_capacity_wh) : null);
  const display =
    (inst?.display_name != null && String(inst.display_name).trim() !== '' ? String(inst.display_name) : null) ||
    (u?.name != null && String(u.name).trim() !== '' ? String(u.name) : null);
  const imgRaw =
    (inst?.image_url != null && String(inst.image_url).trim() !== '' ? String(inst.image_url) : null) ||
    (u?.image != null && String(u.image).trim() !== '' ? String(u.image) : null);
  const img = imgRaw && imgRaw.trim() !== '' ? imgRaw.trim() : null;
  return {
    catalogItemId: catalogId,
    powerWh: power != null && Number.isFinite(Number(power)) ? Number(power) : null,
    displayName: display,
    imageUrl: img
  };
}
