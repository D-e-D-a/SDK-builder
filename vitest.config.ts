import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/__tests__/**/*.test.ts'],
    globals: false,
    // Default environment for tests without a @vitest-environment annotation.
    // FSM/events/queue tests run fine in Node.
    // Transport/SDK tests annotate themselves with // @vitest-environment happy-dom.
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/__tests__/**', 'packages/*/src/index.ts'],
    },
  },
});
