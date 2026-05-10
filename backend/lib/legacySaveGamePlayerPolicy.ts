/**
 * Neutralização de `POST /api/save-game` (e fusão de slices) para jogadores normais:
 * campos críticos não podem ser escritos a partir do payload do cliente.
 */
import type { PoolClient } from 'pg';
import type { SaveGameQueryClient } from './sqlTransaction.js';
import { loadWorkshopSlotsArrayForMerge } from './gameSaveSliceMerge.js';
import { loadUserPlacedRacksWithSlots } from './serverRoomPersistence.js';

export type LegacySaveGameBarrierResult =
  | { mode: 'allow' }
  | { mode: 'reject'; status: 409 | 422; message: string; code: string; fields: string[] };

const POLICY = String(process.env.LEGACY_SAVEGAME_PLAYER_POLICY || 'strip')
  .trim()
  .toLowerCase();

/** Chaves de topo em `changes` que nunca devem ser persistidas por jogador normal (save completo). */
const CRITICAL_TOP_KEYS = new Set([
  'stock',
  'storedBatteries',
  'placedRacks',
  'workshopSlots',
  'unopenedBoxes',
  'coinBalances',
  'racks',
  'servers',
  'inventory',
  'wallet',
  'balances',
  'production',
  'hashRate',
  'minedBalances'
]);

/** Dentro de `changes.gameState` (quando objeto) — mesma política. */
const CRITICAL_GAMESTATE_KEYS = new Set([
  'usdc',
  'coinBalances',
  'balances',
  'wallet',
  'production',
  'hashRate',
  'minedBalances',
  'stock',
  'storedBatteries',
  'placedRacks',
  'workshopSlots'
]);

export type LegacySaveLogPayload = {
  event: 'legacy_savegame_critical_rejected' | 'legacy_savegame_critical_ignored' | 'legacy_savegame_slice_neutralized';
  userId: number;
  requestId: string | null;
  fields: string[];
  route: string;
  origin: string;
  adminOverride: boolean;
  saveDomain: '' | 'inventory' | 'servers' | 'workshop';
  timestamp: string;
};

export function logLegacySaveStructured(payload: LegacySaveLogPayload): void {
  console.log(JSON.stringify(payload));
}

function readSaveDomainHeader(req: { headers?: unknown; originalUrl?: string }): '' | 'inventory' | 'servers' | 'workshop' {
  const h = req.headers as Record<string, unknown> | undefined;
  const raw = String(h?.['x-game-save-domain'] ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'inventory' || raw === 'servers' || raw === 'workshop') return raw;
  return '';
}

function requestIdFrom(req: { headers?: unknown }): string | null {
  const h = req.headers as Record<string, unknown> | undefined;
  const rid = h?.['x-request-id'] ?? h?.['x-correlation-id'];
  if (typeof rid !== 'string') return null;
  const s = rid.trim();
  return s.length > 0 ? s.slice(0, 200) : null;
}

function originFrom(req: { get?: (n: string) => string | undefined }): string {
  try {
    const o = req.get?.('origin') || req.get?.('referer') || '';
    return typeof o === 'string' && o.trim() ? o.slice(0, 500) : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function legacyCriticalKeysInChanges(changes: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of CRITICAL_TOP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(changes, k) && changes[k] !== undefined) {
      out.push(k);
    }
  }
  const gs = changes.gameState;
  if (gs && typeof gs === 'object' && !Array.isArray(gs)) {
    const g = gs as Record<string, unknown>;
    for (const k of CRITICAL_GAMESTATE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(g, k) && g[k] !== undefined) {
        out.push(`gameState.${k}`);
      }
    }
  }
  return [...new Set(out)];
}

function stripCriticalTopKeys(changes: Record<string, unknown>): string[] {
  const removed: string[] = [];
  for (const k of CRITICAL_TOP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(changes, k)) {
      delete changes[k];
      removed.push(k);
    }
  }
  if (changes.gameState && typeof changes.gameState === 'object' && !Array.isArray(changes.gameState)) {
    const g = changes.gameState as Record<string, unknown>;
    for (const k of CRITICAL_GAMESTATE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(g, k)) {
        delete g[k];
        removed.push(`gameState.${k}`);
      }
    }
  }
  return removed;
}

/**
 * Barreira para save completo (sem `X-Game-Save-Domain`). Mutates `changes` em modo `strip`.
 */
export function applyLegacySaveGameFullBarrier(
  req: { headers?: unknown; originalUrl?: string; get?: (n: string) => string | undefined },
  changes: Record<string, unknown>,
  userId: number,
  adminOverride: boolean
): LegacySaveGameBarrierResult {
  if (adminOverride) return { mode: 'allow' };
  if (readSaveDomainHeader(req) !== '') return { mode: 'allow' };

  const fields = legacyCriticalKeysInChanges(changes);
  if (fields.length === 0) return { mode: 'allow' };

  const base: Omit<LegacySaveLogPayload, 'event'> = {
    userId,
    requestId: requestIdFrom(req),
    fields,
    route: String(req.originalUrl || '/api/save-game').slice(0, 400),
    origin: originFrom(req),
    adminOverride: false,
    saveDomain: '',
    timestamp: new Date().toISOString()
  };

  if (POLICY === 'reject') {
    logLegacySaveStructured({ ...base, event: 'legacy_savegame_critical_rejected' });
    return {
      mode: 'reject',
      status: 422,
      code: 'LEGACY_SAVEGAME_CRITICAL_REJECTED',
      message:
        'Este pedido tenta alterar estado crítico do jogo por um canal legado. Recarregue a página e utilize apenas as ações do jogo suportadas.',
      fields
    };
  }

  const stripped = stripCriticalTopKeys(changes);
  logLegacySaveStructured({
    ...base,
    event: 'legacy_savegame_critical_ignored',
    fields: stripped.length > 0 ? stripped : fields
  });
  return { mode: 'allow' };
}

/**
 * Após `mergeSaveGameSlicePayload`, ignora autoridade do cliente nos slices e repõe dados críticos a partir da BD.
 */
export async function neutralizeLegacySaveGameSlicePayload(
  client: SaveGameQueryClient,
  uid: number,
  saveDomain: 'inventory' | 'servers' | 'workshop',
  changes: Record<string, unknown>,
  req: { headers?: unknown; originalUrl?: string; get?: (n: string) => string | undefined },
  userId: number
): Promise<void> {
  const pg = client as unknown as PoolClient;
  const removed: string[] = [];
  if (saveDomain === 'inventory') {
    if ('stock' in changes) {
      delete changes.stock;
      removed.push('stock');
    }
    if ('storedBatteries' in changes) {
      delete changes.storedBatteries;
      removed.push('storedBatteries');
    }
  } else if (saveDomain === 'servers') {
    changes.placedRacks = await loadUserPlacedRacksWithSlots(pg, uid);
    removed.push('placedRacks(replaced_from_db)');
    if ('stock' in changes) {
      delete changes.stock;
      removed.push('stock');
    }
    if ('storedBatteries' in changes) {
      delete changes.storedBatteries;
      removed.push('storedBatteries');
    }
  } else if (saveDomain === 'workshop') {
    changes.workshopSlots = await loadWorkshopSlotsArrayForMerge(client, uid);
    removed.push('workshopSlots(replaced_from_db)');
    if ('stock' in changes) {
      delete changes.stock;
      removed.push('stock');
    }
    if ('storedBatteries' in changes) {
      delete changes.storedBatteries;
      removed.push('storedBatteries');
    }
  }
  if (removed.length > 0) {
    logLegacySaveStructured({
      event: 'legacy_savegame_slice_neutralized',
      userId,
      requestId: requestIdFrom(req),
      fields: removed,
      route: String(req.originalUrl || '').slice(0, 400),
      origin: originFrom(req),
      adminOverride: false,
      saveDomain,
      timestamp: new Date().toISOString()
    });
  }
}
