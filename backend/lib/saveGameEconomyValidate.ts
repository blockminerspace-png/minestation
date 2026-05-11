import type { Pool, PoolClient } from 'pg';
import { STORED_BATTERY_CATALOG_PENDING_ID } from '../modules/batteries/batteries.constants.js';
import {
  CANONICAL_1000WH_BATTERY_ID,
  normalizeKnown1000WhBatteryCatalogId
} from '../modules/batteries/batteries.catalog.js';

/** Alinhado a `RACK_ID_RE` no servidor — IDs de item / instância. */
export const SAVE_GAME_ITEM_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

export { STORED_BATTERY_CATALOG_PENDING_ID };

const MAX_STOCK_KEYS = 3500;
const MAX_STOCK_QTY = 50_000_000;
const MAX_BOX_KEYS = 600;
const MAX_BOX_QTY = 5_000_000;
const MAX_DAILY_KEYS = 250;
const MAX_STORED_BATTERIES = 800;
const DAILY_TS_MIN = 0;
const DAILY_TS_MAX = 4102444800000; // ~2100
function parseIntQty(q: unknown): number | null {
  const n = typeof q === 'number' ? Math.trunc(q) : parseInt(String(q ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseNumericCharge(q: unknown): number | null {
  const n = typeof q === 'number' ? q : parseFloat(String(q ?? ''));
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Chaves que o cliente pode gravar no save (oficina). `tx_*` nunca pelo save. */
export function isClientDailyActionKey(key: string): boolean {
  if (key.length > 96) return false;
  const ad = /^reward_ad_slot_(\d+)$/.exec(key);
  if (ad) {
    const n = Number(ad[1]);
    return n >= 0 && n <= 15;
  }
  const db = /^daily_boost_slot_(\d+)$/.exec(key);
  if (db) {
    const n = Number(db[1]);
    return n >= 0 && n <= 15;
  }
  const ir = /^instant_recharge_slot_(\d+)$/.exec(key);
  if (ir) {
    const n = Number(ir[1]);
    return n >= 0 && n <= 15;
  }
  return false;
}

/** Admin a editar utilizador: chaves mais amplas, mas nunca `tx_*` (idempotência de depósito). */
export function isAdminDailyActionKey(key: string): boolean {
  if (key.startsWith('tx_')) return false;
  if (key.length > 180) return false;
  return /^[a-zA-Z0-9_.:-]+$/.test(key);
}

const STOCK_VALIDATE_LOG_SAMPLES = 24;

async function load1000WhBatteryAliasMap(client: PoolClient): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const target = await client.query<{ id: string }>(
      `SELECT id::text
         FROM upgrades
        WHERE id = $1
          AND (LOWER(COALESCE(type::text, '')) = 'battery' OR LOWER(COALESCE(category::text, '')) = 'battery')
        LIMIT 1`,
      [CANONICAL_1000WH_BATTERY_ID]
    );
    if ((target.rowCount ?? 0) === 0) return out;
    const src = await client.query<{ id: string }>(
      `SELECT id::text
         FROM upgrades
        WHERE id <> $1
          AND (LOWER(COALESCE(type::text, '')) = 'battery' OR LOWER(COALESCE(category::text, '')) = 'battery')
          AND power_capacity = 1000`,
      [CANONICAL_1000WH_BATTERY_ID]
    );
    for (const row of src.rows || []) {
      const id = String(row.id || '').trim();
      if (id) out.set(id, CANONICAL_1000WH_BATTERY_ID);
    }
  } catch (e) {
    console.warn('[batteryAlias] Falha ao ler aliases 1000Wh:', e instanceof Error ? e.message : String(e));
  }
  return out;
}

/**
 * Diagnóstico de falhas ao gravar `stock` (save-game). Causas típicas:
 * - `invalid_key`: chave fora do padrão (espaços, `__proto__`, merge de objetos errado, estado corrompido no cliente).
 * - `bad_qty`: quantidade NaN/negativa/fora do limite após dessincronização ou bug de UI.
 * - `unknown_item`: (já não usado) stock com ids fora de `upgrades` é aceite como legado e regista-se em log.
 */
export type ValidateStockForSaveResult =
  | { ok: true; itemIds: string[]; qtys: number[] }
  | {
      ok: false;
      error: string;
      reason: 'too_many_keys' | 'invalid_key' | 'bad_qty' | 'unknown_item';
      /** Chaves ou IDs de exemplo (nunca o inventário completo). */
      samples: string[];
      meta?: { keyCount?: number };
    };

export async function validateStockForSave(
  client: PoolClient,
  stock: Record<string, unknown>
): Promise<ValidateStockForSaveResult> {
  const keys = Object.keys(stock);
  if (keys.length > MAX_STOCK_KEYS) {
    return {
      ok: false,
      error:
        'O inventário enviado é demasiado grande para guardar de uma vez. Recarregue a página (F5) e tente outra vez; se repetir, contacte o suporte.',
      reason: 'too_many_keys',
      samples: [],
      meta: { keyCount: keys.length }
    };
  }

  const invalidKeys: string[] = [];
  for (const k of keys) {
    const itemId = String(k);
    if (!SAVE_GAME_ITEM_ID_RE.test(itemId)) invalidKeys.push(itemId);
  }
  if (invalidKeys.length > 0) {
    return {
      ok: false,
      error:
        'O inventário contém um identificador de peça inválido. Recarregue a página (F5) para sincronizar com o servidor.',
      reason: 'invalid_key',
      samples: invalidKeys.slice(0, STOCK_VALIDATE_LOG_SAMPLES)
    };
  }

  const itemQty = new Map<string, number>();
  const badQtyKeys: string[] = [];
  const aliasMap = await load1000WhBatteryAliasMap(client);
  for (const k of keys) {
    const rawItemId = String(k);
    const itemId = aliasMap.get(rawItemId) || rawItemId;
    const q = parseIntQty(stock[k]);
    if (q === null || q < 0 || q > MAX_STOCK_QTY) {
      badQtyKeys.push(rawItemId);
      continue;
    }
    itemQty.set(itemId, (itemQty.get(itemId) || 0) + q);
  }
  if (badQtyKeys.length > 0) {
    return {
      ok: false,
      error:
        'Uma ou mais quantidades no inventário são inválidas (número demasiado grande ou não numérico). Recarregue a página (F5).',
      reason: 'bad_qty',
      samples: badQtyKeys.slice(0, STOCK_VALIDATE_LOG_SAMPLES)
    };
  }

  const itemIds = [...itemQty.keys()];
  const qtys = itemIds.map((id) => itemQty.get(id) || 0);
  if (itemIds.length === 0) return { ok: true, itemIds: [], qtys: [] };
  try {
    const chk = await client.query('SELECT id FROM upgrades WHERE id = ANY($1::text[])', [itemIds]);
    const have = new Set((chk.rows as Array<{ id: string }>).map((x) => String(x.id)));
    const missing = itemIds.filter((id) => !have.has(id));
    if (missing.length > 0) {
      console.warn(
        '[validateStockForSave] Stock com ids fora do catálogo (preservado como legado):',
        missing.slice(0, STOCK_VALIDATE_LOG_SAMPLES).join(', ')
      );
    }
  } catch (e) {
    console.warn(
      '[validateStockForSave] Falha ao consultar upgrades (stock não bloqueado):',
      e instanceof Error ? e.message : String(e)
    );
  }
  return { ok: true, itemIds, qtys };
}

export async function validateUnopenedBoxesForSave(
  client: PoolClient,
  boxes: Record<string, unknown>
): Promise<{ ok: true; boxIds: string[]; qtys: number[] } | { ok: false; error: string }> {
  const keys = Object.keys(boxes);
  if (keys.length > MAX_BOX_KEYS) {
    return {
      ok: false,
      error:
        'A lista de caixas por abrir é demasiado longa. Recarregue a página (F5); se o problema continuar, contacte o suporte.'
    };
  }
  const boxIds: string[] = [];
  const qtys: number[] = [];
  for (const k of keys) {
    const boxId = String(k);
    if (!SAVE_GAME_ITEM_ID_RE.test(boxId)) {
      return {
        ok: false,
        error:
          'Há um identificador de caixa inválido nos dados guardados. Recarregue a página (F5) para alinhar com o servidor.'
      };
    }
    const q = parseIntQty(boxes[k]);
    if (q === null || q < 0 || q > MAX_BOX_QTY) {
      return {
        ok: false,
        error:
          'Uma ou mais quantidades de caixas são inválidas. Recarregue a página (F5).'
      };
    }
    boxIds.push(boxId);
    qtys.push(q);
  }
  if (boxIds.length === 0) return { ok: true, boxIds: [], qtys: [] };
  const chk = await client.query('SELECT id FROM loot_boxes WHERE id = ANY($1::text[])', [boxIds]);
  if (chk.rowCount !== boxIds.length) {
    return {
      ok: false,
      error:
        'Há caixas nos dados que já não existem no jogo ou o cliente está desatualizado. Recarregue a página (F5).'
    };
  }
  return { ok: true, boxIds, qtys };
}

export function validateDailyActionsForSave(
  raw: Record<string, unknown>,
  adminOverride: boolean,
  nowMs: number
): { ok: true; keys: string[]; vals: number[] } | { ok: false; error: string } {
  const allow = adminOverride ? isAdminDailyActionKey : isClientDailyActionKey;
  const keys: string[] = [];
  const vals: number[] = [];
  for (const [k0, v0] of Object.entries(raw)) {
    const k = String(k0);
    if (k.startsWith('tx_')) continue;
    if (!allow(k)) {
      return {
        ok: false,
        error:
          'Os registos de utilização diária (oficina / recompensas) contêm dados que o servidor não aceita neste guardar. Recarregue a página (F5).'
      };
    }
    const ts = typeof v0 === 'number' ? v0 : parseFloat(String(v0));
    if (!Number.isFinite(ts)) {
      return {
        ok: false,
        error:
          'Há uma data ou hora inválida nos lembretes diários da oficina. Recarregue a página (F5).'
      };
    }
    const ti = Math.floor(ts);
    if (ti < DAILY_TS_MIN || ti > DAILY_TS_MAX) {
      return {
        ok: false,
        error:
          'Uma data nos lembretes diários está fora do intervalo permitido. Recarregue a página (F5).'
      };
    }
    if (!adminOverride && ti > nowMs + 86400000) {
      return {
        ok: false,
        error:
          'O relógio do teu dispositivo parece adiantado em relação ao servidor; ajusta a data/hora ou recarrega a página (F5).'
      };
    }
    keys.push(k);
    vals.push(ti);
  }
  if (keys.length > MAX_DAILY_KEYS) {
    return {
      ok: false,
      error:
        'Demasiados registos diários de uma vez. Recarregue a página (F5); se persistir, contacte o suporte.'
    };
  }
  return { ok: true, keys, vals };
}

export async function validateStoredBatteriesForSave(
  client: PoolClient,
  uid: number,
  batteries: unknown[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Array.isArray(batteries)) {
    return { ok: false, error: 'O formato das baterias no armazém está incorrecto. Recarregue a página (F5).' };
  }
  if (batteries.length > MAX_STORED_BATTERIES) {
    return {
      ok: false,
      error:
        'Há demasiadas baterias listadas no armazém de uma só vez. Recarregue a página (F5); se for erro, contacte o suporte.'
    };
  }

  let fallbackCatalogId = '';
  try {
    const fbRes = await client.query<{ id: string }>(
      `SELECT id::text FROM upgrades
       WHERE LOWER(COALESCE(type::text, '')) = 'battery'
         AND COALESCE(is_active, 1) <> 0
       ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END,
                COALESCE(base_cost, 0) ASC NULLS LAST,
                id ASC
       LIMIT 1`,
      [CANONICAL_1000WH_BATTERY_ID]
    );
    fallbackCatalogId = String(fbRes.rows[0]?.id || '').trim();
  } catch (e) {
    console.warn(
      '[validateStoredBatteriesForSave] fallback bateria:',
      e instanceof Error ? e.message : String(e)
    );
  }

  type BatRow = { id: string; itemId: string; charge: number; obj: Record<string, unknown> };
  const rows: BatRow[] = [];
  for (const b of batteries) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return {
        ok: false,
        error:
          'Uma das entradas de bateria no armazém está corrompida. Recarregue a página (F5) para voltar a carregar do servidor.'
      };
    }
    const o = b as Record<string, unknown>;
    const id = o.id != null ? String(o.id) : '';
    let itemId = o.itemId != null ? String(o.itemId) : '';
    if (!SAVE_GAME_ITEM_ID_RE.test(id)) {
      return {
        ok: false,
        error: 'Identificador de instância de bateria inválido. Recarregue a página (F5).'
      };
    }
    if (!itemId || !SAVE_GAME_ITEM_ID_RE.test(itemId)) {
      itemId = STORED_BATTERY_CATALOG_PENDING_ID;
    }
    const ch = parseNumericCharge(o.currentCharge);
    if (ch === null || ch < -1 || ch > 1e15) {
      return {
        ok: false,
        error:
          'O valor de carga de uma bateria no armazém é inválido. Recarregue a página (F5).'
      };
    }
    rows.push({ id, itemId, charge: ch, obj: o });
  }
  if (rows.length === 0) return { ok: true };

  const bIds = rows.map((r) => r.id);
  const dupOther = await client.query(
    'SELECT id FROM stored_batteries WHERE id = ANY($1::text[]) AND user_id IS DISTINCT FROM $2 LIMIT 5',
    [bIds, uid]
  );
  if ((dupOther.rowCount ?? 0) > 0) {
    return {
      ok: false,
      error:
        'Detectámos um conflito de identificadores de bateria (dados inconsistentes). Recarregue a página (F5); não uses contas ou sessões ao mesmo tempo no mesmo browser.'
    };
  }

  let dbMap = new Map<string, string>();
  try {
    const dbRes = await client.query<{ id: string; item_id: string | null }>(
      'SELECT id, item_id FROM stored_batteries WHERE user_id = $1 AND id = ANY($2::text[])',
      [uid, bIds]
    );
    for (const row of dbRes.rows || []) {
      dbMap.set(String(row.id).trim(), String(row.item_id ?? '').trim());
    }
  } catch (e) {
    console.warn(
      '[validateStoredBatteriesForSave] SELECT stored_batteries:',
      e instanceof Error ? e.message : String(e)
    );
    dbMap = new Map();
  }

  if (!SAVE_GAME_ITEM_ID_RE.test(fallbackCatalogId)) {
    return {
      ok: false,
      error:
        'Configuração do servidor incompleta (nenhuma bateria ativa no catálogo). Contacte o suporte.'
    };
  }

  const resolvedIds: string[] = [];
  const aliasMap = await load1000WhBatteryAliasMap(client);
  for (const r of rows) {
    let it = r.itemId;
    if (it === STORED_BATTERY_CATALOG_PENDING_ID) {
      const dbv = (dbMap.get(r.id) || '').trim();
      it = SAVE_GAME_ITEM_ID_RE.test(dbv) ? normalizeKnown1000WhBatteryCatalogId(dbv) : fallbackCatalogId;
    }
    it = aliasMap.get(it) || normalizeKnown1000WhBatteryCatalogId(it);
    resolvedIds.push(it);
  }

  const uniqResolved = [...new Set(resolvedIds)];
  let validBattery = new Set<string>();
  try {
    const chk = await client.query<{ id: string }>(
      `SELECT id::text FROM upgrades WHERE id = ANY($1::text[]) AND LOWER(COALESCE(type::text, '')) = 'battery'`,
      [uniqResolved]
    );
    validBattery = new Set((chk.rows || []).map((x) => String(x.id)));
  } catch (e) {
    console.warn(
      '[validateStoredBatteriesForSave] upgrades battery check:',
      e instanceof Error ? e.message : String(e)
    );
  }

  for (let i = 0; i < rows.length; i++) {
    let it = resolvedIds[i]!;
    if (!validBattery.has(it)) {
      console.warn(
        '[validateStoredBatteriesForSave] item_id normalizado (legado ou catálogo alterado) inst=%s was=%s',
        rows[i]!.id,
        it
      );
      it = fallbackCatalogId;
    }
    rows[i]!.obj.itemId = it;
  }

  return { ok: true };
}

/** Erro de guarda ao aplicar remoções em `stored_batteries` (save-game / persistência de sala). */
export class StoredBatterySaveGuardError extends Error {
  readonly httpStatus = 409 as const;
  readonly forceReload = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'StoredBatterySaveGuardError';
  }
}

function collectBatteryInstanceRefsFromWorkshopPayload(workshopSlots: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(workshopSlots)) return out;
  for (const w of workshopSlots) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    const internal = (w as Record<string, unknown>).internalSlots;
    if (!internal || typeof internal !== 'object' || Array.isArray(internal)) continue;
    for (const v of Object.values(internal)) {
      if (v == null) continue;
      const s = String(v).trim();
      if (s) out.add(s);
    }
  }
  return out;
}

/** UUIDs / ids de `placed_racks.battery_id` já persistidos na BD (fonte de verdade antes do merge do payload). */
export async function collectBatteryIdsFromPlacedRacksDb(
  client: PoolClient,
  uid: number | string
): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const res = await client.query<{ battery_id: string | null }>(
      `SELECT battery_id FROM placed_racks WHERE user_id = $1 AND battery_id IS NOT NULL AND btrim(battery_id::text) <> ''`,
      [uid]
    );
    for (const row of res.rows || []) {
      const s = String(row.battery_id ?? '').trim();
      if (s) out.add(s);
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Instâncias referenciadas na oficina já persistida na BD (save "servers" sem `workshopSlots`). */
async function collectBatteryInstanceRefsFromWorkshopDb(client: PoolClient, uid: number | string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const res = await client.query<{ internal_state: string | null }>(
      'SELECT internal_state FROM workshop_slots WHERE user_id = $1',
      [uid]
    );
    for (const row of res.rows || []) {
      const raw = row.internal_state;
      if (!raw) continue;
      let o: unknown;
      try {
        o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      for (const v of Object.values(o as Record<string, unknown>)) {
        if (v == null) continue;
        const s = String(v).trim();
        if (s) out.add(s);
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function collectBatteryIdsFromPlacedRacksPayload(placedRacks: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(placedRacks)) return out;
  for (const r of placedRacks) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const bid = (r as Record<string, unknown>).batteryId;
    if (bid != null && String(bid).trim()) out.add(String(bid).trim());
  }
  return out;
}

/**
 * Impede que o save apague linhas de `stored_batteries` quando o payload não mostra para onde
 * foram as instâncias (ex.: cliente incompleto após rede/VM). Cada id que deixaria de estar
 * listado no armazém tem de aparecer como `batteryId` numa rig ou como valor em `internalSlots`
 * da oficina no mesmo pedido.
 */
export async function validateStoredBatteryWarehouseRemovalAllowed(
  client: PoolClient,
  uid: number | string,
  incomingIds: string[],
  changes: { placedRacks?: unknown; workshopSlots?: unknown },
  adminOverride: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (adminOverride) return { ok: true };

  const dbRes = await client.query<{ id: string }>('SELECT id FROM stored_batteries WHERE user_id = $1', [uid]);
  const dbIds = (dbRes.rows || [])
    .map((r) => String(r.id || '').trim())
    .filter((id) => id.length > 0);
  if (dbIds.length === 0) return { ok: true };

  const incomingSet = new Set(
    incomingIds.map((id) => String(id || '').trim()).filter((id) => id.length > 0)
  );
  const toDrop = dbIds.filter((id) => !incomingSet.has(id));
  if (toDrop.length === 0) return { ok: true };

  const referenced = new Set<string>([
    ...collectBatteryIdsFromPlacedRacksPayload(changes.placedRacks),
    ...collectBatteryInstanceRefsFromWorkshopPayload(changes.workshopSlots)
  ]);
  for (const id of await collectBatteryInstanceRefsFromWorkshopDb(client, uid)) {
    referenced.add(id);
  }
  for (const id of await collectBatteryIdsFromPlacedRacksDb(client, uid)) {
    referenced.add(id);
  }

  const orphans = toDrop.filter((id) => !referenced.has(id));
  if (orphans.length > 0) {
    return {
      ok: false,
      error:
        'O armazém de baterias enviado deixa de listar unidades que o servidor ainda tem no armazém, sem aparecerem montadas nas rigs ou na oficina neste guardar. Recarrega a página (F5) para sincronizar.'
    };
  }
  return { ok: true };
}

/**
 * Normaliza o array `storedBatteries` antes de validar/persistir:
 * - deduplica por `id` (mantém a última entrada — alinhado ao estado mais recente do cliente);
 * - remove entradas cujo `id` já está montado na oficina (`internalSlots`) ou numa rig (`batteryId`),
 *   evitando duplicar a mesma instância no armazém (bug do carregador Genesis / cliente).
 */
export function sanitizeStoredBatteriesForSavePayload(
  batteries: unknown[],
  workshopSlots: unknown,
  placedRacks: unknown
): unknown[] {
  if (!Array.isArray(batteries)) return [];
  const mounted = new Set<string>([
    ...collectBatteryInstanceRefsFromWorkshopPayload(workshopSlots),
    ...collectBatteryIdsFromPlacedRacksPayload(placedRacks)
  ]);
  const byId = new Map<string, { id: string; itemId: string; currentCharge: number }>();
  for (const b of batteries) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    const o = b as Record<string, unknown>;
    const id = o.id != null ? String(o.id).trim() : '';
    let itemId = o.itemId != null ? String(o.itemId).trim() : '';
    if (!SAVE_GAME_ITEM_ID_RE.test(id)) continue;
    if (!itemId || !SAVE_GAME_ITEM_ID_RE.test(itemId)) {
      itemId = STORED_BATTERY_CATALOG_PENDING_ID;
    }
    const ch = parseNumericCharge(o.currentCharge);
    if (ch === null || ch < -1 || ch > 1e15) continue;
    if (mounted.has(id)) continue;
    byId.set(id, { id, itemId, currentCharge: ch });
  }
  return [...byId.values()];
}

const WORKSHOP_SLOT_COUNT = 6;
const MAX_WORKSHOP_JSON_KEYS = 400;

export type WorkshopSlotClientPayload = {
  itemId: string;
  currentCharge: number;
  internalSlots: Record<string, unknown>;
  slotCharges: Record<string, number>;
  slotItemIds: Record<string, string> | null;
};

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** Valida e normaliza `workshopSlots` antes do merge com o estado na BD (save-game). */
export async function validateWorkshopSlotsPayloadForSave(
  client: PoolClient,
  slots: unknown,
  opts: { adminOverride?: boolean }
): Promise<{ ok: true; normalized: (WorkshopSlotClientPayload | null)[] } | { ok: false; error: string }> {
  if (!Array.isArray(slots)) {
    return {
      ok: false,
      error:
        'O estado da oficina foi enviado num formato inválido. Recarregue a página (F5).'
    };
  }
  if (slots.length > WORKSHOP_SLOT_COUNT) {
    return {
      ok: false,
      error:
        'A oficina enviou demasiadas bancadas de uma vez. Recarregue a página (F5); se o erro voltar, contacte o suporte.'
    };
  }
  const padded: unknown[] = [...slots];
  while (padded.length < WORKSHOP_SLOT_COUNT) padded.push(null);

  const wantIds = new Set<string>();
  const staged: (WorkshopSlotClientPayload | null)[] = [];

  for (let i = 0; i < WORKSHOP_SLOT_COUNT; i++) {
    const w = padded[i];
    if (w == null) {
      staged.push(null);
      continue;
    }
    if (!isPlainRecord(w)) {
      return {
        ok: false,
        error:
          'Uma das bancadas da oficina tem dados inválidos. Recarregue a página (F5).'
      };
    }
    const itemIdRaw = w.itemId != null ? String(w.itemId).trim() : '';
    if (!itemIdRaw) {
      staged.push(null);
      continue;
    }
    if (!SAVE_GAME_ITEM_ID_RE.test(itemIdRaw)) {
      return {
        ok: false,
        error:
          'Há uma peça na oficina com identificador inválido. Recarregue a página (F5).'
      };
    }
    wantIds.add(itemIdRaw);

    const cc = parseNumericCharge(w.currentCharge);
    const currentCharge = cc === null || cc < 0 ? 0 : cc;

    let internalSlots: Record<string, unknown> = {};
    if (w.internalSlots != null) {
      if (!isPlainRecord(w.internalSlots)) {
        return {
          ok: false,
          error:
            'O conteúdo instalado num carregador (oficina) está num formato inválido. Recarregue a página (F5).'
        };
      }
      const keys = Object.keys(w.internalSlots);
      if (keys.length > MAX_WORKSHOP_JSON_KEYS) {
        return {
          ok: false,
          error:
            'Demasiados componentes listados na oficina. Recarregue a página (F5).'
        };
      }
      internalSlots = { ...w.internalSlots };
    }

    const slotCharges: Record<string, number> = {};
    if (w.slotCharges != null) {
      if (!isPlainRecord(w.slotCharges)) {
        return {
          ok: false,
          error:
            'Os níveis de carga das baterias na oficina estão num formato inválido. Recarregue a página (F5).'
        };
      }
      for (const [k, v] of Object.entries(w.slotCharges)) {
        if (k.length > 200) {
          return {
            ok: false,
            error:
              'Detectámos dados de carga inconsistentes na oficina. Recarregue a página (F5).'
          };
        }
        const n = parseNumericCharge(v);
        if (n === null || n < 0) {
          return {
            ok: false,
            error:
              'Um valor de carga na oficina é inválido. Recarregue a página (F5).'
          };
        }
        slotCharges[k] = n;
      }
      if (Object.keys(slotCharges).length > MAX_WORKSHOP_JSON_KEYS) {
        return {
          ok: false,
          error:
            'Demasiadas entradas de carga na oficina. Recarregue a página (F5).'
        };
      }
    }

    let slotItemIds: Record<string, string> | null = null;
    if (w.slotItemIds != null) {
      if (!isPlainRecord(w.slotItemIds)) {
        return {
          ok: false,
          error:
            'A referência de peças na oficina está num formato inválido. Recarregue a página (F5).'
        };
      }
      slotItemIds = {};
      for (const [k, v] of Object.entries(w.slotItemIds)) {
        if (k.length > 200) {
          return {
            ok: false,
            error:
              'Detectámos referências de peças inválidas na oficina. Recarregue a página (F5).'
          };
        }
        if (v == null) continue;
        const sid = String(v).trim();
        if (!SAVE_GAME_ITEM_ID_RE.test(sid)) {
          return {
            ok: false,
            error:
              'Uma peça referenciada na oficina tem identificador inválido. Recarregue a página (F5).'
          };
        }
        slotItemIds[k] = sid;
        wantIds.add(sid);
      }
    }

    staged.push({
      itemId: itemIdRaw,
      currentCharge,
      internalSlots,
      slotCharges,
      slotItemIds
    });
  }

  if (wantIds.size === 0) {
    return { ok: true, normalized: staged };
  }

  const ids = [...wantIds];
  let upRes: { rows: Array<{ id: string; type?: unknown; category?: unknown }>; rowCount?: number | null };
  try {
    upRes = await client.query(`SELECT id, type, category FROM upgrades WHERE id = ANY($1::text[])`, [ids]);
  } catch (e) {
    console.warn(
      '[validateWorkshopSlotsPayloadForSave] Erro ao ler upgrades:',
      e instanceof Error ? e.message : String(e)
    );
    return {
      ok: false,
      error:
        'Não foi possível validar a oficina na base de dados. Recarregue a página (F5) e tente de novo.'
    };
  }
  const defMap = new Map<string, { type: string; category: string }>();
  for (const row of upRes.rows as Array<{ id: string; type?: unknown; category?: unknown }>) {
    defMap.set(String(row.id), {
      type: String(row.type ?? ''),
      category: String(row.category ?? '')
    });
  }
  const haveUp = new Set(defMap.keys());
  const missingWorkshop = ids.filter((id) => !haveUp.has(id));
  if (missingWorkshop.length > 0) {
    console.warn(
      '[validateWorkshopSlotsPayloadForSave] IDs órfãos (legado; validação relaxada):',
      missingWorkshop.slice(0, 16).join(', ')
    );
    for (const mid of missingWorkshop) {
      defMap.set(mid, { type: 'charger', category: 'oficina' });
    }
  }

  const admin = !!opts.adminOverride;
  for (const s of staged) {
    if (!s) continue;
    let def = defMap.get(s.itemId);
    if (!def) {
      defMap.set(s.itemId, { type: 'charger', category: 'oficina' });
      def = defMap.get(s.itemId)!;
    }
    if (!admin) {
      const t = def.type.toLowerCase();
      const c = def.category.toLowerCase();
      if (t !== 'charger' && c !== 'oficina') {
        return {
          ok: false,
          error:
            'Só é permitido instalar na oficina estruturas da categoria Oficina ou carregadores. Recarregue a página (F5).'
        };
      }
    }
    if (s.slotItemIds) {
      for (const sid of Object.values(s.slotItemIds)) {
        if (!defMap.has(sid)) {
          defMap.set(sid, { type: 'battery', category: 'battery' });
        }
      }
    }
  }

  return { ok: true, normalized: staged };
}

function isPlainObjectRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Preenche `slotItemIds` em slots da oficina quando há instância em `internalSlots` mas falta o
 * `battery_item_id` (estado legado após saves que corromperam `slot_item_ids`). Usa o último
 * registo em `charging_history` por `battery_instance_id`.
 */
export async function enrichWorkshopSlotsSlotItemIdsFromChargingHistory(
  client: Pool | PoolClient,
  userEmail: string,
  workshopSlots: unknown[]
): Promise<void> {
  const email = String(userEmail || '').trim();

  const orphans: string[] = [];
  const instanceIds: string[] = [];
  for (const ws of workshopSlots) {
    if (!ws || !isPlainObjectRecord(ws)) continue;
    const intRaw = ws.internalSlots;
    const sidRaw = ws.slotItemIds;
    if (!isPlainObjectRecord(intRaw)) continue;
    const sidMap = isPlainObjectRecord(sidRaw) ? sidRaw : {};
    for (const [slotId, instId] of Object.entries(intRaw)) {
      if (instId === undefined || instId === null) continue;
      const clean = String(instId).trim();
      if (clean.length < 20) continue;
      if (!SAVE_GAME_ITEM_ID_RE.test(clean)) continue;
      instanceIds.push(clean);
      const existingSid = sidMap[slotId];
      if (existingSid !== undefined && existingSid !== null && String(existingSid).trim() !== '') {
        continue;
      }
      orphans.push(clean);
    }
  }

  const uniqAll = [...new Set(instanceIds)];
  try {
    const storedResolve = new Map<string, { itemId: string; charge: number }>();
    if (uniqAll.length > 0) {
      const sbRes = await client.query(
        `SELECT id, item_id, current_charge
           FROM stored_batteries
          WHERE id = ANY($1::text[])`,
        [uniqAll]
      );
      for (const row of sbRes.rows as Array<{ id: string; item_id: string | null; current_charge: unknown }>) {
        const bid = String(row.id || '').trim();
        const iid = String(row.item_id || '').trim();
        const charge = Number(row.current_charge);
        if (bid) storedResolve.set(bid, { itemId: iid, charge: Number.isFinite(charge) ? charge : 0 });
      }
    }

    const resolve = new Map<string, string>();
    for (const [bid, row] of storedResolve.entries()) {
      if (row.itemId) resolve.set(bid, row.itemId);
    }

    const orphanIds = [...new Set(orphans.filter((id) => !resolve.has(id)))];
    if (email && orphanIds.length > 0) {
      const histRes = await client.query(
        `SELECT DISTINCT ON (battery_instance_id) battery_instance_id, battery_item_id
         FROM charging_history
         WHERE user_email = $1
           AND battery_instance_id = ANY($2::text[])
           AND battery_item_id IS NOT NULL
           AND BTRIM(battery_item_id::text) <> ''
         ORDER BY battery_instance_id, timestamp DESC`,
        [email, orphanIds]
      );
      for (const row of histRes.rows as Array<{ battery_instance_id: string; battery_item_id: string }>) {
        const bid = String(row.battery_instance_id || '').trim();
        const iid = String(row.battery_item_id || '').trim();
        if (bid && iid) resolve.set(bid, iid);
      }
    }
    if (resolve.size === 0 && storedResolve.size === 0) return;

    for (const ws of workshopSlots) {
      if (!ws || !isPlainObjectRecord(ws)) continue;
      const intRaw = ws.internalSlots;
      if (!isPlainObjectRecord(intRaw)) continue;
      const sidRaw = ws.slotItemIds;
      const chargeRaw = ws.slotCharges;
      const nextMap: Record<string, string> = isPlainObjectRecord(sidRaw)
        ? Object.fromEntries(
            Object.entries(sidRaw)
              .filter(([, v]) => v != null && String(v).trim() !== '')
              .map(([k, v]) => [k, String(v).trim()])
          )
        : {};
      const nextCharges: Record<string, number> = isPlainObjectRecord(chargeRaw)
        ? Object.fromEntries(
            Object.entries(chargeRaw)
              .map(([k, v]) => [k, Number(v)])
              .filter(([, v]) => Number.isFinite(v))
          )
        : {};
      let changed = false;
      for (const [slotId, instId] of Object.entries(intRaw)) {
        if (instId === undefined || instId === null) continue;
        const clean = String(instId).trim();
        const itemIdGuess = resolve.get(clean);
        if (itemIdGuess && (!nextMap[slotId] || nextMap[slotId].trim() === '')) {
          nextMap[slotId] = itemIdGuess;
          changed = true;
        }
        const stored = storedResolve.get(clean);
        if (stored) {
          nextCharges[slotId] = stored.charge;
          changed = true;
        }
      }
      if (changed) ws.slotItemIds = nextMap;
      if (changed) ws.slotCharges = nextCharges;
    }
  } catch (e) {
    console.warn(
      '[enrichWorkshopSlotsSlotItemIdsFromChargingHistory]',
      e instanceof Error ? e.message : String(e)
    );
  }
}

const WORKSHOP_LINK_INSTANCE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Após gravar `workshop_slots`, alinha `stored_batteries`: apontadores provisórios + `current_charge`
 * a partir do payload normalizado (mesma fonte que o JSON da oficina).
 */
export async function refreshStoredBatteriesWorkshopLinkage(
  client: PoolClient,
  userId: number,
  workshopNorm: (WorkshopSlotClientPayload | null)[]
): Promise<void> {
  const uid = Math.floor(Number(userId));
  if (!Number.isFinite(uid) || uid <= 0) return;

  await client.query(
    `UPDATE stored_batteries
        SET workshop_slot_index = NULL,
            workshop_component_slot_id = NULL
      WHERE user_id = $1
        AND workshop_slot_index IS NOT NULL`,
    [uid]
  );

  for (let i = 0; i < workshopNorm.length; i++) {
    const w = workshopNorm[i];
    if (!w?.itemId || !w.internalSlots || typeof w.internalSlots !== 'object') continue;
    const charges = w.slotCharges && typeof w.slotCharges === 'object' ? w.slotCharges : {};
    for (const [compId, rawVal] of Object.entries(w.internalSlots)) {
      if (rawVal == null) continue;
      const bid = String(rawVal).trim();
      if (!bid || !WORKSHOP_LINK_INSTANCE_UUID_RE.test(bid)) continue;
      const chRaw = (charges as Record<string, unknown>)[compId];
      const hasExplicitSlotCharge =
        chRaw !== undefined &&
        chRaw !== null &&
        String(chRaw).trim() !== '' &&
        !(typeof chRaw === 'number' && !Number.isFinite(chRaw));

      if (!hasExplicitSlotCharge) {
        await client.query(
          `UPDATE stored_batteries
              SET workshop_slot_index = $1,
                  workshop_component_slot_id = $2
            WHERE user_id = $3 AND id = $4`,
          [i, String(compId).slice(0, 200), uid, bid]
        );
        continue;
      }

      const ch = typeof chRaw === 'number' && Number.isFinite(chRaw) ? chRaw : Number(chRaw);
      const currentCharge = Number.isFinite(ch) ? Math.max(0, ch) : 0;
      await client.query(
        `UPDATE stored_batteries
            SET workshop_slot_index = $1,
                workshop_component_slot_id = $2,
                current_charge = $3
          WHERE user_id = $4 AND id = $5`,
        [i, String(compId).slice(0, 200), currentCharge, uid, bid]
      );
    }
  }
}
