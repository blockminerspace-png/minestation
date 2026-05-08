import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { batteryIdLooksLikePhysicalInstanceUuid } from './batteryInstanceResolve.js';

type DbLike = Pick<PrismaClient, '$queryRaw' | 'stored_batteries'>;

export type BatteryPossessionDomain = 'stored' | 'rack' | 'workshop';

export type BatteryPossessionConflict = {
  instanceId: string;
  userId: number;
  domains: BatteryPossessionDomain[];
  stored?: { itemId: string; currentCharge: number };
  racks: Array<{ rackId: string; currentCharge: number; isOn: number }>;
  workshopSlots: Array<{ slotIndex: number; slotKey: string; catalogItemId?: string; charge?: number }>;
  /** Heurística: rack > armazém > oficina (produção em rig costuma ser canónica). */
  recommendedStrategy: 'prefer_rack' | 'prefer_warehouse' | 'prefer_workshop';
};

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw == null || raw === '') return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type WorkshopInstanceRef = {
  slotIndex: number;
  slotKey: string;
  instanceId: string;
  catalogItemId?: string;
  charge?: number;
};

/** Todas as instâncias (UUID) referenciadas na oficina do utilizador. */
export function listWorkshopBatteryInstancesForRow(
  slotIndex: number,
  internalState: string | null | undefined,
  slotItemIds: string | null | undefined,
  slotCharges: string | null | undefined
): WorkshopInstanceRef[] {
  const int = parseJsonRecord(internalState ?? null);
  const sid = parseJsonRecord(slotItemIds ?? null);
  const chg = parseJsonRecord(slotCharges ?? null);
  if (!int) return [];
  const out: WorkshopInstanceRef[] = [];
  for (const [slotKey, rawVal] of Object.entries(int)) {
    if (rawVal == null) continue;
    const inst = String(rawVal).trim();
    if (!batteryIdLooksLikePhysicalInstanceUuid(inst)) continue;
    const catRaw = sid?.[slotKey];
    const cat = catRaw != null ? String(catRaw).trim() : undefined;
    const chargeRaw = chg?.[slotKey];
    const charge =
      typeof chargeRaw === 'number'
        ? chargeRaw
        : chargeRaw != null && String(chargeRaw).trim() !== ''
          ? parseFloat(String(chargeRaw))
          : undefined;
    out.push({
      slotIndex,
      slotKey,
      instanceId: inst,
      catalogItemId: cat || undefined,
      charge: Number.isFinite(charge) ? charge : undefined
    });
  }
  return out;
}

async function resolveCatalogItemIdForInstance(
  db: DbLike,
  userId: number,
  instanceId: string
): Promise<string | null> {
  const sb = await db.stored_batteries.findFirst({
    where: { user_id: userId, id: instanceId },
    select: { item_id: true }
  });
  if (sb?.item_id) return String(sb.item_id).trim();
  const rows = await db.$queryRaw<Array<{ item_id: string }>>(
    Prisma.sql`
      SELECT ch.battery_item_id::text AS item_id
      FROM charging_history ch
      INNER JOIN users u ON lower(trim(u.email::text)) = lower(trim(ch.user_email::text))
      WHERE u.id = ${userId}
        AND ch.battery_instance_id::text = ${instanceId}
        AND ch.battery_item_id IS NOT NULL
        AND BTRIM(ch.battery_item_id::text) <> ''
      ORDER BY ch.timestamp DESC
      LIMIT 1
    `
  );
  const fromHist = rows[0]?.item_id != null ? String(rows[0].item_id).trim() : '';
  if (fromHist) return fromHist;
  return null;
}

/**
 * Lista conflitos de posse: a mesma `battery_instance_id` em mais de um domínio (armazém, rig, oficina)
 * ou em várias rigs / vários slots de oficina.
 */
export async function auditBatteryPossessionForUser(userId: number): Promise<BatteryPossessionConflict[]> {
  const [stored, racks, workshopRows] = await Promise.all([
    prisma.stored_batteries.findMany({ where: { user_id: userId } }),
    prisma.placed_racks.findMany({
      where: { user_id: userId, battery_id: { not: null } },
      select: { id: true, battery_id: true, current_charge: true, is_on: true }
    }),
    prisma.workshop_slots.findMany({ where: { user_id: userId } })
  ]);

  type Acc = {
    domains: Set<BatteryPossessionDomain>;
    stored?: { itemId: string; currentCharge: number };
    racks: Array<{ rackId: string; currentCharge: number; isOn: number }>;
    workshopSlots: Array<{ slotIndex: number; slotKey: string; catalogItemId?: string; charge?: number }>;
  };

  const byInstance = new Map<string, Acc>();

  function touch(id: string): Acc {
    let a = byInstance.get(id);
    if (!a) {
      a = { domains: new Set(), racks: [], workshopSlots: [] };
      byInstance.set(id, a);
    }
    return a;
  }

  for (const s of stored) {
    const id = String(s.id).trim();
    if (!batteryIdLooksLikePhysicalInstanceUuid(id)) continue;
    const a = touch(id);
    a.domains.add('stored');
    a.stored = { itemId: String(s.item_id), currentCharge: Number(s.current_charge) || 0 };
  }

  for (const r of racks) {
    const bid = r.battery_id ? String(r.battery_id).trim() : '';
    if (!bid || !batteryIdLooksLikePhysicalInstanceUuid(bid)) continue;
    const a = touch(bid);
    a.domains.add('rack');
    a.racks.push({
      rackId: String(r.id),
      currentCharge: Number(r.current_charge) || 0,
      isOn: Number(r.is_on) || 0
    });
  }

  for (const w of workshopRows) {
    const refs = listWorkshopBatteryInstancesForRow(
      w.slot_index,
      w.internal_state,
      w.slot_item_ids,
      w.slot_charges
    );
    for (const ref of refs) {
      const a = touch(ref.instanceId);
      a.domains.add('workshop');
      a.workshopSlots.push({
        slotIndex: ref.slotIndex,
        slotKey: ref.slotKey,
        catalogItemId: ref.catalogItemId,
        charge: ref.charge
      });
    }
  }

  const conflicts: BatteryPossessionConflict[] = [];

  for (const [instanceId, acc] of byInstance) {
    const multiRack = acc.racks.length > 1;
    const multiWs = acc.workshopSlots.length > 1;
    const cross =
      (acc.domains.has('stored') && (acc.domains.has('rack') || acc.domains.has('workshop'))) ||
      (acc.domains.has('rack') && acc.domains.has('workshop'));
    const conflict = cross || multiRack || multiWs;

    if (!conflict) continue;

    let recommendedStrategy: BatteryPossessionConflict['recommendedStrategy'] = 'prefer_warehouse';
    if (acc.racks.some((x) => x.isOn === 1)) recommendedStrategy = 'prefer_rack';
    else if (acc.racks.length > 0) recommendedStrategy = 'prefer_rack';
    else if (acc.workshopSlots.length > 0 && !acc.stored) recommendedStrategy = 'prefer_workshop';

    conflicts.push({
      instanceId,
      userId,
      domains: [...acc.domains],
      stored: acc.stored,
      racks: acc.racks,
      workshopSlots: acc.workshopSlots,
      recommendedStrategy
    });
  }

  conflicts.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  return conflicts;
}

export type BatteryPossessionStrategy = 'prefer_rack' | 'prefer_warehouse' | 'prefer_workshop';

/**
 * Normaliza posse para uma instância: fica num único domínio. Preserva carga (máximo entre fontes).
 * Corre dentro de uma transação Prisma.
 */
export async function applyBatteryPossessionNormalization(
  userId: number,
  instanceId: string,
  strategy: BatteryPossessionStrategy
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = String(instanceId || '').trim();
  if (!id || !batteryIdLooksLikePhysicalInstanceUuid(id)) {
    return { ok: false, error: 'instanceId tem de ser um UUID de instância.' };
  }

  const pre = await auditBatteryPossessionForUser(userId);
  const hit = pre.find((c) => c.instanceId === id);
  if (!hit) {
    return { ok: false, error: 'Sem conflito conhecido para esta instância (já está consistente ou não existe).' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const storedRow = await tx.stored_batteries.findUnique({
        where: { id: id },
        select: { user_id: true, item_id: true, current_charge: true }
      });
      if (storedRow && storedRow.user_id !== userId) {
        throw new Error('A instância não pertence a este utilizador.');
      }

      const rackRows = await tx.placed_racks.findMany({
        where: { user_id: userId, battery_id: id },
        select: { id: true, current_charge: true }
      });

      const wsRows = await tx.workshop_slots.findMany({ where: { user_id: userId } });
      const wsRefsAll: WorkshopInstanceRef[] = [];
      for (const w of wsRows) {
        wsRefsAll.push(
          ...listWorkshopBatteryInstancesForRow(
            w.slot_index,
            w.internal_state,
            w.slot_item_ids,
            w.slot_charges
          )
        );
      }
      const wsRefsForId = wsRefsAll.filter((r) => r.instanceId === id);

      const charges: number[] = [];
      if (storedRow) charges.push(Number(storedRow.current_charge) || 0);
      for (const r of rackRows) charges.push(Number(r.current_charge) || 0);
      for (const r of wsRefsForId) {
        if (typeof r.charge === 'number' && Number.isFinite(r.charge)) charges.push(r.charge);
      }
      const maxCharge = charges.length ? Math.max(...charges) : 0;

      let catalogItemId =
        storedRow?.item_id?.trim() ||
        hit.stored?.itemId ||
        hit.workshopSlots.find((s) => s.catalogItemId)?.catalogItemId ||
        (await resolveCatalogItemIdForInstance(tx, userId, id));

      if (!catalogItemId) {
        throw new Error('Não foi possível determinar battery_item_id (catálogo) para esta instância.');
      }

      const clearWorkshop = async () => {
        for (const w of wsRows) {
          const int = parseJsonRecord(w.internal_state ?? null) ?? {};
          let changed = false;
          const nextInt = { ...int };
          const sid = parseJsonRecord(w.slot_item_ids ?? null) ?? {};
          const nextSid = { ...sid };
          const chg = parseJsonRecord(w.slot_charges ?? null) ?? {};
          const nextChg = { ...chg };
          for (const [k, v] of Object.entries(nextInt)) {
            if (v != null && String(v).trim() === id) {
              nextInt[k] = null;
              delete nextSid[k];
              delete nextChg[k];
              changed = true;
            }
          }
          if (changed) {
            await tx.workshop_slots.update({
              where: { user_id_slot_index: { user_id: userId, slot_index: w.slot_index } },
              data: {
                internal_state: JSON.stringify(nextInt),
                slot_item_ids: JSON.stringify(nextSid),
                slot_charges: JSON.stringify(nextChg)
              }
            });
          }
        }
      };

      const clearRacks = async () => {
        for (const r of rackRows) {
          await tx.placed_racks.update({
            where: { id: r.id },
            data: { battery_id: null, current_charge: 0, is_on: 0 }
          });
        }
      };

      const deleteStored = async () => {
        if (storedRow) {
          await tx.stored_batteries.delete({ where: { id } });
        }
      };

      if (strategy === 'prefer_rack') {
        if (rackRows.length === 0) throw new Error('prefer_rack: não há rig com esta bateria.');
        const canonical = rackRows.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0]!;
        for (const r of rackRows) {
          if (r.id === canonical.id) {
            await tx.placed_racks.update({
              where: { id: r.id },
              data: { battery_id: id, current_charge: maxCharge, is_on: 0 }
            });
          } else {
            await tx.placed_racks.update({
              where: { id: r.id },
              data: { battery_id: null, current_charge: 0, is_on: 0 }
            });
          }
        }
        await deleteStored();
        await clearWorkshop();
        return;
      }

      if (strategy === 'prefer_warehouse') {
        await clearRacks();
        await clearWorkshop();
        await tx.stored_batteries.upsert({
          where: { id },
          create: { id, user_id: userId, item_id: catalogItemId, current_charge: maxCharge },
          update: { item_id: catalogItemId, current_charge: maxCharge, user_id: userId }
        });
        return;
      }

      if (strategy === 'prefer_workshop') {
        if (wsRefsForId.length === 0) throw new Error('prefer_workshop: a instância não está na oficina.');
        const sorted = [...wsRefsForId].sort(
          (a, b) => a.slotIndex - b.slotIndex || a.slotKey.localeCompare(b.slotKey)
        );
        const keep = sorted[0]!;
        await clearRacks();
        await deleteStored();
        for (const w of wsRows) {
          const int = parseJsonRecord(w.internal_state ?? null) ?? {};
          const sid = parseJsonRecord(w.slot_item_ids ?? null) ?? {};
          const chg = parseJsonRecord(w.slot_charges ?? null) ?? {};
          const nextInt: Record<string, unknown> = { ...int };
          const nextSid: Record<string, unknown> = { ...sid };
          const nextChg: Record<string, unknown> = { ...chg };
          let changed = false;
          for (const [k, v] of Object.entries(nextInt)) {
            if (v == null || String(v).trim() !== id) continue;
            const isKeep = w.slot_index === keep.slotIndex && k === keep.slotKey;
            if (!isKeep) {
              nextInt[k] = null;
              delete nextSid[k];
              delete nextChg[k];
              changed = true;
            } else {
              nextChg[k] = maxCharge;
              if (catalogItemId && (nextSid[k] == null || String(nextSid[k]).trim() === '')) {
                nextSid[k] = catalogItemId;
              }
              changed = true;
            }
          }
          if (changed) {
            await tx.workshop_slots.update({
              where: { user_id_slot_index: { user_id: userId, slot_index: w.slot_index } },
              data: {
                internal_state: JSON.stringify(nextInt),
                slot_item_ids: JSON.stringify(nextSid),
                slot_charges: JSON.stringify(nextChg)
              }
            });
          }
        }
        return;
      }
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
