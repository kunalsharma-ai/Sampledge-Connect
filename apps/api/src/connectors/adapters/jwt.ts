import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import {
  SignJWT,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { WebhookRejected } from './types.js';

const remote = new Map<string, JWTVerifyGetKey>();
/** JWKS fetched from the provider and cached by jose (refreshes on unknown kid). */
const remoteKeys = (url: string) => {
  let k = remote.get(url);
  if (!k)
    remote.set(
      url,
      (k = createRemoteJWKSet(new URL(url), { timeoutDuration: 5000, cooldownDuration: 30_000 })),
    );
  return k;
};

/**
 * Verifies a provider-issued bearer token. In test mode the connector carries its own
 * generated key (`testSigningKey`) and the provider's keys are never fetched.
 */
export async function verifyBearer(
  authorization: string | undefined,
  opts: { jwksUrl: string; issuer: string; audience: string; testSigningKey?: string },
): Promise<JWTPayload> {
  if (!authorization?.startsWith('Bearer ')) throw new WebhookRejected('Missing bearer token');
  const token = authorization.slice(7);
  try {
    const key = opts.testSigningKey
      ? createPublicKey(createPrivateKey(opts.testSigningKey))
      : remoteKeys(opts.jwksUrl);
    const { payload } = await jwtVerify(token, key as never, {
      issuer: opts.issuer,
      audience: opts.audience,
      algorithms: ['RS256'],
      clockTolerance: 300,
    });
    return payload;
  } catch (e) {
    throw new WebhookRejected(`Bearer token rejected: ${(e as Error).message}`);
  }
}

export function testRsaKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
}

export async function signTestToken(
  pem: string,
  claims: JWTPayload & { iss: string; aud: string },
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'sandbox' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(createPrivateKey(pem));
}

export async function signAssertion(pem: string, claims: JWTPayload) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(createPrivateKey(pem));
}
