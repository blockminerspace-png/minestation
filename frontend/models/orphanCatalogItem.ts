import type { Upgrade } from '../types';

/**
 * Placeholder de UI / stock quando o id já não existe em `upgrades` (peça retirada do catálogo).
 * Mantém o id original para desmontar / gravar o estado sem depender do catálogo.
 */
export function orphanCatalogUpgrade(id: string, type: Upgrade['type']): Upgrade {
  const label =
    type === 'machine'
      ? 'Máquina'
      : type === 'battery'
        ? 'Bateria'
        : type === 'wiring'
          ? 'Fiação'
          : type === 'multiplier'
            ? 'Multiplicador'
            : type === 'infrastructure'
              ? 'Rack / infra'
              : 'Peça';
  return {
    id,
    name: `${label} (catálogo removido)`,
    category: 'legacy',
    type,
    baseCost: 0,
    baseProduction: 0,
    powerConsumption: 0,
    powerCapacity: type === 'battery' ? 100 : undefined,
    multiplier: type === 'multiplier' ? 0 : undefined,
    description:
      'Este item já não está no catálogo activo. Podes remover ou substituir; o servidor aceita gravar o equipamento em legado.',
    icon: '📦',
    status: 'legacy'
  };
}
