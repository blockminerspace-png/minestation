import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'lib/**/*.ts',
        'utils/**/*.ts',
        'config/**/*.ts',
        'validation/**/*.ts',
        'models/**/*.ts',
        'cron/**/*.ts',
        'src/auth/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'dist/**',
        'node_modules/**',
        'config/initDb.ts',
      ],
    },
  },
});
