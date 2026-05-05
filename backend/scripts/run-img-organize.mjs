/**
 * CLI: reorganiza ficheiros de media na raiz de backend/img/ (mesma lógica do arranque do servidor).
 * Requer build TypeScript: npm run build:ts  (ou npm run build:app)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { organizeLooseFilesInImgRoot } from '../dist/models/imageAssetModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG = path.resolve(__dirname, '../img');
const n = organizeLooseFilesInImgRoot(IMG);
console.log(`[img:classify] movidos ${n} ficheiro(s) para subpastas de img/`);
