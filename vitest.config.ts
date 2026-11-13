/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

const config = {
  test: {
    // Keep the test runner lightweight so it also runs on memory-constrained
    // machines: one forked worker, no parallel files.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    // Windows agent-workflow tests can legitimately spend >15s in a single
    // checkpoint/repair cycle. Keep the suite bounded, but avoid classifying
    // a healthy run as a timeout when the machine is under load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
    include: ['src/server/__tests__/**/*.test.ts'],
  },
  coverage: {
    // Core modules = server engine + shared contracts (the app logic itself).
    provider: 'v8',
    reporter: ['text', 'json-summary', 'html'],
    reportsDirectory: 'coverage',
    include: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
    exclude: ['**/__tests__/**', '**/*.test.ts', '**/node_modules/**', '**/dist/**'],
    // Some suites cannot load on this machine (OS blocks a tree-sitter native
    // binding); still emit the report so coverage can be reviewed.
    reportOnFailure: true,
  },
};

// The published vite UserConfig type in this vitest version does not declare
// the top-level `coverage` key (vitest reads it from the object at runtime).
export default defineConfig(config as Parameters<typeof defineConfig>[0] & { coverage: unknown });
