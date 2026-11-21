import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes does not ship WebCrypto. Install expo-crypto's CSPRNG as
 * globalThis.crypto.getRandomValues so shared code (ids, socket.io) can use it.
 * Imported once from the root layout.
 */
const g = globalThis as { crypto?: { getRandomValues?: <T extends ArrayBufferView>(a: T) => T } };
if (!g.crypto) g.crypto = {};
if (!g.crypto.getRandomValues) {
  g.crypto.getRandomValues = (<T extends ArrayBufferView>(a: T) =>
    ExpoCrypto.getRandomValues(a as unknown as Uint8Array) as unknown as T) as never;
}
