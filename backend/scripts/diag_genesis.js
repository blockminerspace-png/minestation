import db from '../dist/config/db.js';

const GENESIS_BUNDLE_ID = '53f0c699-0471-4e65-a147-17064e3aafe0';

async function diagnose() {
  try {
    console.log('--- Genesis Bundle Items ---');
    const itemsRes = await db.query('SELECT * FROM admin_upgrade_items WHERE upgrade_id = $1', [GENESIS_BUNDLE_ID]);
    console.log(itemsRes.rows);

    console.log('--- Genesis Bundle Boxes ---');
    const boxesRes = await db.query('SELECT * FROM admin_upgrade_boxes WHERE upgrade_id = $1', [GENESIS_BUNDLE_ID]);
    console.log(boxesRes.rows);

    console.log('--- Genesis Bundle Passes ---');
    const passesRes = await db.query('SELECT * FROM admin_upgrade_passes WHERE upgrade_id = $1', [GENESIS_BUNDLE_ID]);
    console.log(passesRes.rows);

    console.log('--- Genesis Bundle Coins ---');
    const coinsRes = await db.query('SELECT * FROM admin_upgrade_coins WHERE upgrade_id = $1', [GENESIS_BUNDLE_ID]);
    console.log(coinsRes.rows);

    console.log('--- Admin Upgrade Data ---');
    const upRes = await db.query('SELECT * FROM admin_upgrades WHERE id = $1', [GENESIS_BUNDLE_ID]);
    console.log(upRes.rows[0]);

  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

diagnose();
