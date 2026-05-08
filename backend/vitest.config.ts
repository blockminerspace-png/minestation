import { defineConfig } from 'vitest/config';

const ci = process.env.CI === 'true';

export default defineConfig({
  test: {
    environment: 'node',
    ...(ci && {
      poolOptions: {
        threads: { maxThreads: 2, minThreads: 1 },
      },
    }),
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        'lib/activityThrottle.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100
        },
        'lib/playerGameHeaderSnapshot.ts': {
          statements: 100,
          branches: 70,
          functions: 100,
          lines: 100
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
