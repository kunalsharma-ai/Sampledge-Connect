import { z } from 'zod';

/**
 * Analytics: how the organization (admins) or you (everyone) use SampConnect over a period.
 * Computed on request from messages, calls, meetings, tasks and approvals. Names of direct
 * messages never appear; they are counted together as "Direct messages".
 */
export const ANALYTICS_RANGES = ['7d', '30d', '90d'] as const;
export const AnalyticsRangeSchema = z.enum(ANALYTICS_RANGES);
export type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>;
export const RANGE_DAYS: Record<AnalyticsRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

export const AnalyticsQuerySchema = z.object({
  range: AnalyticsRangeSchema.default('30d'),
  /** 'org' needs owner or admin. */
  scope: z.enum(['org', 'me']).default('me'),
  /** IANA zone for days and hours. */
  tz: z.string().min(1).max(64).default('UTC'),
});
export type AnalyticsQuery = z.input<typeof AnalyticsQuerySchema>;

export const AnalyticsTotalsSchema = z.object({
  messages: z.number().int(),
  /** People who sent at least one message (org), or conversations you posted in (me). */
  activePeople: z.number().int(),
  activeConversations: z.number().int(),
  filesShared: z.number().int(),
  callMinutes: z.number().int(),
  meetings: z.number().int(),
  tasksCreated: z.number().int(),
  tasksCompleted: z.number().int(),
  approvalsDecided: z.number().int(),
  /** Median hours from request to decision, null when nothing was decided. */
  medianApprovalHours: z.number().nullable(),
});
export type AnalyticsTotals = z.infer<typeof AnalyticsTotalsSchema>;

export const AnalyticsDaySchema = z.object({
  /** YYYY-MM-DD in the requested time zone. */
  date: z.string(),
  messages: z.number().int(),
  activePeople: z.number().int(),
  callMinutes: z.number().int(),
});

export const AnalyticsResponseSchema = z.object({
  range: AnalyticsRangeSchema,
  scope: z.enum(['org', 'me']),
  tz: z.string(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  generatedAt: z.string().datetime(),
  totals: AnalyticsTotalsSchema,
  /** The same totals for the period before, for trends. */
  previous: AnalyticsTotalsSchema,
  /** One row per day, oldest first, days without activity included. */
  daily: z.array(AnalyticsDaySchema),
  /** Messages by weekday (0 = Sunday) and hour: 7 rows of 24. */
  heatmap: z.array(z.array(z.number().int()).length(24)).length(7),
  /** Busiest conversations. DMs are grouped under one row with conversationId null. */
  topConversations: z.array(
    z.object({
      conversationId: z.string().nullable(),
      name: z.string(),
      kind: z.enum(['dm', 'group', 'channel_public', 'channel_private']),
      messages: z.number().int(),
      people: z.number().int(),
    }),
  ),
  /** Most active senders (org scope only; empty for 'me'). */
  topPeople: z.array(z.object({ userId: z.string(), messages: z.number().int() })),
  /** Messages by conversation kind. */
  byKind: z.object({ dm: z.number().int(), group: z.number().int(), channel: z.number().int() }),
});
export type AnalyticsResponse = z.infer<typeof AnalyticsResponseSchema>;

/** Percentage change, rounded; null when there is no earlier value to compare with. */
export function trend(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

/** Calendar days (YYYY-MM-DD) in `tz` from `from` up to `to`, inclusive. */
export function daysBetween(from: Date, to: Date, tz: string): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const out: string[] = [];
  for (let t = from.getTime(); t <= to.getTime() + 1; t += 3_600_000) {
    const d = fmt.format(new Date(t));
    if (out.at(-1) !== d) out.push(d);
  }
  const last = fmt.format(to);
  if (out.at(-1) !== last) out.push(last);
  return out;
}
