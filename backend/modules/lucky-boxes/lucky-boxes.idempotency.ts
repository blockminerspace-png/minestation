import { prisma } from '../../config/prisma.js';

export type LuckyBoxIdemScope = 'purchase' | 'open' | 'promo_redeem';

export function normalizeLuckyBoxIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, 128);
  return t.length ? t : null;
}

export async function readLuckyBoxIdempotency(userId: number, scope: LuckyBoxIdemScope, key: string) {
  return prisma.lucky_box_idempotency.findUnique({
    where: {
      user_id_scope_idempotency_key: {
        user_id: userId,
        scope,
        idempotency_key: key
      }
    }
  });
}

export async function writeLuckyBoxIdempotency(
  userId: number,
  scope: LuckyBoxIdemScope,
  key: string,
  httpStatus: number,
  body: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.lucky_box_idempotency.create({
      data: {
        user_id: userId,
        scope,
        idempotency_key: key,
        http_status: httpStatus,
        body_json: JSON.stringify(body),
        created_at: BigInt(Date.now())
      }
    });
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
    if (code === 'P2002') return;
    throw e;
  }
}
