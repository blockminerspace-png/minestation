/**
 * Logs append-only no MongoDB (opcional via `MONGODB_URI`).
 * Contrato de campos por coleção: `backend/docs/MONGO_LOG_CONTRACT.md`.
 */
import { getGenesisMongo } from './genesisStack/init.js';

/** Base de dados Mongo só para logs / analytics (não é fonte de verdade). */
export const MONGO_LOG_DB = process.env.GENESIS_MONGO_DB?.trim() || 'genesis_logs';

export const MONGO_COLLECTIONS = {
  actionLogs: 'action_logs',
  eventHistory: 'event_history',
  analyticsEvents: 'analytics_events',
  /** Auditoria de jogo (ex.: caixas, roleta, depósitos) — antes em Postgres `game_activity_logs`. */
  gameActivity: 'game_activity_logs',
} as const;

export type MongoLogCollection = (typeof MONGO_COLLECTIONS)[keyof typeof MONGO_COLLECTIONS] | string;

/**
 * Escrita fire-and-forget (não bloqueia o pedido HTTP).
 * `collection`: use `MONGO_COLLECTIONS.*` ou nome próprio.
 */
export function mongoLogInsert(collection: MongoLogCollection, doc: Record<string, unknown>): void {
  const client = getGenesisMongo();
  if (!client) return;
  const payload = { ...doc, at: new Date() };
  void client
    .db(MONGO_LOG_DB)
    .collection(collection)
    .insertOne(payload)
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[MongoLogs] insert falhou:', collection, msg);
    });
}

/**
 * Ação de utilizador (login, P2P, registo, etc.).
 * Não incluir palavras-passe, cookies, JWT nem dados de cartão — só ids e métricas agregadas.
 */
export function logUserAction(
  userId: number | null,
  action: string,
  meta: Record<string, unknown> = {}
): void {
  mongoLogInsert(MONGO_COLLECTIONS.actionLogs, {
    userId,
    action,
    ...meta,
  });
}

/** Evento de sistema / jogo (tick, job, erro controlado). */
export function logGameEvent(kind: string, meta: Record<string, unknown> = {}): void {
  mongoLogInsert(MONGO_COLLECTIONS.eventHistory, { kind, ...meta });
}

/** Métricas de analytics (agregações leves). */
export function logAnalyticsEvent(name: string, meta: Record<string, unknown> = {}): void {
  mongoLogInsert(MONGO_COLLECTIONS.analyticsEvents, { name, ...meta });
}

export type GameActivityLogRow = {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  createdAt: number;
};

/**
 * Grava um evento de atividade de jogo (auditoria admin). Exige Mongo configurado.
 */
export async function appendGameActivityLogMongo(
  userId: number,
  action: string,
  meta: Record<string, unknown>
): Promise<void> {
  const client = getGenesisMongo();
  if (!client) {
    console.warn('[MongoLogs] appendGameActivityLogMongo: MONGODB_URI ausente; evento não gravado:', action);
    return;
  }
  const safeAction = String(action).slice(0, 200);
  let metaObj: Record<string, unknown> = {};
  try {
    metaObj = JSON.parse(JSON.stringify(meta ?? {})) as Record<string, unknown>;
  } catch {
    metaObj = {};
  }
  const at = new Date();
  const created_at = at.getTime();
  try {
    await client.db(MONGO_LOG_DB).collection(MONGO_COLLECTIONS.gameActivity).insertOne({
      userId,
      action: safeAction,
      meta: metaObj,
      at,
      created_at
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MongoLogs] game_activity insert falhou:', safeAction, msg);
  }
}

/**
 * Lista eventos de atividade para o painel admin (`GET /api/admin/user-activity`).
 */
export async function listGameActivityLogsMongo(userId: number, limit: number): Promise<GameActivityLogRow[]> {
  const client = getGenesisMongo();
  if (!client) return [];
  const lim = Math.min(500, Math.max(1, Math.floor(limit)));
  try {
    const docs = await client
      .db(MONGO_LOG_DB)
      .collection(MONGO_COLLECTIONS.gameActivity)
      .find({ userId })
      .sort({ at: -1 })
      .limit(lim)
      .toArray();
    return docs.map((d) => {
      const id = d._id != null ? String(d._id) : '';
      const at = d.at instanceof Date ? d.at : d.at != null ? new Date(String(d.at)) : new Date();
      const createdAt =
        typeof d.created_at === 'number' && Number.isFinite(d.created_at) ? d.created_at : at.getTime();
      return {
        id,
        action: String(d.action ?? ''),
        meta: (d.meta && typeof d.meta === 'object' && !Array.isArray(d.meta) ? d.meta : {}) as Record<
          string,
          unknown
        >,
        createdAt
      };
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MongoLogs] listGameActivityLogsMongo:', msg);
    return [];
  }
}
