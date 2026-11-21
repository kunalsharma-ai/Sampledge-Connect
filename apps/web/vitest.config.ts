import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/ holds Playwright specs (pnpm e2e), not unit tests.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
