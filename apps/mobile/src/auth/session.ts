import {
  NETWORK_TENANT_SLUG,
  isMfaChallenge,
  uuidv7,
  type MfaChallenge,
  type NetworkSignupRequest,
  type Session,
} from '@sampledge/contracts';
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

/** Which space the app shows: your organization, or SampConnect Network. */
export type Space = 'work' | 'network';
type Slot = 'work' | 'network';

export const isNetworkTenant = (s: { tenant: { slug: string } } | null | undefined): boolean =>
  s?.tenant.slug === NETWORK_TENANT_SLUG;

/** This install, as the server lists it under your devices (its id is added here). */
export interface DeviceLabel {
  name: string;
  platform: 'ios' | 'android';
}

const SESSION_KEY = 'sampledge.session.v1';
/** The network session of a work account (made once by POST /v1/network/link). */
const NETWORK_SESSION_KEY = 'sampledge.session.network.v1';
const SPACE_KEY = 'sampledge.space';
const DEVICE_KEY = 'sampledge.deviceId';
const DEMO_KEY = 'sampledge.demo';
const DB_KEY = 'sampledge.dbKey';
const REFRESH_MARGIN_MS = 60_000;

/**
 * The account you signed in with (`work`: an organization, or a personal SampConnect Network
 * account) and, for a work account, its linked network session (`network`). Each slot keeps
 * its own tokens and refreshes on its own; {@link current} is the one the app is showing.
 */
export class SessionManager {
  readonly events = new Emitter<{ state: SessionState; space: Space }>();
  private _state: SessionState = 'loading';
  private slots: Record<Slot, StoredSession | null> = { work: null, network: null };
  private _space: Space = 'work';
  private refreshing: Record<Slot, Promise<string | undefined> | null> = {
    work: null,
    network: null,
  };

  constructor(
    private readonly secrets: SecretStorage,
    private readonly apiFor: (serverUrl: string) => ApiTransport,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): SessionState {
    return this._state;
  }

  /** The session the app is showing. */
  get current(): StoredSession | null {
    return this.slots[this.activeSlot];
  }

  /** The account you signed in with. */
  get primary(): StoredSession | null {
    return this.slots.work;
  }

  /** The linked network session of a work account, if it has been opened. */
  get networkSession(): StoredSession | null {
    return this.isPersonal ? this.slots.work : this.slots.network;
  }

  /** A personal SampConnect Network account (no organization). */
  get isPersonal(): boolean {
    return isNetworkTenant(this.slots.work);
  }

  get space(): Space {
    return this.isPersonal ? 'network' : this.activeSlot;
  }

  private get activeSlot(): Slot {
    return this._space === 'network' && this.slots.network && !this.isPersonal ? 'network' : 'work';
  }

  async load(): Promise<SessionState> {
    const raw = await this.secrets.get(SESSION_KEY);
    if (raw) {
      this.slots.work = JSON.parse(raw) as StoredSession;
      const net = await this.secrets.get(NETWORK_SESSION_KEY);
      this.slots.network = net ? (JSON.parse(net) as StoredSession) : null;
      this._space = (await this.secrets.get(SPACE_KEY)) === 'network' ? 'network' : 'work';
      this.setState('active');
    } else if ((await this.secrets.get(DEMO_KEY)) === '1') {
      this.setState('demo');
    } else {
      this.setState('signedOut');
    }
    return this._state;
  }

  /**
   * Opens SampConnect Network. A work account is linked on first use (that needs a connection),
   * then the app switches to its own network space; later switches work offline.
   */
  async openNetwork(device: DeviceLabel): Promise<void> {
    const work = this.slots.work;
    if (!work || this._state !== 'active') throw new Error('Sign in to open SampConnect Network.');
    if (!this.isPersonal && !this.slots.network) {
      const s = await this.apiFor(work.serverUrl).linkNetwork({
        device: { ...device, deviceId: await this.deviceId() },
      });
      await this.persist('network', work.serverUrl, s);
    }
    await this.setSpace('network');
  }

  /** Back to your organization (a personal account has only the network). */
  async openWork(): Promise<void> {
    await this.setSpace('work');
  }

  private async setSpace(space: Space): Promise<void> {
    const before = this.space;
    this._space = space;
    await this.secrets.set(SPACE_KEY, space);
    if (this.space !== before) this.events.emit('space', this.space);
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
    /** Set after the server said a new password must be chosen (an admin reset it). */
    newPassword?: string;
    deviceName: string;
    platform: 'ios' | 'android';
  }): Promise<PendingMfa | null> {
    const serverUrl = normaliseUrl(input.serverUrl);
    const r = await this.apiFor(serverUrl).login({
      tenantSlug: input.tenantSlug,
      email: input.email,
      password: input.password,
      ...(input.newPassword ? { newPassword: input.newPassword } : {}),
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

  /** Creates a free personal SampConnect Network account and signs in with it. */
  async signUpPersonal(
    serverUrl: string,
    input: Omit<NetworkSignupRequest, 'device'>,
    device: DeviceLabel,
  ): Promise<void> {
    const base = normaliseUrl(serverUrl);
    const s = await this.apiFor(base).signUpPersonal({
      ...input,
      device: { ...device, deviceId: await this.deviceId() },
    });
    await this.finishSignIn(base, s);
  }

  private async finishSignIn(serverUrl: string, s: Session): Promise<void> {
    // Signing in as someone else on this device must not mix their caches.
    const was = this.slots.work;
    if (was && (was.user.userId !== s.user.userId || was.tenant.tenantId !== s.tenant.tenantId)) {
      throw new Error('Sign out first to switch accounts on this device.');
    }
    await this.persist('work', serverUrl, s);
    await this.secrets.delete(DEMO_KEY);
    this.setState('active');
  }

  async enterDemo(): Promise<void> {
    await this.secrets.set(DEMO_KEY, '1');
    this.setState('demo');
  }

  /** Forgets both sessions (the caller wipes both spaces' local data first). */
  async signOut(): Promise<void> {
    this.slots = { work: null, network: null };
    this._space = 'work';
    for (const k of [SESSION_KEY, NETWORK_SESSION_KEY, SPACE_KEY, DEMO_KEY])
      await this.secrets.delete(k);
    this.setState('signedOut');
  }

  /**
   * Returns a usable access token for the space the app is showing, refreshing it shortly
   * before expiry. Offline: returns the current token (requests fail as network errors and
   * are retried).
   */
  getAccessToken(): Promise<string | undefined> {
    return this.tokenFor(this.activeSlot);
  }

  /** Token of the session you signed in with, whichever space is showing. */
  primaryToken(): Promise<string | undefined> {
    return this.tokenFor('work');
  }

  private async tokenFor(slot: Slot): Promise<string | undefined> {
    const s = this.slots[slot];
    if (!s || this._state !== 'active') return undefined;
    if (s.accessTokenExpiresAt - this.now() > REFRESH_MARGIN_MS) return s.accessToken;
    return this.refreshSlot(slot);
  }

  /** Forces a refresh of the showing space (e.g. after a SESSION_EXPIRED response). Single-flight. */
  refresh(): Promise<string | undefined> {
    return this.refreshSlot(this.activeSlot);
  }

  private refreshSlot(slot: Slot): Promise<string | undefined> {
    this.refreshing[slot] ??= this.doRefresh(slot).finally(() => {
      this.refreshing[slot] = null;
    });
    return this.refreshing[slot];
  }

  private async doRefresh(slot: Slot): Promise<string | undefined> {
    const s = this.slots[slot];
    if (!s) return undefined;
    try {
      const next = await this.apiFor(s.serverUrl).refresh(s.refreshToken);
      await this.persist(slot, s.serverUrl, next);
      if (this._state === 'expired') this.setState('active');
      return next.accessToken;
    } catch (err) {
      if (err instanceof TransportError && err.kind === 'network') return s.accessToken;
      if (slot === 'network') {
        // The link was revoked (the organization turned the network off, or you left it):
        // forget it and go back to work, which still signs in.
        const before = this.space;
        this.slots.network = null;
        this._space = 'work';
        await this.secrets.delete(NETWORK_SESSION_KEY);
        await this.secrets.set(SPACE_KEY, 'work');
        if (before !== 'work') this.events.emit('space', 'work');
        return undefined;
      }
      this.setState('expired');
      return undefined;
    }
  }

  private async persist(slot: Slot, serverUrl: string, s: Session): Promise<void> {
    const stored: StoredSession = {
      serverUrl,
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      accessTokenExpiresAt: this.now() + s.accessTokenExpiresIn * 1000,
      user: s.user,
      tenant: s.tenant,
      workspaceId: s.workspaceId,
    };
    this.slots[slot] = stored;
    await this.secrets.set(
      slot === 'work' ? SESSION_KEY : NETWORK_SESSION_KEY,
      JSON.stringify(stored),
    );
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
