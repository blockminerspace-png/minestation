import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { bodyLootBoxId, bodyOptionalDiscardQty, assertEmailMatchesSession } from '../validation/lootBoxValidation.js';

describe('lootBoxValidation', () => {
  it('bodyLootBoxId', () => {
    expect(bodyLootBoxId(null)).toBeNull();
    expect(bodyLootBoxId({ boxId: 'x_y' })).toBe('x_y');
  });

  it('bodyOptionalDiscardQty', () => {
    expect(bodyOptionalDiscardQty(null)).toBe('all');
    expect(bodyOptionalDiscardQty({})).toBe('all');
    expect(bodyOptionalDiscardQty({ qty: 3 })).toBe(3);
    expect(bodyOptionalDiscardQty({ qty: 0 })).toBeNull();
    expect(bodyOptionalDiscardQty({ qty: 200_000 })).toBeNull();
  });

  it('assertEmailMatchesSession ignora email vazio', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    const r = await assertEmailMatchesSession(client, 1, '');
    expect(r).toEqual({ ok: true });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('assertEmailMatchesSession valida contra BD', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ em: 'u@gmail.com' }] }),
    } as unknown as PoolClient;
    const ok = await assertEmailMatchesSession(client, 1, ' U@Gmail.com ');
    expect(ok).toEqual({ ok: true });
  });

  it('assertEmailMatchesSession 403 quando difere', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ em: 'u@gmail.com' }] }),
    } as unknown as PoolClient;
    const r = await assertEmailMatchesSession(client, 1, 'other@gmail.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});
