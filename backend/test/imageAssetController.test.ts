import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Pool } from 'pg';
import type { RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import {
  mountImageStaticMiddleware,
  registerImageAssetRoutes,
  runImageRootStartupOrganizeIfEnabled
} from '../controllers/imageAssetController.js';

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function poolMockAdmin(): Pool {
  return {
    query: async (sql: string) => {
      if (sql.includes('is_admin')) {
        return { rows: [{ is_admin: 1 }] } as Awaited<ReturnType<Pool['query']>>;
      }
      return { rows: [] } as Awaited<ReturnType<Pool['query']>>;
    }
  } as Pool;
}

function poolMockNonAdmin(): Pool {
  return {
    query: async (sql: string) => {
      if (sql.includes('is_admin')) {
        return { rows: [{ is_admin: 0 }] } as Awaited<ReturnType<Pool['query']>>;
      }
      return { rows: [] } as Awaited<ReturnType<Pool['query']>>;
    }
  } as Pool;
}

const isAdminPass: RequestHandler = (_req, _res, next) => {
  next();
};

async function withTempImgApp(
  pool: Pool,
  fn: (baseUrl: string, root: string) => Promise<void>
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minestation-ctrl-img-'));
  const uploads = path.join(root, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: number }).userId = 99;
    next();
  });
  registerImageAssetRoutes(app, {
    pool,
    isAdmin: isAdminPass,
    imgDir: root,
    uploadsDir: uploads
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl, root);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('imageAssetController', () => {
  it('POST /api/upload-image 401 sem userId na sessão', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minestation-ctrl-img-nouid-'));
    const uploads = path.join(root, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const app = express();
    app.use(express.json({ limit: '3mb' }));
    registerImageAssetRoutes(app, {
      pool: poolMockAdmin(),
      isAdmin: isAdminPass,
      imgDir: root,
      uploadsDir: uploads
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
          originalName: 'x.png'
        })
      });
      expect(res.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('POST /api/upload-image 200 e ficheiro em uploads/', async () => {
    await withTempImgApp(poolMockAdmin(), async (baseUrl, root) => {
      const res = await fetch(`${baseUrl}/api/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
          originalName: 'skin.png'
        })
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { path?: string };
      expect(body.path).toMatch(/^\/img\/.+\.png$/);
      const base = path.basename(String(body.path));
      expect(fs.existsSync(path.join(root, 'uploads', base))).toBe(true);
    });
  });

  it('POST /api/upload-image com assetFolder (admin) grava em subpasta', async () => {
    await withTempImgApp(poolMockAdmin(), async (baseUrl, root) => {
      const res = await fetch(`${baseUrl}/api/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
          originalName: 'rig.png',
          assetFolder: 'miner'
        })
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { path?: string };
      expect(body.path).toMatch(/^\/img\/miner\/.+\.png$/);
      const base = path.basename(String(body.path));
      expect(fs.existsSync(path.join(root, 'miner', base))).toBe(true);
    });
  });

  it('POST /api/upload-image 403 se sessão não é admin (mesmo só para uploads/)', async () => {
    await withTempImgApp(poolMockNonAdmin(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
          originalName: 'x.png',
          assetFolder: 'miner'
        })
      });
      expect(res.status).toBe(403);
    });
  });

  it('POST /api/upload-image 400 sem dataUrl ou data URL inválida', async () => {
    await withTempImgApp(poolMockAdmin(), async (baseUrl) => {
      const r1 = await fetch(`${baseUrl}/api/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(r1.status).toBe(400);
      const r2 = await fetch(`${baseUrl}/api/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: 'data:image/webp;base64,xx' })
      });
      expect(r2.status).toBe(400);
    });
  });

  it('POST /api/admin/upload-ad grava PNG em uploads/', async () => {
    await withTempImgApp(poolMockAdmin(), async (baseUrl, root) => {
      const buf = Buffer.from(TINY_PNG_B64, 'base64');
      const form = new FormData();
      form.append('image', new Blob([buf], { type: 'image/png' }), 'banner.png');
      const res = await fetch(`${baseUrl}/api/admin/upload-ad`, { method: 'POST', body: form });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean; imageUrl?: string };
      expect(body.ok).toBe(true);
      expect(body.imageUrl).toMatch(/^\/img\/ad-/);
      const base = path.basename(String(body.imageUrl));
      expect(fs.existsSync(path.join(root, 'uploads', base))).toBe(true);
    });
  });

  it('POST /api/admin/upload-ad 400 sem ficheiro', async () => {
    await withTempImgApp(poolMockAdmin(), async (baseUrl) => {
      const form = new FormData();
      const res = await fetch(`${baseUrl}/api/admin/upload-ad`, { method: 'POST', body: form });
      expect(res.status).toBe(400);
    });
  });
});

describe('imageAssetController helpers', () => {
  it('mountImageStaticMiddleware regista rotas /img', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minestation-static-'));
    const uploads = path.join(root, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const png = Buffer.from(TINY_PNG_B64, 'base64');
    fs.writeFileSync(path.join(uploads, 'probe.png'), png);
    const app = express();
    mountImageStaticMiddleware(app, uploads, root);
    const server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/img/probe.png`);
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('mountImageStaticMiddleware resolve URL plana quando ficheiro está só em miner/', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minestation-static-miner-'));
    const uploads = path.join(root, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    fs.mkdirSync(path.join(root, 'miner'), { recursive: true });
    const png = Buffer.from(TINY_PNG_B64, 'base64');
    fs.writeFileSync(path.join(root, 'miner', 'shop_gpu.png'), png);
    const app = express();
    mountImageStaticMiddleware(app, uploads, root);
    const server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/img/shop_gpu.png`);
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('runImageRootStartupOrganizeIfEnabled move ficheiro solto quando não SKIP', () => {
    const prev = process.env.SKIP_IMG_AUTO_ORGANIZE;
    delete process.env.SKIP_IMG_AUTO_ORGANIZE;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minestation-org-'));
    try {
      fs.writeFileSync(
        path.join(root, 'video_card_loose.png'),
        Buffer.from(TINY_PNG_B64, 'base64')
      );
      runImageRootStartupOrganizeIfEnabled(root);
      expect(fs.existsSync(path.join(root, 'miner', 'video_card_loose.png'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SKIP_IMG_AUTO_ORGANIZE;
      else process.env.SKIP_IMG_AUTO_ORGANIZE = prev;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('runImageRootStartupOrganizeIfEnabled respeita SKIP_IMG_AUTO_ORGANIZE=1', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minestation-skip-'));
    try {
      process.env.SKIP_IMG_AUTO_ORGANIZE = '1';
      fs.writeFileSync(path.join(root, 'x.png'), Buffer.from(TINY_PNG_B64, 'base64'));
      runImageRootStartupOrganizeIfEnabled(root);
      expect(fs.existsSync(path.join(root, 'x.png'))).toBe(true);
    } finally {
      delete process.env.SKIP_IMG_AUTO_ORGANIZE;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
