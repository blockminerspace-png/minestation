import pkg from 'pg';
const { Pool } = pkg;
import 'dotenv/config';

const poolMax = Math.min(50, Math.max(5, parseInt(process.env.PG_POOL_MAX || '20', 10) || 20));

const poolConfig = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    max: poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  }
  : {
    user: 'postgres',
    host: 'localhost',
    database: 'minestation',
    password: '32638621',
    port: 5432,
    max: poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  };

const pool = new Pool(poolConfig);

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export const connect = () => pool.connect();

export default pool;

