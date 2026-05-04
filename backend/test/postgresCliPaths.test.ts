import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUnixPostgresCli } from '../config/postgresCliPaths.js';

describe('resolveUnixPostgresCli', () => {
  let tmpBin: string;

  beforeEach(() => {
    tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'pgcli-test-'));
    const fakeDump = path.join(tmpBin, 'pg_dump');
    fs.writeFileSync(fakeDump, '#!/bin/sh\necho ok\n', { mode: 0o755 });
    process.env.PG_DUMP_PATH = fakeDump;
    delete process.env.POSTGRES_CLIENT_BIN;
  });

  afterEach(() => {
    delete process.env.PG_DUMP_PATH;
    try {
      fs.rmSync(tmpBin, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('usa PG_DUMP_PATH absoluto existente', () => {
    expect(resolveUnixPostgresCli('pg_dump')).toBe(process.env.PG_DUMP_PATH);
  });
});
