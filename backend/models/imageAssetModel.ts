import fs from 'node:fs';
import path from 'node:path';

/** Pastas canónicas sob `backend/img/` (organização automática na raiz). */
export const IMG_CANONICAL_SUBFOLDERS = [
  'miner',
  'moedas',
  'carregadores',
  'baterias',
  'favicon',
  'uploads'
] as const;

export type ImgCanonicalSubfolder = (typeof IMG_CANONICAL_SUBFOLDERS)[number];

/** Destinos permitidos em `POST /api/upload-image` com `assetFolder` (admin). */
export const IMG_ADMIN_TARGET_SUBFOLDERS = ['miner', 'moedas', 'carregadores', 'baterias', 'favicon'] as const;

export type ImgAdminTargetSubfolder = (typeof IMG_ADMIN_TARGET_SUBFOLDERS)[number];

export const IMG_ADMIN_TARGET_SUBFOLDER_SET = new Set<string>(IMG_ADMIN_TARGET_SUBFOLDERS);

/** Ordem para resolver URLs antigas só com o nome do ficheiro: `/img/123_foo.png` → disco em `uploads/` ou subpastas. */
export const IMG_FLAT_NAME_LOOKUP_SUBFOLDERS: readonly ImgCanonicalSubfolder[] = [
  'uploads',
  'miner',
  'moedas',
  'carregadores',
  'baterias',
  'favicon'
];

const FLAT_MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);

const MOVEABLE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.webm',
  '.mov',
  '.ico'
]);

/**
 * Decide a subpasta destino com base no nome do ficheiro (heurística).
 */
export function classifyImageSubfolder(filename: string): ImgCanonicalSubfolder {
  const lower = filename.toLowerCase();
  if (lower.startsWith('ad-')) return 'uploads';
  if (lower.startsWith('support-') || lower.startsWith('support-reply-')) return 'uploads';
  if (
    lower.includes('genesis-miner-logo') ||
    lower.includes('genesis_miner_logo') ||
    (lower.includes('favicon') && MOVEABLE_EXT.has(path.extname(lower)))
  ) {
    return 'favicon';
  }
  if (lower.includes('carregador')) return 'carregadores';
  const batteryLike =
    lower.includes('connected_battery') ||
    lower.includes('battery_pack') ||
    (lower.includes('bateria') && !lower.includes('carregador')) ||
    lower.includes('kwh') ||
    (/\d+wh/.test(lower) && /\.(png|gif|jpe?g|webp)$/i.test(lower));
  if (batteryLike && !lower.includes('gpu') && !lower.includes('video_card')) return 'baterias';
  if (lower.includes('usdc') || lower.includes('whale')) return 'moedas';
  return 'miner';
}

/**
 * Move ficheiros de media ainda na **raiz** de `imgRootDir` para a subpasta adequada.
 * @returns número de ficheiros movidos
 */
export function organizeLooseFilesInImgRoot(imgRootDir: string): number {
  let moved = 0;
  for (const name of fs.readdirSync(imgRootDir)) {
    if (name.startsWith('.')) continue;
    const src = path.join(imgRootDir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(src);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (!MOVEABLE_EXT.has(ext)) continue;
    const sub = classifyImageSubfolder(name);
    const destDir = path.join(imgRootDir, sub);
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch {
      /* ignore */
    }
    const dest = path.join(destDir, name);
    if (path.dirname(src) === destDir) continue;
    try {
      fs.renameSync(src, dest);
      moved += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[imageAssetModel] não moveu', name, msg);
    }
  }
  return moved;
}

/** Data URL PNG/GIF/JPEG → buffer + extensão de ficheiro. */
export function parseDataUrlImageStrict(dataUrl: string): { buffer: Buffer; ext: string } | null {
  const match = dataUrl.match(/^data:(image\/png|image\/gif|image\/jpeg);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const b64 = match[2];
  const ext = mime === 'image/png' ? '.png' : mime === 'image/gif' ? '.gif' : '.jpg';
  try {
    return { buffer: Buffer.from(b64, 'base64'), ext };
  } catch {
    return null;
  }
}

export function sanitizeOriginalNameBase(originalName: unknown): string {
  const raw =
    originalName != null && typeof originalName !== 'object' ? String(originalName) : 'image';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'image';
}

export function buildStoredUploadFilename(safeBase: string, ext: string): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeBase}${ext}`;
}

/**
 * Caminho absoluto para pedidos legados `/img/<basename>` (sem subpasta), após ficheiros terem sido
 * movidos para `miner/`, etc. Retorna null se não existir.
 */
export function resolveLegacyFlatImgFilePath(
  uploadsDir: string,
  imgDir: string,
  flatSegment: string
): string | null {
  if (!flatSegment || flatSegment.includes('/') || flatSegment.includes('..')) return null;
  const ext = path.extname(flatSegment).toLowerCase();
  if (!FLAT_MEDIA_EXT.has(ext)) return null;
  const basename = path.basename(flatSegment);
  if (basename !== flatSegment) return null;
  for (const sub of IMG_FLAT_NAME_LOOKUP_SUBFOLDERS) {
    const dir = sub === 'uploads' ? uploadsDir : path.join(imgDir, sub);
    const fp = path.join(dir, basename);
    try {
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return path.resolve(fp);
    } catch {
      /* continua */
    }
  }
  return null;
}
