/**
 * Snapshot autoritativo para a área Servidores — alinhado com leituras de `GET /api/game-state`
 * (subset: stock, baterias, racks, oficina, salas, moedas, upgrades).
 */
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { computeProgressForUser } from '../../cron/miningProgressComputer.js';
import { SAVE_GAME_ITEM_ID_RE } from '../../lib/saveGameEconomyValidate.js';
import { enrichWorkshopSlotsSlotItemIdsFromChargingHistory } from '../../lib/saveGameEconomyValidate.js';
import { loadMyRigRoomsForUser } from '../../lib/meUpgradeShopBundlePayload.js';
import { loadMiningCoinsForBootstrap, loadUpgradesForBootstrap } from '../../lib/publicBootstrapPayload.js';
import { normalizePlacedRackRoomId } from '../batteries/batteries.validation.js';
import { recoverOrphanRackBatteryStorageRows } from '../batteries/batteries.recovery.js';
import type {
  ServersAuthoritativeStateDto,
  ServersStatePlacedRackDto,
  ServersStateStoredBatteryDto
} from './servers.types.js';

function isValidSaveGameItemId(value: unknown): value is string {
  return typeof value === 'string' && SAVE_GAME_ITEM_ID_RE.test(value);
}

function safeWorkshopJsonObject(raw: unknown, label: string, userId: unknown): Record<string, unknown> {
  if (raw == null || raw === '') return {};
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v as Record<string, unknown>;
  } catch {
    console.warn(`[servers/state] JSON inválido em ${label} (user ${userId})`);
    return {};
  }
}

/** Expõe construção de racks para testes unitários sem Prisma. */
export function mapPrismaRacksToPlacedRackDtos(
  rackRows: Array<{
    id: string;
    item_id: string;
    wiring_id: string | null;
    battery_id: string | null;
    current_charge: number;
    is_on: number;
    selected_coin_id: string | null;
    room_id: string | null;
    slot_index: number | null;
    battery_catalog_item_id?: string | null;
    battery_power_capacity_wh?: number | null;
    battery_display_name?: string | null;
    battery_image_url?: string | null;
  }>,
  slotsList: Array<{ rack_id: string; slot_index: number; machine_item_id: string | null }>,
  multipliersList: Array<{ rack_id: string; slot_index: number; multiplier_item_id: string | null }>
): ServersStatePlacedRackDto[] {
  const slotsMap = new Map<string, unknown[]>();
  const multipliersMap = new Map<string, unknown[]>();

  slotsList.forEach((s) => {
    if (!slotsMap.has(s.rack_id)) slotsMap.set(s.rack_id, []);
    const arr = slotsMap.get(s.rack_id)!;
    arr[s.slot_index] = s.machine_item_id;
  });

  multipliersList.forEach((m) => {
    if (!multipliersMap.has(m.rack_id)) multipliersMap.set(m.rack_id, []);
    const arr = multipliersMap.get(m.rack_id)!;
    arr[m.slot_index] = m.multiplier_item_id;
  });

  const placedRacks: ServersStatePlacedRackDto[] = [];
  for (const r of rackRows) {
    placedRacks.push({
      id: r.id,
      itemId: r.item_id,
      slots: slotsMap.get(r.id) || [],
      multiplierSlots: multipliersMap.get(r.id) || [],
      wiringId: r.wiring_id,
      batteryId: r.battery_id,
      currentCharge: r.current_charge,
      isOn: !!r.is_on,
      selectedCoinId: r.selected_coin_id,
      batteryCatalogItemId: r.battery_catalog_item_id ?? null,
      batteryPowerCapacityWh:
        r.battery_power_capacity_wh != null ? Number(r.battery_power_capacity_wh) : null,
      batteryDisplayName: r.battery_display_name ?? null,
      batteryImageUrl: r.battery_image_url ?? null,
      roomId: normalizePlacedRackRoomId(r.room_id),
      slotIndex: r.slot_index || 0
    });
  }
  return placedRacks;
}

export async function buildServersAuthoritativeStateDto(
  prisma: PrismaClient,
  pool: Pool,
  uid: number,
  userEmail: string
): Promise<ServersAuthoritativeStateDto> {
  const progressRes = await computeProgressForUser(pool, uid, Date.now());
  if (!progressRes.ok) {
    console.warn(
      '[servers/state] computeProgressForUser falhou uid=%s — snapshot pode estar ligeiramente atrás neste pedido',
      uid
    );
  }

  const [
    gsRow,
    stockRows,
    storedBatRows,
    rackRows,
    workshopRows,
    rigRooms,
    miningCoins,
    upgrades
  ] = await Promise.all([
    prisma.game_states.findUnique({ where: { user_id: uid } }),
    prisma.stock.findMany({ where: { user_id: uid } }),
    prisma.stored_batteries.findMany({ where: { user_id: uid } }),
    prisma.placed_racks.findMany({ where: { user_id: uid } }),
    prisma.workshop_slots.findMany({ where: { user_id: uid }, orderBy: { slot_index: 'asc' } }),
    loadMyRigRoomsForUser(uid),
    loadMiningCoinsForBootstrap(),
    loadUpgradesForBootstrap(uid)
  ]);

  const gs =
    gsRow ||
    ({
      usdc: 0,
      server_updated_at: BigInt(0)
    } as NonNullable<typeof gsRow>);

  const stock: Record<string, number> = {};
  stockRows.forEach((r) => {
    if (!isValidSaveGameItemId(r.item_id)) return;
    stock[r.item_id] = r.qty;
  });

  const storedBatteries: ServersStateStoredBatteryDto[] = storedBatRows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    currentCharge: r.current_charge,
    powerCapacityWh: r.power_capacity_wh != null ? Number(r.power_capacity_wh) : null,
    displayName: r.display_name != null ? String(r.display_name) : null,
    imageUrl: r.image_url != null ? String(r.image_url) : null,
    workshopSlotIndex: r.workshop_slot_index != null ? Number(r.workshop_slot_index) : null,
    workshopComponentSlotId:
      r.workshop_component_slot_id != null ? String(r.workshop_component_slot_id) : null
  }));

  let placedRacks: ServersStatePlacedRackDto[] = [];
  if (rackRows.length > 0) {
    const rackIds = rackRows.map((r) => r.id);
    const [slotsList, multipliersList] = await Promise.all([
      prisma.rack_slots.findMany({
        where: { rack_id: { in: rackIds } },
        orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }]
      }),
      prisma.rack_multiplier_slots.findMany({
        where: { rack_id: { in: rackIds } },
        orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }]
      })
    ]);
    placedRacks = mapPrismaRacksToPlacedRackDtos(rackRows, slotsList, multipliersList);
  }

  if (placedRacks.length > 0) {
    try {
      const recovered = await recoverOrphanRackBatteryStorageRows(pool, uid, placedRacks);
      if (recovered.length > 0) {
        const seen = new Set(storedBatteries.map((b) => b.id));
        for (const row of recovered) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          storedBatteries.push({
            id: row.id,
            itemId: row.item_id,
            currentCharge: row.current_charge,
            powerCapacityWh: null,
            displayName: null,
            imageUrl: null,
            workshopSlotIndex: null,
            workshopComponentSlotId: null
          });
        }
        console.warn(
          `[servers/state] Recuperada(s) ${recovered.length} instância(s) de bateria em armazém (UUID sem linha) uid=${uid}`
        );
      }
    } catch (eRec) {
      console.error(
        `[servers/state] Falha ao recuperar baterias órfãs uid=${uid}:`,
        eRec instanceof Error ? eRec.message : String(eRec)
      );
    }
  }

  const workshopSlots: (ServersAuthoritativeStateDto['workshopSlots'][number])[] = [
    null,
    null,
    null,
    null,
    null,
    null
  ];
  workshopRows.forEach((w) => {
    if (w.slot_index >= 0 && w.slot_index < 6) {
      workshopSlots[w.slot_index] = {
        id: `ws_${uid}_${w.slot_index}`,
        itemId: w.item_id,
        internalSlots: safeWorkshopJsonObject(w.internal_state, 'workshop_slots.internal_state', uid),
        currentCharge: w.current_charge ?? 0,
        slotCharges: safeWorkshopJsonObject(w.slot_charges, 'workshop_slots.slot_charges', uid),
        slotItemIds: safeWorkshopJsonObject(w.slot_item_ids, 'workshop_slots.slot_item_ids', uid),
        installedAt: Number(w.installed_at ?? 0)
      };
    }
  });

  try {
    await enrichWorkshopSlotsSlotItemIdsFromChargingHistory(pool, String(userEmail || ''), workshopSlots);
  } catch (e) {
    console.warn('[servers/state] enrich workshop slotItemIds:', e instanceof Error ? e.message : String(e));
  }

  const serverUpdatedAtNum = Number(gs.server_updated_at ?? 0);
  const serverUpdatedAt = Number.isFinite(serverUpdatedAtNum) ? serverUpdatedAtNum : 0;

  return {
    version: 1,
    usdc: gs.usdc,
    serverUpdatedAt,
    stateVersion: serverUpdatedAt,
    stock,
    storedBatteries,
    placedRacks,
    workshopSlots,
    rigRooms,
    miningCoins,
    upgrades
  };
}
