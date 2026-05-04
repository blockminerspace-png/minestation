import { describe, it, expect } from 'vitest';
import {
  parseFiniteNumber,
  parseFiniteNumberLenient,
  MiningNumericError,
} from '../cron/miningNumeric.js';

describe('miningNumeric', () => {
  it('parseFiniteNumber aceita número e string', () => {
    expect(parseFiniteNumber(42)).toBe(42);
    expect(parseFiniteNumber('12.5')).toBe(12.5);
    expect(parseFiniteNumber('12,5')).toBe(12.5);
    expect(parseFiniteNumber('')).toBe(0);
  });

  it('parseFiniteNumber rejeita inválidos', () => {
    expect(() => parseFiniteNumber('1;DROP')).toThrow(MiningNumericError);
    expect(() => parseFiniteNumber('1,2,3')).toThrow(MiningNumericError);
  });

  it('parseFiniteNumberLenient devolve 0', () => {
    expect(parseFiniteNumberLenient('nope')).toBe(0);
  });
});
