import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { challengeFor, makeVerifier, parseSsoReturn, ssoStartUrl } from '../lib/sso';

// On web the provider's popup reports back through this.
WebBrowser.maybeCompleteAuthSession();

export type SsoResult = { code: string; codeVerifier: string } | { error: string } | null;

/**
 * Runs the provider sign-in in the system browser and returns the one-time code with the
 * verifier that proves this app started it. Null when the person closed the browser.
 */
export async function runSso(opts: {
  serverUrl: string;
  tenantSlug: string;
  deviceId: string;
  deviceName: string;
  platform: 'ios' | 'android';
}): Promise<SsoResult> {
  const codeVerifier = makeVerifier((n) => Crypto.getRandomBytes(n));
  const codeChallenge = await challengeFor(
    codeVerifier,
    async (d) =>
      new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, d as never)),
  );
  // sampledge://sso in a build, exp://…/--/sso in Expo Go (allowed outside production).
  const returnTo = Linking.createURL('sso');
  const url = ssoStartUrl(opts.serverUrl, opts.tenantSlug, {
    returnTo,
    codeChallenge,
    deviceId: opts.deviceId,
    deviceName: opts.deviceName,
    platform: opts.platform,
  });
  const r = await WebBrowser.openAuthSessionAsync(url, returnTo, {
    preferEphemeralSession: false,
  });
  if (r.type !== 'success') return null;
  const back = parseSsoReturn(r.url);
  if (!back) return { error: 'Sign-in did not finish. Try again.' };
  return 'code' in back ? { code: back.code, codeVerifier } : back;
}
