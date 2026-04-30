import { AccessLevel, GameState, LootBox, SystemNews, Upgrade, User, Web3Settings, MiningCoin, SeasonPass, SeasonPurchase, AdminUpgrade, MarketListing, RigRoom, MonetizationSettings, EconomySettings, SecurityStats, ReferralModel } from '../types';

const base = '/api';

async function apiFetch(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    credentials: 'include'
  });
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

export async function getLootBoxes(): Promise<LootBox[]> {
  try {
    const res = await apiFetch(`${base}/loot-boxes`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
  }
}

export async function setLootBoxes(boxes: LootBox[]): Promise<void> {
  const res = await apiFetch(`${base}/loot-boxes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(boxes) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Erro ao salvar caixas: ${res.status}`);
  }
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

export async function purchaseRoomSlot(email: string, roomId: string): Promise<{ ok: boolean; newUsdc?: number; error?: string; missing?: number }> {
  try {
    const res = await apiFetch(`${base}/rig-rooms/purchase-slot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId }) });
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
    const res = await apiFetch(`${base}/market/listings`);
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  } catch {
    return [];
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

export async function buyMarketListing(listingId: string): Promise<{ ok: boolean; error?: string; missing?: number }> {
  try {
    const res = await apiFetch(`${base}/market/buy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }) });
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
    try { return await res.json(); } catch { return { ok: true }; }
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function getCustodyListings(): Promise<MarketListing[]> {
  try {
    const res = await apiFetch(`${base}/market/custody`);
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

export async function getWeb3Settings(): Promise<Web3Settings | null> {
  try {
    const res = await apiFetch(`${base}/web3-settings`);
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
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

export async function saveMiningCoin(coin: any): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await apiFetch(`${base}/mining/coins`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(coin) });
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

export async function login(email: string, password: string): Promise<any> {
  try {
    const res = await apiFetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
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

export async function saveGameState(email: string, state: Partial<GameState>, options: { adminOverride?: boolean } = {}): Promise<{ ok: boolean; forceReload?: boolean; error?: string }> {
  // email is now redundant but kept in signature for compatibility
  const payload = {
    changes: { ...state, lastLoadTime: globalLastLoadTime },
    adminOverride: options.adminOverride,
    targetEmail: email
  };
  try {
    console.log(`[APIService] Saving Game State for ${email}`, payload.changes);
    const res = await apiFetch(`${base}/save-game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    });
    if (!res.ok) {
      try { return await res.json(); } catch { return { ok: false }; }
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
    const res = await apiFetch(`${base}/admin/monetization-settings`);
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
    const res = await apiFetch(`${base}/economy-settings`);
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
    const res = await apiFetch(`${base}/loot-boxes/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boxId }) });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function buyLootBox(email: string, boxId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`${base}/loot-boxes/buy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boxId }) });
    return await res.json();
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

