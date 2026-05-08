import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { getBackendRootFromModelsFile } from '../lib/backendRoot.js';

type DbModule = {
  default: Pool;
  query: Pool['query'];
  getClient: () => Promise<PoolClient>;
  connect: () => Promise<PoolClient>;
};

const dbUrl = pathToFileURL(
  path.join(getBackendRootFromModelsFile(import.meta.url), 'dist', 'config', 'db.js')
).href;

const dbMod: DbModule = (await import(dbUrl)) as DbModule;

export const pool = dbMod.default;
export const query = dbMod.query;
export const getClient = dbMod.getClient;
export const connect = dbMod.connect;

export type { Pool, PoolClient };
