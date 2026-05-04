import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiPort = env.PORT || env.API_PORT || '3000';
  const isDev = mode === 'development';
  return {
    server: {
      port: 5173,
      host: '0.0.0.0',
      ...(isDev
        ? {
            // Nunca `true`: fora desta lista o Vite recusa o Host (evita `vite dev` aberto na Internet).
            allowedHosts: ['localhost', '127.0.0.1', 'test.genesisdao.tech'],
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
    plugins: [react()],
    build: {
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
