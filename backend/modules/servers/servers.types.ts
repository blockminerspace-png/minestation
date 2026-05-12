/**
 * DTO público de `GET /api/servers/state` — sem campos internos de utilizador.
 * Valores numéricos já normalizados (sem BigInt).
 *
 * Sistema de carregamento descontinuado em
 * `20260516180000_battery_uuids_and_purge_charging`: cada bateria em
 * `stored_batteries` é uma instância UUID infinita (sem charge/capacity).
 */

export type ServersStatePlacedRackDto = {
  id: string;
  itemId: string;
  slots: unknown[];
  multiplierSlots: unknown[];
  wiringId: string | null;
  batteryId: string | null;
  isOn: boolean;
  selectedCoinId: string | null;
  roomId: string;
  slotIndex: number;
  batteryCatalogItemId?: string | null;
  batteryDisplayName?: string | null;
  batteryImageUrl?: string | null;
};

export type ServersStateStoredBatteryDto = {
  id: string;
  itemId: string;
  displayName: string | null;
  imageUrl: string | null;
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
  rigRooms: unknown[];
  miningCoins: unknown[];
  upgrades: unknown[];
};
