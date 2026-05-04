import { describe, it, expect } from 'vitest';
import {
  isSafeSqlIdentifier,
  resolveSafeBackupPath,
  RESTORE_ALLOWED_TABLES,
  AUTO_SQL_BACKUP_PREFIX,
} from '../models/backupModel.js';
import path from 'node:path';

describe('backupModel (funções puras)', () => {
  it('isSafeSqlIdentifier', () => {
    expect(isSafeSqlIdentifier('users')).toBe(true);
    expect(isSafeSqlIdentifier('1bad')).toBe(false);
    expect(isSafeSqlIdentifier('drop--')).toBe(false);
  });

  it('resolveSafeBackupPath bloqueia nomes perigosos e traversal', () => {
    const base = path.resolve('/tmp/backups');
    expect(resolveSafeBackupPath('ok.sql', base)).toBe(path.join(base, 'ok.sql'));
    expect(resolveSafeBackupPath('..', base)).toBeNull();
    expect(resolveSafeBackupPath('.', base)).toBeNull();
  });

  it('constantes', () => {
    expect(AUTO_SQL_BACKUP_PREFIX).toContain('auto');
    expect(RESTORE_ALLOWED_TABLES.has('users')).toBe(true);
  });
});
