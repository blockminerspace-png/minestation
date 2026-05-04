import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  timestampMsFromDb,
  parseUsdFromDb,
  computeP2PBandReferenceUsd,
  mapListingForClient,
  MARKET_RESERVE_MS,
  MARKET_LISTING_TTL_MS,
  getBlackMarketPriceBandPercent,
  isP2PMarketEnabled,
} from '../models/p2pMarketModel.js';

describe('p2pMarketModel', () => {
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
        reserver_username: 'buyer',
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
    const query = vi.fn().mockResolvedValue({
      rows: [{ black_market_price_band_percent: 150 }],
    });
    const n = await getBlackMarketPriceBandPercent({ query } as unknown as Pool);
    expect(n).toBe(90);
  });

  it('getBlackMarketPriceBandPercent faz clamp inferior a 1', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ black_market_price_band_percent: 0 }],
    });
    const n = await getBlackMarketPriceBandPercent({ query } as unknown as Pool);
    expect(n).toBe(1);
  });

  it('getBlackMarketPriceBandPercent fallback settings quando economy_settings falha', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('no table'))
      .mockResolvedValueOnce({ rows: [{ value: '7' }] });
    const n = await getBlackMarketPriceBandPercent({ query } as unknown as Pool);
    expect(n).toBe(7);
  });

  it('getBlackMarketPriceBandPercent devolve 20 quando ambas as queries falham', async () => {
    const query = vi.fn().mockRejectedValue(new Error('down'));
    const n = await getBlackMarketPriceBandPercent({ query } as unknown as Pool);
    expect(n).toBe(20);
  });

  it('isP2PMarketEnabled usa economy_settings quando existe linha', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ black_market_enabled: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const on = await isP2PMarketEnabled({ query } as unknown as Pool);
    expect(on).toBe(false);
  });

  it('isP2PMarketEnabled fallback settings quando sem linha em economy_settings', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: '1' }] });
    const on = await isP2PMarketEnabled({ query } as unknown as Pool);
    expect(on).toBe(true);
  });

  it('isP2PMarketEnabled fallback settings value 0 desliga mercado', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: '0' }] });
    expect(await isP2PMarketEnabled({ query } as unknown as Pool)).toBe(false);
  });

  it('isP2PMarketEnabled true quando sem economy_settings nem settings', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await isP2PMarketEnabled({ query } as unknown as Pool)).toBe(true);
  });

  it('isP2PMarketEnabled devolve true em catch', async () => {
    const query = vi.fn().mockRejectedValue(new Error('db'));
    expect(await isP2PMarketEnabled({ query } as unknown as Pool)).toBe(true);
  });
});
