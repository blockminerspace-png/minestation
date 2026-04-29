import pkg from 'pg';
const { Pool } = pkg;

const poolConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'minestation',
    password: '32638621',
    port: 5432,
};

const pool = new Pool(poolConfig);

const fixSchema = async () => {
    const client = await pool.connect();
    try {
        console.log('Fixing schema...');
        await client.query('BEGIN');

        // Create referral_models table
        await client.query(`
            CREATE TABLE IF NOT EXISTS referral_models (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                sender_reward_usdc DOUBLE PRECISION DEFAULT 0,
                receiver_reward_usdc DOUBLE PRECISION DEFAULT 0,
                sender_loot_box_id TEXT,
                receiver_loot_box_id TEXT,
                deposit_commission_percent DOUBLE PRECISION DEFAULT 0,
                hardware_commission_percent DOUBLE PRECISION DEFAULT 0,
                black_market_commission_percent DOUBLE PRECISION DEFAULT 0,
                is_active INTEGER DEFAULT 1
            );
        `);
        console.log('referral_models table ensured.');

        // Create access_level_referral_models table
        await client.query(`
            CREATE TABLE IF NOT EXISTS access_level_referral_models (
                access_level_id TEXT PRIMARY KEY REFERENCES access_levels(id),
                referral_model_id INTEGER REFERENCES referral_models(id)
            );
        `);
        console.log('access_level_referral_models table ensured.');

        await client.query('COMMIT');
        console.log('Schema fix completed successfully.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Schema fix failed:', e);
    } finally {
        client.release();
        pool.end();
    }
};

fixSchema();
