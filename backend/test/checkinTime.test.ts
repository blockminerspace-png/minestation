import { describe, expect, it } from 'vitest';
import { brtDayFromMs, nextBrtMidnightMs, previousBrtDay } from '../modules/checkin/checkin.service.js';

describe('checkin BRT calendar helpers', () => {
  it('previousBrtDay subtrai um dia civil', () => {
    expect(previousBrtDay('2026-03-01')).toBe('2026-02-28');
    expect(previousBrtDay('2026-01-01')).toBe('2025-12-31');
  });

  it('nextBrtMidnightMs devolve instante no futuro com dia BRT diferente', () => {
    const t = Date.parse('2026-06-15T15:30:00-03:00');
    const mid = nextBrtMidnightMs(t);
    expect(mid).toBeGreaterThan(t);
    expect(brtDayFromMs(mid)).not.toBe(brtDayFromMs(t));
    expect(brtDayFromMs(mid - 500)).toBe(brtDayFromMs(t));
  });

  it('brtDayFromMs devolve YYYY-MM-DD', () => {
    const d = brtDayFromMs(Date.parse('2026-08-20T02:00:00Z'));
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
