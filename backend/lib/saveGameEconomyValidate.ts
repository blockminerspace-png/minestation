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

  if (itemIds.length === 0) return { ok: true, itemIds: [], qtys: [] };
  const chk = await client.query('SELECT id FROM upgrades WHERE id = ANY($1::text[])', [itemIds]);
  if ((chk.rowCount ?? 0) !== itemIds.length) {
    const have = new Set((chk.rows as Array<{ id: string }>).map((x) => String(x.id)));
    const missing = itemIds.filter((id) => !have.has(id));
    return {
      ok: false,
      error:
        'O inventário inclui peças que o servidor não reconhece (podem ter sido removidas do jogo ou o teu cliente está desatualizado). Recarregue a página (F5).',
      reason: 'unknown_item',
      samples: missing.slice(0, STOCK_VALIDATE_LOG_SAMPLES)
    };
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
