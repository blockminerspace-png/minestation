import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma } from '@prisma/client';
import { executeUserPutCoreTransaction, type UserPutCoreTxInput } from '../models/userPutCoreTransaction.js';

function baseInput(over: Partial<UserPutCoreTxInput> = {}): UserPutCoreTxInput {
  return {
    uid: 42,
    usernameForUpdate: 'alice',
    normalizedEmail: 'alice@example.com',
    passwordHash: null,
    accessLevelIdForUpdate: null,
    referredByForUpdate: null,
    allowAccessLevelFromBody: false,
    accessLevelIdsValidated: null,
    clientIpReferral: '127.0.0.1',
    ...over
  };
}

function makeTx() {
  const usersUpdate = vi.fn().mockResolvedValue(undefined);
  const tx = {
    users: { update: usersUpdate }
  } as unknown as Prisma.TransactionClient;
  return { tx, usersUpdate };
}

describe('executeUserPutCoreTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('não inclui polygon_wallet no update quando polygonForUpdate é undefined', async () => {
    const { tx, usersUpdate } = makeTx();
    await executeUserPutCoreTransaction(tx, baseInput({ polygonForUpdate: undefined }));
    expect(usersUpdate).toHaveBeenCalledTimes(1);
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).not.toHaveProperty('polygon_wallet');
    expect(arg.data.username).toBe('alice');
    expect(arg.data.email).toBe('alice@example.com');
  });

  it('define polygon_wallet quando polygonForUpdate é endereço válido', async () => {
    const { tx, usersUpdate } = makeTx();
    const addr = '0xabcdef0123456789abcdef0123456789abcdef01';
    await executeUserPutCoreTransaction(tx, baseInput({ polygonForUpdate: addr }));
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.polygon_wallet).toBe(addr);
  });

  it('grava polygon_wallet null quando polygonForUpdate é null', async () => {
    const { tx, usersUpdate } = makeTx();
    await executeUserPutCoreTransaction(tx, baseInput({ polygonForUpdate: null }));
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.polygon_wallet).toBeNull();
  });

  it('grava polygon_wallet null quando polygonForUpdate é string vazia', async () => {
    const { tx, usersUpdate } = makeTx();
    await executeUserPutCoreTransaction(tx, baseInput({ polygonForUpdate: '' }));
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.polygon_wallet).toBeNull();
  });

  it('com passwordHash inclui password e respeita polygon omitido', async () => {
    const { tx, usersUpdate } = makeTx();
    await executeUserPutCoreTransaction(
      tx,
      baseInput({ passwordHash: 'hashed', polygonForUpdate: undefined })
    );
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.password).toBe('hashed');
    expect(arg.data).not.toHaveProperty('polygon_wallet');
  });
});
