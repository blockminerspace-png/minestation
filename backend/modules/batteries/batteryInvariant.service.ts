/**
 * Invariantes de instância de bateria (status/location vs rack/oficina).
 * Usado por serviços novos, snapshots e diagnóstico — sem constraints fortes na BD (legado).
 */

export const BATTERY_STATUS_INVENTORY = 'INVENTORY';
export const BATTERY_STATUS_EQUIPPED = 'EQUIPPED';
export const BATTERY_STATUS_CHARGING = 'CHARGING';
export const BATTERY_STATUS_BROKEN = 'BROKEN';
export const BATTERY_STATUS_CONSUMED = 'CONSUMED';
export const BATTERY_STATUS_LOCKED = 'LOCKED';

export const BATTERY_LOC_WAREHOUSE = 'WAREHOUSE';
/** Alias aceite em legados / especificações (equivale a armazém). */
export const BATTERY_LOC_INVENTORY = 'INVENTORY';
export const BATTERY_LOC_RACK = 'RACK';
export const BATTERY_LOC_WORKSHOP = 'WORKSHOP_CHARGER';

/** Regex POSIX para UUID de instância (alinhado a `batteries.integrity.ts`). */
export const PG_BATTERY_INSTANCE_UUID =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export type BatterySemanticRow = {
  id: string;
  user_id: number;
  status: string | null;
  location: string | null;
  rack_id: string | null;
  slot_id: number | null;
  room_id: string | null;
  workshop_slot_index: number | null;
  workshop_component_slot_id?: string | null;
  version: number | null;
};

export type PlacedRackBatteryRef = {
  rack_id: string;
  battery_id: string | null;
  user_id: number;
};

export function normalizeBatteryStatus(status: string | null | undefined): string {
  return String(status || '').trim().toUpperCase();
}

/** Localização de armazém (migração Fase 3 usa `WAREHOUSE`; texto `INVENTORY` tratado como equivalente). */
export function isWarehouseInventoryLocation(location: string | null | undefined): boolean {
  const l = String(location || '').trim().toUpperCase();
  return l === '' || l === BATTERY_LOC_WAREHOUSE || l === BATTERY_LOC_INVENTORY;
}

/** Bateria disponível no armazém (DTO inventário): não montada nem em oficina. */
export function isBatteryAvailableInWarehouseSemantic(b: BatterySemanticRow): boolean {
  if (b.workshop_slot_index != null) return false;
  const wsc = b.workshop_component_slot_id != null ? String(b.workshop_component_slot_id).trim() : '';
  if (wsc) return false;
  const st = normalizeBatteryStatus(b.status);
  if (st === BATTERY_STATUS_EQUIPPED || st === BATTERY_STATUS_CHARGING) return false;
  if (st === BATTERY_STATUS_CONSUMED || st === BATTERY_STATUS_LOCKED) return false;
  if (st === BATTERY_STATUS_BROKEN) return false;
  return st === BATTERY_STATUS_INVENTORY || st === '';
}

export type InventoryWarehouseExposeInput = {
  id: string;
  status: string | null;
  location: string | null;
  rack_id?: string | null;
  slot_id?: number | null;
  room_id?: string | null;
  workshop_slot_index?: number | null;
  workshop_component_slot_id?: string | null;
};

/**
 * Decide se uma instância pode aparecer como disponível em `GET /api/inventory/state`.
 * Não corrige dados — só classifica (divergências devolvem `ok: false` com `event` para log).
 */
export function shouldExposeBatteryInInventoryWarehouse(
  b: InventoryWarehouseExposeInput,
  mountedRackBatteryIds: ReadonlySet<string>
): { ok: true } | { ok: false; reason: string; event: string } {
  const id = String(b.id || '').trim();
  if (!id) return { ok: false, reason: 'empty_id', event: 'inventory_battery_skip' };
  if (mountedRackBatteryIds.has(id)) {
    return { ok: false, reason: 'listed_on_placed_rack', event: 'inventory_state_battery_divergence' };
  }
  const st = normalizeBatteryStatus(b.status);
  if (st === BATTERY_STATUS_EQUIPPED || st === BATTERY_STATUS_CHARGING) {
    return { ok: false, reason: `status_${st || 'EMPTY'}`, event: 'inventory_state_battery_divergence' };
  }
  if (st === BATTERY_STATUS_CONSUMED || st === BATTERY_STATUS_LOCKED || st === BATTERY_STATUS_BROKEN) {
    return { ok: false, reason: `blocked_${st}`, event: 'inventory_state_battery_blocked' };
  }
  if (b.workshop_slot_index != null) {
    return { ok: false, reason: 'workshop_slot', event: 'inventory_state_battery_divergence' };
  }
  const wsc = b.workshop_component_slot_id != null ? String(b.workshop_component_slot_id).trim() : '';
  if (wsc) {
    return { ok: false, reason: 'workshop_component', event: 'inventory_state_battery_divergence' };
  }
  const rk = b.rack_id != null ? String(b.rack_id).trim() : '';
  if (rk) {
    return { ok: false, reason: 'rack_id_on_inventory_semantics', event: 'inventory_state_battery_divergence' };
  }
  const sid = b.slot_id != null ? Number(b.slot_id) : null;
  if (sid != null && Number.isFinite(sid) && sid !== 0) {
    return { ok: false, reason: 'slot_id_set', event: 'inventory_state_battery_divergence' };
  }
  const rid = b.room_id != null ? String(b.room_id).trim() : '';
  if (rid) {
    return { ok: false, reason: 'room_id_set', event: 'inventory_state_battery_divergence' };
  }
  if (st === BATTERY_STATUS_INVENTORY || st === '') {
    if (!isWarehouseInventoryLocation(b.location)) {
      return { ok: false, reason: 'location_not_warehouse', event: 'inventory_state_battery_divergence' };
    }
    return { ok: true };
  }
  return { ok: false, reason: `unknown_status_${st}`, event: 'inventory_state_battery_divergence' };
}

/** Validação best-effort: INVENTORY não deve ter rack_id. */
export function assertInventoryHasNoRack(b: BatterySemanticRow): { ok: true } | { ok: false; reason: string } {
  const st = (b.status || '').trim().toUpperCase();
  if (st !== BATTERY_STATUS_INVENTORY && st !== '') return { ok: true };
  const rk = b.rack_id != null ? String(b.rack_id).trim() : '';
  if (rk) return { ok: false, reason: 'INVENTORY com rack_id' };
  return { ok: true };
}

/** Validação: EQUIPPED deve alinhar com rack que referencia esta bateria (se rack_id conhecido). */
export function assertEquippedAlignedWithRack(
  b: BatterySemanticRow,
  racksHoldingBattery: PlacedRackBatteryRef[]
): { ok: true } | { ok: false; reason: string } {
  const st = (b.status || '').trim().toUpperCase();
  if (st !== BATTERY_STATUS_EQUIPPED) return { ok: true };
  if (racksHoldingBattery.length === 0) {
    return { ok: false, reason: 'EQUIPPED sem placed_racks' };
  }
  const rk = b.rack_id != null ? String(b.rack_id).trim() : '';
  if (rk && !racksHoldingBattery.some((r) => String(r.rack_id) === rk)) {
    return { ok: false, reason: 'rack_id não coincide com racks' };
  }
  return { ok: true };
}

export function semanticChargingData(slotIndex: number, componentKey: string) {
  return {
    status: BATTERY_STATUS_CHARGING,
    location: BATTERY_LOC_WORKSHOP,
    rack_id: null,
    slot_id: null,
    room_id: null,
    workshop_slot_index: slotIndex,
    workshop_component_slot_id: componentKey
  };
}

export function semanticInventoryWarehouseData() {
  return {
    status: BATTERY_STATUS_INVENTORY,
    location: BATTERY_LOC_WAREHOUSE,
    rack_id: null,
    slot_id: null,
    room_id: null,
    workshop_slot_index: null,
    workshop_component_slot_id: null
  };
}
