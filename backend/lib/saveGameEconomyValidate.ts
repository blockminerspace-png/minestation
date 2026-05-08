import type { Pool, PoolClient } from 'pg';

/** Alinhado a `RACK_ID_RE` no servidor — IDs de item / instância. */
export const SAVE_GAME_ITEM_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

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

/**
 * PostgreSQL: `INSERT … ON CONFLICT DO UPDATE` não pode ter duas linhas do mesmo lote
 * a disputar a mesma chave única (`cannot affect row a second time`).
 * Junta entradas repetidas: última quantidade / último valor ganha.
 */
export function dedupeParallelArraysLastWins(keys: string[], vals: number[]): { keys: string[]; vals: number[] } {
  const m = new Map<string, number>();
  const n = Math.min(keys.length, vals.length);
  for (let i = 0; i < n; i++) {
    m.set(keys[i], vals[i]);
  }
  const keysOut = [...m.keys()];
  return { keys: keysOut, vals: keysOut.map((k) => m.get(k)!) };
}

/** Mesmo que `dedupeParallelArraysLastWins`, mas soma quantidades para a mesma chave (caixas). */
export function dedupeParallelArraysSumQty(keys: string[], vals: number[]): { keys: string[]; vals: number[] } {
  const m = new Map<string, number>();
  const n = Math.min(keys.length, vals.length);
  for (let i = 0; i < n; i++) {
    const k = keys[i];
    const v = vals[i];
    m.set(k, (m.get(k) ?? 0) + v);
  }
  const keysOut = [...m.keys()];
  return { keys: keysOut, vals: keysOut.map((k) => m.get(k)!) };
}

/** Mesmo `rack_id` repetido no payload: mantém a última ocorrência (alinhado a merge de objeto). */
export function dedupePlacedRacksByRackIdLastWins<T extends { id?: unknown }>(racks: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of racks) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const id = String((r as Record<string, unknown>).id ?? '').trim();
    if (!id) continue;
    m.set(id, r);
  }
  return [...m.values()];
}

/** Instâncias repetidas no armazém por `id` — última entrada ganha. */
export function dedupeStoredBatteriesByIdLastWins<T extends { id?: unknown }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const id = String((row as Record<string, unknown>).id ?? '').trim();
    if (!id) continue;
    m.set(id, row);
  }
  return [...m.values()];
}

/**
 * Diagnóstico de falhas ao gravar `stock` (save-game). Causas típicas:
 * - `invalid_key`: chave fora do padrão (espaços, `__proto__`, merge de objetos errado, estado corrompido no cliente).
 * - `bad_qty`: quantidade NaN/negativa/fora do limite após dessincronização ou bug de UI.
 * - `unknown_item`: ID que não existe em `upgrades` (item apagado no admin ou cliente desatualizado).
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

  const itemIds: string[] = [];
  const qtys: number[] = [];
  const badQtyKeys: string[] = [];
  for (const k of keys) {
    const itemId = String(k);
    const q = parseIntQty(stock[k]);
    if (q === null || q < 0 || q > MAX_STOCK_QTY) {
      badQtyKeys.push(itemId);
      continue;
    }
    itemIds.push(itemId);
    qtys.push(q);
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

  const mergedStock = dedupeParallelArraysLastWins(itemIds, qtys);
  const itemIdsU = mergedStock.keys;
  const qtysU = mergedStock.vals;
  if (itemIdsU.length !== itemIds.length) {
    console.warn(
      `[save-game] deduped_stock_parallel_keys rawKeys=${itemIds.length} unique=${itemIdsU.length} (evita ON CONFLICT duplicado no INSERT)`
    );
  }

  if (itemIdsU.length === 0) return { ok: true, itemIds: [], qtys: [] };
  const chk = await client.query('SELECT id FROM upgrades WHERE id = ANY($1::text[])', [itemIdsU]);
  if ((chk.rowCount ?? 0) !== itemIdsU.length) {
    const have = new Set((chk.rows as Array<{ id: string }>).map((x) => String(x.id)));
    const missing = itemIdsU.filter((id) => !have.has(id));
    return {
      ok: false,
      error:
        'O inventário inclui peças que o servidor não reconhece (podem ter sido removidas do jogo ou o teu cliente está desatualizado). Recarregue a página (F5).',
      reason: 'unknown_item',
      samples: missing.slice(0, STOCK_VALIDATE_LOG_SAMPLES)
    };
  }
  return { ok: true, itemIds: itemIdsU, qtys: qtysU };
}

export async function validateUnopenedBoxesForSave(
  client: PoolClient,
  boxes: Record<string, unknown>
): Promise<
  | { ok: true; boxIds: string[]; qtys: number[]; droppedBoxIds: string[] }
  | { ok: false; error: string }
> {
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
  if (boxIds.length === 0) return { ok: true, boxIds: [], qtys: [], droppedBoxIds: [] };
  const chk = await client.query('SELECT id FROM loot_boxes WHERE id = ANY($1::text[])', [boxIds]);
  const known = new Set((chk.rows as Array<{ id: string }>).map((row) => String(row.id)));
  const keptBoxIds: string[] = [];
  const keptQtys: number[] = [];
  const droppedBoxIds: string[] = [];
  for (let i = 0; i < boxIds.length; i += 1) {
    const boxId = boxIds[i];
    if (known.has(boxId)) {
      keptBoxIds.push(boxId);
      keptQtys.push(qtys[i]);
    } else {
      droppedBoxIds.push(boxId);
    }
  }
  const mergedBoxes = dedupeParallelArraysSumQty(keptBoxIds, keptQtys);
  if (mergedBoxes.keys.length !== keptBoxIds.length) {
    console.warn(
      `[save-game] deduped_unopened_boxes_parallel_keys raw=${keptBoxIds.length} unique=${mergedBoxes.keys.length}`
    );
  }
  return { ok: true, boxIds: mergedBoxes.keys, qtys: mergedBoxes.vals, droppedBoxIds };
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
  const mergedDaily = dedupeParallelArraysLastWins(keys, vals);
  if (mergedDaily.keys.length !== keys.length) {
    console.warn(
      `[save-game] deduped_daily_actions_parallel_keys raw=${keys.length} unique=${mergedDaily.keys.length}`
    );
  }
  return { ok: true, keys: mergedDaily.keys, vals: mergedDaily.vals };
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
  const bIds: string[] = [];
  const itemIds: string[] = [];
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
    const itemId = o.itemId != null ? String(o.itemId) : '';
    if (!SAVE_GAME_ITEM_ID_RE.test(id) || !SAVE_GAME_ITEM_ID_RE.test(itemId)) {
      return {
        ok: false,
        error:
          'Identificador de bateria ou tipo de peça inválido. Recarregue a página (F5).'
      };
    }
    const ch = parseNumericCharge(o.currentCharge);
    if (ch === null || ch < -1 || ch > 1e15) {
      return {
        ok: false,
        error:
          'O valor de carga de uma bateria no armazém é inválido. Recarregue a página (F5).'
      };
    }
    bIds.push(id);
    itemIds.push(itemId);
  }
  if (bIds.length === 0) return { ok: true };
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
  const uniqItems = [...new Set(itemIds)];
  const chk = await client.query(
    `SELECT id FROM upgrades WHERE id = ANY($1::text[]) AND LOWER(COALESCE(type::text, '')) = 'battery'`,
    [uniqItems]
  );
  if (chk.rowCount !== uniqItems.length) {
    return {
      ok: false,
      error:
        'Uma bateria no armazém referencia um item que não existe ou não é uma bateria válida. Recarregue a página (F5).'
    };
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

const PLACED_RACK_SLOT_GUARD_MSG_MINERS =
  'O estado das rigs enviado está incompleto (máquinas). Recarrega a página (F5) para sincronizar.';
const PLACED_RACK_SLOT_GUARD_MSG_MULTS =
  'O estado das rigs enviado está incompleto (multiplicadores). Recarrega a página (F5) para sincronizar.';

/**
 * Guarda partilhada: antes de `DELETE rack_slots` + INSERT a partir do payload, garantir que não
 * vamos apagar miners/multiplicadores montados na BD por causa de `slots` omitidos, `[]` ou curtos.
 * Usado em `POST /api/save-game` e em `persistStockStoredBatteriesPlacedRacks` (sala / bulk baterias).
 */
export class PlacedRackSlotsSaveGuardError extends Error {
  readonly httpStatus = 409 as const;
  readonly forceReload = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'PlacedRackSlotsSaveGuardError';
  }
}

export function assertPlacedRacksSlotPayloadAgainstPrevDb(
  prevRacksRows: Array<{ id: string; item_id?: unknown }>,
  prevSlotsRows: Array<{ rack_id: string; slot_index: unknown; machine_item_id?: unknown }>,
  prevMultRows: Array<{ rack_id: string; slot_index: unknown; multiplier_item_id?: unknown }>,
  placedRacks: Array<{ id: string; itemId?: unknown; slots?: unknown; multiplierSlots?: unknown }>,
  opts: { adminOverride?: boolean; userId?: number | string }
): void {
  if (opts.adminOverride) return;

  const prevMap = new Map<string, { id: string; item_id?: unknown }>();
  for (const row of prevRacksRows) {
    prevMap.set(String(row.id), row);
  }

  const slotItemOccupied = (v: unknown) => v != null && String(v).trim() !== '';

  const maxMinerIdxByRack = new Map<string, number>();
  for (const row of prevSlotsRows) {
    const rid = String(row.rack_id);
    const si = Number(row.slot_index);
    if (!Number.isFinite(si)) continue;
    const cur = maxMinerIdxByRack.get(rid);
    if (cur == null || si > cur) maxMinerIdxByRack.set(rid, si);
  }
  const maxMultIdxByRack = new Map<string, number>();
  for (const row of prevMultRows) {
    const rid = String(row.rack_id);
    const si = Number(row.slot_index);
    if (!Number.isFinite(si)) continue;
    const cur = maxMultIdxByRack.get(rid);
    if (cur == null || si > cur) maxMultIdxByRack.set(rid, si);
  }

  const rackHadMiner = new Set<string>();
  for (const row of prevSlotsRows) {
    if (slotItemOccupied(row.machine_item_id)) rackHadMiner.add(String(row.rack_id));
  }
  const rackHadMult = new Set<string>();
  for (const row of prevMultRows) {
    if (slotItemOccupied(row.multiplier_item_id)) rackHadMult.add(String(row.rack_id));
  }

  const uidLog = opts.userId ?? '?';

  for (const r of placedRacks) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const rid = String(r.id);
    if (!prevMap.has(rid)) continue;
    const prow = prevMap.get(rid);
    if (!prow) continue;
    const chassisChanged = String(prow.item_id || '') !== String(r.itemId || '');

    if (rackHadMiner.has(rid)) {
      if (!Array.isArray(r.slots)) {
        console.warn(`[PlacedRackSlotGuard] reject_slots userId=${uidLog} rackId=${rid} reason=not_array`);
        throw new PlacedRackSlotsSaveGuardError(PLACED_RACK_SLOT_GUARD_MSG_MINERS);
      }
      if (r.slots.length === 0) {
        console.warn(`[PlacedRackSlotGuard] reject_slots userId=${uidLog} rackId=${rid} reason=empty_array`);
        throw new PlacedRackSlotsSaveGuardError(PLACED_RACK_SLOT_GUARD_MSG_MINERS);
      }
      if (!chassisChanged) {
        const maxIdx = maxMinerIdxByRack.get(rid);
        if (maxIdx != null && maxIdx >= 0 && r.slots.length <= maxIdx) {
          console.warn(
            `[PlacedRackSlotGuard] reject_slots userId=${uidLog} rackId=${rid} reason=short_array len=${r.slots.length} maxDbIdx=${maxIdx}`
          );
          throw new PlacedRackSlotsSaveGuardError(PLACED_RACK_SLOT_GUARD_MSG_MINERS);
        }
      }
    }

    if (rackHadMult.has(rid)) {
      if (!Array.isArray(r.multiplierSlots)) {
        console.warn(`[PlacedRackSlotGuard] reject_mults userId=${uidLog} rackId=${rid} reason=not_array`);
        throw new PlacedRackSlotsSaveGuardError(PLACED_RACK_SLOT_GUARD_MSG_MULTS);
      }
      if (r.multiplierSlots.length === 0) {
        console.warn(`[PlacedRackSlotGuard] reject_mults userId=${uidLog} rackId=${rid} reason=empty_array`);
        throw new PlacedRackSlotsSaveGuardError(PLACED_RACK_SLOT_GUARD_MSG_MULTS);
      }
      if (!chassisChanged) {
        const maxIdx = maxMultIdxByRack.get(rid);
        if (maxIdx != null && maxIdx >= 0 && r.multiplierSlots.length <= maxIdx) {
          console.warn(
            `[PlacedRackSlotGuard] reject_mults userId=${uidLog} rackId=${rid} reason=short_array len=${r.multiplierSlots.length} maxDbIdx=${maxIdx}`
          );
          throw new PlacedRackSlotsSaveGuardError(PLACED_RACK_SLOT_GUARD_MSG_MULTS);
        }
      }
    }
  }
}

export function collectBatteryInstanceRefsFromWorkshopPayload(workshopSlots: unknown): Set<string> {
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

export function collectBatteryIdsFromPlacedRacksPayload(placedRacks: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(placedRacks)) return out;
  for (const r of placedRacks) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const bid = (r as Record<string, unknown>).batteryId;
    if (bid != null && String(bid).trim()) out.add(String(bid).trim());
  }
  return out;
}

/** IDs de `stored_batteries` que não podem ser apagados neste save (listados no payload + montados em rigs/oficina). */
export function storedBatteryRowIdsProtectedByPayload(
  incomingIds: string[],
  placedRacks: unknown,
  workshopSlots: unknown
): string[] {
  const set = new Set<string>();
  for (const id of incomingIds) {
    const t = String(id || '').trim();
    if (t) set.add(t);
  }
  for (const id of collectBatteryIdsFromPlacedRacksPayload(placedRacks)) set.add(id);
  for (const id of collectBatteryInstanceRefsFromWorkshopPayload(workshopSlots)) set.add(id);
  return [...set];
}

/**
 * IDs de instância em `placed_racks.battery_id`: payload do save + o que já está na BD nesta transação
 * (o UPDATE das rigs corre depois — aqui ainda vemos o mount anterior, o que evita falsos órfãos).
 */
export async function collectMountedRackBatteryInstanceIds(
  client: PoolClient,
  uid: number | string,
  placedRacksFromPayload: unknown
): Promise<Set<string>> {
  const ids = new Set<string>(collectBatteryIdsFromPlacedRacksPayload(placedRacksFromPayload));
  const res = await client.query(
    `SELECT DISTINCT battery_id::text AS bid FROM placed_racks
     WHERE user_id = $1 AND battery_id IS NOT NULL AND BTRIM(battery_id::text) <> ''`,
    [uid]
  );
  for (const row of res.rows || []) {
    const bid = String((row as { bid?: string }).bid || '').trim();
    if (bid) ids.add(bid);
  }
  return ids;
}

/** `internal_state` JSON: só pares string→string não vazios (IDs de instância). */
function parseJsonRecordOrEmpty(raw: unknown): Record<string, string> {
  let obj: Record<string, unknown> | null = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) obj = p as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (!obj) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

/**
 * IDs de instância referenciados na oficina: payload do save + o que já está na BD nesta
 * transação. Isso evita perder o vínculo catálogo/instância quando o cliente omite a oficina
 * num save parcial.
 */
export async function collectMountedWorkshopBatteryInstanceIds(
  client: PoolClient,
  uid: number | string,
  workshopSlotsFromPayload: unknown
): Promise<Set<string>> {
  const ids = new Set<string>(collectBatteryInstanceRefsFromWorkshopPayload(workshopSlotsFromPayload));
  const res = await client.query(
    `SELECT internal_state
       FROM workshop_slots
      WHERE user_id = $1`,
    [uid]
  );
  for (const row of res.rows || []) {
    const raw = (row as { internal_state?: unknown }).internal_state;
    const parsed = parseJsonRecordOrEmpty(raw);
    for (const value of Object.values(parsed)) {
      const id = String(value || '').trim();
      if (id.length >= 20) ids.add(id);
    }
  }
  return ids;
}

/**
 * IDs de `stored_batteries` que continuam a existir no armazém depois do save.
 *
 * Importante: `stored_batteries` também funciona como vínculo persistente
 * `battery_instance_id -> item_id/current_charge`. Se uma instância aparece montada
 * no payload ou ainda está montada na BD nesta transação, ela deve continuar
 * preservada aqui; removê-la faz o runtime perder a resolução de catálogo.
 */
export async function storedBatteryKeepIdsForSave(
  client: PoolClient,
  uid: number | string,
  incomingIds: string[],
  placedRacksFromPayload: unknown,
  workshopSlotsFromPayload: unknown
): Promise<string[]> {
  const set = new Set<string>();
  for (const id of incomingIds) {
    const t = String(id || '').trim();
    if (t) set.add(t);
  }

  const mountedRackIds = await collectMountedRackBatteryInstanceIds(client, uid, placedRacksFromPayload);
  for (const id of mountedRackIds) set.add(id);

  const mountedWorkshopIds = await collectMountedWorkshopBatteryInstanceIds(client, uid, workshopSlotsFromPayload);
  for (const id of mountedWorkshopIds) {
    if (id) set.add(id);
  }

  return [...set];
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

  const rackMounted = await collectMountedRackBatteryInstanceIds(client, uid, changes.placedRacks);
  const workshopMounted = await collectMountedWorkshopBatteryInstanceIds(client, uid, changes.workshopSlots);
  const referenced = new Set<string>([
    ...rackMounted,
    ...workshopMounted
  ]);

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
  const seenBatteryInstanceIds = new Map<string, string>();
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
      for (const [slotKey, rawValue] of Object.entries(internalSlots)) {
        if (rawValue == null) continue;
        const instId = String(rawValue).trim();
        if (!instId || instId.length < 20 || !SAVE_GAME_ITEM_ID_RE.test(instId)) continue;
        const ref = `bancada ${i + 1}/${slotKey}`;
        const prev = seenBatteryInstanceIds.get(instId);
        if (prev) {
          delete internalSlots[slotKey];
          console.warn(
            `[WorkshopSave] dedupe_battery_instance kept=${prev} removed=${ref} inst=${instId.slice(0, 10)}…`
          );
          continue;
        }
        seenBatteryInstanceIds.set(instId, ref);
      }
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
        if (!(k in internalSlots)) continue;
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
        if (!(k in internalSlots)) continue;
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

    for (const key of Object.keys(slotCharges)) {
      if (!(key in internalSlots)) {
        return {
          ok: false,
          error:
            'A oficina enviou carga para um slot vazio. Recarregue a página (F5) para sincronizar.'
        };
      }
    }

    if (slotItemIds) {
      for (const key of Object.keys(slotItemIds)) {
        if (!(key in internalSlots)) {
          return {
            ok: false,
            error:
              'A oficina enviou uma referência de peça sem componente instalado no slot. Recarregue a página (F5) para sincronizar.'
          };
        }
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
  const upRes = await client.query(`SELECT id, type, category FROM upgrades WHERE id = ANY($1::text[])`, [ids]);
  if ((upRes.rowCount ?? 0) !== ids.length) {
    return {
      ok: false,
      error:
        'A oficina referencia peças que o servidor não reconhece. Recarregue a página (F5).'
    };
  }

  const defMap = new Map<string, { type: string; category: string }>();
  for (const row of upRes.rows as Array<{ id: string; type?: unknown; category?: unknown }>) {
    defMap.set(String(row.id), {
      type: String(row.type ?? ''),
      category: String(row.category ?? '')
    });
  }

  const admin = !!opts.adminOverride;
  for (const s of staged) {
    if (!s) continue;
    const def = defMap.get(s.itemId);
    if (!def) {
      return {
        ok: false,
        error:
          'A oficina inclui uma estrutura desconhecida. Recarregue a página (F5).'
      };
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
        const d2 = defMap.get(sid);
        if (!d2) {
          return {
            ok: false,
            error:
              'Uma bateria ou peça na oficina não existe no catálogo. Recarregue a página (F5).'
          };
        }
      }
    }

    for (const [slotId, rawValue] of Object.entries(s.internalSlots || {})) {
      if (rawValue == null) continue;
      const rawId = String(rawValue).trim();
      if (!rawId) continue;
      const savedItemId = s.slotItemIds?.[slotId];
      if (!savedItemId) {
        return {
          ok: false,
          error:
            'Há uma bateria/peça instalada na oficina sem referência do item original. Recarregue a página (F5) para sincronizar.'
        };
      }
      const savedItemDef = defMap.get(savedItemId);
      if (!savedItemDef) {
        return {
          ok: false,
          error:
            'A oficina referencia uma peça instalada que o servidor não reconhece. Recarregue a página (F5).'
        };
      }
      const looksLikeInstanceId = rawId.length >= 20;
      if (looksLikeInstanceId && savedItemDef.type.toLowerCase() !== 'battery') {
        return {
          ok: false,
          error:
            'A oficina enviou um ID de instância num slot que não é bateria. Recarregue a página (F5) para sincronizar.'
        };
      }
      if (looksLikeInstanceId && s.slotCharges?.[slotId] == null) {
        return {
          ok: false,
          error:
            'A oficina enviou uma bateria sem carga associada no slot. Recarregue a página (F5) para sincronizar.'
        };
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
  if (!email) return;

  const orphans: string[] = [];
  for (const ws of workshopSlots) {
    if (!ws || !isPlainObjectRecord(ws)) continue;
    const intRaw = ws.internalSlots;
    const sidRaw = ws.slotItemIds;
    if (!isPlainObjectRecord(intRaw)) continue;
    const sidMap = isPlainObjectRecord(sidRaw) ? sidRaw : {};
    for (const [slotId, instId] of Object.entries(intRaw)) {
      const existingSid = sidMap[slotId];
      if (existingSid !== undefined && existingSid !== null && String(existingSid).trim() !== '') {
        continue;
      }
      if (instId === undefined || instId === null) continue;
      const clean = String(instId).trim();
      if (clean.length < 20) continue;
      if (!SAVE_GAME_ITEM_ID_RE.test(clean)) continue;
      orphans.push(clean);
    }
  }
  if (orphans.length === 0) return;

  const uniq = [...new Set(orphans)];
  try {
    const histRes = await client.query(
      `SELECT DISTINCT ON (battery_instance_id) battery_instance_id, battery_item_id
       FROM charging_history
       WHERE user_email = $1
         AND battery_instance_id = ANY($2::text[])
         AND battery_item_id IS NOT NULL
         AND BTRIM(battery_item_id::text) <> ''
       ORDER BY battery_instance_id, timestamp DESC`,
      [email, uniq]
    );
    const resolve = new Map<string, string>();
    for (const row of histRes.rows as Array<{ battery_instance_id: string; battery_item_id: string }>) {
      const bid = String(row.battery_instance_id || '').trim();
      const iid = String(row.battery_item_id || '').trim();
      if (bid && iid) resolve.set(bid, iid);
    }
    if (resolve.size === 0) return;

    for (const ws of workshopSlots) {
      if (!ws || !isPlainObjectRecord(ws)) continue;
      const intRaw = ws.internalSlots;
      if (!isPlainObjectRecord(intRaw)) continue;
      const sidRaw = ws.slotItemIds;
      const nextMap: Record<string, string> = isPlainObjectRecord(sidRaw)
        ? Object.fromEntries(
            Object.entries(sidRaw)
              .filter(([, v]) => v != null && String(v).trim() !== '')
              .map(([k, v]) => [k, String(v).trim()])
          )
        : {};
      let changed = false;
      for (const [slotId, instId] of Object.entries(intRaw)) {
        if (instId === undefined || instId === null) continue;
        const clean = String(instId).trim();
        const itemIdGuess = resolve.get(clean);
        if (!itemIdGuess) continue;
        if (nextMap[slotId] && nextMap[slotId].trim() !== '') continue;
        nextMap[slotId] = itemIdGuess;
        changed = true;
      }
      if (changed) ws.slotItemIds = nextMap;
    }
  } catch (e) {
    console.warn(
      '[enrichWorkshopSlotsSlotItemIdsFromChargingHistory]',
      e instanceof Error ? e.message : String(e)
    );
  }
}
