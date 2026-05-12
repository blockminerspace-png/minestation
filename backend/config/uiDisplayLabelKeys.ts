/**
 * Chaves permitidas em `ui_display_labels` (validação POST /api/admin/display-labels).
 * Manter alinhado com `DEFAULT_DISPLAY_LABELS` em `frontend/models/displayLabelsModel.ts`.
 */
export const UI_DISPLAY_LABEL_KEYS = [
  'nav.servers',
  'nav.inventory',
  'nav.oficina',
  'nav.hardware_store',
  'nav.black_market',
  'nav.arcade',
  'nav.lucky_store',
  'nav.roleta',
  'nav.wallet',
  'nav.ranking',
  'nav.upgrade',
  'nav.transparency',
  'nav.support',
  'nav.partners',
  'nav.partner_games',
  'page.servers',
  'page.inventory',
  'page.oficina',
  'page.hardware_store',
  'page.black_market',
  'page.arcade',
  'page.lucky_store',
  'page.wallet',
  'page.upgrade',
  'page.profile',
  'page.transparency',
  'page.support',
  'page.partners',
  'page.partner_games',
  'shop.page_title',
  'shop.checkout_confirm_title',
  'shop.filter.all',
  'shop.filter.machine',
  'shop.filter.infrastructure',
  'shop.filter.battery',
  'shop.filter.wiring',
  'shop.filter.multiplier',
  'shop.filter.charger',
  'p2p.type.all',
  'p2p.type.machine',
  'p2p.type.infrastructure',
  'p2p.type.battery',
  'p2p.type.wiring',
  'p2p.type.multiplier',
  'p2p.type.charger'
] as const;

export type UiDisplayLabelKey = (typeof UI_DISPLAY_LABEL_KEYS)[number];

export const UI_DISPLAY_LABEL_KEY_SET = new Set<string>(UI_DISPLAY_LABEL_KEYS);
