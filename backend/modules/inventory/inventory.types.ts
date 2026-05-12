/** DTO público — inventário / estoque (sem dados de outros utilizadores). */

export type InventoryBatteryInstanceDto = {
  id: string;
  itemId: string;
  displayName: string | null;
  imageUrl: string | null;
  /** Prefixo seguro do UUID para rótulo visual (não é secreto). */
  publicRef: string;
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
  storedBatteries: Pick<InventoryBatteryInstanceDto, 'id' | 'itemId'>[];
  serverUpdatedAt: number;
};

export type InventoryStateV1Dto = {
  version: 1;
  serverUpdatedAt: number;
  /** Igual a `serverUpdatedAt` — controlo de versão para mutações futuras. */
  stateVersion: number;
  stock: Record<string, number>;
  storedBatteries: InventoryBatteryInstanceDto[];
  stackableCategories: InventoryStackableCategoryDto[];
};
