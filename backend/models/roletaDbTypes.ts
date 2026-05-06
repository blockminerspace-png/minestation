import type { PrismaClient } from '@prisma/client';

/** Cliente Prisma (raiz ou dentro de `$transaction`) usado pela roleta. */
export type RoletaDbTx = Pick<
  PrismaClient,
  | '$queryRaw'
  | 'loot_boxes'
  | 'loot_box_items'
  | 'unopened_boxes'
  | 'promo_code_redemptions'
  | 'promo_codes'
  | 'game_states'
  | 'wheel_paid_pending'
>;
