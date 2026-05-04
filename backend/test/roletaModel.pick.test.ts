import { describe, it, expect, vi, afterEach } from 'vitest';
import { pickWeightedPrize, type WheelPrizeRow } from '../models/roletaModel.js';
import { RoletaAppError } from '../validation/roletaValidation.js';

describe('roletaModel pickWeightedPrize', () => {
  afterEach(() => vi.restoreAllMocks());

  const prizes: WheelPrizeRow[] = [
    { id: '1', label: 'A', weight: 10, color: null, item_id: 'a' },
    { id: '2', label: 'B', weight: 90, color: null, item_id: 'b' },
  ];

  it('escolhe primeiro prémio com r baixo', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    expect(pickWeightedPrize(prizes).item_id).toBe('a');
  });

  it('escolhe segundo com r alto', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(pickWeightedPrize(prizes).item_id).toBe('b');
  });

  it('erro se todos os pesos forem zero', () => {
    const bad = prizes.map((p) => ({ ...p, weight: 0 }));
    expect(() => pickWeightedPrize(bad)).toThrow(RoletaAppError);
  });
});
