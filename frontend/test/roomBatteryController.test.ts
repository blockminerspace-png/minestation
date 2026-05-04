import { describe, it, expect } from 'vitest';
import { runBulkRoomBattery } from '../controllers/roomBatteryController';
import type { GameState, Upgrade } from '../types';

function emptyState(): GameState {
  return {
    usdc: 0,
    startTime: 0,
    stock: {},
    unopenedBoxes: {},
    storedBatteries: [],
    placedRacks: [],
    playerListings: [],
    claimedReferrals: 0,
    referralBonusClaimed: false,
  };
}

describe('runBulkRoomBattery', () => {
  it('rejeita sala inválida', () => {
    const r = runBulkRoomBattery(emptyState(), 'bad<room', 'bat1', [] as Upgrade[]);
    if (!('message' in r)) {
      throw new Error('Esperava falha para sala inválida.');
    }
    expect(r.message).toMatch(/Sala inválida/i);
  });

  it('smartFill sem bateria selecionada ou erro se com bateria', () => {
    const r1 = runBulkRoomBattery(emptyState(), 'room_initial', '', [] as Upgrade[], { smartFill: true });
    expect(r1.ok).toBe(false);

    const r2 = runBulkRoomBattery(emptyState(), 'room_initial', 'bat_x', [] as Upgrade[], { smartFill: true });
    if (!('message' in r2)) {
      throw new Error('Esperava falha no smartFill com bateria explícita.');
    }
    expect(r2.message).toMatch(/inteligente/i);
  });
});
