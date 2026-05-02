import pkg from 'pg';
const { Pool } = pkg;
import 'dotenv/config';
import { buildPoolConfig } from './config/database.js';

const pool = new Pool(buildPoolConfig());

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export const connect = () => pool.connect();

export default pool;
