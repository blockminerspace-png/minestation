import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { computeDiscountPercent, parseUpgradePackageId } from '../modules/upgrades/upgrades.catalog.js';

describe('upgrades.catalog', () => {
  it('parseUpgradePackageId aceita ids seguros', () => {
    expect(parseUpgradePackageId('53f0c699-0471-4e65-a147-17064e3aafe0')).toBe('53f0c699-0471-4e65-a147-17064e3aafe0');
    expect(parseUpgradePackageId('pack_starter_1')).toBe('pack_starter_1');
    expect(parseUpgradePackageId('')).toBeNull();
    expect(parseUpgradePackageId('../../../etc/passwd')).toBeNull();
  });

  it('computeDiscountPercent só quando original > final', () => {
    expect(computeDiscountPercent(new Prisma.Decimal('10'), new Prisma.Decimal('7'))).toBeCloseTo(30, 1);
    expect(computeDiscountPercent(new Prisma.Decimal('7'), new Prisma.Decimal('7'))).toBeNull();
    expect(computeDiscountPercent(new Prisma.Decimal('0'), new Prisma.Decimal('7'))).toBeNull();
  });
});
