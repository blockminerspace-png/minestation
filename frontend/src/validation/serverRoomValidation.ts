import type { RigRoom } from '../types';

/** Alinhado com o servidor (`RACK_ID_RE`): ids de upgrades, rigs, moedas. */
const GAME_ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

/** IDs de `stored_batteries` (UUID ou prefixo legado). */
const STORED_BATTERY_ID_RE = /^[a-zA-Z0-9_.:-]{1,240}$/;

export function isValidGameItemId(raw: unknown): boolean {
  return typeof raw === 'string' && GAME_ID_RE.test(raw.trim());
}

/** Devolve o id normalizado ou `null` se inválido. */
export function parseValidGameItemId(raw: unknown): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  return GAME_ID_RE.test(t) ? t : null;
}

export function parseValidStoredBatteryId(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const t = String(raw).trim();
  return STORED_BATTERY_ID_RE.test(t) ? t : null;
}

export function isValidUserEmailForRoomsFetch(raw: string | undefined | null): boolean {
  const e = (raw != null ? String(raw) : '').trim();
  if (e.length < 3 || e.length > 254) return false;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/.test(e)) return false;
  return e.includes('@');
}

export function sanitizeEmailForRoomsFetch(raw: string | undefined | null): string {
  return (raw != null ? String(raw) : '').trim().toLowerCase().slice(0, 254);
}

export function isValidRigRoomId(raw: unknown): boolean {
  const t = raw != null ? String(raw).trim() : '';
  return t.length > 0 && t.length <= 120 && GAME_ID_RE.test(t);
}

/** `url("...")` seguro para CSS `backgroundImage` (evita quebra com `"` ou `\`). */
export function cssSafeBackgroundUrl(raw: string | undefined | null): string | undefined {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return undefined;
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `url("${escaped}")`;
}

/** Alinhado com o limite do servidor em `POST /api/rig-rooms/purchase-slot`. */
export const MAX_RIG_SLOTS_PURCHASE_PER_REQUEST = 50;

/** Quantidade inteira 1..MAX para compra em lote de slots. */
export function parseRigSlotPurchaseQuantity(raw: unknown): number | null {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > MAX_RIG_SLOTS_PURCHASE_PER_REQUEST) return null;
  return n;
}

/**
 * Pré-visualização de custo para os próximos `quantity` slots (ou menos se bater no teto).
 * `purchasedSoFar` = `unlockedSlots` atual na sala.
 */
export function previewRigSlotBulkPurchase(
  room: RigRoom,
  quantity: number,
  walletUsdc: number
): {
  maxBuyable: number;
  appliedQty: number;
  totalUsdc: number;
  saldoApos: number;
  ok: boolean;
  message?: string;
} {
  const unlocked = Math.max(0, Math.floor(Number(room.unlockedSlots) || 0));
  const initial = Math.max(0, Math.floor(Number(room.initialCapacity) || 0));
  const maxCap = Math.max(0, Math.floor(Number(room.maxCapacity) || 0));
  const cap = initial + unlocked;
  const maxBuyable = Math.max(0, maxCap - cap);
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  const appliedQty = Math.min(q, maxBuyable, MAX_RIG_SLOTS_PURCHASE_PER_REQUEST);
  if (appliedQty < 1 || maxBuyable < 1) {
    return { maxBuyable, appliedQty: 0, totalUsdc: 0, saldoApos: walletUsdc, ok: false, message: 'Capacidade máxima desta sala.' };
  }
  const base = Number(room.baseSlotPrice);
  const pct = Number(room.slotPriceIncreasePercent);
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(pct)) {
    return { maxBuyable, appliedQty, totalUsdc: 0, saldoApos: walletUsdc, ok: false, message: 'Dados da sala inválidos.' };
  }
  const factor = 1 + pct / 100;
  let total = 0;
  for (let j = 0; j < appliedQty; j++) {
    total += base * Math.pow(factor, unlocked + j);
  }
  const w = typeof walletUsdc === 'number' && Number.isFinite(walletUsdc) ? walletUsdc : 0;
  const saldoApos = w - total;
  if (saldoApos < -1e-9) {
    return { maxBuyable, appliedQty, totalUsdc: total, saldoApos: w, ok: false, message: 'Saldo USDC insuficiente para esta compra.' };
  }
  return { maxBuyable, appliedQty, totalUsdc: total, saldoApos, ok: true };
}
