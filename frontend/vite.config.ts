import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isSpaIndexHtmlPath } from './lib/gamePathRoutes';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiPort = env.PORT || env.API_PORT || '3000';
  const isDev = mode === 'development';
  /** Muda em cada `vite build` → o cliente limpa o flag de auto-recarga de chunks após deploy. */
  const appBuildStamp = `${mode}-${Date.now()}`;
  return {
    define: {
      __APP_BUILD_STAMP__: JSON.stringify(appBuildStamp)
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      ...(isDev
        ? {
            // Nunca `true`: fora desta lista o Vite recusa o Host (evita `vite dev` aberto na Internet).
            allowedHosts: ['localhost', '127.0.0.1', 'genesisdao.tech', 'test.genesisdao.tech'],
          }
        : {}),
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          secure: false,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
              console.log('proxy error', err);
            });
          },
        },
        '/img': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          ws: true,
          secure: false,
        }
      }
    },
    plugins: [
      react(),
      {
        name: 'spa-game-routes',
        configureServer(server) {
          const indexHtml = path.join(server.config.root, 'index.html');
          return () => {
            server.middlewares.use((req, res, next) => {
              const raw = (req.url || '').split('?')[0] || '';
              if (req.method !== 'GET' && req.method !== 'HEAD') return next();
              if (raw.startsWith('/api') || raw.startsWith('/img') || raw.startsWith('/ws')) return next();
              if (raw.startsWith('/@') || raw.startsWith('/node_modules') || raw.startsWith('/src')) return next();
              const p = raw.split('#')[0].replace(/\/+$/, '') || '/';
              const low = p.toLowerCase();
              if (!isSpaIndexHtmlPath(low)) return next();
              try {
                const html = fs.readFileSync(indexHtml, 'utf-8');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(html);
              } catch {
                next();
              }
            });
          };
        }
      }
    ],
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            lucide: ['lucide-react'],
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
