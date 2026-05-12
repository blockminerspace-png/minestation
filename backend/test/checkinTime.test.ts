import { describe, expect, it } from 'vitest';
import {
  brtDayFromMs,
  CHECKIN_WINDOW_MS,
  isCheckinFrozenAtMs,
  nextBrtMidnightMs,
  previousBrtDay
} from '../modules/checkin/checkin.service.js';

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

describe('checkin rolling 24h window (isCheckinFrozenAtMs)', () => {
  const now = Date.parse('2026-06-15T20:00:00Z');

  it('NULL last check-in → frozen', () => {
    expect(isCheckinFrozenAtMs(null, now)).toBe(true);
    expect(isCheckinFrozenAtMs(undefined, now)).toBe(true);
    expect(isCheckinFrozenAtMs(0, now)).toBe(true);
  });

  it('check-in há 1h → ainda activo', () => {
    expect(isCheckinFrozenAtMs(now - 60 * 60 * 1000, now)).toBe(false);
  });

  it('check-in há 23h59m → ainda activo', () => {
    expect(isCheckinFrozenAtMs(now - (CHECKIN_WINDOW_MS - 60_000), now)).toBe(false);
  });

  it('check-in exactamente há 24h → frozen', () => {
    expect(isCheckinFrozenAtMs(now - CHECKIN_WINDOW_MS, now)).toBe(true);
  });

  it('check-in há 25h → frozen', () => {
    expect(isCheckinFrozenAtMs(now - (CHECKIN_WINDOW_MS + 60 * 60 * 1000), now)).toBe(true);
  });
});
