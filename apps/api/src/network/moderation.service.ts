import { Injectable } from '@nestjs/common';
import {
  ModerationActionSchema,
  ModerationQuerySchema,
  REPORT_STATUSES,
  ReportSchema,
  type ModerationActionKind,
  type ModerationQueue,
  type ModerationReport,
  type NetworkSuspensions,
  type ReportStatus,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { PlatformAdmins } from '../common/platform-admins.js';
import type { CommunityDoc, NetworkProfileDoc, NetworkReportDoc } from '../database/documents.js';
import { TenantDb, type ScopedDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { RateLimitService } from '../redis/redis.module.js';
import { CommunitiesService } from './communities.service.js';
import { NetworkGate } from './network-gate.js';
import { NetworkService, toPerson } from './network.service.js';
import { StatusService } from './status.service.js';

const SUSPENDED = { $type: 'date' } as const;
const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Who is acting on a report: a platform operator, or a moderator of one community. */
type Moderator =
  | { kind: 'platform'; ctx: TenantContext; name: string }
  | { kind: 'community'; ctx: TenantContext; name: string; community: CommunityDoc };

const ALLOWED: Record<Moderator['kind'], ModerationActionKind[]> = {
  platform: ['dismiss', 'remove_content', 'suspend_user', 'suspend_community'],
  community: ['dismiss', 'remove_content', 'ban_from_community'],
};

/**
 * Reports and moderation for SampConnect Network (docs/network.md → Moderation).
 * Anyone reports a person, status, community or message they can see. Platform operators
 * (PLATFORM_ADMIN_EMAILS) review every report in Administration → SampConnect Network.
 * Community owners, admins and moderators review reports about messages in their groups.
 * Every action resolves all open reports about the same thing and syncs live.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly network: NetworkService,
    private readonly statuses: StatusService,
    private readonly communities: CommunitiesService,
    private readonly messages: MessagesService,
    private readonly sessions: SessionService,
    private readonly gate: NetworkGate,
    private readonly realtime: RealtimePublisher,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly platformAdmins: PlatformAdmins,
    private readonly db: TenantDb,
  ) {}

  // ─── reporting (network sessions) ─────────────────────────────────────────

  async report(ctx: TenantContext, input: unknown): Promise<{ reportId: string }> {
    const net = await this.network.assertNetwork(ctx);
    const req = parse(ReportSchema, input);
    return this.network.once(ctx, req.clientActionId, async () => {
      await this.rateLimit.consume('network_request', `report:${ctx.userId}`);
      const t = await this.resolveTarget(net, ctx.userId, req.targetType, req.targetId);
      if (t.subjectUserId === ctx.userId && req.targetType === 'user')
        throw new AppError('VALIDATION_FAILED', "You can't report yourself");
      const doc = await net.network_reports.insertOne({
        reporterId: ctx.userId,
        targetType: req.targetType,
        targetId: req.targetId,
        reason: req.reason,
        details: req.details,
        status: 'open',
        createdAt: new Date(),
        subjectUserId: t.subjectUserId,
        communityId: t.communityId,
        snapshot: t.snapshot,
        resolution: null,
      });
      await this.network.auditBoth(
        await this.network.requireProfile(ctx.userId),
        'network.reported',
        { type: req.targetType, id: req.targetId },
        { reason: req.reason },
      );
      await this.notify(doc);
      return { reportId: doc._id };
    });
  }

  /** The reporter must be able to see it; captures whose it is and what it said. */
  private async resolveTarget(
    net: ScopedDb,
    reporterId: string,
    type: NetworkReportDoc['targetType'],
    id: string,
  ): Promise<{ subjectUserId: string | null; communityId: string | null; snapshot: string }> {
    if (type === 'user') {
      const p = await net.network_profiles.findOne({ userId: id });
      if (!p || (await this.network.hiddenFor(reporterId)).has(id)) throw notFound('Person');
      return {
        subjectUserId: id,
        communityId: null,
        snapshot: clip(`${p.displayName} (@${p.handle})${p.headline ? ` · ${p.headline}` : ''}`),
      };
    }
    if (type === 'status') {
      const s = await this.statuses.visibleTo(reporterId, id);
      if (!s) throw notFound('Status');
      const media = s.kind === 'text' ? '' : s.kind === 'image' ? '[Photo] ' : '[Video] ';
      return { subjectUserId: s.authorId, communityId: null, snapshot: clip(media + s.text) };
    }
    if (type === 'community') {
      const c = await net.communities.findOne({ _id: id });
      if (!c || c.suspendedAt) throw notFound('Community');
      if (c.visibility === 'private') {
        const m = await net.community_members.findOne({ communityId: id, userId: reporterId });
        if (!m || m.status === 'banned') throw notFound('Community');
      }
      return {
        subjectUserId: c.ownerId,
        communityId: c._id,
        snapshot: clip(`${c.name}${c.description ? ` · ${c.description}` : ''}`),
      };
    }
    const msg = await net.messages.findOne({ _id: id });
    if (!msg || msg.deletedAt) throw notFound('Message');
    const member = await net.conversation_members.findOne({
      conversationId: msg.conversationId,
      userId: reporterId,
    });
    if (!member) throw notFound('Message');
    const conv = await net.conversations.findOne({ _id: msg.conversationId });
    const files = msg.attachments?.length
      ? `[${msg.attachments.length} attachment${msg.attachments.length > 1 ? 's' : ''}] `
      : '';
    return {
      subjectUserId: msg.senderId,
      communityId: conv?.communityId ?? null,
      snapshot: clip(files + (msg.content.text ?? '')),
    };
  }

  // ─── who may moderate ─────────────────────────────────────────────────────

  /** Platform operators act from their work session (Administration). */
  private async operator(ctx: TenantContext): Promise<Moderator> {
    if (await this.network.isNetworkTenant(ctx.tenantId)) throw forbidden();
    await this.platformAdmins.assert(ctx);
    const u = await this.db
      .for(ctx.tenantId)
      .users.findOne({ _id: ctx.userId }, { projection: { displayName: 1 } });
    return { kind: 'platform', ctx, name: `${u?.displayName ?? 'Operator'} (SampConnect)` };
  }

  private async communityModerator(ctx: TenantContext, communityId: string): Promise<Moderator> {
    await this.network.assertNetwork(ctx);
    const { c } = await this.communities.asModerator(ctx, communityId);
    const me = await this.network.requireProfile(ctx.userId);
    return { kind: 'community', ctx, name: me.displayName, community: c };
  }

  // ─── queues ───────────────────────────────────────────────────────────────

  async platformQueue(ctx: TenantContext, query: unknown): Promise<ModerationQueue> {
    await this.operator(ctx);
    const { status } = parse(ModerationQuerySchema, query);
    return this.queue({}, status);
  }

  async communityQueue(ctx: TenantContext, id: string, query: unknown): Promise<ModerationQueue> {
    const m = await this.communityModerator(ctx, id);
    const { status } = parse(ModerationQuerySchema, query);
    return this.queue(this.communityFilter(m), status);
  }

  /** A community's moderators see reports about messages in its groups. */
  private communityFilter(m: Moderator): Record<string, unknown> {
    return m.kind === 'community' ? { communityId: m.community._id, targetType: 'message' } : {};
  }

  /** One card per reported thing (the newest report; the rest count as "also reported"). */
  private async queue(scope: Record<string, unknown>, status: ReportStatus) {
    const net = await this.network.net();
    const distinct = (s: ReportStatus) =>
      net.network_reports
        .aggregate<{ n: number }>([
          { $match: { ...scope, status: s } },
          { $group: { _id: { t: '$targetType', id: '$targetId' } } },
          { $count: 'n' },
        ])
        .toArray()
        .then((r) => r[0]?.n ?? 0);
    const [rows, ...counts] = await Promise.all([
      net.network_reports
        .find({ ...scope, status } as never, { sort: { createdAt: -1 }, limit: 500 })
        .toArray(),
      ...REPORT_STATUSES.map(distinct),
    ]);
    const seen = new Set<string>();
    const firsts = rows
      .filter((r) => {
        const k = `${r.targetType}:${r.targetId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 200);
    return {
      reports: await this.toDtos(net, firsts),
      counts: Object.fromEntries(REPORT_STATUSES.map((s, i) => [s, counts[i]!])) as Record<
        ReportStatus,
        number
      >,
    };
  }

  private async toDtos(net: ScopedDb, rows: NetworkReportDoc[]): Promise<ModerationReport[]> {
    if (!rows.length) return [];
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.reporterId, r.subjectUserId].filter((x): x is string => !!x)),
      ),
    ];
    const communityIds = [
      ...new Set(rows.map((r) => r.communityId).filter((x): x is string => !!x)),
    ];
    const byType = (t: string) => rows.filter((r) => r.targetType === t).map((r) => r.targetId);
    const [profiles, communities, msgs, statuses, open] = await Promise.all([
      net.network_profiles.find({ userId: { $in: userIds } }).toArray(),
      net.communities.find({ _id: { $in: communityIds } }).toArray(),
      net.messages
        .find({ _id: { $in: byType('message') } }, { projection: { deletedAt: 1 } })
        .toArray(),
      net.network_statuses
        .find(
          { _id: { $in: byType('status') }, expiresAt: { $gt: new Date() } },
          { projection: { _id: 1 } },
        )
        .toArray(),
      net.network_reports
        .aggregate<{ _id: string; n: number }>([
          { $match: { status: 'open', targetId: { $in: rows.map((r) => r.targetId) } } },
          { $group: { _id: { $concat: ['$targetType', ':', '$targetId'] }, n: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    const people = new Map(profiles.map((p) => [p.userId, p]));
    const comms = new Map(communities.map((c) => [c._id, c]));
    const removedMsgs = new Set(msgs.filter((m) => m.deletedAt).map((m) => m._id));
    const liveMsgs = new Set(msgs.map((m) => m._id));
    const liveStatuses = new Set(statuses.map((s) => s._id));
    const openCount = new Map(open.map((o) => [o._id, o.n]));
    return rows.map((r) => {
      const subject = r.subjectUserId ? people.get(r.subjectUserId) : undefined;
      const community = r.communityId ? comms.get(r.communityId) : undefined;
      let targetState: ModerationReport['targetState'] = 'active';
      if (r.targetType === 'message' && (removedMsgs.has(r.targetId) || !liveMsgs.has(r.targetId)))
        targetState = 'removed';
      if (r.targetType === 'status' && !liveStatuses.has(r.targetId)) targetState = 'removed';
      if (r.targetType === 'community' && !community) targetState = 'removed';
      if (
        targetState === 'active' &&
        (subject?.suspendedAt || (r.targetType !== 'user' && community?.suspendedAt))
      )
        targetState = 'suspended';
      if (r.targetType === 'user' && subject?.suspendedAt) targetState = 'suspended';
      const n = openCount.get(`${r.targetType}:${r.targetId}`) ?? 0;
      return {
        reportId: r._id,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason as ModerationReport['reason'],
        details: r.details,
        status: r.status === ('reviewed' as string) ? 'dismissed' : r.status,
        reporter: people.has(r.reporterId) ? toPerson(people.get(r.reporterId)!) : null,
        subject: subject ? toPerson(subject) : null,
        community: community
          ? { communityId: community._id, name: community.name, slug: community.slug }
          : null,
        snapshot: r.snapshot ?? '',
        targetState,
        alsoReported: Math.max(0, n - (r.status === 'open' ? 1 : 0)),
        createdAt: r.createdAt.toISOString(),
        resolution: r.resolution
          ? {
              action: r.resolution.action,
              note: r.resolution.note,
              by: r.resolution.byName,
              at: r.resolution.at.toISOString(),
            }
          : null,
      };
    });
  }

  // ─── acting on a report ───────────────────────────────────────────────────

  async platformAct(ctx: TenantContext, reportId: string, input: unknown) {
    return this.act(await this.operator(ctx), reportId, input);
  }

  async communityAct(ctx: TenantContext, communityId: string, reportId: string, input: unknown) {
    return this.act(await this.communityModerator(ctx, communityId), reportId, input);
  }

  private async act(mod: Moderator, reportId: string, input: unknown): Promise<ModerationReport> {
    const req = parse(ModerationActionSchema, input);
    const net = await this.network.net();
    return this.network.once(mod.ctx, req.clientActionId, async () => {
      const r = await net.network_reports.findOne({
        _id: reportId,
        ...this.communityFilter(mod),
      } as never);
      if (!r) throw notFound('Report');
      if (!ALLOWED[mod.kind].includes(req.action)) throw forbidden('You can’t do that from here');
      const reason = req.note || `Reported for ${r.reason}`;
      switch (req.action) {
        case 'dismiss':
          break;
        case 'remove_content':
          if (r.targetType === 'message') {
            await this.messages.removeAsModerator(
              (await this.network.ids()).tenantId,
              r.targetId,
              mod.ctx.userId,
            );
          } else if (r.targetType === 'status' && mod.kind === 'platform') {
            await this.statuses.removeAsModerator(r.targetId, mod.ctx.userId);
          } else
            throw new AppError(
              'VALIDATION_FAILED',
              'Only messages and status updates can be removed. Suspend the person or community instead.',
            );
          break;
        case 'suspend_user':
          if (!r.subjectUserId) throw new AppError('VALIDATION_FAILED', 'No one to suspend');
          await this.suspendUser(r.subjectUserId, reason);
          break;
        case 'suspend_community': {
          const c = r.communityId ? await net.communities.findOne({ _id: r.communityId }) : null;
          if (!c) throw new AppError('VALIDATION_FAILED', 'This report is not about a community');
          await this.communities.suspend(c, reason);
          break;
        }
        case 'ban_from_community':
          if (mod.kind !== 'community' || !r.subjectUserId)
            throw new AppError('VALIDATION_FAILED', 'No one to remove');
          await this.communities.remove(mod.ctx, mod.community._id, r.subjectUserId, true);
          break;
      }
      const resolution = { action: req.action, note: req.note, byName: mod.name, at: new Date() };
      const status: ReportStatus = req.action === 'dismiss' ? 'dismissed' : 'actioned';
      // Dismissing closes just this report; an action closes every open report about it.
      await net.network_reports.updateMany(
        req.action === 'dismiss'
          ? { _id: r._id }
          : { targetType: r.targetType, targetId: r.targetId, status: 'open' },
        { $set: { status, resolution } },
      );
      await this.record(mod, `network.moderation.${req.action}`, r, req.note);
      await this.notify(r, req.action.startsWith('suspend'));
      const [dto] = await this.toDtos(net, [(await net.network_reports.findOne({ _id: r._id }))!]);
      return dto!;
    });
  }

  private async suspendUser(userId: string, reason: string) {
    const { tenantId } = await this.network.ids();
    const net = await this.network.net();
    const res = await net.network_profiles.updateOne(
      { userId, suspendedAt: { $not: SUSPENDED } } as never,
      { $set: { suspendedAt: new Date(), suspendedReason: reason } },
    );
    if (!res.modifiedCount) return;
    this.gate.forget(userId);
    await this.sessions.revokeAllForUser(tenantId, userId, 'network_suspended');
    this.realtime.toUser(tenantId, userId, 'session:expired', { reason: 'revoked' });
    await this.network.changed(await this.circle(userId), { scope: 'connections' });
  }

  /** People who see this person in their lists (connections and followers). */
  private async circle(userId: string): Promise<string[]> {
    const net = await this.network.net();
    const [a, b] = await Promise.all([
      net.network_connections.find({ userId }, { projection: { otherUserId: 1 } }).toArray(),
      net.network_follows
        .find({ targetType: 'user', targetId: userId }, { projection: { followerId: 1 } })
        .toArray(),
    ]);
    return [...a.map((x) => x.otherUserId), ...b.map((x) => x.followerId)];
  }

  // ─── suspensions (platform operators) ────────────────────────────────────

  async suspensions(ctx: TenantContext): Promise<NetworkSuspensions> {
    await this.operator(ctx);
    const net = await this.network.net();
    const [users, communities] = await Promise.all([
      net.network_profiles
        .find({ suspendedAt: SUSPENDED } as never, { sort: { suspendedAt: -1 }, limit: 500 })
        .toArray(),
      net.communities
        .find({ suspendedAt: SUSPENDED } as never, { sort: { suspendedAt: -1 }, limit: 500 })
        .toArray(),
    ]);
    return {
      users: users.map((p: NetworkProfileDoc) => ({
        person: toPerson(p),
        suspendedAt: p.suspendedAt!.toISOString(),
        reason: p.suspendedReason ?? '',
      })),
      communities: communities.map((c) => ({
        communityId: c._id,
        name: c.name,
        slug: c.slug,
        suspendedAt: c.suspendedAt!.toISOString(),
        reason: c.suspendedReason ?? '',
      })),
    };
  }

  async restoreUser(ctx: TenantContext, userId: string): Promise<void> {
    const mod = await this.operator(ctx);
    const net = await this.network.net();
    const res = await net.network_profiles.updateOne({ userId, suspendedAt: SUSPENDED } as never, {
      $set: { suspendedAt: null, suspendedReason: '' },
    });
    if (!res.modifiedCount) return;
    this.gate.forget(userId);
    await this.record(mod, 'network.moderation.restore_user', {
      targetType: 'user',
      targetId: userId,
    });
    await this.network.changed([userId, ...(await this.circle(userId))], { scope: 'connections' });
    this.realtime.toModerators('moderation:changed', { scope: 'suspensions' });
    this.realtime.toModerators('moderation:changed', { scope: 'reports' });
  }

  async restoreCommunity(ctx: TenantContext, communityId: string): Promise<void> {
    const mod = await this.operator(ctx);
    await this.communities.restore(communityId);
    await this.record(mod, 'network.moderation.restore_community', {
      targetType: 'community',
      targetId: communityId,
    });
    this.realtime.toModerators('moderation:changed', { scope: 'suspensions' });
    this.realtime.toModerators('moderation:changed', { scope: 'reports' });
  }

  // ─── audit and live updates ───────────────────────────────────────────────

  /** In the network's audit log, and the operator's own organization's for platform actions. */
  private async record(
    mod: Moderator,
    action: string,
    r: Pick<NetworkReportDoc, 'targetType' | 'targetId'> & { _id?: string },
    note = '',
  ) {
    const { tenantId } = await this.network.ids();
    const target = { type: r.targetType, id: r.targetId };
    const metadata = { reportId: r._id ?? null, note, by: mod.kind };
    await this.audit.record({ tenantId, actorId: mod.ctx.userId, action, target, metadata });
    if (mod.kind === 'platform')
      await this.audit.record({
        tenantId: mod.ctx.tenantId,
        actorId: mod.ctx.userId,
        action,
        target,
        metadata: { ...metadata, network: true },
      });
  }

  private async notify(r: NetworkReportDoc, suspensions = false) {
    this.realtime.toModerators('moderation:changed', { scope: 'reports' });
    if (suspensions) this.realtime.toModerators('moderation:changed', { scope: 'suspensions' });
    if (r.communityId && r.targetType === 'message') {
      const net = await this.network.net();
      await this.network.changed(await this.communities.admins(net, r.communityId), {
        scope: 'reports',
        id: r.communityId,
      });
    }
  }
}
