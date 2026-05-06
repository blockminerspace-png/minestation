import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { setStackIo } from './stackIoSingleton.js';

function parseSocketOrigins(): string[] | boolean {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  const primary = process.env.FRONTEND_URL?.trim();
  const out = new Set<string>();
  if (primary) out.add(primary);
  if (raw) {
    raw.split(',').forEach((s) => {
      const t = s.trim();
      if (t) out.add(t);
    });
  }
  if (out.size === 0) return true;
  return [...out];
}

/**
 * Socket.IO no mesmo `httpServer` que Express (notificações / pub com Redis adapter).
 */
export function attachSocketIo(httpServer: HttpServer): Server | null {
  try {
    const io = new Server(httpServer, {
      path: '/socket.io',
      cors: {
        origin: parseSocketOrigins(),
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
      try {
        const pubClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
        const subClient = pubClient.duplicate();
        io.adapter(createAdapter(pubClient, subClient));
        console.log('[Socket.IO] Redis adapter activo');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[Socket.IO] Adapter Redis falhou — modo single-instance:', msg);
      }
    } else {
      console.log('[Socket.IO] REDIS_URL ausente — adapter Redis desligado');
    }

    io.on('connection', (socket) => {
      socket.emit('stack:hello', { ok: true, t: Date.now() });
    });

    setStackIo(io);
    console.log('[Socket.IO] servidor anexado em /socket.io');
    return io;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Socket.IO] falha ao anexar:', msg);
    setStackIo(null);
    return null;
  }
}
