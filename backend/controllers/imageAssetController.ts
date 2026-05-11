import fs from 'node:fs';
import path from 'node:path';
import cluster from 'node:cluster';
import type { Express, Request, RequestHandler, Response } from 'express';
import express from 'express';
import multer from 'multer';
import { prisma } from '../config/prisma.js';
import { sendIfPrismaHttpError } from '../utils/prismaHttpResponse.js';
import { compressMediaFileInPlace } from '../lib/compressMediaAsset.js';
import {
  IMG_ADMIN_TARGET_SUBFOLDER_SET,
  buildStoredUploadFilename,
  organizeLooseFilesInImgRoot,
  parseDataUrlImageStrict,
  resolveLegacyFlatImgFilePath,
  sanitizeOriginalNameBase
} from '../models/imageAssetModel.js';

/** Extensões + mimetypes aceites no upload admin (multipart). */
const ADMIN_UPLOAD_ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const ADMIN_UPLOAD_ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif'
]);
/** Limite generoso para arte de itens (multipart, sem inflar via base64). */
const ADMIN_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

export type ImageAssetControllerDeps = {
  isAdmin: RequestHandler;
  imgDir: string;
  uploadsDir: string;
};

/** GET/HEAD `/img/ficheiro.ext` sem subpasta: procura em uploads e subpastas (URLs antigas na BD). */
function createLegacyFlatImgMiddleware(uploadsDir: string, imgDir: string): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const raw = String(req.originalUrl || req.url || '').split('?')[0];
    const seg = raw.replace(/^\/img\/?/i, '').replace(/^\/+/, '');
    if (!seg) return next();
    const abs = resolveLegacyFlatImgFilePath(uploadsDir, imgDir, seg);
    if (!abs) return next();
    res.sendFile(abs, (err) => {
      if (err) next(err);
    });
  };
}

export function mountImageStaticMiddleware(app: Express, uploadsDir: string, imgDir: string): void {
  app.use('/img', createLegacyFlatImgMiddleware(uploadsDir, imgDir));
  app.use('/img', express.static(uploadsDir));
  app.use('/img', express.static(imgDir));
}

/**
 * Organiza ficheiros soltos na raiz de `img/` no arranque (um worker em cluster).
 */
export function runImageRootStartupOrganizeIfEnabled(imgDir: string): void {
  try {
    const skip = String(process.env.SKIP_IMG_AUTO_ORGANIZE || '') === '1';
    const soleProcessOrFirstClusterWorker =
      !cluster.isWorker || (cluster.worker != null && cluster.worker.id === 1);
    if (skip || !soleProcessOrFirstClusterWorker) return;
    const n = organizeLooseFilesInImgRoot(imgDir);
    if (n > 0) {
      console.log(`[img] Organização automática: ${n} ficheiro(s) na raiz de img/ movidos para subpastas.`);
    }
  } catch (e) {
    console.warn('[img] organizeLooseFilesInImgRoot:', e instanceof Error ? e.message : String(e));
  }
}

function createAdminAdMulter(uploadsDir: string): ReturnType<typeof multer> {
  const adStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, 'ad-' + uniqueSuffix + ext);
    }
  });
  return multer({
    storage: adStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['.png', '.jpg', '.jpeg', '.gif'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.includes(ext)) cb(null, true);
      else cb(new Error('Formato de arquivo não permitido'));
    }
  });
}

/**
 * Multer dedicado ao upload admin de imagens de itens. Recebe `multipart/form-data`
 * directamente em disco — sem passar por base64 / JSON — para escapar ao limite
 * global de `express.json({ limit: '5mb' })` que estava a derrubar uploads >3.6 MB.
 *
 * Aceita também o campo de texto `assetFolder` (subpasta canónica).
 */
function createAdminImageMulter(uploadsDir: string): ReturnType<typeof multer> {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(uploadsDir, { recursive: true });
      } catch {
        /* idempotente */
      }
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      const safeBase = sanitizeOriginalNameBase(file.originalname);
      cb(null, buildStoredUploadFilename(safeBase, ext));
    }
  });
  return multer({
    storage,
    limits: { fileSize: ADMIN_UPLOAD_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const mime = String(file.mimetype || '').toLowerCase();
      if (ADMIN_UPLOAD_ALLOWED_EXT.has(ext) && ADMIN_UPLOAD_ALLOWED_MIME.has(mime)) {
        cb(null, true);
      } else {
        cb(new Error('Formato de imagem inválido. Usa PNG, JPG, WEBP ou GIF.'));
      }
    }
  });
}

export function registerImageAssetRoutes(app: Express, deps: ImageAssetControllerDeps): void {
  const { isAdmin, imgDir, uploadsDir } = deps;
  const uploadAd = createAdminAdMulter(uploadsDir);
  const uploadAdminImage = createAdminImageMulter(uploadsDir);

  app.post('/api/upload-image', async (req: Request, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    try {
      const adm = await prisma.users.findUnique({
        where: { id: Number(req.userId) },
        select: { is_admin: true }
      });
      if (!Number(adm?.is_admin ?? 0)) {
        return res.status(403).json({ error: 'Apenas administradores podem usar este upload.' });
      }
    } catch (e) {
      if (sendIfPrismaHttpError(res, e, 'POST /api/upload-image admin check')) return;
      return res.status(500).json({ error: 'Falha ao verificar permissões.' });
    }
    const { dataUrl, originalName, assetFolder } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Missing dataUrl' });
    }
    const parsed = parseDataUrlImageStrict(dataUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Only PNG/GIF/JPEG data URLs are allowed' });
    }
    const { buffer, ext } = parsed;
    const safeBase = sanitizeOriginalNameBase(originalName);
    const filename = buildStoredUploadFilename(safeBase, ext);
    let destDir = uploadsDir;
    let publicPath = `/img/${filename}`;
    if (
      assetFolder &&
      typeof assetFolder === 'string' &&
      IMG_ADMIN_TARGET_SUBFOLDER_SET.has(assetFolder) &&
      req.userId
    ) {
      try {
        const adm = await prisma.users.findUnique({
          where: { id: Number(req.userId) },
          select: { is_admin: true }
        });
        if (Number(adm?.is_admin ?? 0) !== 0) {
          destDir = path.join(imgDir, assetFolder);
          fs.mkdirSync(destDir, { recursive: true });
          publicPath = `/img/${assetFolder}/${filename}`;
        }
      } catch {
        /* mantém uploads/ */
      }
    }
    const filePath = path.join(destDir, filename);
    try {
      fs.writeFileSync(filePath, buffer);
    } catch {
      return res.status(500).json({ error: 'Failed to write file' });
    }
    try {
      await compressMediaFileInPlace(filePath);
    } catch {
      /* best-effort */
    }
    return res.json({ path: publicPath });
  });

  /**
   * Upload admin de imagens de itens / arte (Mercado de Hardware, Editor, etc.).
   *
   * Endpoint multipart (não JSON) para evitar o tecto de 5 MB do body parser e
   * para nunca usar 500 genérico em erros de validação.
   *
   *   Request:  multipart/form-data  field `image`  + opcional `assetFolder`
   *   Sucesso:  { ok: true, path: '/img/<sub>/<file>', url: same }
   *   Erros:    400 (mime/extensão inválida ou ficheiro em falta)
   *             401 (sem sessão), 403 (não-admin)
   *             413 (ficheiro maior que ADMIN_UPLOAD_MAX_BYTES)
   *             500 (erro IO real ao gravar)
   */
  app.post('/api/admin/upload-image', isAdmin, (req: Request, res: Response) => {
    uploadAdminImage.single('image')(req, res, async (err: unknown) => {
      const uidLog = req.userId != null ? String(req.userId) : 'anon';
      if (err) {
        const e = err as { code?: string; message?: string };
        if (e?.code === 'LIMIT_FILE_SIZE') {
          console.warn('[AdminImageUpload] payload too large', { uid: uidLog });
          return res.status(413).json({ ok: false, error: 'Imagem muito grande (máx. 15 MB).' });
        }
        console.warn('[AdminImageUpload] multer error', { uid: uidLog, msg: e?.message });
        return res
          .status(400)
          .json({ ok: false, error: e?.message || 'Formato de imagem inválido.' });
      }
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'Nenhum ficheiro enviado.' });
      }
      const rawFolder = typeof req.body?.assetFolder === 'string' ? req.body.assetFolder : '';
      const targetSubfolder =
        rawFolder && IMG_ADMIN_TARGET_SUBFOLDER_SET.has(rawFolder) ? rawFolder : '';
      const tmpAbs = req.file.path;
      const filename = req.file.filename;
      let finalAbs = tmpAbs;
      let publicPath = `/img/${filename}`;
      if (targetSubfolder) {
        try {
          const destDir = path.join(imgDir, targetSubfolder);
          fs.mkdirSync(destDir, { recursive: true });
          const destAbs = path.join(destDir, filename);
          fs.renameSync(tmpAbs, destAbs);
          finalAbs = destAbs;
          publicPath = `/img/${targetSubfolder}/${filename}`;
        } catch (moveErr) {
          console.error('[AdminImageUpload] move to subfolder failed', {
            uid: uidLog,
            targetSubfolder,
            err: moveErr instanceof Error ? moveErr.message : String(moveErr)
          });
          /** Mantém em uploads/ — preferimos entregar a imagem do que falhar. */
        }
      }
      try {
        await compressMediaFileInPlace(finalAbs);
      } catch {
        /* best-effort */
      }
      console.log('[AdminImageUpload] ok', {
        uid: uidLog,
        size: req.file.size,
        mime: req.file.mimetype,
        path: publicPath
      });
      return res.json({ ok: true, path: publicPath, url: publicPath });
    });
  });

  app.post('/api/admin/upload-ad', isAdmin, (req: Request, res: Response) => {
    console.log('[Upload] Starting upload process...');
    uploadAd.single('image')(req, res, async (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : 'Erro no upload';
        console.error('[Upload] Multer Error:', err);
        return res.status(400).json({ error: 'Erro no upload: ' + msg });
      }
      if (!req.file) {
        console.log('[Upload] No file received');
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }
      console.log('[Upload] Success:', req.file.filename);
      const imageUrl = `/img/${req.file.filename}`;
      const absAd = path.join(uploadsDir, req.file.filename);
      try {
        await compressMediaFileInPlace(absAd);
      } catch {
        /* best-effort */
      }
      res.json({ ok: true, imageUrl });
    });
  });
}
