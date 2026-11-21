import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is used so decorator metadata (needed by Nest DI) is emitted in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
