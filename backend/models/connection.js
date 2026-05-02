/** Re-export do pool partilhado — os modelos devem importar daqui em vez de acoplarem a `server.js`. */
export { default as pool, query, getClient, connect } from '../db.js';
