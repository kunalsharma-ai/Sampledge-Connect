import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { ClientIdSchema, DeviceInfoSchema, type Session, type SsoInfo } from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BillingService } from '../billing/billing.service.js';
import { REDIS } from '../redis/redis.module.js';
import { ARGON2_OPTIONS, AuthService, type RequestMeta } from './auth.service.js';
import { SessionService } from './session.service.js';
import { OIDC_PROVIDER, readOidcSettings, type OidcSettings } from './sso-settings.js';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface PendingSso {
  tenantId: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  returnTo: string;
  /** Set when returning to the mobile app: S256 of the app's own verifier. */
  appChallenge?: string;
  device: { deviceId: string; name: string; platform: string };
}

/**
 * Mobile apps get the one-time code through a custom URL scheme, which another app on the
 * phone could also register. So an app return needs app-side PKCE: the app sends a
 * challenge on start and must prove the verifier on exchange.
 */
export const APP_RETURN_SCHEMES = ['sampledge:'];
/** Expo Go during development (`exp://192.168.1.5:8081/--/sso`). Never in production. */
const DEV_APP_RETURN_SCHEMES = ['exp:'];
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

const STATE_TTL_S = 600;
const EXCHANGE_TTL_S = 60;
const b64url = (b: Buffer) => b.toString('base64url');

/**
 * OpenID Connect sign-in (authorization code + PKCE). The identity provider proves who the
 * person is; Connect still decides membership and issues its own device session. The session
 * reaches the browser through a single-use code in the URL fragment, never the tokens themselves.
 */
@Injectable()
export class SsoService implements OnModuleInit {
  private readonly log = new Logger('Sso');
  private readonly discovery = new Map<string, { at: number; doc: Discovery }>();
  private readonly jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(
    private readonly db: TenantDb,
    private readonly settings: IntegrationSettingsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly sessions: SessionService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.settings.register(OIDC_PROVIDER, {
      test: async (v) => {
        const d = await this.discover(String(v.issuer), true);
        return {
          ok: true,
          message: `Found ${new URL(d.authorization_endpoint).host}. Register this redirect URI with your provider: ${this.redirectUri(null)}`,
        };
      },
    });
  }

  /** Public: whether the login page should offer SSO for this workspace. */
  async info(slug: string): Promise<SsoInfo> {
    const tenant = await this.db.tenants.findOne({ slug, status: 'active' });
    const s = tenant ? await this.config(tenant._id) : null;
    return s
      ? { enabled: true, label: s.buttonLabel, passwordLogin: s.allowPasswordLogin }
      : { enabled: false, label: null, passwordLogin: true };
  }

  /** Builds the provider's authorization URL and remembers the attempt. */
  async start(
    slug: string,
    q: {
      returnTo?: string;
      deviceId?: string;
      deviceName?: string;
      platform?: string;
      codeChallenge?: string;
    },
    requestOrigin: string,
  ): Promise<string> {
    const appReturn = this.appReturn(q.returnTo);
    if (appReturn && !CHALLENGE_RE.test(q.codeChallenge ?? ''))
      throw new AppError(
        'VALIDATION_FAILED',
        'Returning to the app needs codeChallenge (S256 of a code verifier, base64url)',
      );
    const returnTo = appReturn ?? this.safeReturn(q.returnTo);
    const tenant = await this.db.tenants.findOne({ slug, status: 'active' });
    const s = tenant ? await this.config(tenant._id) : null;
    if (!tenant || !s)
      throw new AppError('NOT_FOUND', 'Single sign-on is not set up for this workspace');
    const d = await this.discover(s.issuer);
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(16));
    const redirectUri = this.redirectUri(requestOrigin);
    const pending: PendingSso = {
      tenantId: tenant._id,
      verifier,
      nonce,
      redirectUri,
      returnTo,
      ...(appReturn ? { appChallenge: q.codeChallenge } : {}),
      device: {
        deviceId: ClientIdSchema.safeParse(q.deviceId).success ? q.deviceId! : randomUUID(),
        name: (q.deviceName ?? 'Web browser').slice(0, 120),
        platform: DeviceInfoSchema.shape.platform.catch('web').parse(q.platform),
      },
    };
    await this.redis.set(`sso:st:${state}`, JSON.stringify(pending), 'EX', STATE_TTL_S);
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: s.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return u.toString();
  }

  /**
   * Provider redirect back. Always answers with a redirect to the web app: `#sso=<code>` on
   * success or `#sso_error=<message>` so the login page can explain what went wrong.
   */
  async callback(
    q: { code?: string; state?: string; error?: string; error_description?: string },
    meta: RequestMeta,
  ): Promise<string> {
    const raw = q.state ? await this.redis.getdel(`sso:st:${q.state}`) : null;
    if (!raw) return this.fail(this.defaultReturn(), 'This sign-in link expired. Try again.');
    const p = JSON.parse(raw) as PendingSso;
    try {
      if (q.error)
        throw new AppError(
          'UNAUTHENTICATED',
          q.error_description || `Your provider said: ${q.error}`,
        );
      if (!q.code) throw new AppError('UNAUTHENTICATED', 'Your provider sent no code');
      const s = await this.config(p.tenantId);
      if (!s) throw new AppError('UNAUTHENTICATED', 'Single sign-on was turned off');
      const claims = await this.exchangeCode(s, p, q.code);
      const session = await this.signIn(p, s, claims, meta);
      const code = b64url(randomBytes(24));
      await this.redis.set(
        `sso:x:${code}`,
        JSON.stringify({ session, appChallenge: p.appChallenge ?? null }),
        'EX',
        EXCHANGE_TTL_S,
      );
      return `${p.returnTo}#sso=${code}`;
    } catch (e) {
      const msg = e instanceof AppError ? e.message : 'Single sign-on failed. Try again.';
      if (!(e instanceof AppError)) this.log.warn(`SSO callback failed: ${(e as Error).message}`);
      await this.audit.record({
        tenantId: p.tenantId,
        actorId: null,
        action: 'auth.sso_failed',
        metadata: { reason: msg },
        ...meta,
      });
      return this.fail(p.returnTo, msg);
    }
  }

  /** Swaps the one-time code from the redirect for the session. */
  async exchange(code: string, codeVerifier?: string): Promise<Session> {
    const raw = await this.redis.getdel(`sso:x:${code}`);
    if (!raw) throw new AppError('UNAUTHENTICATED', 'This sign-in expired. Try again.');
    const x = JSON.parse(raw) as { session: Session; appChallenge: string | null };
    if (x.appChallenge) {
      const proof = codeVerifier ? b64url(createHash('sha256').update(codeVerifier).digest()) : '';
      const a = Buffer.from(proof);
      const b = Buffer.from(x.appChallenge);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        // Revoke the session we minted: whoever holds this code is not the app that started.
        const sid = decodeJwt(x.session.accessToken).sid;
        if (typeof sid === 'string')
          await this.sessions.revoke(x.session.tenant.tenantId, sid, 'sso_pkce_failed');
        throw new AppError('UNAUTHENTICATED', 'This sign-in could not be verified. Try again.');
      }
    }
    return x.session;
  }

  // ---------- internals ----------

  private async exchangeCode(s: OidcSettings, p: PendingSso, code: string) {
    const d = await this.discover(s.issuer);
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        authorization:
          'Basic ' +
          Buffer.from(
            `${encodeURIComponent(s.clientId)}:${encodeURIComponent(s.clientSecret)}`,
          ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: p.redirectUri,
        code_verifier: p.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.id_token)
      throw new AppError(
        'UNAUTHENTICATED',
        `Your provider refused the sign-in (${body.error_description || body.error || `HTTP ${res.status}`})`,
      );
    let jwks = this.jwks.get(d.jwks_uri);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(d.jwks_uri));
      this.jwks.set(d.jwks_uri, jwks);
    }
    const { payload } = await jwtVerify(body.id_token, jwks, {
      issuer: d.issuer,
      audience: s.clientId,
      clockTolerance: 60,
    }).catch((e: Error) => {
      throw new AppError('UNAUTHENTICATED', `The identity token didn’t verify: ${e.message}`);
    });
    if (payload.nonce !== p.nonce)
      throw new AppError('UNAUTHENTICATED', 'The identity token didn’t match this sign-in');
    return payload;
  }

  private async signIn(p: PendingSso, s: OidcSettings, claims: JWTPayload, meta: RequestMeta) {
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!email)
      throw new AppError('UNAUTHENTICATED', 'Your provider didn’t share an email address');
    if (claims.email_verified === false)
      throw new AppError('UNAUTHENTICATED', 'Your provider says this email address isn’t verified');
    const domain = email.split('@')[1] ?? '';
    if (s.allowedDomains.length && !s.allowedDomains.includes(domain))
      throw new AppError('FORBIDDEN', `${domain} addresses can’t sign in to this workspace`);
    const t = this.db.for(p.tenantId);
    let user = await t.users.findOne({ email });
    if (!user) {
      if (!s.createUsers)
        throw new AppError(
          'FORBIDDEN',
          'You don’t have an account in this workspace yet. Ask an admin to add you.',
        );
      user = await this.provision(p.tenantId, email, claims);
    }
    if (user.status !== 'active')
      throw new AppError('FORBIDDEN', 'Your account in this workspace is deactivated');
    const session = await this.auth.finishLogin(p.tenantId, user._id, p.device, meta, 'sso');
    return session;
  }

  /** Creates a member on first SSO sign-in. Their password is random and unusable. */
  private async provision(tenantId: string, email: string, claims: JWTPayload) {
    await this.billing.assertSeatAvailable(tenantId);
    const t = this.db.for(tenantId);
    const ws = await t.workspaces.findOne({ isDefault: true });
    if (!ws) throw new AppError('INTERNAL', 'Workspace missing');
    const now = new Date();
    const name =
      (typeof claims.name === 'string' && claims.name.trim()) ||
      [claims.given_name, claims.family_name].filter((x) => typeof x === 'string').join(' ') ||
      email.split('@')[0]!;
    const user = await t.users.insertOne({
      email,
      passwordHash: await argon2.hash(b64url(randomBytes(32)), ARGON2_OPTIONS),
      displayName: name.slice(0, 120),
      title: null,
      status: 'active',
      createdAt: now,
    });
    await t.memberships.insertOne({
      userId: user._id,
      workspaceId: ws._id,
      role: 'member',
      createdAt: now,
    });
    const general = await t.conversations.findOne({
      workspaceId: ws._id,
      kind: 'channel_public',
      name: 'general',
    });
    if (general)
      await t.conversation_members.insertOne({
        conversationId: general._id,
        userId: user._id,
        role: 'member',
        joinedAt: now,
      });
    await this.audit.record({
      tenantId,
      actorId: user._id,
      action: 'member.created_by_sso',
      target: { type: 'user', id: user._id },
    });
    return user;
  }

  private config(tenantId: string): Promise<OidcSettings | null> {
    return readOidcSettings(this.settings, tenantId);
  }

  private async discover(issuer: string, fresh = false): Promise<Discovery> {
    const iss = issuer.replace(/\/+$/, '');
    const hit = this.discovery.get(iss);
    if (!fresh && hit && Date.now() - hit.at < 3_600_000) return hit.doc;
    if (this.cfg.NODE_ENV === 'production' && !iss.startsWith('https://'))
      throw new AppError('VALIDATION_FAILED', 'The issuer must use https');
    const res = await fetch(`${iss}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok)
      throw new AppError(
        'VALIDATION_FAILED',
        `No OpenID configuration at that issuer (HTTP ${res.status})`,
      );
    const doc = (await res.json()) as Partial<Discovery>;
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri || !doc.issuer)
      throw new AppError('VALIDATION_FAILED', 'The OpenID configuration is missing endpoints');
    if (doc.issuer.replace(/\/+$/, '') !== iss)
      throw new AppError(
        'VALIDATION_FAILED',
        `The provider calls itself ${doc.issuer}; use that as the issuer URL`,
      );
    this.discovery.set(iss, { at: Date.now(), doc: doc as Discovery });
    return doc as Discovery;
  }

  private redirectUri(requestOrigin: string | null) {
    const base = this.cfg.PUBLIC_API_URL ?? requestOrigin ?? 'https://<your-api-host>';
    return `${base.replace(/\/+$/, '')}/v1/auth/sso/callback`;
  }

  /** A mobile app return URI (`sampledge://sso`), or null for anything else. */
  private appReturn(returnTo: string | undefined): string | null {
    if (!returnTo) return null;
    try {
      const u = new URL(returnTo);
      const schemes =
        this.cfg.NODE_ENV === 'production'
          ? APP_RETURN_SCHEMES
          : [...APP_RETURN_SCHEMES, ...DEV_APP_RETURN_SCHEMES];
      return schemes.includes(u.protocol) ? `${u.protocol}//${u.host}${u.pathname}` : null;
    } catch {
      return null;
    }
  }

  /** Only send people back to the web app's own origins. */
  private safeReturn(returnTo: string | undefined): string {
    const fallback = this.defaultReturn();
    if (!returnTo) return fallback;
    try {
      const u = new URL(returnTo);
      return this.allowedOrigins().includes(u.origin) ? `${u.origin}${u.pathname}` : fallback;
    } catch {
      return fallback;
    }
  }

  private allowedOrigins() {
    return [this.cfg.PUBLIC_WEB_URL, ...this.cfg.CORS_ORIGINS.split(',')]
      .filter((x): x is string => !!x)
      .map((x) => {
        try {
          return new URL(x.trim()).origin;
        } catch {
          return '';
        }
      })
      .filter(Boolean);
  }

  private defaultReturn() {
    return `${this.allowedOrigins()[0] ?? 'http://localhost:3000'}/login`;
  }

  private fail(returnTo: string, message: string) {
    return `${returnTo}#sso_error=${encodeURIComponent(message)}`;
  }
}
