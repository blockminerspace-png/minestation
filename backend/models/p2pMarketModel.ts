import { prisma } from '../config/prisma.js';

/** Converte valor vindo do PG (BIGINT como string, número, ISO) para epoch ms. */
export function timestampMsFromDb(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (val instanceof Date) {
    const t = val.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

/** Reserva de anúncio antes da compra (ms). */
export const MARKET_RESERVE_MS = 3 * 60 * 1000;
/** TTL de um anúncio ativo (ms). */
export const MARKET_LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mesma regra que GET /api/economy-settings (blackMarketEnabled):
 * linha em economy_settings manda; senão fallback em settings.
 */
/** % de banda (1–90); fallback 20. Alinhado a economy_settings / settings. */
export async function getBlackMarketPriceBandPercent(): Promise<number> {
  try {
    const row = await prisma.economy_settings.findUnique({
      where: { id: 1 },
      select: { black_market_price_band_percent: true }
    });
    const n = Number(row?.black_market_price_band_percent ?? 20);
    return Math.min(90, Math.max(1, Number.isFinite(n) ? n : 20));
  } catch {
    try {
      const bk = await prisma.settings.findUnique({
        where: { key: 'black_market_price_band_percent' },
        select: { value: true }
      });
      const n = Number(bk?.value);
      return Math.min(90, Math.max(1, Number.isFinite(n) ? n : 20));
    } catch {
      return 20;
    }
  }
}

/** Interpreta USDC vindo da BD (numeric/string; vírgula como decimal). */
export function parseUsdFromDb(raw: unknown): number {
  if (raw == null) return NaN;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'string') {
    const t = raw.trim().replace(/\s/g, '').replace(',', '.');
    if (!t) return NaN;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Preço âncora para ±band%: sempre o valor da loja (base_cost / Lojinha Miner), quando existir.
 * O mínimo legal fica em (1 − band%) × loja (ex.: band 20% → floor 80% do preço da loja).
 * Sem base_cost válido: usa `bookFallbackAsk` (ex. mediana das ofertas ativas), não o mínimo absoluto,
 * para uma única oferta “lixo” a 0,01 não dominar a banda quando a loja devia mandar.
 */
export function computeP2PBandReferenceUsd(baseCost: number, bookFallbackAsk: number | null): number {
  const b = Number(baseCost);
  if (Number.isFinite(b) && b > 0) return b;
  const m =
    bookFallbackAsk != null && Number.isFinite(bookFallbackAsk) && bookFallbackAsk > 0
      ? bookFallbackAsk
      : null;
  return m ?? 0;
}

export async function isP2PMarketEnabled(): Promise<boolean> {
  try {
    const row = await prisma.economy_settings.findUnique({
      where: { id: 1 },
      select: { black_market_enabled: true }
    });
    const bk = await prisma.settings.findUnique({
      where: { key: 'black_market_enabled' },
      select: { value: true }
    });
    if (row != null) return Number(row.black_market_enabled) !== 0;
    if (bk?.value != null) return bk.value === '1';
    return true;
  } catch {
    return true;
  }
}

export type PlayerListingRow = {
  id: string;
  username?: string;
  email?: string;
  reserver_username?: string | null;
  item_id: string;
  price: string | number;
  qty?: number | null;
  expires_at: string | number;
  reserved_until?: string | number | null;
  status?: string;
  user_id?: number;
  reserved_by?: number | null;
};

export function mapListingForClient(
  l: PlayerListingRow,
  now: number
): {
  id: string;
  sellerName: string;
  itemId: string;
  /** USDC por unidade */
  price: number;
  qty: number;
  /** USDC total do lote (preço unitário × quantidade) */
  lineTotal: number;
  expiresAt: number;
  reservedBy?: string;
  reservedUntil?: number;
} {
  const exp = timestampMsFromDb(l.expires_at);
  const resUntil = timestampMsFromDb(l.reserved_until);
  let reservedBy: string | undefined;
  if (resUntil > now && l.reserver_username) {
    reservedBy = l.reserver_username;
  }
  const unitPrice = Number(l.price);
  const qty = Math.max(1, parseInt(String(l.qty ?? 1), 10) || 1);
  return {
    id: l.id,
    sellerName: l.username || l.email || '',
    itemId: l.item_id,
    price: unitPrice,
    qty,
    lineTotal: unitPrice * qty,
    expiresAt: exp,
    reservedBy,
    reservedUntil: l.reserved_until != null && resUntil > now ? resUntil : undefined
  };
}
