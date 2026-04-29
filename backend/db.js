import pkg from 'pg';
const { Pool } = pkg;
import 'dotenv/config';

const poolConfig = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 2000,
  }
  : {
    user: 'postgres',
    host: 'localhost',
    database: 'minestation',
    password: '32638621',
    port: 5432,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 2000,
  };

const pool = new Pool(poolConfig);

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export const connect = () => pool.connect();

export default pool;

