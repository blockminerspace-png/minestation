import { describe, expect, it, afterEach } from 'vitest';
import {
  orphanRackBatteryAutoRecoverEnabled
} from '../lib/orphanRackBatteryRecoveryGate.js';

describe('orphanRackBatteryAutoRecoverEnabled', () => {
  const prev = process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER;

  afterEach(() => {
    if (prev === undefined) delete process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER;
    else process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER = prev;
  });

  it('é falso por defeito (GET/save não recriam órfãos)', () => {
    delete process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER;
    expect(orphanRackBatteryAutoRecoverEnabled()).toBe(false);
    process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER = '0';
    expect(orphanRackBatteryAutoRecoverEnabled()).toBe(false);
  });

  it('aceita 1 / true / yes', () => {
    process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER = '1';
    expect(orphanRackBatteryAutoRecoverEnabled()).toBe(true);
    process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER = 'true';
    expect(orphanRackBatteryAutoRecoverEnabled()).toBe(true);
    process.env.ORPHAN_RACK_BATTERY_AUTO_RECOVER = 'YES';
    expect(orphanRackBatteryAutoRecoverEnabled()).toBe(true);
  });
});
