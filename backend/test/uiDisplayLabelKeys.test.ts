import { describe, it, expect } from 'vitest';
import { UI_DISPLAY_LABEL_KEY_SET, UI_DISPLAY_LABEL_KEYS } from '../config/uiDisplayLabelKeys.js';

describe('uiDisplayLabelKeys', () => {
  it('todas as chaves estão no Set', () => {
    for (const k of UI_DISPLAY_LABEL_KEYS) {
      expect(UI_DISPLAY_LABEL_KEY_SET.has(k)).toBe(true);
    }
  });

  it('rejeita chave inexistente', () => {
    expect(UI_DISPLAY_LABEL_KEY_SET.has('nav.nope')).toBe(false);
  });
});
