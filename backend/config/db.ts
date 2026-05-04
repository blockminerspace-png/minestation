import pkg from 'pg';
import { buildPoolConfig } from './database.js';

const { Pool } = pkg;

const pool = new Pool(buildPoolConfig());

export const query = (text: string, params?: unknown[]) => pool.query(text, params);
export const getClient = () => pool.connect();
export const connect = () => pool.connect();

export default pool;
