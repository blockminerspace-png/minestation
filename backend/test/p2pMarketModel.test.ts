import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  economy_settings: { findUnique: vi.fn() },
  settings: { findUnique: vi.fn() }
}));

vi.mock('../config/prisma.js', () => ({ prisma: prismaMock }));

import {
  timestampMsFromDb,
  parseUsdFromDb,
  computeP2PBandReferenceUsd,
  mapListingForClient,
  MARKET_RESERVE_MS,
  MARKET_LISTING_TTL_MS,
  getBlackMarketPriceBandPercent,
  isP2PMarketEnabled
} from '../models/p2pMarketModel.js';

describe('p2pMarketModel', () => {
  beforeEach(() => {
    prismaMock.economy_settings.findUnique.mockReset();
    prismaMock.settings.findUnique.mockReset();
  });

  it('timestampMsFromDb', () => {
    expect(timestampMsFromDb(null)).toBe(0);
    expect(timestampMsFromDb(1700000000000)).toBe(1700000000000);
    expect(timestampMsFromDb('1700000000000')).toBe(1700000000000);
    expect(timestampMsFromDb('2024-01-01T00:00:00.000Z')).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
    expect(timestampMsFromDb(BigInt(5))).toBe(5);
  });

  it('parseUsdFromDb', () => {
    expect(parseUsdFromDb('12,5')).toBe(12.5);
    expect(parseUsdFromDb(null)).toBeNaN();
    expect(parseUsdFromDb(3)).toBe(3);
  });

  it('computeP2PBandReferenceUsd', () => {
    expect(computeP2PBandReferenceUsd(10, 99)).toBe(10);
    expect(computeP2PBandReferenceUsd(0, 5)).toBe(5);
    expect(computeP2PBandReferenceUsd(NaN, null)).toBe(0);
  });

  it('mapListingForClient', () => {
    const now = 1_000_000;
    const m = mapListingForClient(
      {
        id: '1',
        username: 's',
        item_id: 'i',
        price: 2,
        qty: 3,
        expires_at: now + 60_000,
        reserved_until: now + 30_000,
        reserver_username: 'buyer'
      },
      now
    );
    expect(m.lineTotal).toBe(6);
    expect(m.reservedBy).toBe('buyer');
  });

  it('constantes de mercado', () => {
    expect(MARKET_RESERVE_MS).toBe(180_000);
    expect(MARKET_LISTING_TTL_MS).toBeGreaterThan(0);
  });

  it('getBlackMarketPriceBandPercent lê economy_settings e faz clamp', async () => {
    prismaMock.economy_settings.findUnique.mockResolvedValue({
      black_market_price_band_percent: 150
    } as never);
    const n = await getBlackMarketPriceBandPercent();
    expect(n).toBe(90);
  });

  it('getBlackMarketPriceBandPercent faz clamp inferior a 1', async () => {
    prismaMock.economy_settings.findUnique.mockResolvedValue({
      black_market_price_band_percent: 0
    } as never);
    const n = await getBlackMarketPriceBandPercent();
    expect(n).toBe(1);
  });

  it('getBlackMarketPriceBandPercent fallback settings quando economy_settings falha', async () => {
    prismaMock.economy_settings.findUnique.mockRejectedValueOnce(new Error('no table'));
    prismaMock.settings.findUnique.mockResolvedValue({ value: '7' } as never);
    const n = await getBlackMarketPriceBandPercent();
    expect(n).toBe(7);
  });

  it('getBlackMarketPriceBandPercent devolve 20 quando ambas as queries falham', async () => {
    prismaMock.economy_settings.findUnique.mockRejectedValue(new Error('down'));
    prismaMock.settings.findUnique.mockRejectedValue(new Error('down'));
    const n = await getBlackMarketPriceBandPercent();
    expect(n).toBe(20);
  });

  it('isP2PMarketEnabled usa economy_settings quando existe linha', async () => {
    prismaMock.economy_settings.findUnique.mockResolvedValue({ black_market_enabled: 0 } as never);
    const on = await isP2PMarketEnabled();
    expect(on).toBe(false);
  });

  it('isP2PMarketEnabled com linha economy_settings e black_market_enabled null não usa settings', async () => {
    prismaMock.economy_settings.findUnique.mockResolvedValue({ black_market_enabled: null } as never);
    prismaMock.settings.findUnique.mockResolvedValue({ value: '1' } as never);
    expect(await isP2PMarketEnabled()).toBe(false);
  });

  it('isP2PMarketEnabled fallback settings quando sem linha em economy_settings', async () => {
    prismaMock.economy_settings.findUnique.mockResolvedValue(null);
    prismaMock.settings.findUnique.mockResolvedValue({ value: '1' } as never);
    const on = await isP2PMarketEnabled();
    expect(on).toBe(true);
  });

  it('isP2PMarketEnabled fallback settings value 0 desliga mercado', async () => {
    prismaMock.economy_settings.findUnique.mockResolvedValue(null);
    prismaMock.settings.findUnique.mockResolvedValue({ value: '0' } as never);
    expect(await isP2PMarketEnabled()).toBe(false);
  });

  it('isP2PMarketEnabled true quando sem economy_settings nem settings', async () => {
    prismaMock.economy_settings.findUnique.mockResolvedValue(null);
    prismaMock.settings.findUnique.mockResolvedValue(null);
    expect(await isP2PMarketEnabled()).toBe(true);
  });

  it('isP2PMarketEnabled devolve true em catch', async () => {
    prismaMock.economy_settings.findUnique.mockRejectedValue(new Error('db'));
    expect(await isP2PMarketEnabled()).toBe(true);
  });
});
