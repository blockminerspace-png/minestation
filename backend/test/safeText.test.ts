import { describe, it, expect } from 'vitest';
import { sanitizeForLog, sanitizeApiMessage } from '../lib/safeText.js';

describe('sanitizeForLog', () => {
  it('remove controlos e limita tamanho', () => {
    expect(sanitizeForLog('a\u200bb', 10)).toBe('ab');
    expect(sanitizeForLog('x'.repeat(100), 5)).toBe('xxxxx…');
  });

  it('aceita não-string', () => {
    expect(sanitizeForLog(42)).toBe('42');
  });
});

describe('sanitizeApiMessage', () => {
  it('bloqueia esquemas perigosos', () => {
    expect(sanitizeApiMessage('javascript:alert(1)')).toBe('Pedido inválido.');
    expect(sanitizeApiMessage('<script>x</script>')).toBe('Pedido inválido.');
  });

  it('reutiliza sanitizeForLog para texto normal', () => {
    expect(sanitizeApiMessage('  ok  ')).toBe('ok');
  });
});
