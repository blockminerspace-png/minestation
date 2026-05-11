import { prisma } from '../../config/prisma.js';
import { stableIntentFingerprint } from '../../lib/gameIntentIdempotencyPrisma.js';

export type LuckyBoxIdemScope = 'purchase' | 'open' | 'promo_redeem';

export function normalizeLuckyBoxIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, 128);
  return t.length ? t : null;
}

/** Fingerprint canónico do pedido de abertura (mesma caixa + mesma key = replay). */
export function luckyBoxOpenRequestFingerprint(boxId: string): string {
  const b = String(boxId || '').trim();
  return stableIntentFingerprint({ op: 'lucky_box_open', boxId: b });
}

export function luckyBoxPurchaseRequestFingerprint(boxId: string, qty: number | null | undefined): string {
  const b = String(boxId || '').trim();
  const q = qty != null && Number.isFinite(qty) ? Math.max(1, Math.floor(Number(qty))) : 1;
  return stableIntentFingerprint({ op: 'lucky_box_purchase', boxId: b, qty: q });
}

export async function readLuckyBoxIdempotency(userId: number, scope: LuckyBoxIdemScope, key: string) {
  return prisma.lucky_box_idempotency.findUnique({
    where: {
      user_id_scope_idempotency_key: {
        user_id: userId,
        scope,
        idempotency_key: key
      }
    },
    select: {
      http_status: true,
      body_json: true,
      request_fingerprint: true
    }
  });
}

export async function writeLuckyBoxIdempotency(
  userId: number,
  scope: LuckyBoxIdemScope,
  key: string,
  httpStatus: number,
  body: Record<string, unknown>,
  requestFingerprint?: string | null
): Promise<void> {
  try {
    await prisma.lucky_box_idempotency.create({
      data: {
        user_id: userId,
        scope,
        idempotency_key: key,
        http_status: httpStatus,
        body_json: JSON.stringify(body),
        created_at: BigInt(Date.now()),
        request_fingerprint: requestFingerprint != null && String(requestFingerprint).trim()
          ? String(requestFingerprint).trim().slice(0, 64)
          : null
      }
    });
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
    if (code === 'P2002') return;
    throw e;
  }
}
