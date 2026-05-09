import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        // Instrumentação v8 pode deixar ~1% de linhas (ex.: cabeçalho); valores alinhados ao suite actual.
        'lib/activityThrottle.ts': {
          statements: 98,
          branches: 96,
          functions: 100,
          lines: 98
        },
        'lib/playerGameHeaderSnapshot.ts': {
          statements: 99,
          branches: 70,
          functions: 100,
          lines: 99
        },
        'models/userPutCoreTransaction.ts': {
          statements: 25,
          branches: 33,
          functions: 60,
          lines: 25
        }
      },
      include: [
        'lib/**/*.ts',
        'utils/**/*.ts',
        'config/**/*.ts',
        'validation/**/*.ts',
        'models/**/*.ts',
        'controllers/**/*.ts',
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
