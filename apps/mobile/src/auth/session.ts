import { isMfaChallenge, uuidv7, type MfaChallenge, type Session } from '@sampledge/contracts';
import { Emitter } from '../lib/emitter';
import { TransportError, type ApiTransport } from '../sync/transport';

/** OS keystore abstraction (expo-secure-store on device). */
export interface SecretStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A password sign-in waiting for its two-step code. */
export interface PendingMfa {
  serverUrl: string;
  challenge: MfaChallenge;
}

export interface StoredSession {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  accessTokenExpiresAt: number;
  user: Session['user'];
  tenant: Session['tenant'];
  workspaceId: string;
}

/**
 * - `active`: tokens are valid (or refreshable).
 * - `expired`: the refresh token was rejected. Cached data stays readable and unsent
 *   messages stay queued; the user signs in again to resume sending.
 * - `demo`: explicitly chosen local demo workspace with no server.
 */
export type SessionState = 'loading' | 'signedOut' | 'active' | 'expired' | 'demo';

const SESSION_KEY = 'sampledge.session.v1';
const DEVICE_KEY = 'sampledge.deviceId';
const DEMO_KEY = 'sampledge.demo';
const DB_KEY = 'sampledge.dbKey';
const REFRESH_MARGIN_MS = 60_000;

export class SessionManager {
  readonly events = new Emitter<{ state: SessionState }>();
  private _state: SessionState = 'loading';
  private session: StoredSession | null = null;
  private refreshing: Promise<string | undefined> | null = null;

  constructor(
    private readonly secrets: SecretStorage,
    private readonly apiFor: (serverUrl: string) => ApiTransport,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): SessionState {
    return this._state;
  }

  get current(): StoredSession | null {
    return this.session;
  }

  async load(): Promise<SessionState> {
    const raw = await this.secrets.get(SESSION_KEY);
    if (raw) {
      this.session = JSON.parse(raw) as StoredSession;
      this.setState('active');
    } else if ((await this.secrets.get(DEMO_KEY)) === '1') {
      this.setState('demo');
    } else {
      this.setState('signedOut');
    }
    return this._state;
  }

  async deviceId(): Promise<string> {
    let id = await this.secrets.get(DEVICE_KEY);
    if (!id) {
      id = uuidv7(this.now());
      await this.secrets.set(DEVICE_KEY, id);
    }
    return id;
  }

  /** Per-install key for the encrypted SQLite cache. Never leaves the keystore. */
  async databaseKey(randomHex: () => string): Promise<string> {
    let key = await this.secrets.get(DB_KEY);
    if (!key) {
      key = randomHex();
      await this.secrets.set(DB_KEY, key);
    }
    return key;
  }

  /**
   * Signs in with a password. Accounts with two-step verification get a challenge back
   * instead; finish it with {@link verifyMfa} within its five minutes.
   */
  async signIn(input: {
    serverUrl: string;
    tenantSlug: string;
    email: string;
    password: string;
    deviceName: string;
    platform: 'ios' | 'android';
  }): Promise<PendingMfa | null> {
    const serverUrl = normaliseUrl(input.serverUrl);
    const r = await this.apiFor(serverUrl).login({
      tenantSlug: input.tenantSlug,
      email: input.email,
      password: input.password,
      device: { deviceId: await this.deviceId(), name: input.deviceName, platform: input.platform },
    });
    if (isMfaChallenge(r)) return { serverUrl, challenge: r };
    await this.finishSignIn(serverUrl, r);
    return null;
  }

  /** Second step: a 6-digit authenticator code or a recovery code. */
  async verifyMfa(pending: PendingMfa, code: string): Promise<void> {
    const s = await this.apiFor(pending.serverUrl).verifyMfa(
      pending.challenge.challengeId,
      code.trim(),
    );
    await this.finishSignIn(pending.serverUrl, s);
  }

  /**
   * Finishes single sign-on: the one-time code the server sent back to the app, plus the
   * PKCE verifier whose challenge started the flow.
   */
  async signInWithSso(serverUrl: string, code: string, codeVerifier: string): Promise<void> {
    const base = normaliseUrl(serverUrl);
    const s = await this.apiFor(base).ssoExchange(code, codeVerifier);
    await this.finishSignIn(base, s);
  }

  private async finishSignIn(serverUrl: string, s: Session): Promise<void> {
    // Signing in as someone else on this device must not mix their caches.
    if (
      this.session &&
      (this.session.user.userId !== s.user.userId ||
        this.session.tenant.tenantId !== s.tenant.tenantId)
    ) {
      throw new Error('Sign out first to switch accounts on this device.');
    }
    await this.persist(serverUrl, s);
    await this.secrets.delete(DEMO_KEY);
    this.setState('active');
  }

  async enterDemo(): Promise<void> {
    await this.secrets.set(DEMO_KEY, '1');
    this.setState('demo');
  }

  async signOut(): Promise<void> {
    this.session = null;
    await this.secrets.delete(SESSION_KEY);
    await this.secrets.delete(DEMO_KEY);
    this.setState('signedOut');
  }

  /**
   * Returns a usable access token, refreshing it shortly before expiry.
   * Offline: returns the current token (requests will fail as network errors and be retried).
   */
  async getAccessToken(): Promise<string | undefined> {
    const s = this.session;
    if (!s || this._state !== 'active') return undefined;
    if (s.accessTokenExpiresAt - this.now() > REFRESH_MARGIN_MS) return s.accessToken;
    return this.refresh();
  }

  /** Forces a refresh (e.g. after a SESSION_EXPIRED response). Single-flight. */
  refresh(): Promise<string | undefined> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string | undefined> {
    const s = this.session;
    if (!s) return undefined;
    try {
      const next = await this.apiFor(s.serverUrl).refresh(s.refreshToken);
      await this.persist(s.serverUrl, next);
      if (this._state === 'expired') this.setState('active');
      return next.accessToken;
    } catch (err) {
      if (err instanceof TransportError && err.kind === 'network') return s.accessToken;
      this.setState('expired');
      return undefined;
    }
  }

  private async persist(serverUrl: string, s: Session): Promise<void> {
    this.session = {
      serverUrl,
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      accessTokenExpiresAt: this.now() + s.accessTokenExpiresIn * 1000,
      user: s.user,
      tenant: s.tenant,
      workspaceId: s.workspaceId,
    };
    await this.secrets.set(SESSION_KEY, JSON.stringify(this.session));
  }

  private setState(state: SessionState): void {
    if (state === this._state) return;
    this._state = state;
    this.events.emit('state', state);
  }
}

export function normaliseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  const local =
    ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname) ||
    url.hostname.endsWith('.local');
  if (url.protocol !== 'https:' && !local) throw new Error('Use an https:// server address.');
  return url.origin;
}
