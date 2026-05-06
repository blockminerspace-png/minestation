import { getGenesisMongo } from './genesisStack/init.js';

/** Base de dados Mongo só para logs / analytics (não é fonte de verdade). */
export const MONGO_LOG_DB = process.env.GENESIS_MONGO_DB?.trim() || 'genesis_logs';

export const MONGO_COLLECTIONS = {
  actionLogs: 'action_logs',
  eventHistory: 'event_history',
  analyticsEvents: 'analytics_events',
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

/** Ação de utilizador (login, compra, etc.). */
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
