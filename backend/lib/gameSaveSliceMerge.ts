/**
 * Quando o cliente grava só um domínio (estoque, salas), o servidor funde na mesma
 * transação os dados já persistidos nas outras áreas — evita interpretar payload incompleto
 * como remoção de rigs/baterias e reutiliza a lógica existente de POST /api/save-game.
 *
 * O domínio `workshop` foi descontinuado em 20260516180000_battery_uuids_and_purge_charging.
 */
import type { PoolClient } from 'pg';
import type { SaveGameQueryClient } from './sqlTransaction.js';
import { loadUserPlacedRacksWithSlots } from './serverRoomPersistence.js';

export type GameSaveSlice = 'inventory' | 'servers';

export async function mergeSaveGameSlicePayload(
  client: SaveGameQueryClient,
  uid: number,
  slice: GameSaveSlice,
  changes: Record<string, unknown>
): Promise<void> {
  const pg = client as unknown as PoolClient;
  if (slice === 'inventory') {
    if (changes.placedRacks == null) {
      changes.placedRacks = await loadUserPlacedRacksWithSlots(pg, uid);
    }
  }
  // 'servers': sem merge cross-slice; oficina deixou de existir.
}
