import * as SecureStore from 'expo-secure-store';
import type { SecretStorage } from '../auth/session';

/** Tokens and the cache key live in the iOS Keychain / Android Keystore, bound to this device. */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureStorage: SecretStorage = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  delete: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
