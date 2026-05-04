import type { ServerRoomSelectionContext } from '../models/serverRoomModel';
import { NFT_AUTO_ALLOWED_CHASSIS_ID, isNftAutoArmario1OnlyRoomContext } from '../types';
import { parseValidGameItemId, parseValidStoredBatteryId } from '../validation/serverRoomValidation';

export type ServerRoomActionHandlers = {
  onPlaceRack: (
    rackTypeId: string,
    roomId: string,
    slotIndex: number,
    ctx?: { roomName?: string; nftAutoArmario1Only?: boolean }
  ) => void;
  onEquipMiner: (rackId: string, slotIndex: number, minerId: string) => void;
  onEquipAux: (
    rackId: string,
    itemId: string,
    type: 'battery' | 'wiring' | 'multiplier',
    storedBatteryId?: string,
    slotIndex?: number
  ) => void;
};

/**
 * Valida ids antes de delegar ao `App` (persistência + validação no servidor no save).
 */
export function runValidatedItemSelection(
  selection: ServerRoomSelectionContext,
  itemId: string,
  storedBatteryId: string | undefined,
  handlers: ServerRoomActionHandlers
): { ok: true } | { ok: false; message: string } {
  const cleanItem = parseValidGameItemId(itemId);
  if (!cleanItem) {
    return { ok: false, message: 'Identificador de item inválido.' };
  }
  if (storedBatteryId != null && storedBatteryId !== '') {
    const sb = parseValidStoredBatteryId(storedBatteryId);
    if (!sb) {
      return { ok: false, message: 'Identificador de bateria em armazém inválido.' };
    }
  }

  const { rackId, slotIndex, type, roomId, roomName, nftAutoArmario1Only } = selection;

  if (type === 'rack') {
    if (!roomId || slotIndex === null || slotIndex < 0) {
      return { ok: false, message: 'Sala ou slot inválido.' };
    }
    if (isNftAutoArmario1OnlyRoomContext(roomId, roomName, nftAutoArmario1Only) && cleanItem !== NFT_AUTO_ALLOWED_CHASSIS_ID) {
      return { ok: false, message: 'Nesta sala só é permitido o chassis Rack H1 NFT Collection.' };
    }
    handlers.onPlaceRack(cleanItem, roomId, slotIndex, { roomName: roomName ?? undefined, nftAutoArmario1Only });
    return { ok: true };
  }

  if (!rackId) {
    return { ok: false, message: 'Rig inválida.' };
  }

  if (type === 'machine') {
    if (slotIndex === null || slotIndex < 0) {
      return { ok: false, message: 'Slot de GPU inválido.' };
    }
    handlers.onEquipMiner(rackId, slotIndex, cleanItem);
    return { ok: true };
  }

  const sb = storedBatteryId ? parseValidStoredBatteryId(storedBatteryId) : undefined;
  handlers.onEquipAux(rackId, cleanItem, type, sb ?? undefined, slotIndex ?? undefined);
  return { ok: true };
}
