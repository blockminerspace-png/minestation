import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  users: {
    update: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../config/prisma.js', () => ({
  prisma: prismaMock
}));

import { clearUserPolygonWallet } from '../models/authModel.js';

describe('clearUserPolygonWallet', () => {
  beforeEach(() => {
    prismaMock.users.update.mockClear();
  });

  it('atualiza polygon_wallet para null no id indicado', async () => {
    await clearUserPolygonWallet(99);
    expect(prismaMock.users.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.users.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { polygon_wallet: null }
    });
  });

  it('propaga erro do Prisma', async () => {
    prismaMock.users.update.mockRejectedValueOnce(new Error('P2025'));
    await expect(clearUserPolygonWallet(1)).rejects.toThrow('P2025');
  });
});
