import path from 'node:path';
import type { Express, Response } from 'express';

export const SUPPORT_ALLOWED_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.webm',
  '.mov'
]);

export function buildAttachmentsFromFiles(
  files: Express.Multer.File[] | undefined
): { list: { url: string; originalName: string; mime: string }[] } {
  const list: { url: string; originalName: string; mime: string }[] = [];
  const arr = Array.isArray(files) ? files : [];
  for (const f of arr) {
    if (!f?.filename) continue;
    const ext = path.extname(f.filename).toLowerCase();
    if (!SUPPORT_ALLOWED_EXT.has(ext)) continue;
    list.push({
      url: `/img/${f.filename}`,
      originalName: String(f.originalname || f.filename).slice(0, 200),
      mime: String(f.mimetype || '').slice(0, 120)
    });
  }
  return { list };
}

export function sendSupportMulterError(res: Response, err: unknown): void {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
  if (code === 'LIMIT_FILE_SIZE' || code === 'LIMIT_FIELD_VALUE' || code === 'LIMIT_PART_COUNT') {
    res.status(413).json({
      error:
        'Um ou mais ficheiros excedem o limite de tamanho permitido. Reduz o tamanho ou envia menos anexos.',
      code: 'PAYLOAD_TOO_LARGE'
    });
    return;
  }
  const msg = err instanceof Error ? err.message : 'Erro no upload';
  res.status(400).json({ error: msg || 'Erro no upload', code: 'UPLOAD' });
}
