import { describe, it, expect } from 'vitest';
import { formatUserActivityMeta, ACTIVITY_LOG_FILTER_GROUPS } from '../utils/adminUserActivityLog';

describe('adminUserActivityLog', () => {
  it('formatUserActivityMeta', () => {
    expect(formatUserActivityMeta(null)).toBe('—');
    expect(formatUserActivityMeta({ a: 1 })).toBe('{"a":1}');
    const big = { x: 'y'.repeat(500) };
    expect(formatUserActivityMeta(big).length).toBeLessThanOrEqual(422);
  });

  it('ACTIVITY_LOG_FILTER_GROUPS cobre ações típicas', () => {
    const deposit = ACTIVITY_LOG_FILTER_GROUPS.find((g) => g.id === 'deposit');
    expect(deposit?.test?.('usdc_deposit_confirmed')).toBe(true);
    const roleta = ACTIVITY_LOG_FILTER_GROUPS.find((g) => g.id === 'roleta');
    expect(roleta?.test?.('roleta_roll')).toBe(true);
  });
});
