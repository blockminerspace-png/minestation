/**
 * Neutralização de `POST /api/save-game` (e fusão de slices) para jogadores normais:
 * campos críticos não podem ser escritos a partir do payload do cliente.
 */
import type { PoolClient } from 'pg';
import type { SaveGameQueryClient } from './sqlTransaction.js';
import { loadUserPlacedRacksWithSlots } from './serverRoomPersistence.js';

/**
 * Mantém topologia de rigs da BD (fonte de verdade) mas aplica do cliente os campos
 * operáveis em jogo que o slice `save-servers` envia (ex.: interruptor, moeda por rig).
 */
export function overlayPlacedRacksDbWithClientRuntime(dbRacks: unknown[], clientRacks: unknown): unknown[] {
  if (!Array.isArray(dbRacks)) return [];
  const clientList = Array.isArray(clientRacks) ? clientRacks : [];
  const clientById = new Map<string, Record<string, unknown>>();
  for (const raw of clientList) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.id !== 'string') continue;
    const id = rec.id.trim();
    if (!id) continue;
    clientById.set(id, rec);
  }
  return dbRacks.map((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const db = raw as Record<string, unknown>;
    if (typeof db.id !== 'string') return raw;
    const id = db.id.trim();
    if (!id) return raw;
    const c = clientById.get(id);
    if (!c) return raw;
    const next: Record<string, unknown> = { ...db };
    if ('isOn' in c) next.isOn = Boolean(c.isOn);
    if ('selectedCoinId' in c) {
      const sc = c.selectedCoinId;
      next.selectedCoinId =
        sc === null || sc === undefined || sc === '' ? undefined : String(sc);
    }
    return next;
  });
}

export type LegacySaveGameBarrierResult =
  | { mode: 'allow' }
  | { mode: 'reject'; status: 409 | 422; message: string; code: string; fields: string[] };

function readLegacySaveGamePlayerPolicy(): string {
  return String(process.env.LEGACY_SAVEGAME_PLAYER_POLICY || 'strip')
    .trim()
    .toLowerCase();
}

/** Chaves de topo em `changes` que nunca devem ser persistidas por jogador normal (save completo). */
const CRITICAL_TOP_KEYS = new Set([
  'stock',
  'storedBatteries',
  'placedRacks',
  'unopenedBoxes',
  'coinBalances',
  'racks',
  'servers',
  'inventory',
  'wallet',
  'balances',
  'production',
  'hashRate',
  'minedBalances',
  /** Campos frequentes em payloads legados de rig/bateria que não podem ser escritos pelo cliente. */
  'batteryId',
  'rackId',
  'slotId'
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
  'batteryId',
  'rackId',
  'slotId'
]);

export type LegacySaveLogPayload = {
  event: 'legacy_savegame_critical_rejected' | 'legacy_savegame_critical_ignored' | 'legacy_savegame_slice_neutralized';
  userId: number;
  requestId: string | null;
  fields: string[];
  route: string;
  origin: string;
  adminOverride: boolean;
  saveDomain: '' | 'inventory' | 'servers';
  timestamp: string;
};

export function logLegacySaveStructured(payload: LegacySaveLogPayload): void {
  console.log(JSON.stringify(payload));
}

function readSaveDomainHeader(req: { headers?: unknown; originalUrl?: string }): '' | 'inventory' | 'servers' {
  const h = req.headers as Record<string, unknown> | undefined;
  const raw = String(h?.['x-game-save-domain'] ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'inventory' || raw === 'servers') return raw;
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

  if (readLegacySaveGamePlayerPolicy() === 'reject') {
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
  saveDomain: 'inventory' | 'servers',
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
    const clientPlacedRacks = changes.placedRacks;
    const dbRacks = await loadUserPlacedRacksWithSlots(pg, uid);
    changes.placedRacks = overlayPlacedRacksDbWithClientRuntime(dbRacks, clientPlacedRacks);
    removed.push('placedRacks(db_topology+client_runtime)');
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
