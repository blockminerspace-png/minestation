import db from './db.js';
import fs from 'fs';

async function diagnoseRooms() {
  try {
    const res = await db.query('SELECT * FROM rig_rooms');
    fs.writeFileSync('rooms_output.json', JSON.stringify(res.rows, null, 2));
    console.log('Results written to rooms_output.json');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
diagnoseRooms();
