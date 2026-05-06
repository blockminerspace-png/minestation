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

export function registerImageAssetRoutes(app: Express, deps: ImageAssetControllerDeps): void {
  const { isAdmin, imgDir, uploadsDir } = deps;
  const uploadAd = createAdminAdMulter(uploadsDir);

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
