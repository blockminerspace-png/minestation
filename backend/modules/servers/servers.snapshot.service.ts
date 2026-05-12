/**
 * Snapshot autoritativo para a área Servidores — alinhado com leituras de `GET /api/game-state`
 * (subset: stock, baterias, racks, salas, moedas, upgrades).
 *
 * Sistema de carregamento descontinuado em
 * `20260516180000_battery_uuids_and_purge_charging`: já não há oficina,
 * `current_charge`, `power_capacity_wh` ou `workshop_slot_index` em qualquer lado.
 */
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { computeProgressForUser } from '../../cron/miningProgressComputer.js';
import { SAVE_GAME_ITEM_ID_RE } from '../../lib/saveGameEconomyValidate.js';
import { loadMyRigRoomsForUser } from '../../lib/meUpgradeShopBundlePayload.js';
import { loadMiningCoinsForBootstrap, loadUpgradesForBootstrap } from '../../lib/publicBootstrapPayload.js';
import { normalizePlacedRackRoomId } from '../batteries/batteries.validation.js';
import { isRackBatteryInstanceUuid } from '../batteries/batteries.repository.js';
import { normalizeKnown1000WhBatteryCatalogId } from '../batteries/batteries.catalog.js';
import { normalizeBatteryStatus } from '../batteries/batteryInvariant.service.js';
import type {
  ServersAuthoritativeStateDto,
  ServersStatePlacedRackDto,
  ServersStateStoredBatteryDto
} from './servers.types.js';

function isValidSaveGameItemId(value: unknown): value is string {
  return typeof value === 'string' && SAVE_GAME_ITEM_ID_RE.test(value);
}

/** Expõe construção de racks para testes unitários sem Prisma. */
export function mapPrismaRacksToPlacedRackDtos(
  rackRows: Array<{
    id: string;
    item_id: string;
    wiring_id: string | null;
    battery_id: string | null;
    is_on: number;
    selected_coin_id: string | null;
    room_id: string | null;
    slot_index: number | null;
    battery_catalog_item_id?: string | null;
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
      isOn: !!r.is_on,
      selectedCoinId: r.selected_coin_id,
      batteryCatalogItemId:
        r.battery_catalog_item_id != null ? normalizeKnown1000WhBatteryCatalogId(r.battery_catalog_item_id) : null,
      batteryDisplayName: r.battery_display_name ?? null,
      batteryImageUrl: r.battery_image_url ?? null,
      roomId: normalizePlacedRackRoomId(r.room_id),
      slotIndex: r.slot_index || 0
    });
  }
  return placedRacks;
}

export type ServersStateRequestContext = {
  requestId?: string | null;
};

function safeRequestId(ctx: ServersStateRequestContext | undefined): string | null {
  const r = ctx?.requestId;
  if (r == null || typeof r !== 'string') return null;
  const t = r.trim().slice(0, 120);
  return t || null;
}

/**
 * Detecta órfãos / duplicados / status incompatível com `placed_racks` (sem mutar dados).
 */
export function logServerStateBatteryConsistency(
  userId: number,
  placedRacks: Array<{ id: string; batteryId?: string | null }>,
  storedById: Map<string, { id: string; status: string | null }>,
  ctx?: ServersStateRequestContext
): void {
  const rid = safeRequestId(ctx);
  const base = (ev: string, extra: Record<string, unknown>) => {
    console.warn(JSON.stringify({ event: ev, userId, ...extra, ...(rid ? { requestId: rid } : {}) }));
  };

  const racksPerBattery = new Map<string, string[]>();
  for (const r of placedRacks) {
    const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
    if (!bid || !isRackBatteryInstanceUuid(bid)) continue;
    const arr = racksPerBattery.get(bid) || [];
    arr.push(String(r.id));
    racksPerBattery.set(bid, arr);
  }
  for (const [batteryId, rackIds] of racksPerBattery) {
    if (rackIds.length > 1) {
      base('server_state_battery_duplicate', {
        batteryId: batteryId.slice(0, 12),
        rackCount: rackIds.length
      });
    }
  }

  for (const r of placedRacks) {
    const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
    if (!bid || !isRackBatteryInstanceUuid(bid)) continue;
    const sb = storedById.get(bid);
    if (!sb) {
      base('server_state_battery_orphan', { rackId: String(r.id), batteryId: bid.slice(0, 12) });
      continue;
    }
    const st = normalizeBatteryStatus(sb.status);
    if (st === 'INVENTORY') {
      base('server_state_battery_status_mismatch', {
        rackId: String(r.id),
        batteryId: bid.slice(0, 12),
        storedStatus: st
      });
    }
  }
}

export async function buildServersAuthoritativeStateDto(
  prisma: PrismaClient,
  pool: Pool,
  uid: number,
  userEmail: string,
  ctx?: ServersStateRequestContext
): Promise<ServersAuthoritativeStateDto> {
  void userEmail;
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
    rigRooms,
    miningCoins,
    upgrades
  ] = await Promise.all([
    prisma.game_states.findUnique({ where: { user_id: uid } }),
    prisma.stock.findMany({ where: { user_id: uid } }),
    prisma.stored_batteries.findMany({
      where: { user_id: uid },
      select: {
        id: true,
        item_id: true,
        display_name: true,
        image_url: true,
        status: true
      }
    }),
    prisma.placed_racks.findMany({ where: { user_id: uid } }),
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
    const itemId = normalizeKnown1000WhBatteryCatalogId(r.item_id);
    stock[itemId] = (stock[itemId] || 0) + (Number(r.qty) || 0);
  });

  const storedById = new Map<string, { id: string; status: string | null }>();
  for (const r of storedBatRows) {
    storedById.set(String(r.id), { id: String(r.id), status: r.status != null ? String(r.status) : null });
  }

  const storedBatteries: ServersStateStoredBatteryDto[] = storedBatRows.map((r) => ({
    id: r.id,
    itemId: normalizeKnown1000WhBatteryCatalogId(r.item_id),
    displayName: r.display_name != null ? String(r.display_name) : null,
    imageUrl: r.image_url != null ? String(r.image_url) : null
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

  logServerStateBatteryConsistency(uid, placedRacks, storedById, ctx);

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
    rigRooms,
    miningCoins,
    upgrades
  };
}
