import { describe, it, expect } from 'vitest';
import { getPgDumpPath } from '../config/pgDump.js';

describe('getPgDumpPath', () => {
  it('devolve string não vazia', () => {
    const p = getPgDumpPath();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
  });
});
