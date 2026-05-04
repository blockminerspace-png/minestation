import { describe, it, expect } from 'vitest';
import { GAME_NAV_LABEL_KEYS, DEFAULT_GAME_NAV_LABELS } from '../constants/gameNavLabels';

describe('gameNavLabels', () => {
  it('cada chave tem rótulo default', () => {
    for (const k of GAME_NAV_LABEL_KEYS) {
      expect(DEFAULT_GAME_NAV_LABELS[k].length).toBeGreaterThan(0);
    }
  });
});
