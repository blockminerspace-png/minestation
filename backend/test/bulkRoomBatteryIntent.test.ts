import { describe, it, expect } from 'vitest';
import {
  bulkRoomBatteryIntentFingerprint,
  bulkRoomBatteryIntentScope
} from '../modules/batteries/batteries.controller.js';

describe('bulk room battery intent', () => {
  it('scope is stable per user', () => {
    expect(bulkRoomBatteryIntentScope(42)).toBe('bulk_room_batt:42');
  });

  it('fingerprint muda quando o pedido muda', () => {
    const a = bulkRoomBatteryIntentFingerprint({
      roomNorm: 'room_initial',
      batteryUpgradeId: 'bat1',
      smartFill: false,
      rigSort: 'slot_asc'
    });
    const b = bulkRoomBatteryIntentFingerprint({
      roomNorm: 'room_initial',
      batteryUpgradeId: 'bat2',
      smartFill: false,
      rigSort: 'slot_asc'
    });
    expect(a).not.toBe(b);
    expect(a.length).toBe(32);
  });

  it('fingerprint é idempotente para os mesmos parâmetros', () => {
    const p = {
      roomNorm: 'room_a',
      batteryUpgradeId: '',
      smartFill: true,
      rigSort: 'hashrate_desc' as const
    };
    expect(bulkRoomBatteryIntentFingerprint(p)).toBe(bulkRoomBatteryIntentFingerprint(p));
  });
});
