/**
 * Carrega variáveis de ambiente antes do resto do servidor.
 * Compilado para `dist/utils/loadEnv.js` — `__dirname` aponta para `dist/utils`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(backendRoot, '..', '.env') });
dotenv.config({ path: path.join(backendRoot, '.env'), override: true });
