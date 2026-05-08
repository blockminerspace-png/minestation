import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Express } from 'express';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Otimização com fidelidade visual alta:
 * - PNG/WebP: recompressão sem perda de pixels (nível PNG alto; WebP lossless).
 * - JPEG: mozjpeg q=94 só substitui se o ficheiro ficar menor (evita piorar uploads já otimizados).
 * - GIF: tenta recompressão com ffmpeg + palette (preserva animação); só substitui se menor.
 * - MP4/WebM/MOV: se `ffmpeg` existir no PATH, H.264 CRF 20 (muito próximo do lossless); só substitui se menor.
 */
export async function compressMediaFileInPlace(absPath: string): Promise<void> {
  try {
    if (!fs.existsSync(absPath)) return;
    const ext = path.extname(absPath).toLowerCase();
    if (RASTER.has(ext)) {
      await compressRaster(absPath, ext);
      return;
    }
    if (ext === '.gif') {
      await compressGifPreserveAnimation(absPath);
      return;
    }
    if (ext === '.mp4') {
      await compressVideoNearLossless(absPath);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[compressMedia] skip', absPath, msg);
  }
}

export async function compressUploadedMulterFiles(
  files: Express.Multer.File[] | undefined
): Promise<void> {
  const arr = Array.isArray(files) ? files : [];
  for (const f of arr) {
    if (f?.path) await compressMediaFileInPlace(f.path);
  }
}

async function compressRaster(absPath: string, ext: string): Promise<void> {
  const input = fs.readFileSync(absPath);
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  if (meta.format === 'png') {
    const out = await sharp(input, { failOn: 'none' })
      .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
      .toBuffer();
    if (out.length <= input.length) fs.writeFileSync(absPath, out);
    return;
  }
  if (meta.format === 'jpeg' || ext === '.jpg' || ext === '.jpeg') {
    const out = await sharp(input, { failOn: 'none' })
      .jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    if (out.length < input.length) fs.writeFileSync(absPath, out);
    return;
  }
  if (meta.format === 'webp' || ext === '.webp') {
    const out = await sharp(input, { failOn: 'none' }).webp({ lossless: true, effort: 6 }).toBuffer();
    if (out.length <= input.length) fs.writeFileSync(absPath, out);
  }
}

async function compressVideoNearLossless(absPath: string): Promise<void> {
  const ext = path.extname(absPath);
  const tmp = `${absPath.slice(0, -ext.length)}.ms-reencode${ext}`;
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        absPath,
        '-c:v',
        'libx264',
        '-crf',
        '20',
        '-preset',
        'slow',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        tmp
      ],
      { timeout: 300_000 }
    );
    const before = fs.statSync(absPath).size;
    const after = fs.statSync(tmp).size;
    if (after > 0 && after < before * 0.98) {
      fs.renameSync(tmp, absPath);
    } else {
      fs.unlinkSync(tmp);
    }
  } catch {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function compressGifPreserveAnimation(absPath: string): Promise<void> {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath, '.gif');
  const palette = path.join(dir, `${base}.ms-palette.png`);
  const tmp = path.join(dir, `${base}.ms-opt.gif`);
  try {
    await execFileAsync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', absPath, '-vf', 'fps=12,scale=iw:-1:flags=lanczos,palettegen', palette],
      { timeout: 300_000 }
    );
    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        absPath,
        '-i',
        palette,
        '-lavfi',
        'fps=12,scale=iw:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3',
        tmp
      ],
      { timeout: 300_000 }
    );
    const before = fs.statSync(absPath).size;
    const after = fs.statSync(tmp).size;
    if (after > 0 && after < before * 0.98) {
      fs.renameSync(tmp, absPath);
    } else {
      fs.unlinkSync(tmp);
    }
  } catch {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  } finally {
    try {
      if (fs.existsSync(palette)) fs.unlinkSync(palette);
    } catch {
      /* ignore */
    }
  }
}
