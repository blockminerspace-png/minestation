import { describe, it, expect, vi, afterEach } from 'vitest';
import { logServerStateBatteryConsistency } from '../modules/servers/servers.snapshot.service.js';

const BID = '550e8400-e29b-41d4-a716-446655440099';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logServerStateBatteryConsistency', () => {
  it('regista órfão (rack com UUID sem stored)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = new Map<string, { id: string; status: string | null }>();
    logServerStateBatteryConsistency(42, [{ id: 'rack_a', batteryId: BID }], stored, { requestId: 'req-test-1' });
    expect(spy).toHaveBeenCalled();
    const line = spy.mock.calls.map((c) => c[0]).find((x) => typeof x === 'string' && x.includes('server_state_battery_orphan'));
    expect(line).toBeTruthy();
    const j = JSON.parse(String(line));
    expect(j.event).toBe('server_state_battery_orphan');
    expect(j.userId).toBe(42);
    expect(j.requestId).toBe('req-test-1');
  });

  it('regista duplicado (mesma bateria em dois racks)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = new Map([[BID, { id: BID, status: 'EQUIPPED' }]]);
    logServerStateBatteryConsistency(
      7,
      [
        { id: 'rack_1', batteryId: BID },
        { id: 'rack_2', batteryId: BID }
      ],
      stored,
      {}
    );
    const dup = spy.mock.calls.map((c) => c[0]).find((x) => typeof x === 'string' && x.includes('server_state_battery_duplicate'));
    expect(dup).toBeTruthy();
    expect(JSON.parse(String(dup)).event).toBe('server_state_battery_duplicate');
  });

  it('regista mismatch de status (INVENTORY apesar de estar montada na rig)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = new Map([[BID, { id: BID, status: 'INVENTORY' }]]);
    logServerStateBatteryConsistency(3, [{ id: 'rack_z', batteryId: BID }], stored, {});
    const mm = spy.mock.calls.map((c) => c[0]).find((x) => typeof x === 'string' && x.includes('server_state_battery_status_mismatch'));
    expect(mm).toBeTruthy();
    expect(JSON.parse(String(mm)).storedStatus).toBe('INVENTORY');
  });
});
