/**
 * Referência: trecho de backend/server.js (integrar no ficheiro real).
 * Requer: path, fs, multer, e __dirname apontando para backend/
 */
const SUPPORT_UPLOAD_MAX = 12 * 1024 * 1024;
const SUPPORT_ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov']);
const supportStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'img');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uid = req.userId ? String(req.userId) : '0';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `support-${uid}-${uniqueSuffix}${ext}`);
  }
});
const uploadSupport = multer({
  storage: supportStorage,
  limits: { fileSize: SUPPORT_UPLOAD_MAX, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (SUPPORT_ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error('Tipo de ficheiro não permitido (imagens ou vídeo mp4/webm/mov).'));
  }
});
const supportReplyStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'img');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uid = req.userId ? String(req.userId) : '0';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `support-reply-${uid}-${uniqueSuffix}${ext}`);
  }
});
const uploadSupportReply = multer({
  storage: supportReplyStorage,
  limits: { fileSize: SUPPORT_UPLOAD_MAX, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (SUPPORT_ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error('Tipo de ficheiro não permitido (imagens ou vídeo mp4/webm/mov).'));
  }
});
