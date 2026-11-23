import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64url, challengeFor, makeVerifier, parseSsoReturn, ssoStartUrl } from './sso';

const sha256 = async (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());

describe('sso helpers', () => {
  it('base64url matches Node for every tail length', () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n);
      expect(base64url(new Uint8Array(b))).toBe(b.toString('base64url'));
    }
  });

  it('makes a verifier the server accepts and its S256 challenge', async () => {
    const v = makeVerifier((n) => new Uint8Array(randomBytes(n)));
    expect(v).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    const c = await challengeFor(v, sha256);
    expect(c).toBe(createHash('sha256').update(v).digest('base64url'));
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('builds the start URL', () => {
    const u = new URL(
      ssoStartUrl('https://connect.example.com', 'northwind', {
        returnTo: 'sampledge://sso',
        codeChallenge: 'abc',
        deviceId: 'd1',
        deviceName: 'Asha’s iPhone',
        platform: 'ios',
      }),
    );
    expect(u.pathname).toBe('/api/v1/auth/sso/northwind/start');
    expect(u.searchParams.get('returnTo')).toBe('sampledge://sso');
    expect(u.searchParams.get('deviceName')).toBe('Asha’s iPhone');
    expect(u.searchParams.get('platform')).toBe('ios');
  });

  it('reads the code or the error from the return URL', () => {
    expect(parseSsoReturn('sampledge://sso#sso=one-time-code-123')).toEqual({
      code: 'one-time-code-123',
    });
    expect(parseSsoReturn('sampledge://sso#sso_error=Your%20account%20is%20not%20allowed')).toEqual(
      { error: 'Your account is not allowed' },
    );
    expect(parseSsoReturn('sampledge://sso')).toBeNull();
    expect(parseSsoReturn('sampledge://sso#other=1')).toBeNull();
  });
});
