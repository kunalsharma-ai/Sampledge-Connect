import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests cover the platform-independent offline engine (store, outbox, sync)
// against real SQLite via node:sqlite. React Native UI is not exercised here.
// Native file access is swapped for the fetch-based web variant.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^.*\/lib\/localFiles$/,
        replacement: fileURLToPath(new URL('./src/lib/localFiles.web.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
