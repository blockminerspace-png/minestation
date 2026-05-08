import { describe, it, expect, vi } from 'vitest';
import { runValidatedItemSelection, type ServerRoomActionHandlers } from '../controllers/serverRoomController';
import type { ServerRoomSelectionContext } from '../models/serverRoomModel';
import { NFT_AUTO_ALLOWED_CHASSIS_ID } from '../types';

function handlers(): ServerRoomActionHandlers {
  return {
    onPlaceRack: vi.fn(),
    onEquipMiner: vi.fn(),
    onEquipAux: vi.fn(),
  };
}

describe('runValidatedItemSelection', () => {
  it('rejeita id de item inválido', () => {
    const h = handlers();
    const sel: ServerRoomSelectionContext = {
      rackId: 'rig1',
      slotIndex: 0,
      type: 'machine',
      roomId: 'room_initial',
    };
    const r = runValidatedItemSelection(sel, 'bad id', undefined, h);
    expect(r).toEqual({ ok: false, message: 'Identificador de item inválido.' });
    expect(h.onEquipMiner).not.toHaveBeenCalled();
  });

  it('rejeita id de bateria em armazém inválido quando fornecido', () => {
    const h = handlers();
    const sel: ServerRoomSelectionContext = {
      rackId: 'rig1',
      slotIndex: 0,
      type: 'battery',
      roomId: 'room_initial',
    };
    const longId = 'x'.repeat(300);
    const r = runValidatedItemSelection(sel, 'bat_ok', longId, h);
    expect(r).toEqual({ ok: false, message: 'Identificador de bateria em armazém inválido.' });
  });

  it('rack: sala ou slot inválido', () => {
    const h = handlers();
    const sel: ServerRoomSelectionContext = {
      rackId: null,
      slotIndex: 0,
      type: 'rack',
      roomId: '',
    };
    expect(runValidatedItemSelection(sel, 'rack_1', undefined, h).ok).toBe(false);
    expect(h.onPlaceRack).not.toHaveBeenCalled();
  });

  it('rack: política NFT só permite chassis H1', () => {
    const h = handlers();
    const sel: ServerRoomSelectionContext = {
      rackId: null,
      slotIndex: 0,
      type: 'rack',
      roomId: 'room_x',
      nftAutoArmario1Only: true,
    };
    const r = runValidatedItemSelection(sel, 'outro_rack', undefined, h);
    expect(r).toEqual({
      ok: false,
      message: 'Nesta sala só é permitido o chassis Rack H1 NFT Collection.',
    });
    expect(h.onPlaceRack).not.toHaveBeenCalled();
  });

  it('machine: rig ou slot inválido', () => {
    const h = handlers();
    const r1 = runValidatedItemSelection(
      { rackId: '', slotIndex: 0, type: 'machine', roomId: 'room_initial' },
      'miner_1',
      undefined,
      h
    );
    expect(r1).toEqual({ ok: false, message: 'Rig inválida.' });

    const r2 = runValidatedItemSelection(
      { rackId: 'rig1', slotIndex: null, type: 'machine', roomId: 'room_initial' },
      'miner_1',
      undefined,
      h
    );
    expect(r2).toEqual({ ok: false, message: 'Slot de GPU inválido.' });
  });

  it('delega rack, machine e aux com ids válidos', () => {
    const h = handlers();

    const rackSel: ServerRoomSelectionContext = {
      rackId: null,
      slotIndex: 2,
      type: 'rack',
      roomId: 'room_initial',
      roomName: 'Lab',
    };
    expect(runValidatedItemSelection(rackSel, 'rack_10u', undefined, h)).toEqual({ ok: true });
    expect(h.onPlaceRack).toHaveBeenCalledWith('rack_10u', 'room_initial', 2, {
      roomName: 'Lab',
      nftAutoArmario1Only: undefined,
    });

    expect(
      runValidatedItemSelection(
        { rackId: 'pr1', slotIndex: 1, type: 'machine', roomId: 'room_initial' },
        'gpu_1',
        undefined,
        h
      )
    ).toEqual({ ok: true });
    expect(h.onEquipMiner).toHaveBeenCalledWith('pr1', 1, 'gpu_1');

    expect(
      runValidatedItemSelection(
        { rackId: 'pr1', slotIndex: 3, type: 'battery', roomId: 'room_initial' },
        'bat_item',
        'sb-uuid-1',
        h
      )
    ).toEqual({ ok: true });
    expect(h.onEquipAux).toHaveBeenCalledWith('pr1', 'bat_item', 'battery', 'sb-uuid-1', 3);

    expect(
      runValidatedItemSelection(
        { rackId: 'pr1', slotIndex: null, type: 'wiring', roomId: 'room_initial' },
        NFT_AUTO_ALLOWED_CHASSIS_ID,
        undefined,
        h
      )
    ).toEqual({ ok: true });
    expect(h.onEquipAux).toHaveBeenLastCalledWith('pr1', NFT_AUTO_ALLOWED_CHASSIS_ID, 'wiring', undefined, undefined);
  });
});
