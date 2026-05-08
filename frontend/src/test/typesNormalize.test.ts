import { describe, it, expect } from 'vitest';
import { normalizePlacedRackRoomId } from '../types';

describe('types normalizePlacedRackRoomId', () => {
  it('main e vazio → default', () => {
    expect(normalizePlacedRackRoomId('main')).toBe('room_initial');
    expect(normalizePlacedRackRoomId('')).toBe('room_initial');
  });

  it('preserva id custom', () => {
    expect(normalizePlacedRackRoomId('  custom  ')).toBe('custom');
  });
});
