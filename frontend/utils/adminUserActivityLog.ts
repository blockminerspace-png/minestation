import type { GameUserActivityEntry } from '../types';

export function formatUserActivityMeta(meta: GameUserActivityEntry['meta']): string {
  if (meta == null || typeof meta !== 'object') return '—';
  try {
    const s = JSON.stringify(meta);
    return s.length > 420 ? `${s.slice(0, 420)}…` : s;
  } catch {
    return '—';
  }
}

/** Filtros da aba Atividade (ação em `game_activity_logs`). */
export const ACTIVITY_LOG_FILTER_GROUPS: {
  id: string;
  label: string;
  test?: (action: string) => boolean;
}[] = [
  { id: 'all', label: 'Todas' },
  {
    id: 'deposit',
    label: 'Depósitos',
    test: (a) => /deposit/i.test(a),
  },
  {
    id: 'purchase',
    label: 'Compras / loja',
    test: (a) => /^(hardware_buy|loot_box_buy|rig_room_slot_purchase|exchange_sell)$/i.test(a),
  },
  {
    id: 'boxes',
    label: 'Caixas (abrir)',
    test: (a) => /loot_box_open/i.test(a),
  },
  {
    id: 'roleta',
    label: 'Roleta',
    test: (a) => /roleta_(roll|claim)|promo_redeem_roleta/i.test(a),
  },
  {
    id: 'promo',
    label: 'Códigos / promo',
    test: (a) => /promo_redeem/i.test(a) && !/roleta/i.test(a),
  },
  {
    id: 'rigs',
    label: 'Rigs / salas',
    test: (a) => /mining_rack|rack_dismantle|room_battery|room_coin_bulk/i.test(a),
  },
  {
    id: 'workshop',
    label: 'Oficina',
    test: (a) => /workshop_(place|dismantle)/i.test(a),
  },
  {
    id: 'client',
    label: 'Cliente / telemetria',
    test: (a) => /^client_/i.test(a),
  },
  {
    id: 'login',
    label: 'Login / sessão',
    test: (a) => /login|session|auth|logout/i.test(a),
  },
];

export function filterUserActivityLogs(
  rows: GameUserActivityEntry[],
  activityLogFilterId: string,
  activityLogSearch: string
): GameUserActivityEntry[] {
  let out = rows;
  const q = activityLogSearch.trim().toLowerCase();
  if (q) {
    out = out.filter((r) => {
      const action = String(r.action || '').toLowerCase();
      const metaStr = formatUserActivityMeta(r.meta).toLowerCase();
      return action.includes(q) || metaStr.includes(q);
    });
  }
  const group = ACTIVITY_LOG_FILTER_GROUPS.find((g) => g.id === activityLogFilterId);
  if (!group?.test) return out;
  return out.filter((r) => group.test!(String(r.action || '')));
}
