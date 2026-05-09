import { describe, it, expect } from 'vitest';
import { parseHardwareCartOrError } from '../modules/shop/shop.checkout.service.js';

describe('parseHardwareCartOrError', () => {
  it('rejeita carrinho vazio', () => {
    const r = parseHardwareCartOrError({});
    expect('ok' in r && r.ok === false).toBe(true);
    if ('ok' in r && r.ok === false) expect(r.status).toBe(400);
  });

  it('aceita carrinho válido', () => {
    const r = parseHardwareCartOrError({ gpu_x: 2, rack_1: 1 });
    expect(typeof r).toBe('object');
    if (r && !('ok' in r)) {
      expect(r).toEqual({ gpu_x: 2, rack_1: 1 });
    }
  });

  it('rejeita quantidade negativa', () => {
    const r = parseHardwareCartOrError({ a: -1 });
    expect('ok' in r && r.ok === false).toBe(true);
  });
});
