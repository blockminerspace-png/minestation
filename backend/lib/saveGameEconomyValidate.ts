import type { PoolClient } from 'pg';
import { STORED_BATTERY_CATALOG_PENDING_ID } from '../modules/batteries/batteries.constants.js';
import { normalizeKnown1000WhBatteryCatalogId } from '../modules/batteries/batteries.catalog.js';

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

/**
 * Sistema de carregamento descontinuado em 20260516180000_battery_uuids_and_purge_charging:
 * o cliente já não pode escrever chaves de daily-boost / reward-ad / instant-recharge.
 * Mantém-se a função para compatibilidade, mas nunca aceita chaves.
 */
export function isClientDailyActionKey(_key: string): boolean {
  return false;
}

/** Admin a editar utilizador: chaves mais amplas, mas nunca `tx_*` (idempotência de depósito). */
export function isAdminDailyActionKey(key: string): boolean {
  if (key.startsWith('tx_')) return false;
  if (key.length > 180) return false;
  return /^[a-zA-Z0-9_.:-]+$/.test(key);
}

const STOCK_VALIDATE_LOG_SAMPLES = 24;

/**
 * Diagnóstico de falhas ao gravar `stock` (save-game).
 */
export type ValidateStockForSaveResult =
  | { ok: true; itemIds: string[]; qtys: number[] }
  | {
      ok: false;
      error: string;
      reason: 'too_many_keys' | 'invalid_key' | 'bad_qty' | 'unknown_item';
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
  for (const k of keys) {
    const rawItemId = String(k);
    const itemId = normalizeKnown1000WhBatteryCatalogId(rawItemId);
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
      // Cliente não pode mais gravar daily actions (oficina descontinuada). Ignora silenciosamente.
      continue;
    }
    const ts = typeof v0 === 'number' ? v0 : parseFloat(String(v0));
    if (!Number.isFinite(ts)) {
      return {
        ok: false,
        error: 'Há uma data ou hora inválida nos lembretes diários. Recarregue a página (F5).'
      };
    }
    const ti = Math.floor(ts);
    if (ti < DAILY_TS_MIN || ti > DAILY_TS_MAX) {
      return {
        ok: false,
        error: 'Uma data nos lembretes diários está fora do intervalo permitido. Recarregue a página (F5).'
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
       WHERE (LOWER(COALESCE(type::text, '')) = 'battery' OR LOWER(COALESCE(category::text, '')) = 'battery')
         AND COALESCE(is_active, 1) <> 0
       ORDER BY COALESCE(base_cost, 0) ASC NULLS LAST,
                id ASC
       LIMIT 1`
    );
    fallbackCatalogId = String(fbRes.rows[0]?.id || '').trim();
  } catch (e) {
    console.warn(
      '[validateStoredBatteriesForSave] fallback bateria:',
      e instanceof Error ? e.message : String(e)
    );
  }

  type BatRow = { id: string; itemId: string; obj: Record<string, unknown> };
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
    rows.push({ id, itemId, obj: o });
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
  for (const r of rows) {
    let it = r.itemId;
    if (it === STORED_BATTERY_CATALOG_PENDING_ID) {
      const dbv = (dbMap.get(r.id) || '').trim();
      it = SAVE_GAME_ITEM_ID_RE.test(dbv) ? normalizeKnown1000WhBatteryCatalogId(dbv) : fallbackCatalogId;
    }
    it = normalizeKnown1000WhBatteryCatalogId(it);
    resolvedIds.push(it);
  }

  const uniqResolved = [...new Set(resolvedIds)];
  let validBattery = new Set<string>();
  try {
    const chk = await client.query<{ id: string }>(
      `SELECT id::text FROM upgrades WHERE id = ANY($1::text[]) AND (
         LOWER(COALESCE(type::text, '')) = 'battery'
         OR LOWER(COALESCE(category::text, '')) = 'battery'
       )`,
      [uniqResolved]
    );
    validBattery = new Set((chk.rows || []).map((x) => String(x.id)));
  } catch (e) {
    console.warn(
      '[validateStoredBatteriesForSave] upgrades battery check:',
      e instanceof Error ? e.message : String(e)
    );
  }

  let nonBatteryCatalogIds = new Set<string>();
  if (uniqResolved.length > 0) {
    try {
      const nb = await client.query<{ id: string }>(
        `SELECT id::text FROM upgrades WHERE id = ANY($1::text[])
          AND NOT (
            LOWER(COALESCE(type::text, '')) = 'battery'
            OR LOWER(COALESCE(category::text, '')) = 'battery'
          )`,
        [uniqResolved]
      );
      nonBatteryCatalogIds = new Set((nb.rows || []).map((x) => String(x.id)));
    } catch (e) {
      console.warn(
        '[validateStoredBatteriesForSave] upgrades non-battery check:',
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const it = resolvedIds[i]!;
    if (validBattery.has(it)) {
      rows[i]!.obj.itemId = it;
      continue;
    }
    const dbPrior = normalizeKnown1000WhBatteryCatalogId((dbMap.get(rows[i]!.id) || '').trim());
    if (dbPrior && validBattery.has(dbPrior)) {
      rows[i]!.obj.itemId = dbPrior;
      continue;
    }
    if (nonBatteryCatalogIds.has(it)) {
      return {
        ok: false,
        error:
          'O armazém de baterias contém `item_id` de equipamento que não é bateria (ex.: GPU/miner). Recarrega (F5); se persistir, contacta o suporte para corrigir instâncias na base de dados.'
      };
    }
    console.warn(
      '[validateStoredBatteriesForSave] item_id sem bateria válida no catálogo; fallback inst=%s was=%s',
      rows[i]!.id,
      it
    );
    rows[i]!.obj.itemId = fallbackCatalogId;
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
 * foram as instâncias. Cada id que deixaria de estar listado no armazém tem de aparecer como
 * `batteryId` numa rig no mesmo pedido (ou já estar montado em rig na BD).
 */
export async function validateStoredBatteryWarehouseRemovalAllowed(
  client: PoolClient,
  uid: number | string,
  incomingIds: string[],
  changes: { placedRacks?: unknown },
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
    ...collectBatteryIdsFromPlacedRacksPayload(changes.placedRacks)
  ]);
  for (const id of await collectBatteryIdsFromPlacedRacksDb(client, uid)) {
    referenced.add(id);
  }

  const orphans = toDrop.filter((id) => !referenced.has(id));
  if (orphans.length > 0) {
    return {
      ok: false,
      error:
        'O armazém de baterias enviado deixa de listar unidades que o servidor ainda tem no armazém, sem aparecerem montadas nas rigs neste guardar. Recarrega a página (F5) para sincronizar.'
    };
  }
  return { ok: true };
}

/**
 * Normaliza o array `storedBatteries` antes de validar/persistir:
 * - deduplica por `id` (mantém a última entrada);
 * - remove entradas cujo `id` já está montado numa rig (`batteryId`),
 *   evitando duplicar a mesma instância no armazém.
 */
export function sanitizeStoredBatteriesForSavePayload(
  batteries: unknown[],
  placedRacks: unknown
): unknown[] {
  if (!Array.isArray(batteries)) return [];
  const mounted = new Set<string>([
    ...collectBatteryIdsFromPlacedRacksPayload(placedRacks)
  ]);
  const byId = new Map<string, { id: string; itemId: string }>();
  for (const b of batteries) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    const o = b as Record<string, unknown>;
    const id = o.id != null ? String(o.id).trim() : '';
    let itemId = o.itemId != null ? String(o.itemId).trim() : '';
    if (!SAVE_GAME_ITEM_ID_RE.test(id)) continue;
    if (!itemId || !SAVE_GAME_ITEM_ID_RE.test(itemId)) {
      itemId = STORED_BATTERY_CATALOG_PENDING_ID;
    }
    if (mounted.has(id)) continue;
    byId.set(id, { id, itemId });
  }
  return [...byId.values()];
}
