import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  SignJWT,
  errors as joseErrors,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type CryptoKey,
} from 'jose';
import { TenantRoleSchema, type AccessTokenClaims } from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError } from '../common/errors.js';

const ALG = 'EdDSA';

/**
 * Short-lived access tokens signed with Ed25519. In development and tests an
 * ephemeral key pair is generated at boot (tokens die with the process);
 * production refuses to start without configured keys.
 */
@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger('TokenService');
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async onModuleInit() {
    if (this.cfg.JWT_PRIVATE_KEY && this.cfg.JWT_PUBLIC_KEY) {
      this.privateKey = await importPKCS8(this.cfg.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), ALG);
      this.publicKey = await importSPKI(this.cfg.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'), ALG);
    } else {
      const kp = await generateKeyPair(ALG, { crv: 'Ed25519', extractable: true });
      this.privateKey = kp.privateKey;
      this.publicKey = kp.publicKey;
      this.logger.warn('JWT keys not configured: using an ephemeral development key pair');
    }
  }

  get accessTtlSeconds(): number {
    return this.cfg.ACCESS_TOKEN_TTL_SECONDS;
  }

  signAccess(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ tid: claims.tid, sid: claims.sid, role: claims.role })
      .setProtectedHeader({ alg: ALG, typ: 'at+jwt' })
      .setSubject(claims.sub)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience('sampledge-connect')
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.privateKey);
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.cfg.JWT_ISSUER,
        audience: 'sampledge-connect',
        algorithms: [ALG],
        typ: 'at+jwt',
      });
      const role = TenantRoleSchema.safeParse(payload.role);
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.tid !== 'string' ||
        typeof payload.sid !== 'string' ||
        !role.success
      ) {
        throw new AppError('UNAUTHENTICATED', 'Malformed token');
      }
      return { sub: payload.sub, tid: payload.tid, sid: payload.sid, role: role.data };
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof joseErrors.JWTExpired)
        throw new AppError('SESSION_EXPIRED', 'Access token expired');
      throw new AppError('UNAUTHENTICATED', 'Invalid access token');
    }
  }
}
