import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';

const prismaMock = vi.hoisted(() => ({
  jwt_refresh_tokens: {
    count: vi.fn()
  }
}));

vi.mock('../config/prisma.js', () => ({ prisma: prismaMock }));

describe('storageMirror', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    prismaMock.jwt_refresh_tokens.count.mockReset();
  });

  it('writeJwtRefreshSnapshot grava ficheiro quando query ok', async () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    prismaMock.jwt_refresh_tokens.count.mockResolvedValue(3);
    const { writeJwtRefreshSnapshot } = await import('../src/auth/storageMirror.js');
    await writeJwtRefreshSnapshot();
    expect(write).toHaveBeenCalled();
    const payload = JSON.parse(write.mock.calls[0]![1] as string);
    expect(payload.activeRefreshTokens).toBe(3);
  });

  it('writeJwtRefreshSnapshot engole erro e avisa', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    prismaMock.jwt_refresh_tokens.count.mockResolvedValue(0);
    const { writeJwtRefreshSnapshot } = await import('../src/auth/storageMirror.js');
    await expect(writeJwtRefreshSnapshot()).resolves.toBeUndefined();
  });
});
