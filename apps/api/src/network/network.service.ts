import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import nodemailer from 'nodemailer';
import {
  CreateNetworkInviteSchema,
  DEFAULT_NETWORK_PRIVACY,
  LinkNetworkRequestSchema,
  NetworkSearchQuerySchema,
  NetworkSignupRequestSchema,
  ReportSchema,
  RespondConnectionRequestSchema,
  SendConnectionRequestSchema,
  SetCircleSchema,
  UpdateNetworkProfileSchema,
  type Connection,
  type ConnectionRequest,
  type MyNetworkProfile,
  type NetworkChangedEvent,
  type NetworkInvite,
  type NetworkInvitePreview,
  type NetworkLinkStatus,
  type NetworkPerson,
  type NetworkProfile,
  type PersonWithRelationship,
  type Relationship,
  type Session,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  NetworkInviteDoc,
  NetworkProfileDoc,
  NetworkRequestDoc,
} from '../database/documents.js';
import { TenantDb, newId, type ScopedDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { ARGON2_OPTIONS, toUserSummary, type RequestMeta } from '../auth/auth.service.js';
import { SessionService } from '../auth/session.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { NetworkTenant } from './network-tenant.js';
import { NetworkPolicyService } from './network-policy.service.js';
import { NetworkGate } from './network-gate.js';

const AVATAR_COLORS = ['#5B8CFF', '#8B5CF6', '#0D9488', '#D97706', '#DB2777', '#059669', '#2563EB'];
export const colorFor = (id: string) =>
  AVATAR_COLORS[parseInt(id.slice(-4), 16) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;

const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pairKey = (a: string, b: string) => [a, b].sort().join(':');
const INVITE_DAYS = 30;

export function toPerson(p: NetworkProfileDoc): NetworkPerson {
  return {
    userId: p.userId,
    handle: p.handle,
    displayName: p.displayName,
    headline: p.headline,
    kind: p.kind,
    organizationName: p.privacy.showOrganization ? p.organizationName : null,
    avatarColor: p.avatarColor,
  };
}

/**
 * Identity, people search, connection requests, follows, blocks, reports and invites.
 * Statuses and communities have their own services. Every mutation is idempotent
 * (clientActionId or a natural key) and tells all affected devices with `network:changed`.
 */
@Injectable()
export class NetworkService {
  constructor(
    private readonly db: TenantDb,
    private readonly network: NetworkTenant,
    private readonly policy: NetworkPolicyService,
    private readonly gate: NetworkGate,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly realtime: RealtimePublisher,
    private readonly settings: IntegrationSettingsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ─── helpers ────────────────────────────────────────────────────────────────

  get webBase(): string {
    return (this.cfg.PUBLIC_WEB_URL ?? this.cfg.corsOrigins[0] ?? 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );
  }

  async net(): Promise<ScopedDb> {
    return this.network.scoped();
  }

  /** Only network sessions may call network-side endpoints. */
  async assertNetwork(ctx: TenantContext): Promise<ScopedDb> {
    if (!(await this.network.isNetwork(ctx.tenantId)))
      throw forbidden('Open Sampledge Network to do this');
    return this.net();
  }

  async profileOf(userId: string): Promise<NetworkProfileDoc | null> {
    return (await this.net()).network_profiles.findOne({ userId });
  }

  async requireProfile(userId: string): Promise<NetworkProfileDoc> {
    const p = await this.profileOf(userId);
    if (!p) throw notFound('Person');
    return p;
  }

  /** Tell every device of these people that `scope` changed. */
  async changed(userIds: string[], e: NetworkChangedEvent) {
    const tenantId = await this.network.id();
    for (const id of new Set(userIds)) this.realtime.toUser(tenantId, id, 'network:changed', e);
  }

  /** Runs a mutation once per clientActionId; a replay returns the first result. */
  async once<T>(ctx: TenantContext, clientActionId: string, fn: () => Promise<T>): Promise<T> {
    const net = await this.net();
    const prior = await net.network_actions.findOne({ userId: ctx.userId, clientActionId });
    if (prior) return prior.result as T;
    const result = await fn();
    await net.network_actions
      .insertOne({
        userId: ctx.userId,
        clientActionId,
        result: JSON.parse(JSON.stringify(result ?? null)),
        createdAt: new Date(),
      })
      .catch((e) => {
        if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
      });
    return result;
  }

  private async auditBoth(
    actor: NetworkProfileDoc,
    action: string,
    target: { type: string; id: string } | null,
    metadata: Record<string, unknown> = {},
  ) {
    const netId = await this.network.id();
    await this.audit.record({ tenantId: netId, actorId: actor.userId, action, target, metadata });
    // The organization sees that its member acted on the network, never the content.
    if (actor.homeTenantId && actor.homeUserId)
      await this.audit.record({
        tenantId: actor.homeTenantId,
        actorId: actor.homeUserId,
        action,
        target,
        metadata: { ...metadata, network: true },
      });
  }

  private async uniqueHandle(net: ScopedDb, base: string): Promise<string> {
    let root = base
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^[^a-z]+/, '')
      .replace(/\.+$/, '')
      .slice(0, 22);
    if (root.length < 3) root = `user${root}`;
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? root : `${root}.${Math.floor(1000 + Math.random() * 9000)}`;
      if (!(await net.network_profiles.findOne({ handle: candidate }))) return candidate;
    }
    return `${root}.${randomBytes(3).toString('hex')}`.replace(/[^a-z0-9.]/g, '');
  }

  private async assertHandleFree(net: ScopedDb, handle: string, self?: string) {
    const taken = await net.network_profiles.findOne({ handle });
    if (taken && taken.userId !== self) throw new AppError('CONFLICT', 'That Connect ID is taken');
  }

  // ─── work account ↔ network identity ───────────────────────────────────────

  async linkStatus(ctx: TenantContext): Promise<NetworkLinkStatus> {
    if (await this.network.isNetwork(ctx.tenantId))
      return {
        allowed: true,
        reason: null,
        linked: true,
        handle: (await this.profileOf(ctx.userId))?.handle ?? null,
      };
    const p = await this.policy.get(ctx.tenantId);
    const net = await this.net();
    const linked = await net.network_profiles.findOne({
      homeTenantId: ctx.tenantId,
      homeUserId: ctx.userId,
    });
    const allowed = p.enabled && ctx.role !== 'guest';
    return {
      allowed,
      reason: allowed
        ? null
        : ctx.role === 'guest'
          ? 'Guests of an organization cannot use Sampledge Network'
          : 'Your organization turned off external connections',
      linked: !!linked,
      handle: linked?.handle ?? null,
    };
  }

  /**
   * Exchanges an organization session for a network session on the same device, creating the
   * network identity on first use. The organization token itself never works in the network.
   */
  async link(ctx: TenantContext, input: unknown, meta: RequestMeta): Promise<Session> {
    if (await this.network.isNetwork(ctx.tenantId)) throw forbidden('Already in Sampledge Network');
    const req = parse(LinkNetworkRequestSchema, input);
    const status = await this.linkStatus(ctx);
    if (!status.allowed) throw forbidden(status.reason ?? undefined);
    const home = this.db.for(ctx.tenantId);
    const [user, tenant] = await Promise.all([
      home.users.findOne({ _id: ctx.userId }),
      this.db.tenants.findOne({ _id: ctx.tenantId }),
    ]);
    if (!user || !tenant) throw notFound('User');
    const { tenantId: netId, workspaceId } = await this.network.get();
    const net = await this.net();
    let profile = await net.network_profiles.findOne({
      homeTenantId: ctx.tenantId,
      homeUserId: ctx.userId,
    });
    if (!profile) {
      if (req.handle) await this.assertHandleFree(net, req.handle);
      const handle = req.handle ?? (await this.uniqueHandle(net, user.displayName));
      const now = new Date();
      const netUser = await net.users.insertOne({
        // Not a sign-in address: work identities sign in through their organization.
        email: `${ctx.userId}.${ctx.tenantId}@linked.invalid`,
        passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS),
        displayName: user.displayName,
        title: user.title,
        status: 'active',
        createdAt: now,
      });
      try {
        await net.memberships.insertOne({
          userId: netUser._id,
          workspaceId,
          role: 'guest',
          createdAt: now,
        });
        const email = user.email.toLowerCase();
        profile = await net.network_profiles.insertOne({
          userId: netUser._id,
          handle,
          displayName: user.displayName,
          headline: user.title ?? '',
          bio: '',
          kind: 'work',
          homeTenantId: ctx.tenantId,
          homeUserId: ctx.userId,
          organizationName: tenant.name,
          email,
          emailDomain: email.split('@')[1] ?? null,
          phone: null,
          privacy: { ...DEFAULT_NETWORK_PRIVACY },
          avatarColor: colorFor(netUser._id),
          createdAt: now,
          updatedAt: now,
        });
      } catch (e) {
        await Promise.allSettled([
          net.users.deleteMany({ _id: netUser._id }),
          net.memberships.deleteMany({ userId: netUser._id }),
        ]);
        if (e instanceof MongoServerError && e.code === 11000) {
          const raced = await net.network_profiles.findOne({
            homeTenantId: ctx.tenantId,
            homeUserId: ctx.userId,
          });
          if (!raced) throw new AppError('CONFLICT', 'That Connect ID is taken');
          profile = raced;
        } else throw e;
      }
      await this.auditBoth(
        profile,
        'network.linked',
        { type: 'user', id: profile.userId },
        { handle },
      );
    }
    const issued = await this.sessions.create({
      tenantId: netId,
      userId: profile.userId,
      role: 'guest',
      device: req.device,
    });
    await this.audit.record({
      tenantId: netId,
      actorId: profile.userId,
      action: 'auth.login',
      target: { type: 'device', id: issued.sessionId },
      metadata: { method: 'organization-link' },
      ...meta,
    });
    const netUser = (await net.users.findOne({ _id: profile.userId }))!;
    return {
      ...issued,
      user: toUserSummary(netUser, 'guest'),
      tenant: {
        tenantId: netId,
        slug: (await this.db.tenants.findOne({ _id: netId }))!.slug,
        name: 'Sampledge Network',
      },
      workspaceId,
    };
  }

  /** Free personal account for people outside any organization. */
  async signup(input: unknown, meta: RequestMeta): Promise<Session> {
    const req = parse(NetworkSignupRequestSchema, input);
    await this.rateLimit.consume('register_ip', meta.ip ?? 'unknown');
    const { tenantId: netId, workspaceId } = await this.network.get();
    const net = await this.net();
    if (req.handle) await this.assertHandleFree(net, req.handle);
    const invite = req.inviteToken
      ? await net.network_invites.findOne({ tokenHash: sha256(req.inviteToken) })
      : null;
    const now = new Date();
    let user;
    try {
      user = await net.users.insertOne({
        email: req.email,
        passwordHash: await argon2.hash(req.password, ARGON2_OPTIONS),
        displayName: req.displayName,
        title: null,
        status: 'active',
        createdAt: now,
      });
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError(
          'CONFLICT',
          'An account with that email already exists. Sign in instead.',
        );
      throw e;
    }
    await net.memberships.insertOne({
      userId: user._id,
      workspaceId,
      role: 'guest',
      createdAt: now,
    });
    const profile = await net.network_profiles.insertOne({
      userId: user._id,
      handle: req.handle ?? (await this.uniqueHandle(net, req.displayName)),
      displayName: req.displayName,
      headline: '',
      bio: '',
      kind: 'personal',
      homeTenantId: null,
      homeUserId: null,
      organizationName: null,
      email: req.email,
      emailDomain: req.email.split('@')[1] ?? null,
      phone: null,
      privacy: { ...DEFAULT_NETWORK_PRIVACY },
      avatarColor: colorFor(user._id),
      createdAt: now,
      updatedAt: now,
    });
    await this.auditBoth(
      profile,
      'network.signup',
      { type: 'user', id: user._id },
      {
        invited: !!invite,
      },
    );
    const issued = await this.sessions.create({
      tenantId: netId,
      userId: user._id,
      role: 'guest',
      device: req.device,
    });
    const ctx: TenantContext = {
      tenantId: netId,
      userId: user._id,
      sessionId: issued.sessionId,
      deviceId: req.device.deviceId,
      role: 'guest',
      workspaceId,
    };
    if (invite && invite.expiresAt > now) await this.completeInvite(ctx, profile, invite);
    if (req.follow) await this.follow(ctx, req.follow.type, req.follow.id).catch(() => undefined);
    return {
      ...issued,
      user: toUserSummary(user, 'guest'),
      tenant: {
        tenantId: netId,
        slug: (await this.db.tenants.findOne({ _id: netId }))!.slug,
        name: 'Sampledge Network',
      },
      workspaceId,
    };
  }

  // ─── profile ───────────────────────────────────────────────────────────────

  publicUrl(p: NetworkProfileDoc): string | null {
    return p.privacy.profileVisibility === 'public' ? `${this.webBase}/n/${p.handle}` : null;
  }

  async counts(userId: string) {
    const net = await this.net();
    const [connections, followers, following] = await Promise.all([
      net.network_connections.countDocuments({ userId }),
      net.network_follows.countDocuments({ targetType: 'user', targetId: userId }),
      net.network_follows.countDocuments({ followerId: userId }),
    ]);
    return { connections, followers, following };
  }

  async toProfile(p: NetworkProfileDoc): Promise<NetworkProfile> {
    return {
      ...toPerson(p),
      bio: p.bio,
      counts: await this.counts(p.userId),
      publicUrl: this.publicUrl(p),
    };
  }

  async me(ctx: TenantContext): Promise<MyNetworkProfile> {
    await this.assertNetwork(ctx);
    const p = await this.requireProfile(ctx.userId);
    const home = p.homeTenantId ? await this.db.tenants.findOne({ _id: p.homeTenantId }) : null;
    return {
      ...(await this.toProfile(p)),
      organizationName: p.organizationName,
      email: p.email,
      phone: p.phone,
      privacy: p.privacy,
      home: home ? { tenantName: home.name } : null,
    };
  }

  async updateMe(ctx: TenantContext, input: unknown): Promise<MyNetworkProfile> {
    const net = await this.assertNetwork(ctx);
    const req = parse(UpdateNetworkProfileSchema, input);
    const p = await this.requireProfile(ctx.userId);
    if (req.handle && req.handle !== p.handle)
      await this.assertHandleFree(net, req.handle, ctx.userId);
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['handle', 'displayName', 'headline', 'bio', 'phone'] as const)
      if (req[k] !== undefined) $set[k] = req[k];
    if (req.privacy) $set.privacy = { ...p.privacy, ...req.privacy };
    try {
      await net.network_profiles.updateOne({ userId: ctx.userId }, { $set });
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError('CONFLICT', 'That Connect ID is taken');
      throw e;
    }
    if (req.displayName)
      await net.users.updateOne({ _id: ctx.userId }, { $set: { displayName: req.displayName } });
    if (req.handle && req.handle !== p.handle)
      await this.auditBoth(
        p,
        'network.handle_changed',
        { type: 'user', id: p.userId },
        { from: p.handle, to: req.handle },
      );
    await this.changed([ctx.userId], { scope: 'profile' });
    return this.me(ctx);
  }

  // ─── relationships ─────────────────────────────────────────────────────────

  async relationships(
    meId: string,
    others: NetworkProfileDoc[],
  ): Promise<Map<string, Relationship>> {
    const net = await this.net();
    const ids = others.map((o) => o.userId);
    const [conns, reqs, iFollow, followMe, blocks, me] = await Promise.all([
      net.network_connections.find({ userId: meId, otherUserId: { $in: ids } }).toArray(),
      net.network_requests
        .find({ pairKey: { $in: ids.map((id) => pairKey(meId, id)) }, status: 'pending' })
        .toArray(),
      net.network_follows
        .find({ followerId: meId, targetType: 'user', targetId: { $in: ids } })
        .toArray(),
      net.network_follows
        .find({ followerId: { $in: ids }, targetType: 'user', targetId: meId })
        .toArray(),
      net.network_blocks.find({ userId: meId, blockedUserId: { $in: ids } }).toArray(),
      net.network_profiles.findOne({ userId: meId }),
    ]);
    const out = new Map<string, Relationship>();
    for (const o of others) {
      const c = conns.find((x) => x.otherUserId === o.userId);
      const r = reqs.find((x) => x.pairKey === pairKey(meId, o.userId));
      const blocked = blocks.some((b) => b.blockedUserId === o.userId);
      const policyReason = me ? await this.policy.pairBlockedReason(me, o) : 'x';
      const connection = c
        ? 'connected'
        : r
          ? r.fromUserId === meId
            ? 'outgoing'
            : 'incoming'
          : 'none';
      out.set(o.userId, {
        connection,
        requestId: r?._id ?? null,
        circle: c?.circle ?? null,
        following: iFollow.some((f) => f.targetId === o.userId),
        followsYou: followMe.some((f) => f.followerId === o.userId),
        blocked,
        canRequest:
          connection === 'none' &&
          !blocked &&
          !policyReason &&
          o.privacy.allowRequestsFrom === 'everyone',
        canFollow: !blocked && o.privacy.allowFollowers && o.userId !== meId,
        canMessage: connection === 'connected' && !blocked && !policyReason,
      });
    }
    return out;
  }

  private async withRelationships(
    meId: string,
    ps: NetworkProfileDoc[],
  ): Promise<PersonWithRelationship[]> {
    const rel = await this.relationships(meId, ps);
    return ps.map((p) => ({ person: toPerson(p), relationship: rel.get(p.userId)! }));
  }

  /** Ids I blocked or who blocked me: hidden from each other everywhere. */
  async hiddenFor(meId: string): Promise<Set<string>> {
    const net = await this.net();
    const rows = await net.network_blocks
      .find({ $or: [{ userId: meId }, { blockedUserId: meId }] })
      .toArray();
    return new Set(rows.map((r) => (r.userId === meId ? r.blockedUserId : r.userId)));
  }

  async search(ctx: TenantContext, query: unknown): Promise<PersonWithRelationship[]> {
    const net = await this.assertNetwork(ctx);
    const { q } = parse(NetworkSearchQuerySchema, query);
    await this.rateLimit.consume('network_search', `${ctx.userId}`);
    const hidden = await this.hiddenFor(ctx.userId);
    const term = q.replace(/^@/, '').toLowerCase();
    const or: object[] = [{ handle: term }];
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q))
      or.push({ email: q.toLowerCase(), 'privacy.findableByEmail': true });
    const digits = q.replace(/[^\d+]/g, '');
    if (/^\+?\d{7,15}$/.test(digits) && /^[\d\s+().-]+$/.test(q))
      or.push({ phone: digits, 'privacy.findableByPhone': true });
    if (term.length >= 2 && !q.includes('@')) {
      const re = new RegExp(`(^|\\s)${escapeRe(q.trim())}`, 'i');
      or.push({ displayName: re, 'privacy.discoverableByName': true });
      or.push({ handle: new RegExp(`^${escapeRe(term)}`), 'privacy.discoverableByName': true });
    }
    const rows = await net.network_profiles
      .find({ $or: or, userId: { $nin: [ctx.userId, ...hidden] } } as never, { limit: 25 })
      .toArray();
    // Exact Connect ID first, then by name.
    rows.sort(
      (a, b) =>
        Number(b.handle === term) - Number(a.handle === term) ||
        a.displayName.localeCompare(b.displayName),
    );
    return this.withRelationships(ctx.userId, rows);
  }

  async person(
    ctx: TenantContext,
    idOrHandle: string,
  ): Promise<{ profile: NetworkProfile; relationship: Relationship }> {
    const net = await this.assertNetwork(ctx);
    const p = await net.network_profiles.findOne({
      $or: [{ userId: idOrHandle }, { handle: idOrHandle.toLowerCase().replace(/^@/, '') }],
    });
    if (!p || (await this.hiddenFor(ctx.userId)).has(p.userId)) throw notFound('Person');
    const rel = await this.relationships(ctx.userId, [p]);
    return { profile: await this.toProfile(p), relationship: rel.get(p.userId)! };
  }

  // ─── connection requests ───────────────────────────────────────────────────

  private async toRequest(meId: string, r: NetworkRequestDoc): Promise<ConnectionRequest | null> {
    const otherId = r.fromUserId === meId ? r.toUserId : r.fromUserId;
    const other = await this.profileOf(otherId);
    if (!other) return null;
    return {
      requestId: r._id,
      direction: r.fromUserId === meId ? 'outgoing' : 'incoming',
      person: toPerson(other),
      message: r.message,
      circle: r.circle,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async sendRequest(ctx: TenantContext, input: unknown): Promise<ConnectionRequest | Connection> {
    const net = await this.assertNetwork(ctx);
    const req = parse(SendConnectionRequestSchema, input);
    return this.once(ctx, req.clientActionId, async () => {
      if (req.toUserId === ctx.userId)
        throw new AppError('VALIDATION_FAILED', "You can't connect with yourself");
      const [me, other] = await Promise.all([
        this.requireProfile(ctx.userId),
        this.requireProfile(req.toUserId),
      ]);
      if ((await this.hiddenFor(ctx.userId)).has(other.userId)) throw notFound('Person');
      const reason = await this.policy.pairBlockedReason(me, other);
      if (reason) throw forbidden(reason);
      const existing = await net.network_connections.findOne({
        userId: ctx.userId,
        otherUserId: other.userId,
      });
      if (existing) return this.toConnection(existing.circle, existing.connectedAt, other);
      const key = pairKey(ctx.userId, other.userId);
      const pending = await net.network_requests.findOne({ pairKey: key, status: 'pending' });
      // They already asked me: sending one back accepts theirs.
      if (pending && pending.toUserId === ctx.userId)
        return this.accept(ctx, me, other, pending, req.circle);
      if (pending) return (await this.toRequest(ctx.userId, pending))!;
      if (other.privacy.allowRequestsFrom !== 'everyone')
        throw forbidden('This person is not accepting connection requests');
      await this.rateLimit.consume('network_request', ctx.userId);
      let doc: NetworkRequestDoc;
      try {
        doc = await net.network_requests.insertOne({
          fromUserId: ctx.userId,
          toUserId: other.userId,
          pairKey: key,
          circle: req.circle,
          message: req.message,
          status: 'pending',
          createdAt: new Date(),
          respondedAt: null,
        });
      } catch (e) {
        if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
        doc = (await net.network_requests.findOne({ pairKey: key, status: 'pending' }))!;
      }
      await this.auditBoth(me, 'network.request_sent', { type: 'user', id: other.userId });
      await this.changed([ctx.userId, other.userId], { scope: 'requests', id: doc._id });
      return (await this.toRequest(ctx.userId, doc))!;
    });
  }

  private toConnection(
    circle: 'business' | 'friends',
    at: Date,
    other: NetworkProfileDoc,
  ): Connection {
    return { person: toPerson(other), circle, connectedAt: at.toISOString() };
  }

  private async accept(
    ctx: TenantContext,
    me: NetworkProfileDoc,
    other: NetworkProfileDoc,
    request: NetworkRequestDoc,
    myCircle: 'business' | 'friends',
  ): Promise<Connection> {
    const net = await this.net();
    const reason = await this.policy.pairBlockedReason(me, other);
    if (reason) throw forbidden(reason);
    const now = new Date();
    await net.network_requests.updateOne(
      { _id: request._id, status: 'pending' },
      { $set: { status: 'accepted', respondedAt: now } },
    );
    await this.connect(me.userId, other.userId, myCircle, request.circle, now);
    await this.auditBoth(me, 'network.request_accepted', { type: 'user', id: other.userId });
    await this.changed([me.userId, other.userId], { scope: 'connections' });
    await this.changed([me.userId, other.userId], { scope: 'requests', id: request._id });
    return this.toConnection(myCircle, now, other);
  }

  /** Both directions; idempotent. */
  private async connect(
    a: string,
    b: string,
    aCircle: 'business' | 'friends',
    bCircle: 'business' | 'friends',
    at: Date,
  ) {
    const net = await this.net();
    for (const [userId, otherUserId, circle] of [
      [a, b, aCircle],
      [b, a, bCircle],
    ] as const) {
      await net.network_connections.updateOne(
        { userId, otherUserId },
        { $setOnInsert: { userId, otherUserId, circle, connectedAt: at } as never },
        { upsert: true },
      );
    }
  }

  async listRequests(
    ctx: TenantContext,
  ): Promise<{ incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] }> {
    const net = await this.assertNetwork(ctx);
    const rows = await net.network_requests
      .find(
        { status: 'pending', $or: [{ toUserId: ctx.userId }, { fromUserId: ctx.userId }] },
        { sort: { createdAt: -1 }, limit: 500 },
      )
      .toArray();
    const hidden = await this.hiddenFor(ctx.userId);
    const all = (
      await Promise.all(
        rows
          .filter((r) => !hidden.has(r.fromUserId) && !hidden.has(r.toUserId))
          .map((r) => this.toRequest(ctx.userId, r)),
      )
    ).filter((r): r is ConnectionRequest => !!r);
    return {
      incoming: all.filter((r) => r.direction === 'incoming'),
      outgoing: all.filter((r) => r.direction === 'outgoing'),
    };
  }

  async respond(
    ctx: TenantContext,
    requestId: string,
    input: unknown,
  ): Promise<ConnectionRequest | Connection> {
    const net = await this.assertNetwork(ctx);
    const req = parse(RespondConnectionRequestSchema, input);
    return this.once(ctx, req.clientActionId, async () => {
      const r = await net.network_requests.findOne({ _id: requestId, toUserId: ctx.userId });
      if (!r) throw notFound('Request');
      const [me, other] = await Promise.all([
        this.requireProfile(ctx.userId),
        this.requireProfile(r.fromUserId),
      ]);
      if (r.status === 'accepted') {
        const c = await net.network_connections.findOne({
          userId: ctx.userId,
          otherUserId: other.userId,
        });
        if (c) return this.toConnection(c.circle, c.connectedAt, other);
      }
      if (r.status !== 'pending') return (await this.toRequest(ctx.userId, r))!;
      if (req.accept) return this.accept(ctx, me, other, r, req.circle);
      await net.network_requests.updateOne(
        { _id: r._id },
        { $set: { status: 'declined', respondedAt: new Date() } },
      );
      await this.auditBoth(me, 'network.request_declined', { type: 'user', id: other.userId });
      // The sender only sees their request disappear: declines are not announced.
      await this.changed([ctx.userId, other.userId], { scope: 'requests', id: r._id });
      return (await this.toRequest(ctx.userId, { ...r, status: 'declined' }))!;
    });
  }

  async cancelRequest(ctx: TenantContext, requestId: string): Promise<void> {
    const net = await this.assertNetwork(ctx);
    const r = await net.network_requests.findOne({ _id: requestId, fromUserId: ctx.userId });
    if (!r) throw notFound('Request');
    if (r.status !== 'pending') return;
    await net.network_requests.updateOne(
      { _id: r._id },
      { $set: { status: 'cancelled', respondedAt: new Date() } },
    );
    await this.changed([ctx.userId, r.toUserId], { scope: 'requests', id: r._id });
  }

  async connections(ctx: TenantContext): Promise<Connection[]> {
    const net = await this.assertNetwork(ctx);
    const rows = await net.network_connections
      .find({ userId: ctx.userId }, { limit: 5000 })
      .toArray();
    const profiles = await net.network_profiles
      .find({ userId: { $in: rows.map((r) => r.otherUserId) } })
      .toArray();
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    return rows
      .filter((r) => byId.has(r.otherUserId))
      .map((r) => this.toConnection(r.circle, r.connectedAt, byId.get(r.otherUserId)!))
      .sort((a, b) => a.person.displayName.localeCompare(b.person.displayName));
  }

  async setCircle(ctx: TenantContext, userId: string, input: unknown): Promise<Connection> {
    const net = await this.assertNetwork(ctx);
    const { circle } = parse(SetCircleSchema, input);
    const c = await net.network_connections.findOneAndUpdate(
      { userId: ctx.userId, otherUserId: userId },
      { $set: { circle } },
      { returnDocument: 'after' },
    );
    if (!c) throw notFound('Connection');
    await this.changed([ctx.userId], { scope: 'connections' });
    return this.toConnection(c.circle, c.connectedAt, await this.requireProfile(userId));
  }

  async removeConnection(ctx: TenantContext, userId: string): Promise<void> {
    const net = await this.assertNetwork(ctx);
    const res = await net.network_connections.deleteMany({
      $or: [
        { userId: ctx.userId, otherUserId: userId },
        { userId, otherUserId: ctx.userId },
      ],
    });
    if (res.deletedCount) {
      await this.auditBoth(await this.requireProfile(ctx.userId), 'network.connection_removed', {
        type: 'user',
        id: userId,
      });
      await this.changed([ctx.userId, userId], { scope: 'connections' });
    }
  }

  // ─── follows ───────────────────────────────────────────────────────────────

  async follow(
    ctx: TenantContext,
    targetType: 'user' | 'community',
    targetId: string,
  ): Promise<void> {
    const net = await this.assertNetwork(ctx);
    if (targetType === 'user') {
      if (targetId === ctx.userId)
        throw new AppError('VALIDATION_FAILED', "You can't follow yourself");
      const [me, other] = await Promise.all([
        this.requireProfile(ctx.userId),
        this.requireProfile(targetId),
      ]);
      if ((await this.hiddenFor(ctx.userId)).has(targetId)) throw notFound('Person');
      if (!other.privacy.allowFollowers) throw forbidden('This person does not accept followers');
      const reason = await this.policy.pairBlockedReason(me, other);
      if (reason) throw forbidden(reason);
    } else {
      const c = await net.communities.findOne({ _id: targetId });
      if (!c) throw notFound('Community');
      const m = await net.community_members.findOne({ communityId: c._id, userId: ctx.userId });
      if (m?.status === 'banned' || (c.visibility !== 'public' && m?.status !== 'active'))
        throw notFound('Community');
    }
    const res = await net.network_follows.updateOne(
      { followerId: ctx.userId, targetType, targetId },
      {
        $setOnInsert: {
          followerId: ctx.userId,
          targetType,
          targetId,
          createdAt: new Date(),
        } as never,
      },
      { upsert: true },
    );
    if (res.upsertedCount)
      await this.changed(targetType === 'user' ? [ctx.userId, targetId] : [ctx.userId], {
        scope: 'follows',
      });
  }

  async unfollow(
    ctx: TenantContext,
    targetType: 'user' | 'community',
    targetId: string,
  ): Promise<void> {
    const net = await this.assertNetwork(ctx);
    const res = await net.network_follows.deleteMany({
      followerId: ctx.userId,
      targetType,
      targetId,
    });
    if (res.deletedCount)
      await this.changed(targetType === 'user' ? [ctx.userId, targetId] : [ctx.userId], {
        scope: 'follows',
      });
  }

  async follows(
    ctx: TenantContext,
  ): Promise<{ followers: PersonWithRelationship[]; following: PersonWithRelationship[] }> {
    const net = await this.assertNetwork(ctx);
    const [followers, following] = await Promise.all([
      net.network_follows
        .find({ targetType: 'user', targetId: ctx.userId }, { limit: 5000 })
        .toArray(),
      net.network_follows
        .find({ followerId: ctx.userId, targetType: 'user' }, { limit: 5000 })
        .toArray(),
    ]);
    const hidden = await this.hiddenFor(ctx.userId);
    const load = async (ids: string[]) =>
      this.withRelationships(
        ctx.userId,
        await net.network_profiles
          .find({ userId: { $in: ids.filter((i) => !hidden.has(i)) } })
          .toArray(),
      );
    return {
      followers: await load(followers.map((f) => f.followerId)),
      following: await load(following.map((f) => f.targetId)),
    };
  }

  // ─── blocks and reports ────────────────────────────────────────────────────

  async block(ctx: TenantContext, userId: string): Promise<void> {
    const net = await this.assertNetwork(ctx);
    if (userId === ctx.userId) throw new AppError('VALIDATION_FAILED', "You can't block yourself");
    await this.requireProfile(userId);
    await net.network_blocks.updateOne(
      { userId: ctx.userId, blockedUserId: userId },
      {
        $setOnInsert: { userId: ctx.userId, blockedUserId: userId, createdAt: new Date() } as never,
      },
      { upsert: true },
    );
    // Blocking ends everything between the two: connection, follows both ways, pending requests.
    await Promise.all([
      net.network_connections.deleteMany({
        $or: [
          { userId: ctx.userId, otherUserId: userId },
          { userId, otherUserId: ctx.userId },
        ],
      }),
      net.network_follows.deleteMany({
        targetType: 'user',
        $or: [
          { followerId: ctx.userId, targetId: userId },
          { followerId: userId, targetId: ctx.userId },
        ],
      }),
      net.network_requests.updateMany(
        { pairKey: pairKey(ctx.userId, userId), status: 'pending' },
        { $set: { status: 'cancelled', respondedAt: new Date() } },
      ),
    ]);
    await this.auditBoth(await this.requireProfile(ctx.userId), 'network.blocked', {
      type: 'user',
      id: userId,
    });
    await this.changed([ctx.userId], { scope: 'blocks' });
    // The other person's lists refresh without saying why.
    await this.changed([ctx.userId, userId], { scope: 'connections' });
  }

  async unblock(ctx: TenantContext, userId: string): Promise<void> {
    const net = await this.assertNetwork(ctx);
    const res = await net.network_blocks.deleteMany({ userId: ctx.userId, blockedUserId: userId });
    if (res.deletedCount) await this.changed([ctx.userId], { scope: 'blocks' });
  }

  async blocks(ctx: TenantContext): Promise<NetworkPerson[]> {
    const net = await this.assertNetwork(ctx);
    const rows = await net.network_blocks.find({ userId: ctx.userId }).toArray();
    const ps = await net.network_profiles
      .find({ userId: { $in: rows.map((r) => r.blockedUserId) } })
      .toArray();
    return ps.map(toPerson);
  }

  async report(ctx: TenantContext, input: unknown): Promise<{ reportId: string }> {
    const net = await this.assertNetwork(ctx);
    const req = parse(ReportSchema, input);
    return this.once(ctx, req.clientActionId, async () => {
      await this.rateLimit.consume('network_request', `report:${ctx.userId}`);
      const doc = await net.network_reports.insertOne({
        reporterId: ctx.userId,
        targetType: req.targetType,
        targetId: req.targetId,
        reason: req.reason,
        details: req.details,
        status: 'open',
        createdAt: new Date(),
      });
      await this.auditBoth(
        await this.requireProfile(ctx.userId),
        'network.reported',
        { type: req.targetType, id: req.targetId },
        { reason: req.reason },
      );
      return { reportId: doc._id };
    });
  }

  // ─── invites for people not on the platform ────────────────────────────────

  private toInvite(i: NetworkInviteDoc, token: string | null): NetworkInvite {
    const url = token ? `${this.webBase}/join/n/${token}` : `${this.webBase}/join/n/…`;
    const now = new Date();
    return {
      inviteId: i._id,
      channel: i.channel,
      email: i.email,
      phone: i.phone,
      name: i.name,
      url,
      smsUrl:
        i.channel === 'sms' && i.phone && token
          ? `sms:${i.phone}?&body=${encodeURIComponent(`Join me on Sampledge Connect: ${url}`)}`
          : null,
      delivery: i.delivery,
      status: i.status === 'accepted' ? 'accepted' : i.expiresAt < now ? 'expired' : 'pending',
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
    };
  }

  async createInvite(ctx: TenantContext, input: unknown): Promise<NetworkInvite> {
    const net = await this.assertNetwork(ctx);
    const req = parse(CreateNetworkInviteSchema, input);
    return this.once(ctx, req.clientActionId, async () => {
      await this.rateLimit.consume('network_invite', ctx.userId);
      const me = await this.requireProfile(ctx.userId);
      if (me.homeTenantId && !(await this.policy.get(me.homeTenantId)).enabled)
        throw forbidden('Your organization turned off external connections');
      const token = randomBytes(24).toString('base64url');
      const now = new Date();
      const doc = await net.network_invites.insertOne({
        inviterId: ctx.userId,
        tokenHash: sha256(token),
        channel: req.channel,
        email: req.email ?? null,
        phone: req.phone ?? null,
        name: req.name ?? null,
        circle: req.circle,
        delivery: req.channel === 'email' ? 'not_configured' : null,
        status: 'pending',
        acceptedBy: [],
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
      });
      if (req.channel === 'email' && req.email) {
        const delivery = await this.sendInviteEmail(
          me,
          req.email,
          req.name ?? '',
          `${this.webBase}/join/n/${token}`,
        );
        doc.delivery = delivery;
        await net.network_invites.updateOne({ _id: doc._id }, { $set: { delivery } });
      }
      await this.auditBoth(
        me,
        'network.invite_created',
        { type: 'invite', id: doc._id },
        { channel: req.channel },
      );
      await this.changed([ctx.userId], { scope: 'invites' });
      return this.toInvite(doc, token);
    });
  }

  /** Through the SMTP server set up in Integrations (the inviter's organization, else the platform). */
  private async sendInviteEmail(
    inviter: NetworkProfileDoc,
    email: string,
    name: string,
    url: string,
  ): Promise<'sent' | 'not_configured' | 'failed'> {
    const smtp = await this.settings.get(inviter.homeTenantId, 'smtp').catch(() => null);
    if (!smtp?.enabled || !smtp.values.host || !smtp.values.from) return 'not_configured';
    const v = smtp.values;
    const t = nodemailer.createTransport({
      host: String(v.host),
      port: Number(v.port ?? 587),
      secure: v.security === 'tls',
      requireTLS: v.security === 'starttls',
      ...(v.username ? { auth: { user: String(v.username), pass: String(v.password ?? '') } } : {}),
      connectionTimeout: 15_000,
    });
    const who =
      inviter.displayName +
      (inviter.organizationName && inviter.privacy.showOrganization
        ? ` (${inviter.organizationName})`
        : '');
    const esc = (s: string) =>
      s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    try {
      await t.sendMail({
        from: String(v.from),
        to: { name, address: email },
        subject: `${inviter.displayName} invited you to connect on Sampledge Connect`,
        text: `Hi${name ? ` ${name}` : ''},\n\n${who} would like to connect with you on Sampledge Connect.\n\nCreate your free account and you'll be connected right away:\n${url}\n\nThis link works for 30 days.`,
        html: `<p>Hi${name ? ` ${esc(name)}` : ''},</p><p><strong>${esc(who)}</strong> would like to connect with you on Sampledge Connect.</p><p><a href="${esc(url)}">Create your free account</a> and you'll be connected right away.</p><p style="color:#64748b">This link works for 30 days.</p>`,
      });
      return 'sent';
    } catch {
      return 'failed';
    } finally {
      t.close();
    }
  }

  async invites(ctx: TenantContext): Promise<NetworkInvite[]> {
    const net = await this.assertNetwork(ctx);
    const rows = await net.network_invites
      .find({ inviterId: ctx.userId }, { sort: { createdAt: -1 }, limit: 200 })
      .toArray();
    return rows.map((r) => this.toInvite(r, null));
  }

  async invitePreview(token: string): Promise<NetworkInvitePreview> {
    const net = await this.net();
    const i = await net.network_invites.findOne({ tokenHash: sha256(token) });
    if (!i) throw notFound('Invite');
    const inviter = await this.requireProfile(i.inviterId);
    return { inviter: toPerson(inviter), valid: i.expiresAt > new Date() };
  }

  /** An existing account opens an invite link: connect straight away. */
  async acceptInvite(ctx: TenantContext, token: string): Promise<Connection> {
    const net = await this.assertNetwork(ctx);
    const i = await net.network_invites.findOne({ tokenHash: sha256(token) });
    if (!i || i.expiresAt < new Date()) throw notFound('Invite');
    if (i.inviterId === ctx.userId)
      throw new AppError('VALIDATION_FAILED', 'This is your own invite');
    const me = await this.requireProfile(ctx.userId);
    return this.completeInvite(ctx, me, i);
  }

  private async completeInvite(
    ctx: TenantContext,
    me: NetworkProfileDoc,
    i: NetworkInviteDoc,
  ): Promise<Connection> {
    const net = await this.net();
    const inviter = await this.requireProfile(i.inviterId);
    if (await this.hiddenFor(me.userId).then((h) => h.has(inviter.userId)))
      throw notFound('Invite');
    const reason = await this.policy.pairBlockedReason(me, inviter);
    if (reason) throw forbidden(reason);
    const now = new Date();
    await this.connect(me.userId, inviter.userId, i.circle, i.circle, now);
    await net.network_requests.updateMany(
      { pairKey: pairKey(me.userId, inviter.userId), status: 'pending' },
      { $set: { status: 'accepted', respondedAt: now } },
    );
    await net.network_invites.updateOne(
      { _id: i._id },
      { $set: { status: 'accepted' }, $addToSet: { acceptedBy: me.userId } },
    );
    await this.auditBoth(me, 'network.invite_accepted', { type: 'user', id: inviter.userId });
    await this.changed([me.userId, inviter.userId], { scope: 'connections' });
    await this.changed([inviter.userId], { scope: 'invites' });
    void ctx;
    return this.toConnection(i.circle, now, inviter);
  }

  // ─── directory for network sessions ────────────────────────────────────────

  /**
   * What GET /v1/users returns in the network: you, your connections and the people in your
   * conversations, with no email addresses. Never the whole network.
   */
  async directory(ctx: TenantContext) {
    const net = await this.net();
    const [conns, mine] = await Promise.all([
      net.network_connections
        .find({ userId: ctx.userId }, { projection: { otherUserId: 1 } })
        .toArray(),
      net.conversation_members
        .find({ userId: ctx.userId }, { projection: { conversationId: 1 } })
        .toArray(),
    ]);
    const coMembers = mine.length
      ? await net.conversation_members
          .find(
            { conversationId: { $in: mine.map((m) => m.conversationId) } },
            { projection: { userId: 1 }, limit: 20_000 },
          )
          .toArray()
      : [];
    const ids = [
      ...new Set([
        ctx.userId,
        ...conns.map((c) => c.otherUserId),
        ...coMembers.map((m) => m.userId),
      ]),
    ];
    const [users, profiles] = await Promise.all([
      net.users.find({ _id: { $in: ids } }).toArray(),
      net.network_profiles.find({ userId: { $in: ids } }).toArray(),
    ]);
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    return users.map((u) => {
      const p = byId.get(u._id);
      return {
        ...toUserSummary(u, 'member'),
        displayName: p?.displayName ?? u.displayName,
        email: u._id === ctx.userId ? (p?.email ?? '') : '',
        title: p ? p.headline || (p.privacy.showOrganization ? p.organizationName : null) : u.title,
        handle: p?.handle ?? null,
      };
    });
  }

  /** Audit a community action in the network and in the actor's organization. */
  async audit_(
    ctx: TenantContext,
    action: string,
    communityId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.auditBoth(
      await this.requireProfile(ctx.userId),
      action,
      { type: 'community', id: communityId },
      metadata,
    );
  }

  async newId() {
    return newId();
  }
}
