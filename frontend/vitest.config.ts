import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const ci = process.env.CI === 'true';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    ...(ci && {
      poolOptions: {
        threads: { maxThreads: 2, minThreads: 1 },
      },
    }),
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      /** Evita misturar relatórios antigos com ficheiros da app. */
      clean: true,
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/utils/**/*.ts',
        'src/lib/**/*.ts',
        'src/validation/**/*.ts',
        'src/constants/**/*.ts',
        'src/models/**/*.ts',
        'src/controllers/**/*.ts',
        'src/types.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'node_modules/**', 'src/services/api.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
