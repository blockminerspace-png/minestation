import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import type { Pool } from 'pg';

describe('storageMirror', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writeJwtRefreshSnapshot grava ficheiro quando query ok', async () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const { writeJwtRefreshSnapshot } = await import('../src/auth/storageMirror.js');
    await writeJwtRefreshSnapshot({
      query: vi.fn().mockResolvedValue({ rows: [{ active: 3 }] }),
    } as unknown as Pool);
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
    const { writeJwtRefreshSnapshot } = await import('../src/auth/storageMirror.js');
    await expect(
      writeJwtRefreshSnapshot({
        query: vi.fn().mockResolvedValue({ rows: [{ active: 0 }] }),
      } as unknown as Pool)
    ).resolves.toBeUndefined();
  });
});
