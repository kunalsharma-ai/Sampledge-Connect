import type { SecretStorage } from '../auth/session';

/**
 * Web build only (used for previews and screenshots, not shipped to users).
 * Browsers have no hardware-backed keystore, so this uses localStorage.
 */
export const secureStorage: SecretStorage = {
  get: async (key) => globalThis.localStorage?.getItem(key) ?? null,
  set: async (key, value) => globalThis.localStorage?.setItem(key, value),
  delete: async (key) => globalThis.localStorage?.removeItem(key),
};
