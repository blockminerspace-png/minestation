import { AccessLevel, GameState, LootBox, SystemNews, Upgrade, User, Web3Settings, MiningCoin, SeasonPass, SeasonPurchase, AdminUpgrade, MarketListing, RigRoom, MonetizationSettings, EconomySettings, SecurityStats, ReferralModel, GameUserActivityEntry, TransparencyEntry, TransparencyCategory, DeviceFingerprintPayload, AdminDeviceFingerprintLog, PlacedRack, StoredBattery, P2PMarketTradeHistory, P2PMarketTradeHistoryEntry } from '@/types';
import { GAME_NAV_LABEL_KEYS } from '../constants/gameNavLabels';

const base = '/api';

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshSessionOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${base}/auth/refresh`, { method: 'POST', credentials: 'include' });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function shouldSkipAuthRefreshRetry(url: string): boolean {
  const u = url.replace(/^https?:\/\/[^/]+/i, '');
  return (
    u.includes('/auth/refresh') ||
    u.includes('/login') ||
    u.includes('/logout') ||
    u.includes('/password-reset')
  );
}

async function apiFetch(url: string, options: RequestInit = {}, allowRefreshRetry = true): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include'
  });
  if (res.status === 401 && allowRefreshRetry && !shouldSkipAuthRefreshRetry(url)) {
    const refreshed = await tryRefreshSessionOnce();
    if (refreshed) {
      return fetch(url, { ...options, credentials: 'include' });
    }
  }
  return res;
}

/** Log de atividade do jogador (auditoria); falhas não devem bloquear o jogo. */
export async function logPlayerActivity(
  action: string,
  meta: Record<string, unknown>,
  clientHints?: Record<string, unknown>
): Promise<void> {
  try {
    await apiFetch(`${base}/player-activity-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, meta, clientHints: clientHints && typeof clientHints === 'object' ? clientHints : {} })
    });
  } catch {
    /* ignore */
  }
}

/** Transferências USDC (Polygon) para o treasury — só admin; chave Etherscan fica no servidor. */
export async function getAdminTreasuryTokenTxs(page: number, offset: number): Promise<unknown> {
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  const o = Math.min(1000, Math.max(1, Math.floor(Number(offset)) || 20));
  const res = await apiFetch(`${base}/admin/etherscan/treasury-token-txs?page=${p}&offset=${o}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data;
}

export async function getUpgrades(): Promise<Upgrade[]> {
  try {
    const res = await apiFetch(`${base}/upgrades`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

export async function setUpgrades(upgrades: Upgrade[]): Promise<void> {
  const res = await apiFetch(`${base}/upgrades`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(upgrades) });
  if (!res.ok) {
    let errorMsg = `Server Error: ${res.status}`;
    try {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json.error) errorMsg = json.error;
        else errorMsg += ' ' + text.substring(0, 100);
      } catch {
        errorMsg += ' ' + text.substring(0, 100);
      }
    } catch { }
    throw new Error(errorMsg);
  }
}

export async function getAccessLevels(): Promise<AccessLevel[]> {
  try {
    const res = await apiFetch(`${base}/access-levels`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

export async function setAccessLevels(levels: AccessLevel[]): Promise<void> {
  const res = await apiFetch(`${base}/access-levels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(levels) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Server error: ${res.status}`);
  }
}

/** Prefixo em `ui_display_labels` para itens da barra de navegação (alinhado ao backend). */
const GAME_NAV_DB_PREFIX = 'nav.';

function gameNavLabelsFromDisplayLabelsPayload(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const short of GAME_NAV_LABEL_KEYS) {
    const v = data[`${GAME_NAV_DB_PREFIX}${short}`];
    if (typeof v === 'string' && v.trim()) out[short] = v.trim();
  }
  return out;
}

/** Rótulos do menu do jogo (via GET /api/display-labels; chaves `nav.*` no servidor). */
export async function getGameNavLabels(): Promise<Record<string, string>> {
  try {
    const res = await apiFetch(`${base}/display-labels`);
    if (!res.ok) return {};
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return gameNavLabelsFromDisplayLabelsPayload(data);
  } catch {
    return {};
  }
}

/** Salva rótulos do menu (admin) em POST /api/admin/display-labels. */
export async function saveGameNavLabels(labels: Record<string, string>): Promise<Record<string, string>> {
  const payload: Record<string, string> = {};
  for (const short of GAME_NAV_LABEL_KEYS) {
    const raw = labels[short];
    const s = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
    payload[`${GAME_NAV_DB_PREFIX}${short}`] = s;
  }
  const res = await apiFetch(`${base}/admin/display-labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: payload })
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; labels?: unknown };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  const merged = data.labels;
  if (!merged || typeof merged !== 'object' || Array.isArray(merged)) return {};
  return gameNavLabelsFromDisplayLabelsPayload(merged as Record<string, unknown>);
}

export async function getLootBoxes(): Promise<LootBox[]> {
  try {
    const res = await apiFetch(`${base}/loot-boxes`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

/** `replaceCatalog: true` = lista completa do painel de caixas; desativa no DB as que sumiram da lista. */
export async function setLootBoxes(
  boxes: LootBox[],
  options?: { replaceCatalog?: boolean }
): Promise<void> {
  const replaceCatalog = options?.replaceCatalog === true;
  const res = await apiFetch(`${base}/loot-boxes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxes, replaceCatalog })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Erro ao salvar caixas: ${res.status}`);
  }
}

/** Resumo do DELETE em cascata na base de dados (admin). */
export type LootBoxDeleteSummary = {
  lootBoxItemsRemoved: number;
  unopenedBoxesRows: number;
  playerClaimedRows: number;
  adminUpgradeBoxesRows: number;
  promoCodesCleared: number;
  referralModelsSenderCleared: number;
  referralModelsReceiverCleared: number;
  lootBoxesRemoved: number;
};

/**
 * Remove a caixa do PostgreSQL (itens, inventários, shop_once, pacotes admin, promo_codes, referral_models).
 * Use `brokenOnly: true` para apagar apenas caixas sem itens ou com soma de probabilidades ≤ 0.
 */
export async function deleteLootBox(
  boxId: string,
  options?: { brokenOnly?: boolean }
): Promise<{ ok: true; summary: LootBoxDeleteSummary }> {
  const enc = encodeURIComponent(boxId);
  const qs = options?.brokenOnly ? '?brokenOnly=1' : '';
  const res = await apiFetch(`${base}/admin/loot-boxes/${enc}${qs}`, { method: 'DELETE' });
  const text = await res.text();
  let data: { ok?: boolean; summary?: LootBoxDeleteSummary; error?: string } = {};
  try {
    if (text) data = JSON.parse(text) as typeof data;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(data.error || text || `Erro ao apagar caixa: ${res.status}`);
  }
  if (!data.ok || !data.summary) {
    throw new Error('Resposta inválida do servidor.');
  }
  return { ok: true, summary: data.summary };
}

export async function getRigRooms(): Promise<RigRoom[]> {
  try {
    const res = await apiFetch(`${base}/rig-rooms`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function setRigRooms(rooms: RigRoom[]): Promise<{ ok: boolean }> {
  try {
    const res = await apiFetch(`${base}/rig-rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rooms) });
    if (!res.ok) return { ok: false };
    try { return await res.json(); } catch { return { ok: true } };
  } catch { return { ok: false } }
}

export async function getMyRigRooms(email: string): Promise<RigRoom[]> {
  try {
    const res = await apiFetch(`${base}/my-rig-rooms/${encodeURIComponent(email)}`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function purchaseRoomSlot(
  email: string,
  roomId: string,
  quantity = 1
): Promise<{ ok: boolean; newUsdc?: number; slotsPurchased?: number; totalPaid?: number; error?: string; missing?: number }> {
  try {
    const res = await apiFetch(`${base}/rig-rooms/purchase-slot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, quantity })
    });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Purchase failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' } }
}

export async function getSystemNews(): Promise<SystemNews[]> {
  try {
    const res = await apiFetch(`${base}/news`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

export async function addOrUpdateNews(item: { id: string; text: string; link?: string; duration?: number; authorName?: string; adType?: string; imageUrl?: string }): Promise<void> {
  await apiFetch(`${base}/news`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
}

export async function uploadAdImage(file: File): Promise<{ ok: boolean; imageUrl?: string; error?: string }> {
  const formData = new FormData();
  formData.append('image', file);
  try {
    const res = await apiFetch(`${base}/admin/upload-ad`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Server returned ${res.status}: ${text.slice(0, 100)}` };
    }
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: 'Network error: ' + (err.message || 'unknown') };
  }
}

export async function deleteNews(id: string): Promise<void> {
  await apiFetch(`${base}/news/${id}`, { method: 'DELETE' });
}

export async function getNewsFee(): Promise<number> {
  try {
    const res = await apiFetch(`${base}/news-fee`);
    if (!res.ok) return 0;
    try { const j = await res.json(); return j.feeUsdc || 0; } catch { return 0; }
  } catch { return 0; }
}

export async function setNewsFee(feeUsdc: number): Promise<void> {
  await apiFetch(`${base}/news-fee`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feeUsdc }) });
}

export async function getPendingPlayerNews(): Promise<Array<{ id: string; userId: number; username: string; email: string; text: string; link?: string; status: string; createdAt: number }>> {
  try {
    const res = await apiFetch(`${base}/player-news/pending`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function getNewsExpireDays(): Promise<number> {
  try {
    const res = await apiFetch(`${base}/news-expire-days`);
    if (!res.ok) return 0;
    try { const j = await res.json(); return j.days || 0; } catch { return 0; }
  } catch { return 0; }
}

export async function setNewsExpireDays(days: number): Promise<void> {
  await apiFetch(`${base}/news-expire-days`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) });
}
export async function submitPlayerNews(email: string, text: string, link?: string): Promise<{ ok: boolean; newUsdc?: number; error?: string; missing?: number }> {
  try {
    const res = await apiFetch(`${base}/player-news/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, text, link }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Submit failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' } }
}

export async function approvePlayerNews(id: string): Promise<{ ok: boolean }> {
  const res = await apiFetch(`${base}/player-news/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  try { return await res.json(); } catch { return { ok: false } }
}

export async function rejectPlayerNews(id: string): Promise<{ ok: boolean }> {
  const res = await apiFetch(`${base}/player-news/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  try { return await res.json(); } catch { return { ok: false } }
}
export async function getUsers(
  page: number = 1,
  limit: number = 50,
  search: string = '',
  sortBy: string = 'creation',
  sortDir: 'asc' | 'desc' = 'asc',
  filterStatus: string = 'all',
  filterLevel: string = 'all'
): Promise<{ users: User[]; total: number; pages: number; levels: { id: string; name: string }[] }> {
  try {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      search: search,
      sortBy,
      sortDir,
      filterStatus,
      filterLevel
    }).toString();
    const res = await apiFetch(`${base}/users?${query}`);
    if (!res.ok) return { users: [], total: 0, pages: 0, levels: [] };
    try { return await res.json(); } catch { return { users: [], total: 0, pages: 0, levels: [] }; }
  } catch {
    return { users: [], total: 0, pages: 0, levels: [] };
  }
}

export async function getAdminUserMap(): Promise<Array<{ id: number; username: string; polygonWallet?: string; email: string }>> {
  try {
    const res = await apiFetch(`${base}/admin/users/map`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

export async function toggleUserBlocked(email: string, blocked: boolean): Promise<void> {
  await apiFetch(`${base}/users/block`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, blocked }) });
}

export async function updateUser(user: User & { newReferralFor?: string }): Promise<{ ok: boolean; error?: string; code?: string; accounts?: any[] }> {
  try {
    const res = await apiFetch(`${base}/user`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: (data as { error?: string }).error || `Erro ${res.status}`,
        code: (data as { code?: string }).code,
        accounts: (data as { accounts?: any[] }).accounts
      };
    }
    return { ok: true, ...(typeof data === 'object' && data ? data : {}) } as { ok: boolean; error?: string; code?: string; accounts?: any[] };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function deleteUser(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/user/${encodeURIComponent(email)}`, { method: 'DELETE' });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Delete failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true } };
  } catch { return { ok: false, error: 'Network error' } }
}

export async function bulkDeleteUsers(emails: string[]): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    const res = await apiFetch(`${base}/admin/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function bulkGiftUsers(emails: string[], gift: { type: string; id?: string; qty: number }): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    const res = await apiFetch(`${base}/admin/bulk-gift`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails, gift })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function getGameState(email: string, opts?: { adminOverride?: boolean }): Promise<{ data: GameState | null; status: number }> {
  // Use 'me' if it's the current session user to leverage the backend's session-based auth
  const target = email === 'me' ? 'me' : encodeURIComponent(email);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts?.adminOverride) headers['X-Admin-Edit'] = '1';
    const res = await apiFetch(`${base}/game-state/${target}?t=${Date.now()}`, { headers });
    if (!res.ok) {
      return { data: null, status: res.status };
    }
    const data = await res.json();
    if (data && data.serverUpdatedAt) {
      globalLastLoadTime = data.serverUpdatedAt;
    }
    return { data, status: res.status };
  } catch (e) {
    console.error('[APIService] getGameState failed', e);
    return { data: null, status: 500 };
  }
}



export async function getMarketListings(): Promise<MarketListing[]> {
  try {
    const res = await apiFetch(`${base}/market/listings?t=${Date.now()}`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

const emptyP2pHistory: P2PMarketTradeHistory = { purchases: [], sales: [] };

export async function getMarketTradeHistory(): Promise<P2PMarketTradeHistory> {
  try {
    const res = await apiFetch(`${base}/market/history?limit=100&t=${Date.now()}`);
    if (!res.ok) return emptyP2pHistory;
    let j: unknown;
    try {
      j = await res.json();
    } catch {
      return emptyP2pHistory;
    }
    if (!j || typeof j !== 'object') return emptyP2pHistory;
    const o = j as Record<string, unknown>;
    const purchases = Array.isArray(o.purchases) ? o.purchases : [];
    const sales = Array.isArray(o.sales) ? o.sales : [];
    const norm = (row: unknown): P2PMarketTradeHistoryEntry | null => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const at = typeof r.at === 'number' ? r.at : parseInt(String(r.at ?? '0'), 10) || 0;
      const itemId = typeof r.itemId === 'string' ? r.itemId : String(r.itemId ?? '');
      const qty = Math.max(1, parseInt(String(r.qty ?? 1), 10) || 1);
      const unitPrice = Number(r.unitPrice);
      const buyerPaidUsdc = Number(r.buyerPaidUsdc);
      const sellerReceivedUsdc = Number(r.sellerReceivedUsdc);
      const taxUsdc = Number(r.taxUsdc);
      const counterpartName = typeof r.counterpartName === 'string' ? r.counterpartName : '—';
      if (!itemId) return null;
      return {
        at,
        itemId,
        qty,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        buyerPaidUsdc: Number.isFinite(buyerPaidUsdc) ? buyerPaidUsdc : 0,
        sellerReceivedUsdc: Number.isFinite(sellerReceivedUsdc) ? sellerReceivedUsdc : 0,
        taxUsdc: Number.isFinite(taxUsdc) ? taxUsdc : 0,
        counterpartName
      };
    };
    return {
      purchases: purchases.map(norm).filter((x): x is P2PMarketTradeHistoryEntry => x != null),
      sales: sales.map(norm).filter((x): x is P2PMarketTradeHistoryEntry => x != null)
    };
  } catch {
    return emptyP2pHistory;
  }
}

export async function reserveMarketListing(listingId: string): Promise<{ ok: boolean; error?: string; reservedUntil?: number }> {
  try {
    const res = await apiFetch(`${base}/market/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }) });
    try { return await res.json(); } catch { return { ok: false, error: 'Reserve failed' }; }
  } catch { return { ok: false, error: 'Network error' } }
}

export async function cancelMarketReservation(listingId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/market/cancel-reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }) });
    try { return await res.json(); } catch { return { ok: false, error: 'Cancel failed' }; }
  } catch { return { ok: false, error: 'Network error' } }
}

export type BuyMarketListingResult = {
  ok: boolean;
  error?: string;
  missing?: number;
  message?: string;
  purchasedQty?: number;
  totalUsdc?: number;
  unitPrice?: number;
};

export async function buyMarketListing(listingId: string, qty?: number): Promise<BuyMarketListingResult> {
  try {
    const body: Record<string, unknown> = { listingId };
    if (qty != null) {
      const q = Math.floor(Number(qty));
      if (Number.isFinite(q) && q >= 1) {
        body.qty = q;
        body.quantity = q;
      }
    }
    const res = await apiFetch(`${base}/market/buy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Purchase failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function claimMarketFunds(): Promise<{ ok: boolean; claimed?: number; newUsdc?: number; error?: string }> {
  try {
    const res = await apiFetch(`${base}/market/claim`, { method: 'POST' });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Claim failed' }; }
    }
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function sellMarketListing(itemId: string, price: number, qty: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/market/sell`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, price, qty }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Sell failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function cancelMarketListing(listingId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/market/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Cancel failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function getCustodyListings(): Promise<MarketListing[]> {
  try {
    const res = await apiFetch(`${base}/market/custody?t=${Date.now()}`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

export async function claimCustodyItem(listingId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/market/claim-item`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function getTopWithdrawalsByCoin(): Promise<Array<{ coinId: string; coinName: string; top: { username: string; email: string; total: number }[] }>> {
  try {
    const res = await apiFetch(`${base}/stats/top-withdrawals-by-coin`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

export async function getAdminUpgrades(): Promise<AdminUpgrade[]> {
  try {
    const res = await apiFetch(`${base}/admin-upgrades`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function getAdminUpgradePurchases(email: string): Promise<string[]> {
  try {
    const res = await apiFetch(`${base}/admin-upgrade-purchases/${encodeURIComponent(email)}`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function createAdminUpgrade(upgrade: AdminUpgrade): Promise<{ ok: boolean; id?: string }> {
  try {
    const payload: any = {
      id: upgrade.id,
      name: upgrade.name,
      description: upgrade.description || '',
      priceUsdc: upgrade.priceUsdc || 0,
      grantUsdc: upgrade.grantUsdc || 0,
      grantAccessLevelId: upgrade.grantAccessLevelId || null,
      isActive: upgrade.isActive === false ? false : true,
      items: (upgrade.items || []).map(it => ({ itemId: it.itemId, qty: it.qty })),
      boxes: (upgrade.boxes || []).map(b => ({ boxId: b.boxId, qty: b.qty })),
      passes: Array.isArray(upgrade.passes) ? upgrade.passes : [],
      coins: (upgrade.coins || []).map(c => ({ coinId: c.coinId, amount: c.amount })),
      visibleToAccessLevelIds: upgrade.visibleToAccessLevelIds || []
    };
    const res = await apiFetch(`${base}/admin-upgrades`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) return { ok: false };
    try { return await res.json(); } catch { return { ok: true } };
  } catch { return { ok: false } }
}

export async function deleteAdminUpgrade(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin-upgrades/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: txt };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Error' };
  }
}

export async function purchaseAdminUpgrade(email: string, upgradeId: string): Promise<{ ok: boolean; newUsdc?: number; error?: string; missing?: number }> {
  try {
    const res = await apiFetch(`${base}/admin-upgrades/purchase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upgradeId }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Purchase failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true } };
  } catch { return { ok: false, error: 'Network error' } }
}

/** Flags de «desativar depósito» vindas da API/BD (boolean, 1, "1", "true"). */
export function web3DepositFlagDisabled(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === '1' || t === 'true' || t === 'yes' || t === 'on';
  }
  return false;
}

export async function getWeb3Settings(): Promise<Web3Settings | null> {
  try {
    const res = await apiFetch(`${base}/web3-settings?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      ...(raw as Web3Settings),
      depositPolygonDisabled: web3DepositFlagDisabled(o.depositPolygonDisabled),
      depositBnbDisabled: web3DepositFlagDisabled(o.depositBnbDisabled),
      depositBaseDisabled: web3DepositFlagDisabled(o.depositBaseDisabled)
    };
  } catch {
    return null;
  }
}

export async function setWeb3Settings(settings: Web3Settings): Promise<void> {
  const res = await apiFetch(`${base}/web3-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Erro ao salvar configurações Web3: ${res.status}`);
  }
}

/** Código promocional de roleta resgatado mas ainda com fluxo em curso (servidor). */
export async function getPendingRoletaCode(): Promise<string | null> {
  try {
    const res = await apiFetch(`${base}/roleta/pending-code`);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { code?: unknown };
    const c = data.code;
    if (c == null || typeof c !== 'string') return null;
    const t = c.trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

export async function rollWheel(code: string): Promise<{ ok: boolean; wonItemId?: string; item?: any; error?: string }> {
  try {
    const res = await apiFetch(`${base}/wheel/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Erro ao girar a roleta' }; }
    }
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'Erro de rede' };
  }
}

export async function getMiningCoins(): Promise<any[]> {
  try {
    const res = await apiFetch(`${base}/mining-coins`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

/** Aceita vírgula decimal (ex.: 0,11) e evita NaN ao guardar moedas no admin. */
function parseLocaleNumber(input: unknown, fallback: number): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (input === null || input === undefined) return fallback;
  const str = String(input).trim().replace(/\s/g, '');
  if (!str) return fallback;
  let s = str;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && (!hasDot || s.lastIndexOf(',') > s.lastIndexOf('.'))) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Normaliza payload antes de POST /api/mining/coins (evita blockReward=1 por NaN e preço errado). */
export function normalizeMiningCoinPayload(coin: Record<string, any>): Record<string, any> {
  const networkHashrate = parseLocaleNumber(coin.networkHashrate, 1_000_000);
  const blockReward = parseLocaleNumber(coin.blockReward, 0);
  const blockTimeRaw = parseLocaleNumber(coin.blockTime, 60);
  const priceUSDRaw = parseLocaleNumber(coin.priceUSD, NaN);
  const priceUSD = Number.isFinite(priceUSDRaw) ? priceUSDRaw : 1;
  const multiplier = parseLocaleNumber(coin.multiplier, 1);
  const minProportion = parseLocaleNumber(coin.minProportion, 0);
  const targetDailyUSD = parseLocaleNumber(coin.targetDailyUSD, 0);
  const difficulty = parseLocaleNumber(coin.difficulty, 1);
  return {
    ...coin,
    networkHashrate: networkHashrate > 0 ? networkHashrate : 1_000_000,
    blockReward: Math.max(0, blockReward),
    blockTime: blockTimeRaw > 0 ? blockTimeRaw : 60,
    priceUSD: priceUSD >= 0 ? priceUSD : 1,
    multiplier: multiplier > 0 ? multiplier : 1,
    minProportion: Math.max(0, minProportion),
    difficulty: difficulty > 0 ? difficulty : 1,
    targetDailyUSD: Math.max(0, targetDailyUSD),
    usdcRate: priceUSD >= 0 ? priceUSD : 1
  };
}

export async function saveMiningCoin(coin: any): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const payload = normalizeMiningCoinPayload(coin && typeof coin === 'object' ? coin : {});
    const res = await apiFetch(`${base}/mining/coins`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Save failed' }; }
    }
    return await res.json();
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function deleteMiningCoin(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/mining/coins/${id}`, { method: 'DELETE' });
    if (!res.ok) return { ok: false, error: 'Delete failed' };
    return { ok: true };
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function getNfts(contract: string, owner: string): Promise<Array<{ contract: string; tokenId: string; ownerAddress: string; metadata?: any }>> {
  try {
    const params = new URLSearchParams({ contract, owner });
    const res = await apiFetch(`${base}/nfts?${params.toString()}`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

export async function receiveNft(payload: { contract: string; tokenId: string; toAddress: string }): Promise<void> {
  await apiFetch(`${base}/nfts/receive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export async function sendNft(payload: { contract: string; tokenId: string; fromAddress: string; toAddress: string }): Promise<void> {
  await apiFetch(`${base}/nfts/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export async function login(email: string, password: string, deviceFingerprint?: DeviceFingerprintPayload): Promise<any> {
  try {
    const body: Record<string, unknown> = { email, password };
    if (deviceFingerprint) body.deviceFingerprint = deviceFingerprint;
    const res = await apiFetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Erro desconhecido' };
    return data;
  } catch (err: any) {
    return { error: 'Network Error: ' + err.message };
  }
}

export async function getSession(): Promise<User | null> {
  try {
    const res = await apiFetch(`${base}/session`);
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await apiFetch(`${base}/logout`, { method: 'POST' });
}

let globalLastLoadTime = 0;

// fetchGameState removida em favor de getGameState unificada

/** Bateria em massa na sala (Servidores) — servidor aplica regras e persiste. */
export async function postServerRoomBulkBatteries(payload: {
  roomId: string;
  batteryUpgradeId?: string;
  smartFill?: boolean;
  rigSort?: string;
}): Promise<
  | {
      ok: true;
      serverUpdatedAt: number;
      stock: Record<string, number>;
      storedBatteries: StoredBattery[];
      placedRacks: PlacedRack[];
      appliedRigs: number;
      compatibleRigs: number;
      smartFill?: boolean;
    }
  | { ok: false; error: string }
> {
  try {
    const res = await apiFetch(`${base}/server-room/bulk-batteries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      return { ok: false, error: err };
    }
    const su = Number(data.serverUpdatedAt);
    if (Number.isFinite(su) && su > 0) globalLastLoadTime = su;
    return {
      ok: true,
      serverUpdatedAt: su,
      stock: (data.stock as Record<string, number>) || {},
      storedBatteries: Array.isArray(data.storedBatteries) ? (data.storedBatteries as StoredBattery[]) : [],
      placedRacks: Array.isArray(data.placedRacks) ? (data.placedRacks as PlacedRack[]) : [],
      appliedRigs: Math.max(0, Math.floor(Number(data.appliedRigs) || 0)),
      compatibleRigs: Math.max(0, Math.floor(Number(data.compatibleRigs) || 0)),
      smartFill: !!data.smartFill
    };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

/** Moeda em todas as rigs da sala (Servidores) — servidor valida e persiste. */
export async function postServerRoomRoomCoins(
  roomId: string,
  coinId: string
): Promise<{ ok: true; serverUpdatedAt: number; placedRacks: PlacedRack[] } | { ok: false; error: string }> {
  try {
    const res = await apiFetch(`${base}/server-room/room-coins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, coinId })
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      return { ok: false, error: err };
    }
    const su = Number(data.serverUpdatedAt);
    if (Number.isFinite(su) && su > 0) globalLastLoadTime = su;
    return {
      ok: true,
      serverUpdatedAt: su,
      placedRacks: Array.isArray(data.placedRacks) ? (data.placedRacks as PlacedRack[]) : []
    };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

/** fetch + keepalive: corpos grandes falham no browser (~64 KiB). */
const SAVE_GAME_KEEPALIVE_MAX_BYTES = 61440;

export async function saveGameState(
  email: string,
  state: Partial<GameState>,
  options: { adminOverride?: boolean; keepalive?: boolean } = {}
): Promise<{
  ok: boolean;
  forceReload?: boolean;
  error?: string;
  serverUpdatedAt?: number;
  nftAutoSanitized?: boolean;
  placedRacks?: PlacedRack[];
  stock?: Record<string, number>;
  storedBatteries?: StoredBattery[];
}> {
  // email is now redundant but kept in signature for compatibility
  const payload = {
    changes: { ...state, lastLoadTime: globalLastLoadTime },
    adminOverride: options.adminOverride,
    targetEmail: email
  };
  try {
    const body = JSON.stringify(payload);
    const useKeepalive = !!options.keepalive && body.length < SAVE_GAME_KEEPALIVE_MAX_BYTES;
    const res = await apiFetch(`${base}/save-game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      ...(useKeepalive ? { keepalive: true as const } : {})
    });
    if (!res.ok) {
      try {
        const errBody = await res.json();
        return { ok: false, ...errBody };
      } catch {
        return { ok: false, error: `HTTP ${res.status}` };
      }
    }
    try {
      const data = await res.json();
      if (data && data.serverUpdatedAt) {
        globalLastLoadTime = data.serverUpdatedAt;
      }
      return data;
    } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' }; }
}

export type {
  SupportTicketAttachment,
  SupportTicketReplyRow,
  SupportTicketPlayerReplyRow,
  SupportTicketRow,
  MySupportTicketSummary,
  MySupportTicketDetail,
} from './supportTicketsApi';
export {
  submitSupportTicket,
  getAdminSupportTickets,
  postAdminSupportTicketReply,
  updateAdminSupportTicketStatus,
  getMySupportTickets,
  getMySupportTicketDetail,
  postPlayerSupportTicketReply,
} from './supportTicketsApi';

export async function getReferrals(email: string): Promise<string[]> {
  try {
    const res = await apiFetch(`${base}/referrals/${encodeURIComponent(email)}`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function claimReferralCode(email: string, code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/referrals/claim-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function claimReferralReward(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/referrals/claim-reward`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Failed to claim reward' }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function getSeasonPasses(): Promise<SeasonPass[]> {
  try {
    const res = await apiFetch(`${base}/season-passes`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function setSeasonPasses(passes: SeasonPass[]): Promise<void> {
  const res = await apiFetch(`${base}/season-passes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(passes) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Erro ao salvar passes de temporada: ${res.status}`);
  }
}

export async function getSeasonPurchases(email: string): Promise<SeasonPurchase[]> {
  try {
    const res = await apiFetch(`${base}/season-purchases/${encodeURIComponent(email)}`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function purchaseSeasonPass(passId: string, email: string): Promise<{ ok: boolean; newUsdc?: number; error?: string; missing?: number }> {
  try {
    const res = await apiFetch(`${base}/season-pass/purchase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passId }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Purchase failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function grantSeasonPass(email: string, passId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/season-pass/grant`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Edit': '1' }, body: JSON.stringify({ email, passId }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Grant failed' }; }
    }
    try { return await res.json(); } catch { return { ok: true } };
  } catch { return { ok: false, error: 'Network error' } }
}

export async function getMonetizationSettings(): Promise<MonetizationSettings | null> {
  try {
    const res = await apiFetch(`${base}/monetization-settings`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Inclui applixirCallbackSecret — apenas para o painel admin autenticado. */
export async function getAdminMonetizationSettings(): Promise<MonetizationSettings | null> {
  try {
    const res = await apiFetch(`${base}/admin/monetization-settings?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function getSecurityStats(): Promise<SecurityStats | null> {
  try {
    const res = await apiFetch(`${base}/admin/security/stats`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function getAdminDeviceFingerprints(opts?: {
  limit?: number;
  offset?: number;
  eventType?: 'login' | 'register' | '';
  userId?: number;
  q?: string;
}): Promise<{ rows: AdminDeviceFingerprintLog[]; total: number; limit: number; offset: number } | null> {
  try {
    const qs = new URLSearchParams();
    if (opts?.limit != null) qs.set('limit', String(opts.limit));
    if (opts?.offset != null) qs.set('offset', String(opts.offset));
    if (opts?.eventType) qs.set('eventType', opts.eventType);
    if (opts?.userId != null && Number.isFinite(opts.userId)) qs.set('userId', String(opts.userId));
    if (opts?.q && opts.q.trim()) qs.set('q', opts.q.trim());
    const res = await apiFetch(`${base}/admin/device-fingerprints?${qs.toString()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function addToBlacklist(ip: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/security/blacklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, reason })
    });
    return await res.json();
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function removeFromBlacklist(ip: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/security/blacklist/${encodeURIComponent(ip)}`, {
      method: 'DELETE'
    });
    return await res.json();
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function getAdminUserActivity(
  email: string,
  opts?: { userId?: number; limit?: number }
): Promise<{ logs: GameUserActivityEntry[]; error?: string }> {
  const q = new URLSearchParams();
  const uid = opts?.userId;
  if (uid != null && Number.isFinite(uid) && uid > 0) {
    q.set('userId', String(Math.floor(uid)));
  } else {
    const em = email.trim().toLowerCase();
    if (!em) return { logs: [], error: 'Indique o email ou username do jogador.' };
    q.set('email', em);
  }
  if (opts?.limit != null && opts.limit > 0) q.set('limit', String(Math.min(200, opts.limit)));
  try {
    const res = await apiFetch(`${base}/admin/user-activity?${q.toString()}`);
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch { /* ignore */ }
      return { logs: [], error: msg };
    }
    const data = await res.json();
    return { logs: Array.isArray(data.logs) ? data.logs : [] };
  } catch {
    return { logs: [], error: 'Erro de rede.' };
  }
}

export async function setMonetizationSettings(settings: MonetizationSettings): Promise<void> {
  const res = await apiFetch(`${base}/monetization-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Erro ao salvar monetização: ${res.status}`);
  }
}
export async function claimAdReward(email: string, wsIdx: number): Promise<{ ok: boolean; newCharge?: number; rewardMsg?: string; error?: string }> {
  try {
    const res = await apiFetch(`${base}/reward-ad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wsIdx })
    });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Failed to claim reward' }; }
    }
    try { return await res.json(); } catch { return { ok: true }; }
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function performWorkshopInstantRecharge(email: string, wsIdx: number): Promise<{ ok: boolean; newCharge?: number; error?: string }> {
  try {
    const res = await apiFetch(`${base}/workshop/recharge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wsIdx })
    });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Recharge failed' }; }
    }
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function getServerTime(): Promise<{ serverTime: number }> {
  try {
    const res = await apiFetch(`${base}/system/time`);
    if (!res.ok) return { serverTime: Date.now() };
    return await res.json();
  } catch {
    return { serverTime: Date.now() };
  }
}

export async function performDailyBoost(email: string, slotIndex: number): Promise<{ ok: boolean; newCharge?: number; boostAmount?: number; error?: string }> {
  try {
    const res = await apiFetch(`${base}/daily-boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotIndex })
    });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Boost failed' }; }
    }
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function getEconomySettings(): Promise<EconomySettings | null> {
  try {
    const res = await apiFetch(`${base}/economy-settings?t=${Date.now()}`);
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  } catch {
    return null;
  }
}

export async function setEconomySettings(settings: EconomySettings): Promise<void> {
  const res = await apiFetch(`${base}/economy-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Erro ao salvar economia: ${res.status}`);
  }
}

export async function getAdminMarketListings(): Promise<any[]> { // Using any for brevity, or define AdminListing interface
  try {
    const res = await apiFetch(`${base}/admin/market/listings`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch { return []; }
}

export async function impersonateUser(targetEmail: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/impersonate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetEmail }) });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Impersonation failed' }; }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function updateAdminPermissions(email: string, isAdmin: boolean, permissions: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/update-permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, isAdmin, permissions })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function stopImpersonate(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/stop-impersonate`, { method: 'POST' });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false, error: 'Stop impersonation failed' }; }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function openLootBox(email: string, boxId: string): Promise<{ ok: boolean; rewards?: any[]; error?: string }> {
  try {
    const res = await apiFetch(`${base}/loot-boxes/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, email })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function buyLootBox(email: string, boxId: string): Promise<{ ok: boolean; error?: string; newUsdc?: number }> {
  try {
    const res = await apiFetch(`${base}/loot-boxes/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, email })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

/** Descarta caixas não abertas (sem prémio). `qty` omitido = todas as unidades desse `boxId`. */
export async function discardLootBox(
  email: string,
  boxId: string,
  qty?: number
): Promise<{ ok: boolean; error?: string; discardedQty?: number; remainingQty?: number }> {
  try {
    const body: Record<string, unknown> = { boxId, email };
    if (qty !== undefined && Number.isFinite(qty) && qty > 0) body.qty = qty;
    const res = await apiFetch(`${base}/loot-boxes/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      discardedQty?: number;
      remainingQty?: number;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || 'Erro ao descartar.' };
    }
    return {
      ok: !!data.ok,
      discardedQty: data.discardedQty,
      remainingQty: data.remainingQty,
      error: data.error
    };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function buyUpgrades(email: string, cart: Record<string, number>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/upgrades/buy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cart }) });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}
export async function getAdminDashboardStats(): Promise<any> {
  try {
    const res = await apiFetch(`${base}/admin/dashboard-stats`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function toggleRankingExclusion(email: string, excluded: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/ranking-exclusion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, excluded })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function getLeaderboard(): Promise<{ username: string; power: number }[]> {
  try {
    const res = await apiFetch(`${base}/leaderboard`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function recallScan(): Promise<{ ok: boolean, summary?: any[], totalUsersChecked?: number, error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/recall-scan`);
    if (!res.ok) {
      const err = await res.json();
      return { ok: false, error: err.error };
    }
    return await res.json();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function recallAllPlayersItems(): Promise<{ ok: boolean, error?: string, report?: any }> {
  try {
    const res = await apiFetch(`${base}/admin/recall-all-players-items`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      return { ok: false, error: err.error };
    }
    return await res.json();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function getWalletLabels(): Promise<{ address: string; label: string }[]> {
  try {
    const res = await apiFetch(`${base}/wallet-labels`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function saveWalletLabel(address: string, label: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/wallet-labels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, label }) });
    if (!res.ok) return { ok: false, error: 'Failed' };
    return { ok: true };
  } catch { return { ok: false, error: 'Network error' }; }
}



// RECOVERY
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await apiFetch(`${base}/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: !!data.ok, message: data.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro de rede' };
  }
}

export async function verifyRecoveryWallet(email: string, walletAddress: string): Promise<{ ok: boolean; resetToken?: string; error?: string }> {
  try {
    const res = await apiFetch(`${base}/verify-recovery-wallet`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, walletAddress }) });
    return await res.json();
  } catch { return { ok: false, error: 'Network Error' }; }
}

export async function resetPasswordSecure(resetToken: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/reset-password-secure`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resetToken, newPassword }) });
    return await res.json();
  } catch { return { ok: false, error: 'Network Error' }; }
}


export async function getAdminRanking(): Promise<any> {
  try {
    const res = await apiFetch(`${base}/admin/ranking`);
    if (!res.ok) throw new Error('Failed to fetch');
    return await res.json();
  } catch {
    throw new Error('Network Error');
  }
}

export async function getPublicRanking(): Promise<any> {
  try {
    const res = await apiFetch(`${base}/ranking/public`);
    if (!res.ok) throw new Error('Failed to fetch');
    return await res.json();
  } catch {
    throw new Error('Network Error');
  }
}

export async function getEconomyStats(): Promise<any[]> {
  try {
    const res = await apiFetch(`${base}/admin/economy-stats`);
    if (!res.ok) throw new Error('Failed to fetch');
    return await res.json();
  } catch {
    throw new Error('Network Error');
  }
}

export async function updateEconomySettings(coinId: string, networkHashrate: number, blockReward: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/economy-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coinId, networkHashrate, blockReward })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network Error' };
  }
}

export async function getExchangeSettings(): Promise<{ minExchangeAmount: number; exchangeFeePercent: number }> {
  try {
    const res = await apiFetch(`${base}/exchange-settings?t=${Date.now()}`);
    if (!res.ok) return { minExchangeAmount: 0.1, exchangeFeePercent: 0 };
    return await res.json();
  } catch { return { minExchangeAmount: 0.1, exchangeFeePercent: 0 }; }
}

export async function setExchangeSettings(settings: { minExchangeAmount: number; exchangeFeePercent: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/exchange-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    return await res.json();
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function sellCoin(coinId: string, percentage: number): Promise<{ ok: boolean; soldAmount?: number; netUsdc?: number; feeUsdc?: number; newUsdc?: number; newCoinBalance?: number; error?: string }> {
  try {
    const res = await apiFetch(`${base}/exchange/sell`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coinId, percentage }) });
    return await res.json();
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function getReferralModels(): Promise<ReferralModel[]> {
  try {
    const res = await apiFetch(`${base}/admin/referral-models`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function saveReferralModel(model: Partial<ReferralModel>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/referral-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(model)
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error || 'Server error' };
    return { ok: true, ...json };
  } catch (e: any) { return { ok: false, error: e.message || 'Network error' }; }
}

export async function deleteReferralModel(id: number): Promise<{ ok: boolean }> {
  try {
    const res = await apiFetch(`${base}/admin/referral-models/${id}`, { method: 'DELETE' });
    return await res.json();
  } catch { return { ok: false }; }
}

export async function getAccessLevelReferralAssignments(): Promise<Record<string, number>> {
  try {
    const res = await apiFetch(`${base}/admin/access-level-referral-assignments`);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

export async function saveAccessLevelReferralAssignments(assignments: Record<string, number | null>): Promise<{ ok: boolean }> {
  try {
    const res = await apiFetch(`${base}/admin/access-level-referral-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments })
    });
    return await res.json();
  } catch { return { ok: false }; }
}
export async function updateCoinBalance(userId: number, coinId: string, amount: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/update-coin-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, coinId, amount })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function bulkUpdateCoinBalance(coinId: string, amount: number): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/bulk-update-coin-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coinId, amount })
    });

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e: any) {
      return { ok: false, error: e.message || 'Erro de conexão' };
    }
  } catch (e: any) {
    return { ok: false, error: e.message || 'Erro de rede' };
  }
}

export async function requestWithdrawal(coinId: string, amount: number, walletAddress: string): Promise<{ ok: boolean; requestId?: string; message?: string; error?: string }> {
  try {
    const res = await apiFetch(`${base}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coinId, amount, walletAddress })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Erro de rede' };
  }
}

export async function getWithdrawalRequests(): Promise<any[]> {
  try {
    const res = await apiFetch(`${base}/admin/withdrawals`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function updateWithdrawalStatus(requestId: string, status: 'completed' | 'rejected', txHash?: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/withdrawals/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, status, txHash })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Erro de rede' };
  }
}

export async function getTransparency(): Promise<TransparencyEntry[]> {
  try {
    const res = await apiFetch(`${base}/transparency`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function adminCreateTransparencyEntry(payload: {
  category: TransparencyCategory;
  title: string;
  body?: string;
  amountUsdc?: number | null;
  linkUrl?: string;
  sortOrder?: number;
}): Promise<{ ok: true; entry: TransparencyEntry } | { ok: false; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/transparency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error || `HTTP ${res.status}` };
    return { ok: true, entry: data as TransparencyEntry };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erro de rede' };
  }
}

export async function adminUpdateTransparencyEntry(
  id: number,
  payload: Partial<{
    category: TransparencyCategory;
    title: string;
    body: string | null;
    amountUsdc: number | null;
    linkUrl: string | null;
    sortOrder: number;
  }>
): Promise<{ ok: true; entry: TransparencyEntry } | { ok: false; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/transparency/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error || `HTTP ${res.status}` };
    return { ok: true, entry: data as TransparencyEntry };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erro de rede' };
  }
}

export async function adminDeleteTransparencyEntry(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/admin/transparency/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erro de rede' };
  }
}

