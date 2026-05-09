import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { SAVE_GAME_ITEM_ID_RE } from '../lib/saveGameEconomyValidate.js';
import { sanitizeForLog } from '../lib/safeText.js';
import { findLayoutSlot, parseWorkshopStructureLayout } from '../lib/workshopLayoutParse.js';

const WORKSHOP_BENCH_COUNT = 6;
const INSTANCE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WorkshopMutationError extends Error {
  readonly statusCode: number;
  readonly forceReload: boolean;

  constructor(message: string, statusCode = 400, forceReload = false) {
    super(message);
    this.name = 'WorkshopMutationError';
    this.statusCode = statusCode;
    this.forceReload = forceReload;
  }
}

export type WorkshopMutateAction = 'equip_bench' | 'unequip_bench' | 'equip_component' | 'unequip_component';

export type WorkshopMutateBody = {
  action: WorkshopMutateAction;
  slotIndex: number;
  /** Peça de catálogo (stock) ou bateria nova a partir do stock */
  itemId?: string;
  /** Slot interno do layout (ex.: id do slot bateria no JSON do carregador) */
  componentSlotId?: string;
  /** Equipar bateria já instanciada no armazém */
  storedBatteryId?: string;
  /** Optimistic lock opcional — se enviado e divergir do servidor → 409 + forceReload */
  expectedServerUpdatedAt?: number;
};

export type WorkshopMutateOk = {
  ok: true;
  serverUpdatedAt: number;
  workshopSlots: unknown[];
  stock: Record<string, number>;
  storedBatteries: Array<{ id: string; itemId: string; currentCharge: number }>;
};

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || raw === '') return {};
  const t = String(raw).trim();
  if (!t) return {};
  if (t.length > 500_000) return {};
  try {
    const v = JSON.parse(t) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ...(v as Record<string, unknown>) };
  } catch {
    /* ignore */
  }
  return {};
}

function stringifyJson(obj: Record<string, unknown> | null | undefined): string | null {
  if (!obj || Object.keys(obj).length === 0) return null;
  return JSON.stringify(obj);
}

function parseSlotCharges(raw: string | null | undefined): Record<string, number> {
  const o = parseJsonObject(raw);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k.length > 200) continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

function parseSlotItemIds(raw: string | null | undefined): Record<string, string> {
  const o = parseJsonObject(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k.length > 200) continue;
    if (v == null) continue;
    const sid = String(v).trim();
    if (SAVE_GAME_ITEM_ID_RE.test(sid)) out[k] = sid;
  }
  return out;
}

/** Carga Wh num mapa `slot_charges` com chave exacta ou só diferença de capitalização. */
function getWorkshopSlotChargeWh(slotCharges: Record<string, number>, componentSlotId: string): number {
  if (Object.prototype.hasOwnProperty.call(slotCharges, componentSlotId)) {
    const n = Number(slotCharges[componentSlotId]);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  const want = componentSlotId.toLowerCase().trim();
  const hit = Object.entries(slotCharges).find(([k]) => k.toLowerCase().trim() === want);
  if (!hit) return 0;
  const n = Number(hit[1]);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Alinha `stored_batteries` com o JSON gravado nesta bancada: carga = `slot_charges` por slot.
 * Evita que a remoção de uma bateria deixe a outra com `current_charge` desactualizado (UI/modal a ler armazém).
 */
async function syncStoredBatteriesWithWorkshopSlotRow(
  tx: Prisma.TransactionClient,
  userId: number,
  slotIndex: number
): Promise<void> {
  const row = await tx.workshop_slots.findUnique({
    where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } }
  });
  if (!row?.item_id) return;
  const internal = parseJsonObject(row.internal_state);
  const slotCharges = parseSlotCharges(row.slot_charges);
  for (const [compIdRaw, rawVal] of Object.entries(internal)) {
    if (rawVal == null) continue;
    const bid = String(rawVal).trim();
    if (!bid || !INSTANCE_UUID_RE.test(bid)) continue;
    const compId = String(compIdRaw).slice(0, 200);
    const wh = getWorkshopSlotChargeWh(slotCharges, compIdRaw);
    await tx.stored_batteries.updateMany({
      where: { user_id: userId, id: bid },
      data: {
        workshop_slot_index: slotIndex,
        workshop_component_slot_id: compId,
        current_charge: wh
      }
    });
  }
}

function assertItemId(id: unknown, label: string): string {
  const s = id != null ? String(id).trim() : '';
  if (!s || !SAVE_GAME_ITEM_ID_RE.test(s)) {
    throw new WorkshopMutationError(`${label} inválido.`, 400);
  }
  return s;
}

function assertSlotIndex(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(v) || v < 0 || v >= WORKSHOP_BENCH_COUNT) {
    throw new WorkshopMutationError('Índice de bancada inválido.', 400);
  }
  return v;
}

function assertComponentSlotId(id: unknown): string {
  const s = id != null ? String(id).trim() : '';
  if (!s || s.length > 200 || /[\x00-\x1f]/.test(s)) {
    throw new WorkshopMutationError('Identificador de slot interno inválido.', 400);
  }
  return s;
}

function assertStoredBatteryId(id: unknown): string | null {
  if (id === undefined || id === null || id === '') return null;
  const s = String(id).trim();
  if (!INSTANCE_UUID_RE.test(s)) {
    throw new WorkshopMutationError('Identificador de bateria no armazém inválido.', 400);
  }
  return s;
}

async function lockUserGameState(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM game_states WHERE user_id = ${userId}::int FOR UPDATE`;
}

async function checkExpectedRevision(
  tx: Prisma.TransactionClient,
  userId: number,
  expected: number | undefined
): Promise<void> {
  if (expected === undefined || expected === null || !Number.isFinite(Number(expected))) return;
  const gs = await tx.game_states.findUnique({
    where: { user_id: userId },
    select: { server_updated_at: true }
  });
  const cur = Number(gs?.server_updated_at ?? 0);
  if (cur !== Number(expected)) {
    throw new WorkshopMutationError(
      'O estado da oficina mudou no servidor. Recarrega a página (F5).',
      409,
      true
    );
  }
}

async function bumpServerUpdatedAt(tx: Prisma.TransactionClient, userId: number): Promise<number> {
  const now = BigInt(Date.now());
  await tx.game_states.update({
    where: { user_id: userId },
    data: { server_updated_at: now }
  });
  return Number(now);
}

async function logCharging(
  tx: Prisma.TransactionClient,
  userEmail: string,
  row: {
    action: string;
    workshop_slot_index: number | null;
    component_slot_id: string | null;
    battery_instance_id: string | null;
    battery_item_id: string | null;
    charge_amount: number | null;
    stock_confirmed: boolean;
    details: Prisma.InputJsonValue;
  }
): Promise<void> {
  await tx.charging_history.create({
    data: {
      user_email: userEmail,
      action: sanitizeForLog(row.action, 64),
      workshop_slot_index: row.workshop_slot_index,
      component_slot_id: row.component_slot_id,
      battery_instance_id: row.battery_instance_id,
      battery_item_id: row.battery_item_id,
      charge_amount: row.charge_amount,
      stock_confirmed: row.stock_confirmed,
      details: row.details
    }
  });
}

function sanitizeDetails(meta: Record<string, unknown>): Prisma.InputJsonValue {
  const out: Record<string, string | number | boolean> = {};
  for (const [k0, v0] of Object.entries(meta)) {
    if (out && Object.keys(out).length >= 24) break;
    const k = sanitizeForLog(k0, 48);
    if (!k) continue;
    if (typeof v0 === 'string') out[k] = sanitizeForLog(v0, 160);
    else if (typeof v0 === 'number' && Number.isFinite(v0)) out[k] = v0;
    else if (typeof v0 === 'boolean') out[k] = v0;
  }
  return out;
}

type UpgradeLite = {
  id: string;
  type: string | null;
  category: string | null;
  power_capacity: number | null;
  name: string;
  image: string | null;
};

async function loadUpgrade(tx: Prisma.TransactionClient, id: string): Promise<UpgradeLite | null> {
  const u = await tx.upgrades.findUnique({
    where: { id },
    select: { id: true, type: true, category: true, power_capacity: true, name: true, image: true }
  });
  return u;
}

async function batteryAllowedOnCharger(
  tx: Prisma.TransactionClient,
  batteryCatalogId: string,
  chargerItemId: string
): Promise<boolean> {
  const rows = await tx.upgrade_compat_racks.findMany({
    where: { upgrade_id: batteryCatalogId },
    select: { rack_id: true }
  });
  if (rows.length === 0) return true;
  return rows.some((r) => String(r.rack_id) === chargerItemId);
}

function isBatteryUpgrade(u: UpgradeLite | null): boolean {
  if (!u) return false;
  const t = String(u.type || '').toLowerCase();
  const c = String(u.category || '').toLowerCase();
  return t === 'battery' || c === 'battery';
}

function isWorkshopBenchUpgrade(u: UpgradeLite | null): boolean {
  if (!u) return false;
  const t = String(u.type || '').toLowerCase();
  const c = String(u.category || '').toLowerCase();
  if (t === 'charger') return true;
  return c === 'oficina' || c === 'workshop';
}

async function ensureGameStateRow(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  const exists = await tx.game_states.findUnique({ where: { user_id: userId }, select: { user_id: true } });
  if (exists) return;
  const now = BigInt(Date.now());
  await tx.game_states.create({
    data: {
      user_id: userId,
      usdc: 0,
      start_time: now,
      claimed_referrals: 0,
      referral_bonus_claimed: 0,
      last_updated_at: now,
      server_updated_at: now,
      black_market_balance: 0
    }
  });
}

function buildWorkshopSlotsFromRows(
  userId: number,
  rows: Array<{
    slot_index: number;
    item_id: string | null;
    internal_state: string | null;
    current_charge: number | null;
    slot_charges: string | null;
    slot_item_ids: string | null;
    installed_at: bigint | number | null;
  }>
): unknown[] {
  const workshopSlots: unknown[] = [null, null, null, null, null, null];
  for (const w of rows) {
    const idx = w.slot_index;
    if (!Number.isFinite(idx) || idx < 0 || idx >= WORKSHOP_BENCH_COUNT) continue;
    if (!w.item_id) continue;
    workshopSlots[idx] = {
      id: `ws_${userId}_${idx}`,
      itemId: w.item_id,
      internalSlots: parseJsonObject(w.internal_state),
      currentCharge: Number(w.current_charge) || 0,
      slotCharges: parseSlotCharges(w.slot_charges),
      slotItemIds: parseSlotItemIds(w.slot_item_ids),
      installedAt: typeof w.installed_at === 'bigint' ? Number(w.installed_at) : Number(w.installed_at ?? 0)
    };
  }
  return workshopSlots;
}

async function loadSlice(tx: Prisma.TransactionClient, userId: number): Promise<Omit<WorkshopMutateOk, 'ok' | 'serverUpdatedAt'>> {
  const [wsRows, stockRows, batRows] = await Promise.all([
    tx.workshop_slots.findMany({ where: { user_id: userId }, orderBy: { slot_index: 'asc' } }),
    tx.stock.findMany({ where: { user_id: userId } }),
    tx.stored_batteries.findMany({ where: { user_id: userId } })
  ]);
  const stock: Record<string, number> = {};
  for (const r of stockRows) {
    stock[r.item_id] = r.qty;
  }
  const storedBatteries = batRows.map((r) => ({
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
  return {
    workshopSlots: buildWorkshopSlotsFromRows(userId, wsRows),
    stock,
    storedBatteries
  };
}

async function recoverBatteryFromSlot(
  tx: Prisma.TransactionClient,
  userId: number,
  userEmail: string,
  wsIdx: number,
  slotId: string,
  instanceId: string,
  catalogId: string,
  chargeWh: number,
  reason: string
): Promise<void> {
  const batDef = await loadUpgrade(tx, catalogId);
  const cap = batDef?.power_capacity != null ? Number(batDef.power_capacity) : 100;
  const isInf = cap === -1;
  const isFull = isInf || (cap > 0 && chargeWh >= cap * 0.999);

  if (isFull) {
    await tx.stored_batteries.deleteMany({ where: { id: instanceId, user_id: userId } });
    const row = await tx.stock.findUnique({
      where: { user_id_item_id: { user_id: userId, item_id: catalogId } }
    });
    const next = (row?.qty ?? 0) + 1;
    await tx.stock.upsert({
      where: { user_id_item_id: { user_id: userId, item_id: catalogId } },
      create: { user_id: userId, item_id: catalogId, qty: 1 },
      update: { qty: next }
    });
  } else {
    const ch = Math.max(0, chargeWh);
    const img =
      batDef?.image != null && String(batDef.image).trim() !== ''
        ? String(batDef.image).trim().slice(0, 2048)
        : null;
    await tx.stored_batteries.upsert({
      where: { id: instanceId },
      create: {
        id: instanceId,
        user_id: userId,
        item_id: catalogId,
        current_charge: ch,
        power_capacity_wh: batDef?.power_capacity != null ? Number(batDef.power_capacity) : null,
        display_name: batDef?.name != null ? String(batDef.name).slice(0, 500) : null,
        image_url: img,
        workshop_slot_index: null,
        workshop_component_slot_id: null
      },
      update: {
        user_id: userId,
        item_id: catalogId,
        current_charge: ch,
        power_capacity_wh: batDef?.power_capacity != null ? Number(batDef.power_capacity) : undefined,
        display_name: batDef?.name != null ? String(batDef.name).slice(0, 500) : undefined,
        image_url: img ?? undefined,
        workshop_slot_index: null,
        workshop_component_slot_id: null
      }
    });
  }

  await logCharging(tx, userEmail, {
    action: 'removed_to_stock',
    workshop_slot_index: wsIdx,
    component_slot_id: slotId,
    battery_instance_id: instanceId,
    battery_item_id: catalogId,
    charge_amount: chargeWh,
    stock_confirmed: true,
    details: sanitizeDetails({ reason, batteryName: catalogId })
  });
}

async function recoverNonBatteryFromSlot(
  tx: Prisma.TransactionClient,
  userId: number,
  catalogId: string
): Promise<void> {
  const row = await tx.stock.findUnique({
    where: { user_id_item_id: { user_id: userId, item_id: catalogId } }
  });
  const next = (row?.qty ?? 0) + 1;
  await tx.stock.upsert({
    where: { user_id_item_id: { user_id: userId, item_id: catalogId } },
    create: { user_id: userId, item_id: catalogId, qty: 1 },
    update: { qty: next }
  });
}

export async function runWorkshopMutation(userId: number, body: WorkshopMutateBody, userEmail: string): Promise<WorkshopMutateOk> {
  const email = String(userEmail || '').trim();
  if (!email) {
    throw new WorkshopMutationError('Sessão inválida.', 401);
  }

  const action = body?.action;
  if (
    action !== 'equip_bench' &&
    action !== 'unequip_bench' &&
    action !== 'equip_component' &&
    action !== 'unequip_component'
  ) {
    throw new WorkshopMutationError('Operação inválida.', 400);
  }

  const slotIndex = assertSlotIndex(body.slotIndex);

  return prisma.$transaction(
    async (tx) => {
      await ensureGameStateRow(tx, userId);
      await lockUserGameState(tx, userId);
      await checkExpectedRevision(tx, userId, body.expectedServerUpdatedAt);

      if (action === 'equip_bench') {
        const itemId = assertItemId(body.itemId, 'Peça');
        const def = await loadUpgrade(tx, itemId);
        if (!def || !isWorkshopBenchUpgrade(def)) {
          throw new WorkshopMutationError('Esta peça não pode ser instalada na oficina.', 400);
        }
        const row = await tx.workshop_slots.findUnique({
          where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } }
        });
        if (row?.item_id && String(row.item_id).trim() !== '') {
          throw new WorkshopMutationError('Esta bancada já tem uma estrutura instalada.', 409);
        }
        const st = await tx.stock.findUnique({
          where: { user_id_item_id: { user_id: userId, item_id: itemId } }
        });
        if (!st || st.qty < 1) {
          throw new WorkshopMutationError('Não tens stock suficiente desta peça.', 400);
        }
        await tx.stock.update({
          where: { user_id_item_id: { user_id: userId, item_id: itemId } },
          data: { qty: st.qty - 1 }
        });
        const nowBi = BigInt(Date.now());
        await tx.workshop_slots.upsert({
          where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } },
          create: {
            user_id: userId,
            slot_index: slotIndex,
            item_id: itemId,
            internal_state: null,
            current_charge: 0,
            slot_charges: null,
            slot_item_ids: null,
            installed_at: nowBi
          },
          update: {
            item_id: itemId,
            internal_state: null,
            current_charge: 0,
            slot_charges: null,
            slot_item_ids: null,
            installed_at: nowBi
          }
        });
      } else if (action === 'unequip_bench') {
        const row = await tx.workshop_slots.findUnique({
          where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } }
        });
        if (!row || !row.item_id) {
          throw new WorkshopMutationError('Não há estrutura nesta bancada.', 409);
        }
        const structId = String(row.item_id);
        const def = await loadUpgrade(tx, structId);
        const internal = parseJsonObject(row.internal_state);
        const slotCharges = parseSlotCharges(row.slot_charges);
        const slotItemIds = parseSlotItemIds(row.slot_item_ids);

        if (def && String(def.type).toLowerCase() === 'charger') {
          const ch = Number(row.current_charge) || 0;
          if (ch > 0.000001) {
            throw new WorkshopMutationError('Não é possível remover um carregador com carga interna.', 400);
          }
          const instAt = Number(row.installed_at ?? 0);
          if (instAt > 0) {
            const midnight = new Date(instAt);
            midnight.setUTCDate(midnight.getUTCDate() + 1);
            midnight.setUTCHours(0, 0, 0, 0);
            if (Date.now() < midnight.getTime()) {
              throw new WorkshopMutationError(
                'Este carregador só pode ser removido após as 00:00 (UTC) do dia seguinte à instalação.',
                400
              );
            }
          }
        }

        for (const [slotId, val] of Object.entries(internal)) {
          if (val == null) continue;
          const vid = String(val).trim();
          if (!vid) continue;
          const originalItemId = slotItemIds[slotId];
          if (!originalItemId) continue;
          const upg = await loadUpgrade(tx, originalItemId);
          const isBattery = isBatteryUpgrade(upg) || INSTANCE_UUID_RE.test(vid);
          if (isBattery && upg) {
            const charge = slotCharges[slotId] ?? 0;
            await recoverBatteryFromSlot(tx, userId, email, slotIndex, slotId, vid, originalItemId, charge, 'structure_removal');
          } else if (upg) {
            await recoverNonBatteryFromSlot(tx, userId, originalItemId);
          }
        }

        const st = await tx.stock.findUnique({
          where: { user_id_item_id: { user_id: userId, item_id: structId } }
        });
        const nextQty = (st?.qty ?? 0) + 1;
        await tx.stock.upsert({
          where: { user_id_item_id: { user_id: userId, item_id: structId } },
          create: { user_id: userId, item_id: structId, qty: 1 },
          update: { qty: nextQty }
        });

        await tx.workshop_slots.update({
          where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } },
          data: {
            item_id: null,
            internal_state: null,
            current_charge: 0,
            slot_charges: null,
            slot_item_ids: null,
            installed_at: BigInt(0)
          }
        });
      } else if (action === 'equip_component') {
        const componentSlotId = assertComponentSlotId(body.componentSlotId);
        const catalogItemId = assertItemId(body.itemId, 'Peça');
        const sbid = assertStoredBatteryId(body.storedBatteryId);

        const wsRow = await tx.workshop_slots.findUnique({
          where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } }
        });
        if (!wsRow?.item_id) {
          throw new WorkshopMutationError('Não há carregador ou bancada neste índice.', 400);
        }
        const structureId = String(wsRow.item_id);
        const structDef = await loadUpgrade(tx, structureId);
        if (!structDef || String(structDef.type).toLowerCase() !== 'charger') {
          throw new WorkshopMutationError('Só podes montar componentes num carregador.', 400);
        }
        const layoutRows = await tx.upgrades.findUnique({
          where: { id: structureId },
          select: { layout: true }
        });
        const layout = parseWorkshopStructureLayout(layoutRows?.layout ?? null, structureId);
        const layoutSlot = findLayoutSlot(layout, componentSlotId);
        if (!layoutSlot?.id) {
          throw new WorkshopMutationError('Este slot não existe no layout deste carregador.', 400);
        }
        const slotType = String(layoutSlot.type || '').toLowerCase();

        let internal = parseJsonObject(wsRow.internal_state);
        let slotCharges = parseSlotCharges(wsRow.slot_charges);
        let slotItemIds = parseSlotItemIds(wsRow.slot_item_ids);

        const oldInstanceId = internal[componentSlotId] != null ? String(internal[componentSlotId]).trim() : '';
        const oldItemId = slotItemIds[componentSlotId];

        if (oldInstanceId && oldItemId) {
          const oldUpg = await loadUpgrade(tx, oldItemId);
          const oldIsBattery = isBatteryUpgrade(oldUpg) || INSTANCE_UUID_RE.test(oldInstanceId);
          if (oldIsBattery && oldUpg) {
            const oldCharge = getWorkshopSlotChargeWh(slotCharges, componentSlotId);
            await recoverBatteryFromSlot(
              tx,
              userId,
              email,
              slotIndex,
              componentSlotId,
              oldInstanceId,
              oldItemId,
              oldCharge,
              'replaced_during_equip'
            );
          } else if (oldUpg) {
            await recoverNonBatteryFromSlot(tx, userId, oldItemId);
          }
        }

        const partDef = await loadUpgrade(tx, catalogItemId);
        if (!partDef) {
          throw new WorkshopMutationError('Peça desconhecida no catálogo.', 400);
        }

        if (slotType === 'battery') {
          if (!isBatteryUpgrade(partDef)) {
            throw new WorkshopMutationError('Este slot só aceita baterias.', 400);
          }
          const allowed = await batteryAllowedOnCharger(tx, catalogItemId, structureId);
          if (!allowed) {
            throw new WorkshopMutationError('Esta bateria não é compatível com este carregador.', 400);
          }

          let finalInstanceId: string;
          let actualItemId = catalogItemId;
          let initCharge = 0;

          if (sbid) {
            const sb = await tx.stored_batteries.findUnique({ where: { id: sbid } });
            if (!sb || sb.user_id !== userId) {
              throw new WorkshopMutationError('Bateria não encontrada no teu armazém.', 409);
            }
            if (String(sb.item_id) !== catalogItemId) {
              throw new WorkshopMutationError('A bateria escolhida não corresponde ao tipo pedido.', 409);
            }
            const wsi = sb.workshop_slot_index;
            const wsc = sb.workshop_component_slot_id != null ? String(sb.workshop_component_slot_id) : '';
            if (wsi != null && wsc !== '') {
              const sameSlot = wsi === slotIndex && wsc === String(componentSlotId);
              if (!sameSlot) {
                throw new WorkshopMutationError('Esta bateria já está montada num carregador. Retira-a primeiro.', 409);
              }
            }
            finalInstanceId = sbid;
            actualItemId = String(sb.item_id);
            initCharge = Number(sb.current_charge) || 0;
          } else {
            const st = await tx.stock.findUnique({
              where: { user_id_item_id: { user_id: userId, item_id: catalogItemId } }
            });
            if (!st || st.qty < 1) {
              throw new WorkshopMutationError('Sem stock desta bateria.', 400);
            }
            await tx.stock.update({
              where: { user_id_item_id: { user_id: userId, item_id: catalogItemId } },
              data: { qty: st.qty - 1 }
            });
            finalInstanceId = crypto.randomUUID();
            const capNew = partDef.power_capacity != null ? Number(partDef.power_capacity) : 100;
            initCharge = capNew === -1 ? 0 : capNew > 0 ? capNew : 100;
            actualItemId = catalogItemId;
          }

          const maxCap = partDef.power_capacity != null ? Number(partDef.power_capacity) : 100;
          if (Number.isFinite(maxCap) && maxCap > 0 && initCharge > maxCap) {
            initCharge = maxCap;
          }

          if (sbid) {
            await tx.stored_batteries.update({
              where: { id: sbid },
              data: {
                workshop_slot_index: slotIndex,
                workshop_component_slot_id: componentSlotId,
                current_charge: initCharge
              }
            });
          } else {
            const imgNew =
              partDef.image != null && String(partDef.image).trim() !== ''
                ? String(partDef.image).trim().slice(0, 2048)
                : null;
            await tx.stored_batteries.create({
              data: {
                id: finalInstanceId,
                user_id: userId,
                item_id: actualItemId,
                current_charge: initCharge,
                power_capacity_wh: partDef.power_capacity != null ? Number(partDef.power_capacity) : null,
                display_name: partDef.name != null ? String(partDef.name).slice(0, 500) : null,
                image_url: imgNew,
                workshop_slot_index: slotIndex,
                workshop_component_slot_id: componentSlotId
              }
            });
          }

          internal = { ...internal, [componentSlotId]: finalInstanceId };
          slotCharges = { ...slotCharges, [componentSlotId]: initCharge };
          slotItemIds = { ...slotItemIds, [componentSlotId]: actualItemId };

          await logCharging(tx, email, {
            action: 'inserted',
            workshop_slot_index: slotIndex,
            component_slot_id: componentSlotId,
            battery_instance_id: finalInstanceId,
            battery_item_id: actualItemId,
            charge_amount: initCharge,
            stock_confirmed: !sbid,
            details: sanitizeDetails({ note: sbid ? 'from_warehouse' : 'from_stock' })
          });
        } else {
          if (!['machine', 'multiplier', 'wiring'].includes(slotType)) {
            throw new WorkshopMutationError('Tipo de slot não suportado nesta operação.', 400);
          }
          const st = await tx.stock.findUnique({
            where: { user_id_item_id: { user_id: userId, item_id: catalogItemId } }
          });
          if (!st || st.qty < 1) {
            throw new WorkshopMutationError('Sem stock desta peça.', 400);
          }
          await tx.stock.update({
            where: { user_id_item_id: { user_id: userId, item_id: catalogItemId } },
            data: { qty: st.qty - 1 }
          });
          internal = { ...internal, [componentSlotId]: catalogItemId };
          slotItemIds = { ...slotItemIds, [componentSlotId]: catalogItemId };
        }

        await tx.workshop_slots.update({
          where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } },
          data: {
            internal_state: stringifyJson(internal),
            slot_charges: stringifyJson(slotCharges as unknown as Record<string, unknown>),
            slot_item_ids: stringifyJson(slotItemIds as unknown as Record<string, unknown>)
          }
        });
        await syncStoredBatteriesWithWorkshopSlotRow(tx, userId, slotIndex);
      } else if (action === 'unequip_component') {
        const componentSlotId = assertComponentSlotId(body.componentSlotId);
        const wsRow = await tx.workshop_slots.findUnique({
          where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } }
        });
        if (!wsRow?.item_id) {
          throw new WorkshopMutationError('Bancada vazia.', 409);
        }
        const internal = parseJsonObject(wsRow.internal_state);
        const slotCharges = parseSlotCharges(wsRow.slot_charges);
        const slotItemIds = parseSlotItemIds(wsRow.slot_item_ids);
        const val = internal[componentSlotId] != null ? String(internal[componentSlotId]).trim() : '';
        if (!val) {
          throw new WorkshopMutationError('Este slot já está vazio.', 409);
        }
        const originalItemId = slotItemIds[componentSlotId];
        if (!originalItemId) {
          throw new WorkshopMutationError('Estado da oficina incompleto (slotItemIds). Recarrega (F5).', 409, true);
        }
        const upg = await loadUpgrade(tx, originalItemId);
        const isBattery = isBatteryUpgrade(upg) || INSTANCE_UUID_RE.test(val);
        if (isBattery && upg) {
          const charge = getWorkshopSlotChargeWh(slotCharges, componentSlotId);
          await logCharging(tx, email, {
            action: 'removed_to_stock',
            workshop_slot_index: slotIndex,
            component_slot_id: componentSlotId,
            battery_instance_id: val,
            battery_item_id: originalItemId,
            charge_amount: charge,
            stock_confirmed: true,
            details: sanitizeDetails({})
          });
          const cap = upg.power_capacity != null ? Number(upg.power_capacity) : 100;
          const isInf = cap === -1;
          const isFull = isInf || (cap > 0 && charge >= cap * 0.999);
          if (isFull) {
            await tx.stored_batteries.deleteMany({ where: { id: val, user_id: userId } });
            const row = await tx.stock.findUnique({
              where: { user_id_item_id: { user_id: userId, item_id: originalItemId } }
            });
            const next = (row?.qty ?? 0) + 1;
            await tx.stock.upsert({
              where: { user_id_item_id: { user_id: userId, item_id: originalItemId } },
              create: { user_id: userId, item_id: originalItemId, qty: 1 },
              update: { qty: next }
            });
          } else {
            const instId = INSTANCE_UUID_RE.test(val) ? val : crypto.randomUUID();
            const ch = Math.max(0, charge);
            const imgW =
              upg.image != null && String(upg.image).trim() !== ''
                ? String(upg.image).trim().slice(0, 2048)
                : null;
            await tx.stored_batteries.upsert({
              where: { id: instId },
              create: {
                id: instId,
                user_id: userId,
                item_id: originalItemId,
                current_charge: ch,
                power_capacity_wh: upg.power_capacity != null ? Number(upg.power_capacity) : null,
                display_name: upg.name != null ? String(upg.name).slice(0, 500) : null,
                image_url: imgW,
                workshop_slot_index: null,
                workshop_component_slot_id: null
              },
              update: {
                user_id: userId,
                item_id: originalItemId,
                current_charge: ch,
                power_capacity_wh: upg.power_capacity != null ? Number(upg.power_capacity) : undefined,
                display_name: upg.name != null ? String(upg.name).slice(0, 500) : undefined,
                image_url: imgW ?? undefined,
                workshop_slot_index: null,
                workshop_component_slot_id: null
              }
            });
          }
        } else if (upg) {
          await recoverNonBatteryFromSlot(tx, userId, originalItemId);
        }

        delete internal[componentSlotId];
        delete slotCharges[componentSlotId];
        delete slotItemIds[componentSlotId];

        await tx.workshop_slots.update({
          where: { user_id_slot_index: { user_id: userId, slot_index: slotIndex } },
          data: {
            internal_state: stringifyJson(internal),
            slot_charges: stringifyJson(slotCharges as unknown as Record<string, unknown>),
            slot_item_ids: stringifyJson(slotItemIds as unknown as Record<string, unknown>)
          }
        });
        await syncStoredBatteriesWithWorkshopSlotRow(tx, userId, slotIndex);
      }

      const serverUpdatedAt = await bumpServerUpdatedAt(tx, userId);
      const slice = await loadSlice(tx, userId);
      return { ok: true as const, serverUpdatedAt, ...slice };
    },
    { timeout: 25_000, maxWait: 8_000 }
  );
}
