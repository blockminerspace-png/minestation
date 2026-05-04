/**
 * Carrega variáveis de ambiente antes do resto do servidor.
 * `import 'dotenv/config'` só lê `.env` no cwd — ao correr `node server.js` dentro de `backend/`
 * ou no Docker com WORKDIR `/app/backend`, o `.env` na raiz do repo era ignorado.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1) Raiz do repositório (../.env) — típico em `npm start` na raiz ou compose com volume
dotenv.config({ path: path.join(__dirname, '..', '.env') });
// 2) backend/.env sobrepõe (deploy local só com pasta backend)
dotenv.config({ path: path.join(__dirname, '.env'), override: true });
