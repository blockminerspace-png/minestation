import { describe, it, expect } from 'vitest';
import {
  batteryIdLooksLikePhysicalInstanceUuid,
  workshopDbRowInstanceToCatalog,
  workshopPayloadInstanceToCatalog
} from '../lib/batteryInstanceResolve.js';

describe('batteryIdLooksLikePhysicalInstanceUuid', () => {
  it('detects UUID v4-style instance ids', () => {
    expect(batteryIdLooksLikePhysicalInstanceUuid('0cb1b0f8-f078-4d21-975f-195f02c37056')).toBe(true);
  });
  it('rejects catalog snake_case ids', () => {
    expect(batteryIdLooksLikePhysicalInstanceUuid('battery_fusion')).toBe(false);
    expect(batteryIdLooksLikePhysicalInstanceUuid('small_battery')).toBe(false);
  });
});

describe('workshopDbRowInstanceToCatalog', () => {
  it('maps internal instance to slot_item_ids catalog entry', () => {
    const internal = { slot_bat: '0cb1b0f8-f078-4d21-975f-195f02c37056' };
    const sid = { slot_bat: 'battery_fusion' };
    const m = workshopDbRowInstanceToCatalog(internal, sid);
    expect(m.get('0cb1b0f8-f078-4d21-975f-195f02c37056')).toBe('battery_fusion');
  });
});

describe('workshopPayloadInstanceToCatalog', () => {
  it('reads camelCase client payload', () => {
    const inst = 'aaaaaaaa-bbbb-4ccc-8eee-eeeeeeeeeeee';
    const slots = [
      {
        internalSlots: { a: inst },
        slotItemIds: { a: 'bat_x' }
      }
    ];
    const m = workshopPayloadInstanceToCatalog(slots);
    expect(m.get(inst)).toBe('bat_x');
  });
});
