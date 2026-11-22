import { Controller, Get, Injectable, Query, UseGuards } from '@nestjs/common';
import type { Document } from 'mongodb';
import {
  AnalyticsQuerySchema,
  RANGE_DAYS,
  daysBetween,
  type AnalyticsResponse,
  type AnalyticsTotals,
  tenantCan,
} from '@sampledge/contracts';
import { AppError, forbidden, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { TenantDb } from '../database/tenant-db.js';
import { WorkStore } from '../integrations/collections.js';

const MAX_MS = 5000;
const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * GET /v1/analytics: activity over the last 7, 30 or 90 days. Owners and admins can see the
 * whole organization (scope=org); everyone can see their own (scope=me). Read-only and computed
 * on request; the web caches the last result per range for offline viewing.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: TenantDb,
    private readonly work: WorkStore,
  ) {}

  async get(ctx: TenantContext, raw: unknown): Promise<AnalyticsResponse> {
    const q = parse(AnalyticsQuerySchema, raw);
    if (q.scope === 'org' && !tenantCan(ctx, 'analytics.org'))
      throw forbidden('Organization analytics are for owners and admins');
    if (!validZone(q.tz)) throw new AppError('VALIDATION_FAILED', 'Unknown time zone');
    const days = RANGE_DAYS[q.range];
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const prevFrom = new Date(from.getTime() - days * 86_400_000);
    const me = q.scope === 'me' ? ctx.userId : null;
    const t = this.db.for(ctx.tenantId);

    const msgMatch = (a: Date, b: Date): Document => ({
      createdAt: { $gte: a, $lt: b },
      deletedAt: null,
      messageType: 'text',
      ...(me ? { senderId: me } : {}),
    });

    const [totals, previous, daily, heat, convRows, people, callDaily] = await Promise.all([
      this.totals(ctx, me, from, to),
      this.totals(ctx, me, prevFrom, from),
      t.messages
        .aggregate<{ _id: string; n: number; s: string[] }>(
          [
            { $match: msgMatch(from, to) },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: q.tz } },
                n: { $sum: 1 },
                s: { $addToSet: me ? '$conversationId' : '$senderId' },
              },
            },
          ],
          { maxTimeMS: MAX_MS },
        )
        .toArray(),
      t.messages
        .aggregate<{ _id: { d: number; h: number }; n: number }>(
          [
            { $match: msgMatch(from, to) },
            {
              $group: {
                _id: {
                  d: { $dayOfWeek: { date: '$createdAt', timezone: q.tz } },
                  h: { $hour: { date: '$createdAt', timezone: q.tz } },
                },
                n: { $sum: 1 },
              },
            },
          ],
          { maxTimeMS: MAX_MS },
        )
        .toArray(),
      t.messages
        .aggregate<{ _id: string; n: number; s: string[] }>(
          [
            { $match: msgMatch(from, to) },
            { $group: { _id: '$conversationId', n: { $sum: 1 }, s: { $addToSet: '$senderId' } } },
            { $sort: { n: -1 } },
            { $limit: 2000 },
          ],
          { maxTimeMS: MAX_MS },
        )
        .toArray(),
      me
        ? Promise.resolve([])
        : t.messages
            .aggregate<{ _id: string; n: number }>(
              [
                { $match: msgMatch(from, to) },
                { $group: { _id: '$senderId', n: { $sum: 1 } } },
                { $sort: { n: -1 } },
                { $limit: 8 },
              ],
              { maxTimeMS: MAX_MS },
            )
            .toArray(),
      this.callMinutesByDay(ctx, me, from, to, q.tz),
    ]);

    const byDay = new Map(daily.map((d) => [d._id, d]));
    const dailyRows = daysBetween(from, to, q.tz).map((date) => ({
      date,
      messages: byDay.get(date)?.n ?? 0,
      activePeople: byDay.get(date)?.s.length ?? 0,
      callMinutes: callDaily.get(date) ?? 0,
    }));

    const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const h of heat) heatmap[h._id.d - 1]![h._id.h] = h.n;

    const convs = convRows.length
      ? await t.conversations
          .find(
            { _id: { $in: convRows.map((c) => c._id) } },
            { projection: { kind: 1, name: 1, memberIds: 1 } },
          )
          .toArray()
      : [];
    const convById = new Map(convs.map((c) => [c._id, c]));
    const byKind = { dm: 0, group: 0, channel: 0 };
    const dmSenders = new Set<string>();
    let dmCount = 0;
    const named: AnalyticsResponse['topConversations'] = [];
    for (const r of convRows) {
      const c = convById.get(r._id);
      if (!c) continue;
      if (c.kind === 'dm') {
        byKind.dm += r.n;
        dmCount += r.n;
        r.s.forEach((s) => dmSenders.add(s));
        continue;
      }
      if (c.kind === 'group') byKind.group += r.n;
      else byKind.channel += r.n;
      named.push({
        conversationId: c._id,
        name: c.name ?? 'Group',
        kind: c.kind,
        messages: r.n,
        people: r.s.length,
      });
    }
    if (dmCount)
      named.push({
        conversationId: null,
        name: 'Direct messages',
        kind: 'dm',
        messages: dmCount,
        people: dmSenders.size,
      });
    named.sort((a, b) => b.messages - a.messages);

    return {
      range: q.range,
      scope: q.scope,
      tz: q.tz,
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      totals,
      previous,
      daily: dailyRows,
      heatmap,
      topConversations: named.slice(0, 8),
      topPeople: people.map((p) => ({ userId: p._id, messages: p.n })),
      byKind,
    };
  }

  private async totals(
    ctx: TenantContext,
    me: string | null,
    from: Date,
    to: Date,
  ): Promise<AnalyticsTotals> {
    const t = this.db.for(ctx.tenantId);
    const w = this.work.for(ctx.tenantId);
    const range = { $gte: from, $lt: to };
    const [msg, files, calls, meetings, tasksCreated, tasksCompleted, approvals] =
      await Promise.all([
        t.messages
          .aggregate<{ n: number; s: string[]; c: string[] }>(
            [
              {
                $match: {
                  createdAt: range,
                  deletedAt: null,
                  messageType: 'text',
                  ...(me ? { senderId: me } : {}),
                },
              },
              {
                $group: {
                  _id: null,
                  n: { $sum: 1 },
                  s: { $addToSet: '$senderId' },
                  c: { $addToSet: '$conversationId' },
                },
              },
            ],
            { maxTimeMS: MAX_MS },
          )
          .toArray(),
        t.attachments.countDocuments(
          {
            createdAt: range,
            messageId: { $ne: null },
            deletedAt: null,
            recording: null,
            ...(me ? { uploaderId: me } : {}),
          },
          { maxTimeMS: MAX_MS },
        ),
        this.callMinutes(ctx, me, from, to),
        t.meetings.countDocuments(
          {
            startsAt: range,
            status: 'scheduled',
            ...(me ? { $or: [{ organizerId: me }, { 'attendees.userId': me }] } : {}),
          },
          { maxTimeMS: MAX_MS },
        ),
        w.tasks.countDocuments(
          {
            createdAt: range,
            ...(me ? { $or: [{ createdBy: me }, { assigneeIds: me }] } : {}),
          },
          { maxTimeMS: MAX_MS },
        ),
        w.tasks.countDocuments(
          { completedAt: range, ...(me ? { assigneeIds: me } : {}) },
          { maxTimeMS: MAX_MS },
        ),
        w.approvals
          .find(
            {
              decidedAt: range,
              status: { $in: ['approved', 'rejected'] },
              ...(me ? { $or: [{ requesterId: me }, { approverIds: me }] } : {}),
            },
            { projection: { createdAt: 1, decidedAt: 1 }, maxTimeMS: MAX_MS },
          )
          .limit(5000)
          .toArray(),
      ]);
    const m = msg[0];
    const hours = median(
      approvals
        .filter((a) => a.decidedAt)
        .map((a) => (a.decidedAt!.getTime() - a.createdAt.getTime()) / 3_600_000),
    );
    return {
      messages: m?.n ?? 0,
      activePeople: me ? (m?.c.length ?? 0) : (m?.s.length ?? 0),
      activeConversations: m?.c.length ?? 0,
      filesShared: files,
      callMinutes: calls,
      meetings,
      tasksCreated,
      tasksCompleted,
      approvalsDecided: approvals.length,
      medianApprovalHours: hours === null ? null : Math.round(hours * 10) / 10,
    };
  }

  /** Ended calls that started in the period: minutes on the call (yours, for scope=me). */
  private async callRows(ctx: TenantContext, me: string | null, from: Date, to: Date) {
    const calls = await this.db
      .for(ctx.tenantId)
      .calls.find(
        {
          startedAt: { $gte: from, $lt: to },
          status: 'ended',
          ...(me ? { 'participants.userId': me } : {}),
        },
        { projection: { startedAt: 1, endedAt: 1, participants: 1 }, maxTimeMS: MAX_MS },
      )
      .limit(20_000)
      .toArray();
    return calls.map((c) => {
      let ms = 0;
      if (me) {
        const p = c.participants.find((x) => x.userId === me);
        if (p?.joinedAt)
          ms = (p.leftAt ?? c.endedAt ?? p.joinedAt).getTime() - p.joinedAt.getTime();
      } else if (c.endedAt && c.participants.some((p) => p.joinedAt)) {
        ms = c.endedAt.getTime() - c.startedAt.getTime();
      }
      return { startedAt: c.startedAt, minutes: Math.max(0, ms) / 60_000 };
    });
  }

  private async callMinutes(ctx: TenantContext, me: string | null, from: Date, to: Date) {
    const rows = await this.callRows(ctx, me, from, to);
    return Math.round(rows.reduce((s, r) => s + r.minutes, 0));
  }

  private async callMinutesByDay(
    ctx: TenantContext,
    me: string | null,
    from: Date,
    to: Date,
    tz: string,
  ) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const out = new Map<string, number>();
    for (const r of await this.callRows(ctx, me, from, to)) {
      const d = fmt.format(r.startedAt);
      out.set(d, (out.get(d) ?? 0) + r.minutes);
    }
    for (const [k, v] of out) out.set(k, Math.round(v));
    return out;
  }
}

@Controller('v1/analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  get(@Ctx() ctx: TenantContext, @Query() q: Record<string, string>) {
    return this.analytics.get(ctx, q);
  }
}
