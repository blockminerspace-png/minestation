import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  define: {
    __APP_BUILD_STAMP__: JSON.stringify('vitest')
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'utils/**/*.ts',
        'lib/**/*.ts',
        'validation/**/*.ts',
        'constants/**/*.ts',
        'models/**/*.ts',
        'controllers/**/*.ts',
        'types.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'node_modules/**', 'services/api.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
