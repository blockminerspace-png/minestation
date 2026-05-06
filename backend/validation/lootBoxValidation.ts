import type { PrismaClient } from '@prisma/client';
import type { PoolClient } from 'pg';
import { parseLootBoxId } from '../models/lootBoxModel.js';

/** Leitura de email de sessão: pool (`query`) ou Prisma (`users`). */
export type EmailSessionQueryable = Pick<PoolClient, 'query'> | Pick<PrismaClient, 'users'>;

/** Extrai e valida `boxId` do corpo JSON de compra/abertura. */
export function bodyLootBoxId(body: unknown): string | null {
  if (body == null || typeof body !== 'object') return null;
  return parseLootBoxId((body as { boxId?: unknown }).boxId);
}

/**
 * Quantidade a descartar: ausente = todas as unidades em inventário.
 * Retorna `null` se `qty` for inválida (corpo mal formado).
 */
export function bodyOptionalDiscardQty(body: unknown): number | 'all' | null {
  if (body == null || typeof body !== 'object') return 'all';
  const q = (body as { qty?: unknown }).qty;
  if (q === undefined || q === null) return 'all';
  const n = typeof q === 'number' ? q : parseInt(String(q), 10);
  if (!Number.isFinite(n) || n !== Math.floor(n) || n < 1 || n > 100_000) return null;
  return n;
}

/**
 * Se o cliente envia `email`, tem de coincidir com o utilizador da sessão (camada extra contra CSRF confuso).
 */
export async function assertEmailMatchesSession(
  db: EmailSessionQueryable,
  userId: number,
  bodyEmail: unknown
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (bodyEmail == null || bodyEmail === '') return { ok: true };
  if (typeof bodyEmail !== 'string') {
    return { ok: false, status: 400, error: 'Email inválido.' };
  }
  let sessionEmail = '';
  if ('query' in db && typeof (db as Pick<PoolClient, 'query'>).query === 'function') {
    const who = await (db as Pick<PoolClient, 'query'>).query(
      'SELECT lower(trim(email::text)) AS em FROM users WHERE id = $1',
      [userId]
    );
    const row = who.rows[0] as { em: string } | undefined;
    sessionEmail = row?.em ?? '';
  } else {
    const user = await (db as Pick<PrismaClient, 'users'>).users.findUnique({
      where: { id: userId },
      select: { email: true }
    });
    sessionEmail = (user?.email ?? '').trim().toLowerCase();
  }
  if (String(bodyEmail).trim().toLowerCase() !== sessionEmail) {
    return { ok: false, status: 403, error: 'Sessão não corresponde ao email.' };
  }
  return { ok: true };
}
