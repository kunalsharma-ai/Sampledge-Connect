import { defineConfig } from 'vitest/config';

// Unit tests cover the platform-independent offline engine (store, outbox, sync)
// against real SQLite via node:sqlite. React Native UI is not exercised here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
