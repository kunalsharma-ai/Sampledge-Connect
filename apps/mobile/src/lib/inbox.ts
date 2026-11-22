import {
  CONNECTOR_CATALOG,
  type ConnectorProvider,
  type InboxConversation,
  type InboxConversationDetail,
  type InboxMessage,
  type InboxNote,
  type InboxPriority,
  type InboxStatus,
  type InboxTimelineItem,
  type ListInboxQuery,
  type UpdateInboxConversationRequest,
} from '@sampledge/contracts';

/**
 * Client Inbox on the phone: the same views, filters and overlays as the web inbox
 * (apps/web/components/workspace/inbox), kept pure so they can be tested without a device.
 */

export type InboxView = 'mine' | 'unassigned' | 'active' | 'breached' | 'resolved';

export const INBOX_VIEWS: { key: InboxView; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'active', label: 'All open' },
  { key: 'breached', label: 'Overdue' },
  { key: 'resolved', label: 'Resolved' },
];

export const VIEW_QUERY: Record<InboxView, ListInboxQuery> = {
  mine: { assignee: 'me', status: 'active' },
  unassigned: { assignee: 'unassigned', status: 'active' },
  active: { status: 'active' },
  breached: { sla: 'breached', status: 'active' },
  resolved: { status: 'resolved' },
};

export interface InboxListFilter {
  view: InboxView;
  provider?: ConnectorProvider | null;
  q?: string;
}

/** The server query for a view, a channel and a search. */
export function inboxQuery(f: InboxListFilter): ListInboxQuery {
  return {
    ...VIEW_QUERY[f.view],
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.q?.trim() ? { q: f.q.trim() } : {}),
  };
}

/** `/v1/inbox/conversations?...` with stable parameter order (it is also the cache key). */
export function inboxListPath(q: ListInboxQuery): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(q).sort()) {
    const v = (q as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return `/v1/inbox/conversations${s ? `?${s}` : ''}`;
}

const ACTIVE: ReadonlySet<InboxStatus> = new Set(['open', 'pending', 'snoozed']);

/**
 * Whether a conversation still belongs in a view after a change made on this phone (resolving
 * one takes it out of Mine at once, assigning it takes it out of Unassigned). Search and
 * channel are the server's filters; a queued change never moves a conversation between them.
 */
export function inViewAfterChange(c: InboxConversation, view: InboxView, self: string): boolean {
  switch (view) {
    case 'mine':
      return ACTIVE.has(c.status) && c.assigneeId === self;
    case 'unassigned':
      return ACTIVE.has(c.status) && c.assigneeId === null;
    case 'active':
      return ACTIVE.has(c.status);
    case 'breached':
      return ACTIVE.has(c.status) && c.sla.state === 'breached';
    case 'resolved':
      return c.status === 'resolved';
  }
}

// --------------------------------------------------------------- changes waiting on this phone

/** A reply or note made on this phone that has not reached the server (or was refused). */
export interface PendingInboxPost {
  actionId: string;
  kind: 'reply' | 'note';
  inboxId: string;
  /** clientMessageId or clientNoteId (the server dedupes on it). */
  clientId: string;
  text: string;
  createdAt: string;
  /** The server refused it; shown with Retry and Discard. */
  error: string | null;
}

export interface PendingInbox {
  posts: PendingInboxPost[];
  /** Field changes per conversation, merged (the latest choice per field wins). */
  updates: Record<string, UpdateInboxConversationRequest>;
  /** Conversations marked read here and not confirmed yet. */
  reads: ReadonlySet<string>;
}

export const NO_PENDING: PendingInbox = { posts: [], updates: {}, reads: new Set() };

/** A conversation as it will be once this phone's waiting changes land. */
export function overlayConversation<T extends InboxConversation>(c: T, p: PendingInbox): T {
  let out: T = c;
  const patch = p.updates[c.conversationId];
  if (patch) {
    const { subject, ...rest } = patch;
    out = { ...out, ...rest, ...(subject !== undefined ? { subject } : {}) };
    if (patch.status && patch.status !== 'snoozed') out = { ...out, snoozedUntil: null };
  }
  if (p.reads.has(c.conversationId)) out = { ...out, unread: false };
  const mine = p.posts.filter((x) => x.inboxId === c.conversationId && x.kind === 'reply');
  const last = mine[mine.length - 1];
  if (last && (!out.lastMessage || out.lastMessage.at <= last.createdAt))
    out = {
      ...out,
      lastMessage: { direction: 'outbound', preview: last.text.slice(0, 140), at: last.createdAt },
      awaitingReply: 0,
    };
  return out;
}

/** A list with waiting changes laid over; conversations a change moved out of the view go. */
export function overlayList(
  items: InboxConversation[],
  p: PendingInbox,
  view: InboxView,
  self: string,
): InboxConversation[] {
  return items
    .map((c) => {
      const o = overlayConversation(c, p);
      return p.updates[c.conversationId] && !inViewAfterChange(o, view, self) ? null : o;
    })
    .filter((c): c is InboxConversation => c !== null);
}

/** A reply shown before the server has it ("Queued offline", or "Not sent" when refused). */
export type LocalInboxMessage = InboxMessage & { pendingLocal?: true; syncError?: string | null };
export type LocalInboxNote = InboxNote & { pendingLocal?: true; syncError?: string | null };
export type LocalTimelineItem =
  | { type: 'message'; message: LocalInboxMessage; actionId?: string }
  | { type: 'note'; note: LocalInboxNote; actionId?: string }
  | Extract<InboxTimelineItem, { type: 'activity' }>;

/** The timeline with replies and notes from this phone added in order (none twice). */
export function timelineWithPending(
  d: InboxConversationDetail,
  p: PendingInbox,
  selfId: string,
): LocalTimelineItem[] {
  const seen = new Set<string>();
  for (const t of d.timeline) {
    if (t.type === 'message' && t.message.clientMessageId) seen.add(t.message.clientMessageId);
    if (t.type === 'note' && t.note.clientNoteId) seen.add(t.note.clientNoteId);
  }
  const id = d.conversation.conversationId;
  const extra: LocalTimelineItem[] = p.posts
    .filter((x) => x.inboxId === id && !seen.has(x.clientId))
    .map((x) =>
      x.kind === 'reply'
        ? {
            type: 'message' as const,
            actionId: x.actionId,
            message: {
              messageId: `local_${x.clientId}`,
              conversationId: id,
              direction: 'outbound' as const,
              text: x.text,
              attachments: [],
              authorId: selfId,
              accountId: null,
              externalMessageId: null,
              clientMessageId: x.clientId,
              deliveryState: 'queued' as const,
              error: null,
              attempts: 0,
              handoffUrl: null,
              sandboxRequest: null,
              createdAt: x.createdAt,
              sentAt: null,
              pendingLocal: true as const,
              syncError: x.error,
            },
          }
        : {
            type: 'note' as const,
            actionId: x.actionId,
            note: {
              noteId: `local_${x.clientId}`,
              conversationId: id,
              authorId: selfId,
              text: x.text,
              mentions: [],
              clientNoteId: x.clientId,
              createdAt: x.createdAt,
              pendingLocal: true as const,
              syncError: x.error,
            },
          },
    );
  return [...(d.timeline as LocalTimelineItem[]), ...extra].sort(
    (a, b) => Date.parse(itemAt(a)) - Date.parse(itemAt(b)),
  );
}

export function itemAt(t: LocalTimelineItem): string {
  return t.type === 'message'
    ? t.message.createdAt
    : t.type === 'note'
      ? t.note.createdAt
      : t.activity.createdAt;
}

/** The detail with waiting changes laid over (fields, read mark). */
export function overlayDetail(
  d: InboxConversationDetail,
  p: PendingInbox,
): InboxConversationDetail {
  return { ...d, conversation: overlayConversation(d.conversation, p) };
}

/**
 * Merges a field change into one still waiting: the latest choice per field wins. Tags are
 * replaced as a whole, like on the server.
 */
export function mergeInboxPatch(
  a: UpdateInboxConversationRequest,
  b: UpdateInboxConversationRequest,
): UpdateInboxConversationRequest {
  return { ...a, ...b };
}

// --------------------------------------------------------------------------- labels

/** Neutral two-letter marks (no third-party logos) with a stable hue per channel, as on web. */
export const PROVIDER_META: Record<ConnectorProvider, { name: string; mark: string; hue: string }> =
  {
    telegram: { name: 'Telegram', mark: 'TG', hue: '#3B9EDB' },
    slack: { name: 'Slack', mark: 'SL', hue: '#B56BD9' },
    teams: { name: 'Teams', mark: 'MT', hue: '#7B83EB' },
    google_chat: { name: 'Google Chat', mark: 'GC', hue: '#2FA572' },
    discord: { name: 'Discord', mark: 'DC', hue: '#6C7BF2' },
    line: { name: 'LINE', mark: 'LN', hue: '#22B455' },
    mattermost: { name: 'Mattermost', mark: 'MM', hue: '#3F7FD9' },
    nextcloud_talk: { name: 'Nextcloud Talk', mark: 'NC', hue: '#2A8FD6' },
    wechat: { name: 'WeChat', mark: 'WC', hue: '#34B24A' },
    qq: { name: 'QQ Bot', mark: 'QQ', hue: '#2C9CE0' },
    signal: { name: 'Signal', mark: 'SG', hue: '#4A73E8' },
    imessage: { name: 'iMessage', mark: 'iM', hue: '#3DBA5C' },
  };

export const isHandoff = (p: ConnectorProvider): boolean => CONNECTOR_CATALOG[p].mode === 'handoff';

export const STATUS_LABEL: Record<InboxStatus, string> = {
  open: 'Open',
  pending: 'Waiting on client',
  snoozed: 'Snoozed',
  resolved: 'Resolved',
};

export const PRIORITY_LABEL: Record<InboxPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** "12m", "3h 5m", "2d". */
export function minutesLabel(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  return `${Math.floor(h / 24)}d`;
}

/** The SLA pill text and tone, or null when nothing is owed. */
export function slaLabel(
  sla: InboxConversation['sla'],
  now = Date.now(),
): { text: string; tone: 'danger' | 'warning' | 'muted' | 'success' } | null {
  if (sla.state === 'none') return null;
  if (sla.state === 'met') return { text: 'SLA met', tone: 'success' };
  const left = sla.dueAt ? Date.parse(sla.dueAt) - now : 0;
  if (sla.state === 'breached' || left < 0)
    return { text: `${minutesLabel(left)} over`, tone: 'danger' };
  return {
    text: `${minutesLabel(left)} left`,
    tone: sla.state === 'due_soon' ? 'warning' : 'muted',
  };
}

/** What a delivery state reads as under a reply. */
export function deliveryLabel(m: LocalInboxMessage, provider: ConnectorProvider): string {
  if (m.syncError) return `Not sent: ${m.syncError}`;
  if (m.pendingLocal) return 'Queued on this phone';
  const name = PROVIDER_META[provider].name;
  switch (m.deliveryState) {
    case 'queued':
      return m.error?.startsWith('Waiting') ? m.error : 'Queued';
    case 'sending':
      return 'Sending';
    case 'sent':
      return `Sent to ${name}`;
    case 'delivered':
      return 'Delivered';
    case 'read':
      return 'Read';
    case 'test':
      return 'Captured by sandbox (test mode)';
    case 'handoff':
      return `Send it in ${name}`;
    case 'failed':
      return `Failed${m.error ? `: ${m.error}` : ''}`;
  }
}

/** Snooze choices, as ISO times from now. */
export function snoozeOptions(now = new Date()): { key: string; label: string; until: string }[] {
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
  const tomorrow9 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  return [
    { key: '1h', label: '1 hour', until: at(1) },
    { key: '4h', label: '4 hours', until: at(4) },
    { key: 'tomorrow', label: 'Tomorrow 9:00', until: tomorrow9.toISOString() },
    { key: 'week', label: 'Next week', until: at(24 * 7) },
  ];
}

/** "/shortcut" at the start of the composer picks a template. */
export function templateQuery(text: string): string | null {
  const m = /^\/([a-z0-9-]*)$/.exec(text.trim());
  return m ? m[1]! : null;
}
