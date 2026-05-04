import db from '../dist/config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function diagnoseRooms() {
  try {
    const res = await db.query('SELECT * FROM rig_rooms');
    const out = path.join(__dirname, '..', 'data', 'rooms_output.json');
    fs.writeFileSync(out, JSON.stringify(res.rows, null, 2));
    console.log('Results written to', out);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
diagnoseRooms();
