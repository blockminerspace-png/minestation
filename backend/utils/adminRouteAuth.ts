/**
 * Mapeamento de rotas admin → aba do painel (ou SUPER).
 * Operadores com is_super_admin = 1 ignoram esta lista.
 */

export type AdminRouteRequirement = { kind: 'super' } | { kind: 'tab'; tab: string } | { kind: 'anyOf'; tabs: string[] };

/** Constrói o conjunto de permissões a partir do JSON em users.admin_permissions. */
export function permissionTabSetFromDbJson(raw: unknown): Set<string> {
  const s = new Set<string>();
  if (raw == null) return s;
  let p: unknown = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return s;
    try {
      p = JSON.parse(t);
    } catch {
      return s;
    }
  }
  if (Array.isArray(p)) {
    for (const x of p) {
      if (typeof x === 'string' && x.trim()) s.add(x.trim());
    }
    return s;
  }
  if (typeof p === 'object' && p !== null) {
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (v === true || v === 1) s.add(k);
    }
  }
  return s;
}

/**
 * Utilizador tem acesso à aba `required` se tem a permissão exata, a aba-pai (ex.: shops → shops:hardware),
 * ou qualquer sub-permissão shops:* quando tem só "shops".
 */
export function adminTabAllows(tabs: Set<string>, required: string): boolean {
  if (tabs.has(required)) return true;
  const colon = required.indexOf(':');
  if (colon > 0) {
    const parent = required.slice(0, colon);
    if (tabs.has(parent)) return true;
  }
  if (!required.includes(':')) {
    for (const t of tabs) {
      if (t.startsWith(`${required}:`)) return true;
    }
  }
  return false;
}

export function allowsAdminRouteAccess(
  isSuperAdmin: boolean,
  tabs: Set<string>,
  rule: AdminRouteRequirement
): boolean {
  if (isSuperAdmin) return true;
  if (rule.kind === 'super') return false;
  if (rule.kind === 'tab') return adminTabAllows(tabs, rule.tab);
  return rule.tabs.some((t) => adminTabAllows(tabs, t));
}

/** Resolve o requisito de permissão para um pedido autenticado como admin. */
export function resolveAdminRouteRequirement(method: string, rawPath: string): AdminRouteRequirement {
  const p = String(rawPath || '').split('?')[0];

  if (p === '/api/admin/update-permissions') return { kind: 'super' };
  if (p === '/api/admin/impersonate') return { kind: 'super' };
  if (p === '/api/admin/bulk-delete') return { kind: 'super' };
  if (p === '/api/admin/recall-all-players-items') return { kind: 'super' };
  if (p === '/api/admin/restore') return { kind: 'super' };
  if (p === '/api/admin/promo-codes/bulk-delete') return { kind: 'super' };

  if (p.startsWith('/api/admin/wheel/')) return { kind: 'tab', tab: 'games' };
  if (p === '/api/admin/reset-daily-boost') return { kind: 'tab', tab: 'games' };
  /** Calculadora / moedas mineradas no painel: só super (operador admin fica só em Transações USDC nos Relatórios). */
  if (p === '/api/mining-coins' && method.toUpperCase() === 'POST') return { kind: 'super' };
  if (p.startsWith('/api/mining/coins') && method.toUpperCase() !== 'GET') return { kind: 'super' };

  if (p.startsWith('/api/admin/partner-youtube') || p.startsWith('/api/admin/partner-videos')) {
    return { kind: 'tab', tab: 'partners' };
  }
  if (p === '/api/admin/upload-ad') return { kind: 'anyOf', tabs: ['partners', 'settings:news'] };

  if (p.startsWith('/api/admin/support-tickets')) return { kind: 'tab', tab: 'support' };
  if (p === '/api/admin/device-fingerprints') return { kind: 'tab', tab: 'security' };
  if (p.startsWith('/api/admin/security/')) return { kind: 'tab', tab: 'security' };

  if (p.startsWith('/api/admin/loot-boxes')) return { kind: 'tab', tab: 'lootboxes' };
  if (p.startsWith('/api/admin/user-boxes') || p === '/api/admin/delete-user-box') return { kind: 'tab', tab: 'lootboxes' };
  if (p.startsWith('/api/admin/loot-box-redemptions/')) return { kind: 'tab', tab: 'lootboxes' };
  if (p === '/api/loot-boxes' && method.toUpperCase() === 'POST') return { kind: 'tab', tab: 'lootboxes' };

  if (p.startsWith('/api/admin/backups') || p === '/api/admin/backup' || p.startsWith('/api/admin/backup-settings')) {
    return { kind: 'tab', tab: 'backup' };
  }
  if (p === '/api/admin/recall-scan') return { kind: 'tab', tab: 'backup' };

  if (p.startsWith('/api/admin/transparency')) return { kind: 'tab', tab: 'transparency' };

  if (p === '/api/admin/display-labels') return { kind: 'tab', tab: 'settings:labels' };

  if (p.startsWith('/api/player-news/')) return { kind: 'tab', tab: 'settings:news' };
  if (p === '/api/news' || p.startsWith('/api/news/')) return { kind: 'tab', tab: 'settings:news' };
  if (p === '/api/news-fee' || p === '/api/news-expire-days') return { kind: 'tab', tab: 'settings:news' };

  if (p.startsWith('/api/season-passes') || p === '/api/season-pass/grant') return { kind: 'tab', tab: 'settings:monetization' };
  if (p.startsWith('/api/admin/monetization-settings')) return { kind: 'tab', tab: 'settings:monetization' };
  if (p === '/api/monetization-settings' && method.toUpperCase() === 'POST') return { kind: 'tab', tab: 'settings:monetization' };
  if (p.startsWith('/api/admin/promo-codes')) return { kind: 'tab', tab: 'settings:monetization' };

  if (p === '/api/access-levels' && method.toUpperCase() === 'POST') return { kind: 'tab', tab: 'settings' };
  if (p === '/api/rig-rooms' && method.toUpperCase() === 'POST') return { kind: 'tab', tab: 'settings:rigrooms' };

  if (p === '/api/web3-settings' && method.toUpperCase() === 'POST') return { kind: 'super' };
  if (p === '/api/wallet-labels' && method.toUpperCase() === 'GET') return { kind: 'tab', tab: 'reports' };
  if (p === '/api/wallet-labels' && method.toUpperCase() === 'POST') return { kind: 'super' };
  if (p === '/api/nfts/receive' && method.toUpperCase() === 'POST') return { kind: 'super' };

  if (p === '/api/admin-upgrades' || p.startsWith('/api/admin-upgrades/')) return { kind: 'tab', tab: 'shops:hardware' };
  if (p === '/api/upgrades' && method.toUpperCase() === 'POST') return { kind: 'tab', tab: 'shops:hardware' };

  if (p === '/api/admin/market/listings') return { kind: 'tab', tab: 'shops' };

  if (p === '/api/exchange-settings' && method.toUpperCase() === 'POST') return { kind: 'super' };

  if (p === '/api/users' && method.toUpperCase() === 'GET') return { kind: 'tab', tab: 'users' };
  if (p === '/api/admin/users/map') return { kind: 'tab', tab: 'users' };
  if (p === '/api/users/block' && method.toUpperCase() === 'PUT') return { kind: 'tab', tab: 'users' };
  if (p.startsWith('/api/user/') && method.toUpperCase() === 'DELETE') return { kind: 'tab', tab: 'users' };
  if (p.startsWith('/api/admin/referral-models')) return { kind: 'tab', tab: 'users' };
  if (p.startsWith('/api/admin/access-level-referral-assignments')) return { kind: 'tab', tab: 'users' };
  if (p === '/api/admin/bulk-gift') return { kind: 'tab', tab: 'users' };
  if (p.startsWith('/api/admin/user-activity')) return { kind: 'tab', tab: 'users' };
  if (p === '/api/admin/update-coin-balance' || p === '/api/admin/bulk-update-coin-balance') return { kind: 'tab', tab: 'users' };
  if (p === '/api/admin/ranking-exclusion') return { kind: 'tab', tab: 'users' };

  if (p === '/api/admin/ranking') return { kind: 'tab', tab: 'users' };
  if (p === '/api/admin/accounts-dormant-mining') return { kind: 'tab', tab: 'users' };
  if (p.startsWith('/api/admin/economy-stats')) return { kind: 'tab', tab: 'reports' };
  if (p.startsWith('/api/admin/mining-runtime-summary')) return { kind: 'tab', tab: 'reports' };
  if (p.startsWith('/api/admin/etherscan/')) return { kind: 'tab', tab: 'reports' };
  if (p.startsWith('/api/admin/withdrawals')) return { kind: 'super' };
  if (p === '/api/admin/economy-settings' && method.toUpperCase() === 'POST') return { kind: 'super' };
  if (p === '/api/economy-settings' && method.toUpperCase() === 'POST') return { kind: 'tab', tab: 'reports' };

  if (p === '/api/admin/dashboard-stats') return { kind: 'tab', tab: 'dashboard' };

  if (p.startsWith('/api/admin/')) return { kind: 'super' };

  return { kind: 'super' };
}
