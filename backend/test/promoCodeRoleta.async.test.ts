import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { promoCodeRowEligibleForRoletaFlow } from '../models/promoCodeRoleta.js';

describe('promoCodeRowEligibleForRoletaFlow', () => {
  it('true quando type começa com roleta_', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(promoCodeRowEligibleForRoletaFlow(client, { type: 'roleta_x', loot_box_id: null })).resolves.toBe(
      true
    );
    expect(client.query).not.toHaveBeenCalled();
  });

  it('false sem loot_box_id', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(promoCodeRowEligibleForRoletaFlow(client, { type: 'other', loot_box_id: null })).resolves.toBe(false);
  });

  it('consulta loot_boxes quando há box', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ trigger: 'roleta_code' }] }),
    } as unknown as PoolClient;
    await expect(
      promoCodeRowEligibleForRoletaFlow(client, { type: 'std', loot_box_id: 'box1' })
    ).resolves.toBe(true);
  });
});
