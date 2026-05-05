import type { PoolClient } from 'pg';
import { RoletaAppError } from '../validation/roletaValidation.js';

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
  client: PoolClient,
  row: { type?: unknown; loot_box_id?: string | null }
): Promise<boolean> {
  if (promoTypeLiteralIsRoleta(row.type)) return true;
  const bid = row.loot_box_id;
  if (bid == null || String(bid).trim() === '') return false;
  const r = await client.query(`SELECT trigger FROM loot_boxes WHERE id = $1`, [String(bid).trim()]);
  return String((r.rows[0] as { trigger?: string } | undefined)?.trigger || '') === 'roleta_code';
}
