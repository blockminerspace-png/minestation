import { describe, it, expect } from 'vitest';
import { miningRuntimeStats } from '../cron/miningRuntimeStats.js';

describe('miningRuntimeStats', () => {
  it('Maps e contadores existem', () => {
    expect(miningRuntimeStats.globalNetworkHashrates).toBeInstanceOf(Map);
    expect(miningRuntimeStats.globalActiveMinersByCoin).toBeInstanceOf(Map);
    expect(typeof miningRuntimeStats.globalActiveMiners).toBe('number');
  });
});
