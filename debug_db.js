const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/minestation'
});

async function checkCodes() {
    try {
        const codesRes = await pool.query("SELECT code, loot_box_id, upgrade_id, admin_upgrade_id, type FROM promo_codes WHERE code IN ('F607UUH8', 'VES51Q64')");
        console.log('--- PROMO CODES ---');
        console.table(codesRes.rows);

        const boxesRes = await pool.query("SELECT id, name FROM loot_boxes WHERE name LIKE '%Arbam%'");
        console.log('--- LOOT BOXES ---');
        console.table(boxesRes.rows);

        const redemptionsRes = await pool.query("SELECT r.code, r.user_id, u.username, r.reward_granted FROM promo_code_redemptions r JOIN users u ON r.user_id = u.id WHERE r.code IN ('F607UUH8', 'VES51Q64')");
        console.log('--- REDEMPTIONS ---');
        console.table(redemptionsRes.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkCodes();
