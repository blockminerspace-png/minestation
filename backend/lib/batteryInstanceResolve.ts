import type { PoolClient } from 'pg';

/**
 * Identidade física (`stored_batteries.id` / `placed_racks.battery_id` instância) vs catálogo (`upgrades.id`).
 * Resolver central — nunca tratar UUID como `upgradeId` sem resolver `battery_item_id`.
 */

export type BatteryResolutionSource =
  | 'stored_batteries'
  | 'workshop_slots_db'
  | 'workshop_slots_payload'
  | 'charging_history'
  | 'placed_racks_db'
  | 'catalog_bare_id';

export type ResolvedRackBatteryRef = {
  physicalInstanceId: string | null;
  catalogItemId: string;
  source: BatteryResolutionSource;
};

/** RFC 4122 v4 (variant + version) — preferido. */
const UUID_V4_STRICT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Forma 8-4-4-4-12 só com hex (aceita variantes armazenadas fora do RFC). */
const UUID_LOOSE_HEX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function batteryIdLooksLikePhysicalInstanceUuid(id: string | null | undefined): boolean {
  const s = id != null ? String(id).trim() : '';
  if (s.length < 32) return false;
  if (UUID_V4_STRICT_RE.test(s)) return true;
  return s.length === 36 && UUID_LOOSE_HEX_RE.test(s);
}

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (isPlainRecord(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t) as unknown;
    return isPlainRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Oficina (BD): `internal_state` + `slot_item_ids` por chave de slot → instância → catálogo.
 */
export function workshopDbRowInstanceToCatalog(
  internalState: unknown,
  slotItemIds: unknown
): Map<string, string> {
  const out = new Map<string, string>();
  const int = parseJsonObject(internalState);
  const sid = parseJsonObject(slotItemIds);
  if (!int || !sid) return out;
  for (const [slotKey, rawInst] of Object.entries(int)) {
    if (rawInst == null) continue;
    const inst = String(rawInst).trim();
    if (!batteryIdLooksLikePhysicalInstanceUuid(inst)) continue;
    const catRaw = sid[slotKey];
    const cat = catRaw != null ? String(catRaw).trim() : '';
    if (cat) out.set(inst, cat);
  }
  return out;
}

/** Payload cliente: `internalSlots` / `slotItemIds` (camelCase). */
export function workshopPayloadInstanceToCatalog(workshopSlots: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(workshopSlots)) return out;
  for (const w of workshopSlots) {
    if (!w || !isPlainRecord(w)) continue;
    const int = (w.internalSlots ?? w.internal_state) as unknown;
    const sid = (w.slotItemIds ?? w.slot_item_ids) as unknown;
    const m = workshopDbRowInstanceToCatalog(int, sid);
    for (const [k, v] of m) out.set(k, v);
  }
  return out;
}

export type RackBatteryCatalogBatchResult = {
  /** `placed_racks.battery_id` (instância ou catálogo) → `battery_item_id` / `upgrades.id` */
  rackBatteryToCatalog: Map<string, string>;
  /**
   * Instância montada na rig (payload ou BD) sem catálogo resolvido — não validar como upgradeId;
   * evita falso "Item desconhecido no equipamento" para UUID válida.
   */
  unresolvedPhysicalOnRack: Set<string>;
};

/**
 * Ordem de resolução do catálogo (alinhado à regra de produto):
 * 1. `stored_batteries`
 * 2. oficina (BD) — `internal_state` + `slot_item_ids`
 * 3. oficina (payload do mesmo save)
 * 4. `charging_history` (último `battery_item_id` por instância)
 * 5. `placed_racks` (BD) — confirma montagem; não traz `item_id` (só sinaliza instância válida em rig)
 * 6. payload das rigs — instância listada como `batteryId` no pedido
 * 7. valor já é id de catálogo (`upgrades`) — o caller valida com Prisma
 */
export async function resolveRackBatteryIdsToCatalogItemIds(
  client: PoolClient,
  userId: number | string,
  rackBatteryIds: string[],
  opts?: {
    payloadPlacedRacks?: unknown;
    payloadWorkshopSlots?: unknown;
  }
): Promise<RackBatteryCatalogBatchResult> {
  const rackBatteryToCatalog = new Map<string, string>();
  const unresolvedPhysicalOnRack = new Set<string>();

  const uid = typeof userId === 'number' ? userId : parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { rackBatteryToCatalog, unresolvedPhysicalOnRack };
  }

  const ids = [...new Set(rackBatteryIds.map((x) => String(x || '').trim()).filter((x) => x.length > 0))];
  if (ids.length === 0) return { rackBatteryToCatalog, unresolvedPhysicalOnRack };

  const storageToItem = new Map<string, string>();
  const sbRes = await client.query(
    `SELECT id::text AS id, item_id::text AS item_id FROM stored_batteries WHERE user_id = $1 AND id = ANY($2::text[])`,
    [uid, ids]
  );
  for (const row of sbRes.rows || []) {
    const id = String((row as { id?: string }).id || '').trim();
    const itemId = String((row as { item_id?: string }).item_id || '').trim();
    if (id && itemId) storageToItem.set(id, itemId);
  }

  const workshopDbToCatalog = new Map<string, string>();
  const wsRes = await client.query(
    `SELECT internal_state, slot_item_ids FROM workshop_slots WHERE user_id = $1`,
    [uid]
  );
  for (const row of wsRes.rows || []) {
    const m = workshopDbRowInstanceToCatalog(
      (row as { internal_state?: unknown }).internal_state,
      (row as { slot_item_ids?: unknown }).slot_item_ids
    );
    for (const [k, v] of m) workshopDbToCatalog.set(k, v);
  }

  const workshopPayloadToCatalog = workshopPayloadInstanceToCatalog(opts?.payloadWorkshopSlots);

  const historyToItem = new Map<string, string>();
  const histRes = await client.query(
    `SELECT DISTINCT ON (battery_instance_id) battery_instance_id::text AS iid, battery_item_id::text AS item_id
       FROM charging_history
      WHERE user_email = (SELECT email FROM users WHERE id = $1 LIMIT 1)
        AND battery_instance_id = ANY($2::text[])
        AND battery_item_id IS NOT NULL
        AND BTRIM(battery_item_id::text) <> ''
      ORDER BY battery_instance_id, timestamp DESC`,
    [uid, ids]
  );
  for (const row of histRes.rows || []) {
    const iid = String((row as { iid?: string }).iid || '').trim();
    const itemId = String((row as { item_id?: string }).item_id || '').trim();
    if (iid && itemId) historyToItem.set(iid, itemId);
  }

  const dbPlacedIds = new Set<string>();
  const prRes = await client.query(
    `SELECT DISTINCT battery_id::text AS bid FROM placed_racks
      WHERE user_id = $1 AND battery_id IS NOT NULL AND battery_id = ANY($2::text[])`,
    [uid, ids]
  );
  for (const row of prRes.rows || []) {
    const bid = String((row as { bid?: string }).bid || '').trim();
    if (bid) dbPlacedIds.add(bid);
  }

  const payloadMountedIds = new Set<string>(collectBatteryIdsFromPlacedRacksPayload(opts?.payloadPlacedRacks));

  for (const bid of ids) {
    const fromStore = storageToItem.get(bid);
    if (fromStore) {
      rackBatteryToCatalog.set(bid, fromStore);
      continue;
    }
    const fromWsDb = workshopDbToCatalog.get(bid);
    if (fromWsDb) {
      rackBatteryToCatalog.set(bid, fromWsDb);
      continue;
    }
    const fromWsPay = workshopPayloadToCatalog.get(bid);
    if (fromWsPay) {
      rackBatteryToCatalog.set(bid, fromWsPay);
      continue;
    }
    const fromHist = historyToItem.get(bid);
    if (fromHist) {
      rackBatteryToCatalog.set(bid, fromHist);
      continue;
    }

    if (!batteryIdLooksLikePhysicalInstanceUuid(bid)) {
      rackBatteryToCatalog.set(bid, bid);
      continue;
    }

    const mountedDb = dbPlacedIds.has(bid);
    const mountedPayload = payloadMountedIds.has(bid);
    if (mountedDb || mountedPayload) {
      unresolvedPhysicalOnRack.add(bid);
      continue;
    }

    unresolvedPhysicalOnRack.add(bid);
  }

  return { rackBatteryToCatalog, unresolvedPhysicalOnRack };
}

function collectBatteryIdsFromPlacedRacksPayload(placedRacks: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(placedRacks)) return out;
  for (const r of placedRacks) {
    if (!r || typeof r !== 'object') continue;
    const bid = (r as Record<string, unknown>).batteryId;
    if (bid != null && String(bid).trim()) out.push(String(bid).trim());
  }
  return out;
}
