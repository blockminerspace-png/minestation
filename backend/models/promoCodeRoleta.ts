import type { Prisma } from '@prisma/client';
import type { PoolClient } from 'pg';
import { RoletaAppError } from '../validation/roletaValidation.js';
import type { RoletaDbTx } from './roletaDbTypes.js';

type PromoRoletaQueryable = RoletaDbTx | Prisma.TransactionClient | Pick<PoolClient, 'query'>;

function isRoletaTx(db: PromoRoletaQueryable): db is RoletaDbTx {
  return typeof (db as RoletaDbTx).loot_boxes?.findFirst === 'function';
}

/** `expires_at` em ms UNIX; 0 ou ausente = sem expiração. */
export function throwIfPromoCodeExpired(row: { expires_at?: unknown }, serverNowMs: number): void {
  const raw = row.expires_at;
  if (raw == null) return;
  const exp = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(exp) || exp <= 0) return;
  if (serverNowMs > exp) {
    throw new RoletaAppError('Código expirado.', 400);
  }
}

export function promoTypeLiteralIsRoleta(type: unknown): boolean {
  return typeof type === 'string' && type.startsWith('roleta_');
}

/**
 * Código promocional que abre a roleta: `type` começa com `roleta_` OU está ligado a uma caixa com gatilho `roleta_code`.
 * (O admin às vezes gravava só `loot_box_id` + `per_player` — o resgate caía na loja em vez da roleta.)
 */
export async function promoCodeRowEligibleForRoletaFlow(
  db: PromoRoletaQueryable,
  row: { type?: unknown; loot_box_id?: string | null }
): Promise<boolean> {
  if (promoTypeLiteralIsRoleta(row.type)) return true;
  const bid = row.loot_box_id;
  if (bid == null || String(bid).trim() === '') return false;
  if (isRoletaTx(db)) {
    const lb = await db.loot_boxes.findFirst({
      where: { id: String(bid).trim() },
      select: { trigger: true }
    });
    return String(lb?.trigger || '') === 'roleta_code';
  }
  const r = await db.query(`SELECT trigger FROM loot_boxes WHERE id = $1`, [String(bid).trim()]);
  return String((r.rows[0] as { trigger?: string } | undefined)?.trigger || '') === 'roleta_code';
}
