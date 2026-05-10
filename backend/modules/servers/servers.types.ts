/**
 * DTO público de `GET /api/servers/state` — sem campos internos de utilizador.
 * Valores numéricos já normalizados (sem BigInt).
 */

export type ServersStatePlacedRackDto = {
  id: string;
  itemId: string;
  slots: unknown[];
  multiplierSlots: unknown[];
  wiringId: string | null;
  batteryId: string | null;
  currentCharge: number;
  isOn: boolean;
  selectedCoinId: string | null;
  roomId: string;
  slotIndex: number;
  batteryCatalogItemId?: string | null;
  batteryPowerCapacityWh?: number | null;
  batteryDisplayName?: string | null;
  batteryImageUrl?: string | null;
};

export type ServersStateStoredBatteryDto = {
  id: string;
  itemId: string;
  currentCharge: number;
  powerCapacityWh: number | null;
  displayName: string | null;
  imageUrl: string | null;
  workshopSlotIndex: number | null;
  workshopComponentSlotId: string | null;
};

export type ServersStateWorkshopSlotDto = {
  id: string;
  itemId: string | null;
  internalSlots: Record<string, unknown>;
  currentCharge: number;
  slotCharges: Record<string, unknown>;
  slotItemIds: Record<string, unknown>;
  installedAt: number;
};

export type ServersAuthoritativeStateDto = {
  version: 1;
  usdc: number;
  serverUpdatedAt: number;
  /** Igual a `serverUpdatedAt` — controlo de versão para mutações idempotentes / optimistic lock. */
  stateVersion: number;
  stock: Record<string, number>;
  storedBatteries: ServersStateStoredBatteryDto[];
  placedRacks: ServersStatePlacedRackDto[];
  workshopSlots: (ServersStateWorkshopSlotDto | null)[];
  rigRooms: unknown[];
  miningCoins: unknown[];
  upgrades: unknown[];
};
