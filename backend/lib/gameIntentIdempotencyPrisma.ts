/**
 * Idempotência HTTP para mutações de jogo (Postgres via Prisma).
 * Reutiliza `game_servers_intent_idempotency` com `scope` discriminador.
 *
 * Padrão unificado (com câmbio carteira e checkout loja):
 * - **Scope**: string estável por fluxo (`inv_item_use:<userId>`, `wallet_exchange_liquidate`, `shop_checkout` usa PG nativo + lock).
 * - **Chave**: `idempotencyKey` normalizada (8–128 chars) no handler.
 * - **Fingerprint**: `stableIntentFingerprint` sobre objeto canónico (chaves ordenadas); resposta gravada pode incluir
 *   `GAME_INTENT_IDEM_FP_KEY` (`_idemRequestFp`) para replay vs mismatch (`409` / `IDEMPOTENCY_PAYLOAD_MISMATCH`).
 * - **Replay**: mesma `user_id + scope + idempotency_key` devolve `response_json` / corpo armazenado.
 * - **Logs**: eventos JSON sem payload completo (só ids truncados / metadados seguros).
 *
 * Tabelas relacionadas:
 * - `game_servers_intent_idempotency` — intents servidores/oficina/inventário (Prisma).
 * - `wallet_idempotency` — liquidação câmbio (`request_fingerprint`).
 * - `shop_checkout_idempotency` — checkout Lojinha (`request_fingerprint` + lock transacional).
 */
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export function advisoryLockPairFromIntent(userId: number, scope: string, idem: string): [number, number] {
  const h = crypto.createHash('sha256').update(`${userId}\0${scope}\0${idem}`).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

export function parseClientStateVersionIntent(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export async function readGameIntentIdempotencyReplay(
  prisma: PrismaClient,
  userId: number,
  scope: string,
  idem: string
): Promise<{ httpStatus: number; body: unknown } | null> {
  const row = await prisma.game_servers_intent_idempotency.findUnique({
    where: {
      user_id_scope_idempotency_key: {
        user_id: userId,
        scope,
        idempotency_key: idem
      }
    },
    select: { http_status: true, response_json: true }
  });
  if (!row) return null;
  return { httpStatus: row.http_status, body: row.response_json as unknown };
}

/** Metadado interno gravado em `response_json` para detectar replay com corpo diferente. */
export const GAME_INTENT_IDEM_FP_KEY = '_idemRequestFp';

export function stableIntentFingerprint(parts: Record<string, unknown>): string {
  const keys = Object.keys(parts).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = parts[k];
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex').slice(0, 32);
}

export function attachIntentFingerprint(body: Record<string, unknown>, fp: string): void {
  body[GAME_INTENT_IDEM_FP_KEY] = fp;
}

export function stripIntentFingerprint<T extends Record<string, unknown>>(body: T): T {
  const out = { ...body } as Record<string, unknown>;
  delete out[GAME_INTENT_IDEM_FP_KEY];
  return out as T;
}

export async function writeGameIntentIdempotencySuccess(
  prisma: PrismaClient,
  userId: number,
  scope: string,
  idem: string,
  httpStatus: number,
  body: unknown
): Promise<void> {
  await prisma.game_servers_intent_idempotency.upsert({
    where: {
      user_id_scope_idempotency_key: {
        user_id: userId,
        scope,
        idempotency_key: idem
      }
    },
    create: {
      user_id: userId,
      scope,
      idempotency_key: idem,
      http_status: httpStatus,
      response_json: body as object
    },
    update: {
      http_status: httpStatus,
      response_json: body as object
    }
  });
}
