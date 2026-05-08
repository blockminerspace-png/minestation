import type { StoredBattery, Upgrade } from '../types';

export type RackBatteryUnequipInventoryResult = {
  nextNb: StoredBattery[];
  nextNs: Record<string, number>;
  /**
   * Quando `false`, `batteryId` não mapeia para catálogo nem instância no armazém (referência órfã).
   * O caller deve só limpar o slot na rig — não incrementar stock com UUID nem criar linha inválida no armazém.
   */
  returnedToInventory: boolean;
};

/**
 * Devolve uma bateria retirada da rig ao estoque (cheia) ou ao armazém (carga parcial / instância).
 * Centraliza a lógica de `handleUnequipAux`, troca em `handleEquipAux` e desmontagem da rig.
 */
export function applyRackBatteryUnequipToInventory(
  batteryId: string,
  currentCharge: number,
  nb: StoredBattery[],
  ns: Record<string, number>,
  upgrades: Upgrade[]
): RackBatteryUnequipInventoryResult {
  const nextNb = [...nb];
  const nextNs = { ...ns };

  const oldStored = nextNb.find((b) => b.id === batteryId);
  const catalogFromStored = oldStored?.itemId?.trim() || null;
  const catalogFromRackId = upgrades.some((u) => u.id === batteryId) ? String(batteryId).trim() : null;
  const catalogId = catalogFromStored || catalogFromRackId;

  if (!catalogId) {
    return { nextNb, nextNs, returnedToInventory: false };
  }

  const upg = upgrades.find((u) => u.id === catalogId);
  if (!upg || upg.type !== 'battery') {
    return { nextNb, nextNs, returnedToInventory: false };
  }

  const isInfinite = upg.powerCapacity === -1;

  if (isInfinite) {
    if (oldStored) {
      const ix = nextNb.findIndex((b) => b.id === batteryId);
      if (ix >= 0) nextNb.splice(ix, 1);
    }
    nextNs[catalogId] = (nextNs[catalogId] || 0) + 1;
    return { nextNb, nextNs, returnedToInventory: true };
  }

  const capacity = typeof upg.powerCapacity === 'number' && upg.powerCapacity > 0 ? upg.powerCapacity : 100;
  const isFull = currentCharge >= capacity * 0.999;

  if (isFull) {
    nextNs[catalogId] = (nextNs[catalogId] || 0) + 1;
    if (oldStored) {
      const ix = nextNb.findIndex((b) => b.id === batteryId);
      if (ix >= 0) nextNb.splice(ix, 1);
    }
    return { nextNb, nextNs, returnedToInventory: true };
  }

  if (oldStored) {
    const ix = nextNb.findIndex((b) => b.id === batteryId);
    if (ix >= 0) {
      nextNb[ix] = { ...nextNb[ix], currentCharge };
    }
    return { nextNb, nextNs, returnedToInventory: true };
  }

  nextNb.push({ id: crypto.randomUUID(), itemId: catalogId, currentCharge });
  return { nextNb, nextNs, returnedToInventory: true };
}
