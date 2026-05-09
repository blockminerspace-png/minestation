import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  resolveEffectivePaidSpinPrice,
  WHEEL_ABSOLUTE_MIN_SPIN_PRICE_USDC
} from '../models/roletaModel.js';

describe('resolveEffectivePaidSpinPrice', () => {
  it('aplica piso absoluto 0.10 quando config tenta valor menor', () => {
    const eff = resolveEffectivePaidSpinPrice(new Prisma.Decimal('0.05'), new Prisma.Decimal('0.05'));
    expect(eff.toFixed(2)).toBe(WHEEL_ABSOLUTE_MIN_SPIN_PRICE_USDC.toFixed(2));
  });

  it('usa o maior entre spin e min da config acima do piso', () => {
    const eff = resolveEffectivePaidSpinPrice(new Prisma.Decimal('0.25'), new Prisma.Decimal('0.15'));
    expect(eff.toFixed(2)).toBe('0.25');
  });
});
