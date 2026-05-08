/**
 * Quando o cliente grava só um domínio (estoque, salas, oficina), o servidor funde na mesma
 * transação os dados já persistidos nas outras áreas — evita interpretar payload incompleto
 * como remoção de rigs/baterias e reutiliza a lógica existente de POST /api/save-game.
 */
import type { PoolClient } from 'pg';
import type { SaveGameQueryClient } from './sqlTransaction.js';
import { loadUserPlacedRacksWithSlots } from './serverRoomPersistence.js';

export type GameSaveSlice = 'inventory' | 'servers' | 'workshop';

function safeJsonObject(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
}

/** Mesmo formato agregado que o GET game-state usa na oficina (6 slots). */
export async function loadWorkshopSlotsArrayForMerge(
  client: SaveGameQueryClient,
  uid: number
): Promise<unknown[]> {
  const res = await client.query(
    `SELECT slot_index, item_id, internal_state, current_charge, slot_charges, slot_item_ids, installed_at
     FROM workshop_slots WHERE user_id = $1 ORDER BY slot_index ASC`,
    [uid]
  );
  const workshopSlots: unknown[] = [null, null, null, null, null, null];
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const idx = Number(row.slot_index);
    if (!Number.isFinite(idx) || idx < 0 || idx > 5) continue;
    workshopSlots[idx] = {
      id: `ws_${uid}_${idx}`,
      itemId: row.item_id,
      internalSlots: safeJsonObject(row.internal_state),
      currentCharge: Number(row.current_charge) || 0,
      slotCharges: safeJsonObject(row.slot_charges),
      slotItemIds: safeJsonObject(row.slot_item_ids),
      installedAt: Number(row.installed_at ?? 0)
    };
  }
  return workshopSlots;
}

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
    if (changes.workshopSlots == null) {
      changes.workshopSlots = await loadWorkshopSlotsArrayForMerge(client, uid);
    }
  } else if (slice === 'servers') {
    if (changes.workshopSlots == null) {
      changes.workshopSlots = await loadWorkshopSlotsArrayForMerge(client, uid);
    }
  } else if (slice === 'workshop') {
    if (changes.placedRacks == null) {
      changes.placedRacks = await loadUserPlacedRacksWithSlots(pg, uid);
    }
  }
}
