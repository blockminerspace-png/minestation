import { describe, it, expect } from 'vitest';
import { getPsqlPath } from '../config/psql.js';
import { getPgRestorePath } from '../config/pgRestore.js';

describe('postgres CLI paths', () => {
  it('getPsqlPath devolve string', () => {
    expect(typeof getPsqlPath()).toBe('string');
    expect(getPsqlPath().length).toBeGreaterThan(0);
  });

  it('getPgRestorePath devolve string', () => {
    expect(typeof getPgRestorePath()).toBe('string');
    expect(getPgRestorePath().length).toBeGreaterThan(0);
  });
});
