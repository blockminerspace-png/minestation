import type { PlacedRack, StoredBattery, Upgrade, WorkshopStructure } from '../types';

/** `placed_racks.battery_id`: id de upgrade (stock) ou UUID de instância em `storedBatteries`. */
export function resolveRackBatteryItemId(
  batteryId: string | null | undefined,
  upgrades: Upgrade[],
  storedBatteries: StoredBattery[] | undefined | null
): string | null {
  if (!batteryId) return null;
  if (upgrades.some((u) => u.id === batteryId)) return batteryId;
  const row = (storedBatteries || []).find((b) => b.id === batteryId);
  return row?.itemId ?? null;
}

/**
 * Igual a {@link resolveRackBatteryItemId}, mas se o inventário não tiver a instância (ex.: só montada na oficina),
 * tenta `workshopSlots`: mesmo UUID em `internalSlots` → `slotItemIds` do mesmo slot.
 */
export function resolveRackBatteryItemIdWithWorkshopFallback(
  batteryId: string | null | undefined,
  upgrades: Upgrade[],
  storedBatteries: StoredBattery[] | undefined | null,
  workshopSlots?: (WorkshopStructure | null)[] | undefined | null
): string | null {
  const base = resolveRackBatteryItemId(batteryId, upgrades, storedBatteries);
  if (base) return base;
  const id = batteryId != null ? String(batteryId).trim() : '';
  if (!id || !workshopSlots?.length) return null;
  for (const ws of workshopSlots) {
    if (!ws?.internalSlots || !ws.slotItemIds) continue;
    const int = ws.internalSlots;
    const sid = ws.slotItemIds;
    for (const [slotKey, inst] of Object.entries(int)) {
      if (inst == null || String(inst).trim() !== id) continue;
      const cat = sid[slotKey];
      const catTrim = cat != null ? String(cat).trim() : '';
      if (catTrim) return catTrim;
    }
  }
  return null;
}

export function getBatteryUpgradeForRack(
  rack: PlacedRack,
  upgrades: Upgrade[],
  storedBatteries: StoredBattery[] | undefined | null,
  workshopSlots?: (WorkshopStructure | null)[] | undefined | null
): Upgrade | undefined {
  const itemId = resolveRackBatteryItemIdWithWorkshopFallback(
    rack.batteryId,
    upgrades,
    storedBatteries,
    workshopSlots
  );
  return itemId ? upgrades.find((u) => u.id === itemId) : undefined;
}

export function rackBatteryMatchesUpgradeId(
  rack: { batteryId: string | null },
  upgradeId: string,
  upgrades: Upgrade[],
  storedBatteries: StoredBattery[] | undefined | null,
  workshopSlots?: (WorkshopStructure | null)[] | undefined | null
): boolean {
  return (
    resolveRackBatteryItemIdWithWorkshopFallback(rack.batteryId, upgrades, storedBatteries, workshopSlots) ===
    upgradeId
  );
}
