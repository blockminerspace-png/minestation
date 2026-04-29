import db from './db.js';

async function backfill() {
  try {
    console.log('Starting backfill...');
    
    // Find all users who have the 'genesis' access level either as primary or in secondary roles
    const usersRes = await db.query(`
      SELECT DISTINCT user_id 
      FROM (
        SELECT user_id FROM user_access_levels WHERE access_level_id = 'genesis'
        UNION
        SELECT id as user_id FROM users WHERE access_level_id = 'genesis'
      ) AS all_genesis_users
    `);
    
    console.log(`Found ${usersRes.rows.length} users with genesis access level.`);
    
    let added = 0;
    const roomID = 'room_1765936323521';
    
    for (const row of usersRes.rows) {
      const res = await db.query(`
        INSERT INTO user_rig_rooms (user_id, room_id, purchased_at, unlocked_slots)
        VALUES ($1, $2, $3, 0)
        ON CONFLICT (user_id, room_id) DO NOTHING
      `, [row.user_id, roomID, Date.now()]);
      
      if (res.rowCount > 0) {
        added++;
        console.log(`Granted room ${roomID} to user ID ${row.user_id}`);
      }
    }
    
    console.log(`Backfill complete. Added ownership for ${added} users.`);
    process.exit(0);
  } catch (e) {
    console.error('Backfill failed:', e);
    process.exit(1);
  }
}

backfill();
