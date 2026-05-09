/** DTO público — inventário / estoque (sem dados de outros utilizadores). */

export type InventoryBatteryInstanceDto = {
  id: string;
  itemId: string;
  currentCharge: number;
  powerCapacityWh: number | null;
  displayName: string | null;
  imageUrl: string | null;
  /** 0–100 para UI; infinito (−1 Wh no catálogo) → 100. */
  chargePercent: number;
  /** Prefixo seguro do UUID para rótulo visual (não é secreto). */
  publicRef: string;
  isFull: boolean;
};

export type InventoryStackableRowDto = {
  /** Chave em `stock` (pode ser temp legacy). */
  stockKey: string;
  /** Id de catálogo para compatibilidade / ações futuras. */
  catalogItemId: string;
  displayQuantity: number;
  availableQuantity: number;
  name: string;
  description: string;
  category: string;
  type: string;
  image: string | null;
  icon: string;
  baseProduction: number;
  powerConsumption: number;
  powerCapacity: number;
  slotsCapacity: number;
  aiSlotsCapacity: number;
  isNft: boolean;
};

export type InventoryStackableCategoryDto = {
  category: string;
  items: InventoryStackableRowDto[];
};

export type PlayerInventorySnapshot = {
  stock: Record<string, number>;
  storedBatteriesFull: Pick<InventoryBatteryInstanceDto, 'id' | 'itemId' | 'currentCharge'>[];
  storedBatteriesPartial: Pick<InventoryBatteryInstanceDto, 'id' | 'itemId' | 'currentCharge'>[];
  serverUpdatedAt: number;
};

export type InventoryStateV1Dto = {
  version: 1;
  serverUpdatedAt: number;
  stock: Record<string, number>;
  partialChargeBatteries: InventoryBatteryInstanceDto[];
  fullChargeBatteries: InventoryBatteryInstanceDto[];
  stackableCategories: InventoryStackableCategoryDto[];
};
