import fs from 'fs';
import 'dotenv/config';
import pool from './backend/db.js';

const dataFile = process.argv[2] || '/tmp/backup.json';

if (!fs.existsSync(dataFile)) {
    console.error(`File not found: ${dataFile}`);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const tableOrder = [
  'users', 'referrals', 'mining_coins', 'access_levels', 'upgrades', 'upgrade_compat_racks',
  'loot_boxes', 'loot_box_items', 'system_news', 'season_passes', 'season_purchases',
  'game_states', 'settings', 'stock', 'unopened_boxes', 'stored_batteries',
  'placed_racks', 'rack_slots', 'rack_multiplier_slots', 'player_listings', 'nft_items',
  'sessions', 'coin_balances', 'coin_withdrawals',
  'admin_upgrades', 'admin_upgrade_items', 'admin_upgrade_boxes', 'admin_upgrade_passes',
  'admin_upgrade_coins', 'admin_upgrade_purchases',
  'player_news_submissions', 'rig_rooms', 'user_rig_rooms', 'workshop_slots',
  'player_claimed_boxes', 'daily_actions', 'promo_codes', 'promo_code_redemptions',
  'economy_settings', 'withdrawal_requests', 'device_fingerprint_logs'
];

async function ensureColumns(client, table, sampleRow) {
    const columns = Object.keys(sampleRow);
    for (const col of columns) {
        try {
            await client.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
            // We use TEXT as a safe default for unknown columns, or we could try to guess.
            // But BIGINT is safer for columns ending in _at.
            if (col.endsWith('_at') || col.endsWith('_time')) {
                 await client.query(`ALTER TABLE "${table}" ALTER COLUMN "${col}" TYPE BIGINT USING "${col}"::BIGINT`);
            }
        } catch (e) {
            // Ignore if already exists or type mismatch (we tried our best)
        }
    }
}

async function importTable(table, rows) {
    if (!rows || rows.length === 0) {
        console.log(`- ${table}: skipping (empty)`);
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Ensure all columns from JSON exist in DB
        await ensureColumns(client, table, rows[0]);
        
        await client.query('SET session_replication_role = replica;');
        await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
        
        const columns = Object.keys(rows[0]);
        const batchSize = 100;
        
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const values = [];
            const placeholders = [];
            
            batch.forEach((row, bIdx) => {
                const rowPlaceholders = [];
                columns.forEach((col, cIdx) => {
                    const pIdx = bIdx * columns.length + cIdx + 1;
                    rowPlaceholders.push(`$${pIdx}`);
                    let val = row[col];
                    if (val !== null && typeof val === 'object') val = JSON.stringify(val);
                    values.push(val);
                });
                placeholders.push(`(${rowPlaceholders.join(',')})`);
            });
            
            const sql = `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`;
            await client.query(sql, values);
        }
        
        await client.query('SET session_replication_role = DEFAULT;');
        await client.query('COMMIT');
        console.log(`✅ ${table}: ${rows.length} rows imported`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`❌ Error in ${table}: ${e.message}`);
        throw e; // Stop execution on error to ensure consistency
    } finally {
        client.release();
    }
}

async function run() {
    console.log('Starting Production Data Import...');
    try {
        for (const table of tableOrder) {
            await importTable(table, data[table]);
        }
        
        console.log('\nFinalizing: Syncing sequences...');
        const client = await pool.connect();
        try {
            const seqTables = ['users', 'referrals', 'loot_box_items', 'game_states'];
            for (const t of seqTables) {
                try {
                    await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1))`);
                } catch (e) {}
            }
        } finally {
            client.release();
        }
        
        console.log('Done! All data imported successfully.');
    } catch (e) {
        console.error('CRITICAL ERROR: Import aborted.');
        process.exit(1);
    } finally {
        pool.end();
    }
}

run();
