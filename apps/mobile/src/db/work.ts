import {
  uuidv7,
  type Approval,
  type Bookmark,
  type BookingPage,
  type CreateBookingPageRequest,
  type UpdateBookingPageRequest,
  type CreateApprovalRequest,
  type CreatePollRequest,
  type CreateScheduledMessageRequest,
  type CreateTaskRequest,
  type DecideApprovalRequest,
  type Message,
  type Poll,
  type ScheduledMessage,
  type Task,
  type UpdateTaskRequest,
  type UpdateProfileRequest,
  type UserStatus,
  type DndSchedule,
  type WorkingHours,
  type ChatThemeId,
  type CallAppearance,
  type CallBackgroundChoice,
  type MinutesEditableField,
  type MeetingMinutes,
} from '@sampledge/contracts';
import { Emitter } from '../lib/emitter';
import type { NetworkScope } from '../lib/networkSpace';
import type { SqlDriver, SqlExecutor } from './driver';

/**
 * Offline queue for every action that is not a message send, edit, delete or reaction, plus a
 * cache of the lists those actions change. Read paths always return the server's last copy with
 * your queued changes laid over it, so a change shows at once, on or offline, and the server's
 * copy wins again once the change is confirmed or refused.
 *
 * The queue is drained strictly in the order things were done (see OutboxProcessor), and each
 * action is safe to repeat: creates carry a client id the server dedupes on (a booking page's
 * unique link plays that part), and everything else sets a state (pinned, saved, my vote,
 * status...) rather than toggling it.
 */
export type ActionInput =
  | { kind: 'pin'; messageId: string; conversationId: string; pinned: boolean }
  | { kind: 'bookmark'; messageId: string; conversationId: string; saved: boolean }
  | { kind: 'poll.create'; conversationId: string; request: CreatePollRequest }
  | { kind: 'poll.vote'; messageId: string; conversationId: string; optionIds: string[] }
  | { kind: 'poll.close'; messageId: string; conversationId: string }
  | { kind: 'task.create'; localId: string; request: CreateTaskRequest }
  | { kind: 'task.update'; taskId: string; patch: UpdateTaskRequest }
  | { kind: 'approval.create'; localId: string; request: CreateApprovalRequest }
  | { kind: 'approval.decide'; approvalId: string; request: DecideApprovalRequest }
  | { kind: 'approval.cancel'; approvalId: string }
  | {
      kind: 'scheduled.create';
      localId: string;
      conversationId: string;
      request: CreateScheduledMessageRequest;
    }
  | { kind: 'scheduled.update'; scheduledId: string; sendAt: string }
  | { kind: 'scheduled.cancel'; scheduledId: string }
  | { kind: 'scheduled.sendNow'; scheduledId: string }
  | { kind: 'booking.create'; localId: string; request: CreateBookingPageRequest }
  | { kind: 'booking.update'; bookingPageId: string; patch: UpdateBookingPageRequest }
  | { kind: 'booking.delete'; bookingPageId: string }
  | { kind: 'profile.update'; patch: UpdateProfileRequest }
  /** A cropped, compressed photo as a data URL, kept here until it reaches the server. */
  | { kind: 'avatar.set'; image: string }
  | { kind: 'avatar.remove' }
  /** Your recent searches as a whole list (synced to all your devices; the latest wins). */
  | { kind: 'search.recent'; recent: string[] }
  /** Availability and custom status, replaced as a whole (the latest wins). */
  | { kind: 'status.set'; status: UserStatus }
  /** Quiet hours, replaced as a whole (the latest wins). */
  | { kind: 'dnd.set'; schedule: DndSchedule }
  /** Your working hours, replaced as a whole (the latest wins). */
  | { kind: 'hours.set'; hours: WorkingHours }
  | { kind: 'theme.set'; themeId: ChatThemeId | null }
  /** Your background in calls (the latest wins). */
  | { kind: 'callbg.set'; choice: CallBackgroundChoice }
  /** One of your own call backgrounds: a JPEG kept in app storage until it reaches the server. */
  | { kind: 'callbg.image'; localUri: string; name?: string }
  /** Removes one of your backgrounds (no `imageId`: the older "most recent image" form). */
  | { kind: 'callbg.imageRemove'; imageId?: string }
  /** How you look on camera (the latest wins). */
  | { kind: 'callbg.appearance'; appearance: CallAppearance }
  /**
   * Edits to minutes of meeting, merged per field while waiting. `baseRevision` is the revision
   * the first edit started from, so the server can tell a field someone else changed meanwhile.
   */
  | {
      kind: 'minutes.update';
      minutesId: string;
      callId: string;
      baseRevision: number;
      patch: MinutesPatch;
    }
  /**
   * Corrections to a transcript (`language` null) or one of its translations. Waiting
   * corrections merge per line; `baseRevision` is where the first one started.
   */
  | {
      kind: 'transcript.update';
      attachmentId: string;
      language: string | null;
      baseRevision: number;
      patch: TranscriptPatch;
    }
  /**
   * A SampConnect Network change (connect, follow, block, invite...). Every network change
   * shares one queue so they reach the server in the order you made them; each carries an
   * idempotency key (or sets a state), so sending one again never does it twice.
   */
  | {
      kind: 'net.act';
      method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      path: string;
      body?: unknown;
      /** Words for the person, e.g. "Connection request to Maria". */
      label: string;
      scopes: NetworkScope[];
      /**
       * A photo or video kept in app storage until it is uploaded; its attachment id then goes
       * into `body.attachmentId` (status updates).
       */
      media?: { localUri: string; fileName: string; mimeType: string; sizeBytes: number };
    };

export interface TranscriptPatch {
  /** Corrected lines by index. */
  segments?: Record<number, string>;
  /** The whole text, for transcripts without timed lines. */
  text?: string;
  reviewed?: boolean;
}

export function mergeTranscriptPatch(a: TranscriptPatch, b: TranscriptPatch): TranscriptPatch {
  const out: TranscriptPatch = { ...a, ...b };
  if (a.segments || b.segments) out.segments = { ...a.segments, ...b.segments };
  return out;
}

export const transcriptTarget = (attachmentId: string, language: string | null) =>
  `transcript:${attachmentId}|${language ?? 'original'}`;

export type MinutesPatch = Partial<Pick<MeetingMinutes, MinutesEditableField>>;

export type ActionKind = ActionInput['kind'];

/** Your own changes not on the server yet (see {@link WorkStore.pendingProfile}). */
export interface PendingProfile {
  patch: UpdateProfileRequest;
  /** A data URL, or null when you removed your photo. */
  avatar?: string | null;
  status?: UserStatus;
  dndSchedule?: DndSchedule;
}

export interface QueuedAction {
  id: string;
  target: string;
  attempts: number;
  state: 'pending' | 'sending' | 'failed';
  lastError: string | null;
  enqueuedAt: number;
  input: ActionInput;
}

/** Extra fields on records read from the cache. */
export interface LocalWork {
  /** A change made on this device has not reached the server yet. */
  pending?: boolean;
  /** Made on this device and refused by the server; shown until retried or discarded. */
  syncError?: string | null;
  /** Created on this device and not on the server yet (its id is a local one). */
  local?: boolean;
}
export type LocalTask = Task & LocalWork;
export type LocalApproval = Approval & LocalWork;
export type LocalScheduled = ScheduledMessage & LocalWork;
export type LocalBookmark = Bookmark & LocalWork;
export type LocalBookingPage = BookingPage & LocalWork;

export interface TaskFilter {
  scope: 'mine' | 'created' | 'conversation' | 'all';
  conversationId?: string;
  status?: 'active' | 'done' | 'any';
}
export interface ApprovalFilter {
  scope: 'to_decide' | 'requested' | 'conversation' | 'all';
  conversationId?: string;
  status?: 'pending' | 'decided' | 'any';
}

type CacheKind =
  | 'task'
  | 'approval'
  | 'scheduled'
  | 'bookmark'
  | 'vote'
  | 'booking'
  | 'profile'
  | 'search'
  | 'minutes'
  | 'transcript'
  | 'network';
/** Things that can be created on this device before the server knows them. */
export type LocalKind = 'task' | 'approval' | 'scheduled' | 'poll' | 'booking';

export type WorkEvents = {
  /** Something in the cache or queue for this kind changed. */
  changed: { kind: CacheKind };
};

export const LOCAL_PREFIX = 'local_';
export const isLocalId = (id: string): boolean => id.startsWith(LOCAL_PREFIX);

const targetOf = (a: ActionInput): string => {
  switch (a.kind) {
    case 'pin':
      return `pin:${a.messageId}`;
    case 'bookmark':
      return `bookmark:${a.messageId}`;
    case 'poll.create':
      return `poll:${a.request.clientMessageId}`;
    case 'poll.vote':
      return `vote:${a.messageId}`;
    case 'poll.close':
      return `close:${a.messageId}`;
    case 'task.create':
      return `task:${a.localId}`;
    case 'task.update':
      return `task:${a.taskId}`;
    case 'approval.create':
      return `approval:${a.localId}`;
    case 'approval.decide':
    case 'approval.cancel':
      return `approval:${a.approvalId}`;
    case 'scheduled.create':
      return `scheduled:${a.localId}`;
    case 'scheduled.update':
    case 'scheduled.cancel':
    case 'scheduled.sendNow':
      return `scheduled:${a.scheduledId}`;
    case 'booking.create':
      return `booking:${a.localId}`;
    case 'booking.update':
    case 'booking.delete':
      return `booking:${a.bookingPageId}`;
    case 'profile.update':
      return 'profile:me';
    case 'avatar.set':
    case 'avatar.remove':
      return 'avatar:me';
    case 'search.recent':
      return 'search:recent';
    case 'status.set':
      return 'status:me';
    case 'dnd.set':
      return 'dnd:me';
    case 'hours.set':
      return 'hours:me';
    case 'theme.set':
      return 'my-chat-theme';
    case 'callbg.appearance':
      return 'callappearance:me';
    case 'callbg.set':
    case 'callbg.image':
    case 'callbg.imageRemove':
      // One target, so an upload and a later pick reach the server in the order you made them.
      return 'callbg:me';
    case 'minutes.update':
      return `minutes:${a.minutesId}`;
    case 'transcript.update':
      return transcriptTarget(a.attachmentId, a.language);
    case 'net.act':
      return 'network';
  }
};

const kindOfCache = (k: ActionKind): CacheKind =>
  k.startsWith('avatar.') ||
  k === 'status.set' ||
  k === 'dnd.set' ||
  k === 'hours.set' ||
  k === 'theme.set' ||
  k.startsWith('callbg.')
    ? 'profile'
    : k === 'pin' || k === 'poll.create' || k === 'poll.close'
      ? 'vote' // these show on messages; 'vote' listeners also reload polls
      : k === 'bookmark'
        ? 'bookmark'
        : k === 'poll.vote'
          ? 'vote'
          : k === 'net.act'
            ? 'network'
            : (k.split('.')[0] as CacheKind);

interface ActionRow {
  id: string;
  kind: string;
  target: string;
  payload: string;
  state: QueuedAction['state'];
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  enqueued_at: number;
}

const toAction = (r: ActionRow): QueuedAction => ({
  id: r.id,
  target: r.target,
  attempts: r.attempts,
  state: r.state,
  lastError: r.last_error,
  enqueuedAt: r.enqueued_at,
  input: JSON.parse(r.payload) as ActionInput,
});

const TASK_ACTIVE = new Set(['open', 'in_progress', 'blocked']);

/** Server filters, applied to the cache (GET /v1/tasks and /v1/approvals). */
export function taskMatches(t: Task, q: TaskFilter, self: string): boolean {
  if (q.status === 'active' && !TASK_ACTIVE.has(t.status)) return false;
  if (q.status === 'done' && TASK_ACTIVE.has(t.status)) return false;
  switch (q.scope) {
    case 'mine':
      return t.assigneeIds.includes(self);
    case 'created':
      return t.createdBy === self;
    case 'conversation':
      return t.conversationId === (q.conversationId ?? null);
    case 'all':
      return true;
  }
}

export function approvalMatches(a: Approval, q: ApprovalFilter, self: string): boolean {
  if (q.status === 'pending' && a.status !== 'pending') return false;
  if (q.status === 'decided' && a.status === 'pending') return false;
  switch (q.scope) {
    case 'to_decide':
      return a.approverIds.includes(self);
    case 'requested':
      return a.requesterId === self;
    case 'conversation':
      return a.conversationId === (q.conversationId ?? null);
    case 'all':
      return true;
  }
}

/** The approval as it will be once your decision lands (same rules as the server). */
export function applyDecision(
  a: Approval,
  self: string,
  d: DecideApprovalRequest,
  at: string,
): Approval {
  if (a.status !== 'pending') return a;
  const decisions = [
    ...a.decisions.filter((x) => x.userId !== self),
    { userId: self, decision: d.decision, comment: d.comment ?? '', at },
  ];
  let status: Approval['status'] = 'pending';
  if (d.decision === 'reject') status = 'rejected';
  else if (a.policy === 'any') status = 'approved';
  else if (
    a.approverIds.every((u) => decisions.some((x) => x.userId === u && x.decision === 'approve'))
  )
    status = 'approved';
  return { ...a, decisions, status, decidedAt: status === 'pending' ? null : at };
}

/** Poll counts with your queued choice in place of the one the server last counted. */
export function overlayVote(
  poll: Poll,
  self: string,
  before: readonly string[],
  after: readonly string[],
): Poll {
  const had = new Set(before);
  const has = new Set(after);
  return {
    ...poll,
    totalVoters: Math.max(0, poll.totalVoters + (has.size ? 1 : 0) - (had.size ? 1 : 0)),
    options: poll.options.map((o) => {
      const delta = (has.has(o.optionId) ? 1 : 0) - (had.has(o.optionId) ? 1 : 0);
      const voterIds = poll.anonymous
        ? o.voterIds
        : has.has(o.optionId)
          ? o.voterIds.includes(self)
            ? o.voterIds
            : [...o.voterIds, self]
          : o.voterIds.filter((u) => u !== self);
      return { ...o, count: Math.max(0, o.count + delta), voterIds };
    }),
  };
}

/** Booking page defaults, as the server applies them (contracts CreateBookingPageSchema). */
export function bookingFromRequest(
  id: string,
  r: CreateBookingPageRequest,
  self: string,
  at: string,
): BookingPage {
  const slug = r.slug.trim().toLowerCase();
  return {
    bookingPageId: id,
    slug,
    title: r.title.trim(),
    description: (r.description ?? '').trim(),
    durationMinutes: r.durationMinutes ?? 30,
    hostIds: [...new Set([self, ...(r.hostIds ?? [])])],
    mode: r.mode ?? 'any',
    bufferMinutes: r.bufferMinutes ?? 0,
    minNoticeMinutes: r.minNoticeMinutes ?? 240,
    horizonDays: r.horizonDays ?? 30,
    media: r.media ?? 'video',
    enabled: r.enabled ?? true,
    createdBy: self,
    // The link's address is known once the server has it; the path part is already fixed.
    url: `/book/${slug}`,
    createdAt: at,
    updatedAt: at,
  };
}

export class WorkStore {
  readonly events = new Emitter<WorkEvents>();

  constructor(
    private readonly db: SqlDriver,
    private readonly selfId: string,
    private readonly now: () => number = Date.now,
  ) {}

  // ------------------------------------------------------------------ queue

  /**
   * Queues a change. Repeated changes to the same thing collapse into the latest intent while
   * they are still waiting, and edits to something created offline are folded into its create.
   * Returns what the caller should do next when a change cannot be queued as such
   * (sending a scheduled message now that never reached the server becomes an ordinary send).
   */
  async enqueue(
    input: ActionInput,
  ): Promise<{ sendNow?: CreateScheduledMessageRequest & { conversationId: string } }> {
    const target = targetOf(input);
    let result: { sendNow?: CreateScheduledMessageRequest & { conversationId: string } } = {};
    await this.db.transaction(async (tx) => {
      const waiting = (
        await tx.all<ActionRow>(
          `SELECT * FROM actions WHERE target = ? AND state != 'sending' ORDER BY enqueued_at, rowid`,
          [target],
        )
      ).map(toAction);
      const create = waiting.find((a) => a.input.kind.endsWith('.create'));
      const insert = async (i: ActionInput) =>
        tx.run(
          `INSERT INTO actions (id, kind, target, payload, enqueued_at) VALUES (?, ?, ?, ?, ?)`,
          [uuidv7(this.now()), i.kind, target, JSON.stringify(i), this.now()],
        );
      const drop = async (ids: string[]) => {
        for (const id of ids) await tx.run('DELETE FROM actions WHERE id = ?', [id]);
      };
      const rewrite = async (a: QueuedAction, i: ActionInput) =>
        tx.run('UPDATE actions SET payload = ? WHERE id = ?', [JSON.stringify(i), a.id]);

      switch (input.kind) {
        case 'pin':
        case 'bookmark':
        case 'poll.vote':
          // Only the latest intent matters; the server call sets a state.
          await drop(waiting.filter((a) => a.state === 'pending').map((a) => a.id));
          await insert(input);
          break;
        case 'poll.close':
          if (!waiting.length) await insert(input);
          break;
        case 'poll.create':
        case 'net.act':
          await insert(input);
          break;
        case 'task.create':
        case 'approval.create':
        case 'scheduled.create':
        case 'booking.create':
          await insert(input);
          break;
        case 'booking.update': {
          if (create?.input.kind === 'booking.create' && create.state !== 'sending') {
            // Not on the server yet: the create carries the whole page. Fixing a refused one
            // (say, a link someone else took) sends it again.
            const { hostIds, ...rest } = input.patch;
            await rewrite(create, {
              ...create.input,
              request: { ...create.input.request, ...rest, ...(hostIds ? { hostIds } : {}) },
            });
            if (create.state === 'failed')
              await tx.run(
                `UPDATE actions SET state = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL WHERE id = ?`,
                [create.id],
              );
            break;
          }
          if (waiting.some((a) => a.input.kind === 'booking.delete')) break;
          const prior = waiting.find(
            (a) => a.input.kind === 'booking.update' && a.state === 'pending',
          );
          if (prior?.input.kind === 'booking.update')
            await rewrite(prior, {
              ...prior.input,
              patch: { ...prior.input.patch, ...input.patch },
            });
          else await insert(input);
          break;
        }
        case 'profile.update': {
          // Last write wins per field: later edits merge into the one still waiting.
          const prior = waiting.find(
            (a) => a.input.kind === 'profile.update' && a.state === 'pending',
          );
          if (prior?.input.kind === 'profile.update')
            await rewrite(prior, {
              ...prior.input,
              patch: { ...prior.input.patch, ...input.patch },
            });
          else await insert(input);
          break;
        }
        case 'search.recent':
        case 'status.set':
        case 'dnd.set':
        case 'hours.set':
        case 'theme.set':
        case 'avatar.set':
        case 'avatar.remove':
          // Only the latest photo (or its removal, or recent list) matters.
          await drop(waiting.filter((a) => a.state === 'pending').map((a) => a.id));
          await insert(input);
          break;
        case 'minutes.update': {
          // Later edits merge per field into the one still waiting, from the first base revision.
          const prior = waiting.find(
            (a) => a.input.kind === 'minutes.update' && a.state === 'pending',
          );
          if (prior?.input.kind === 'minutes.update')
            await rewrite(prior, {
              ...prior.input,
              patch: { ...prior.input.patch, ...input.patch },
            });
          else await insert(input);
          break;
        }
        case 'transcript.update': {
          // Later corrections merge per line into the one still waiting.
          const prior = waiting.find(
            (a) => a.input.kind === 'transcript.update' && a.state === 'pending',
          );
          if (prior?.input.kind === 'transcript.update')
            await rewrite(prior, {
              ...prior.input,
              patch: mergeTranscriptPatch(prior.input.patch, input.patch),
            });
          else await insert(input);
          break;
        }
        case 'callbg.set':
          // A later pick replaces an earlier one still waiting; uploads stay in order before it.
          await drop(
            waiting
              .filter((a) => a.state === 'pending' && a.input.kind === 'callbg.set')
              .map((a) => a.id),
          );
          await insert(input);
          break;
        case 'callbg.image':
          // The upload selects the image, so picks still waiting before it no longer matter.
          // Earlier uploads stay: each adds a background.
          await drop(
            waiting
              .filter((a) => a.state === 'pending' && a.input.kind === 'callbg.set')
              .map((a) => a.id),
          );
          await insert(input);
          break;
        case 'callbg.imageRemove':
          // Picks of that image still waiting no longer matter.
          await drop(
            waiting
              .filter(
                (a) =>
                  a.state === 'pending' &&
                  a.input.kind === 'callbg.set' &&
                  (input.imageId
                    ? a.input.choice.kind === 'upload' && a.input.choice.imageId === input.imageId
                    : a.input.choice.kind === 'custom'),
              )
              .map((a) => a.id),
          );
          await insert(input);
          break;
        case 'callbg.appearance':
          await drop(waiting.filter((a) => a.state === 'pending').map((a) => a.id));
          await insert(input);
          break;
        case 'booking.delete':
          if (create && create.state !== 'sending') {
            // Never reached the server: forget it here.
            await drop(waiting.map((a) => a.id));
            await tx.run(`DELETE FROM work_cache WHERE kind = 'booking' AND id = ?`, [
              input.bookingPageId,
            ]);
            break;
          }
          // Edits waiting before the delete no longer matter.
          await drop(
            waiting
              .filter((a) => a.state === 'pending' && a.input.kind === 'booking.update')
              .map((a) => a.id),
          );
          if (!waiting.some((a) => a.input.kind === 'booking.delete')) await insert(input);
          break;
        case 'task.update': {
          const { status, ...rest } = input.patch;
          if (create?.input.kind === 'task.create' && create.state === 'pending') {
            // Not on the server yet: fold everything a create can carry into it.
            const r = create.input.request;
            await rewrite(create, {
              ...create.input,
              request: {
                ...r,
                ...(rest.title !== undefined ? { title: rest.title } : {}),
                ...(rest.description !== undefined ? { description: rest.description } : {}),
                ...(rest.priority !== undefined ? { priority: rest.priority } : {}),
                ...(rest.assigneeIds !== undefined ? { assigneeIds: rest.assigneeIds } : {}),
                ...(rest.dueAt !== undefined ? { dueAt: rest.dueAt } : {}),
              },
            });
            if (status === undefined) break;
          }
          const patch =
            create?.state === 'pending' ? (status !== undefined ? { status } : {}) : input.patch;
          const prior = waiting.find(
            (a) => a.input.kind === 'task.update' && a.state === 'pending',
          );
          if (prior?.input.kind === 'task.update')
            await rewrite(prior, { ...prior.input, patch: { ...prior.input.patch, ...patch } });
          else if (Object.keys(patch).length) await insert({ ...input, patch });
          break;
        }
        case 'approval.decide':
          await insert(input);
          break;
        case 'approval.cancel':
          if (create) {
            // Never reached anyone: forget it here.
            await drop(waiting.map((a) => a.id));
            await tx.run(`DELETE FROM work_cache WHERE kind = 'approval' AND id = ?`, [
              input.approvalId,
            ]);
          } else if (!waiting.some((a) => a.input.kind === 'approval.cancel')) await insert(input);
          break;
        case 'scheduled.update': {
          if (create?.input.kind === 'scheduled.create' && create.state === 'pending') {
            await rewrite(create, {
              ...create.input,
              request: { ...create.input.request, sendAt: input.sendAt },
            });
            break;
          }
          await drop(
            waiting
              .filter((a) => a.state === 'pending' && a.input.kind === 'scheduled.update')
              .map((a) => a.id),
          );
          await insert(input);
          break;
        }
        case 'scheduled.cancel':
        case 'scheduled.sendNow': {
          if (create?.input.kind === 'scheduled.create' && create.state !== 'sending') {
            if (input.kind === 'scheduled.sendNow')
              result = {
                sendNow: { ...create.input.request, conversationId: create.input.conversationId },
              };
            await drop(waiting.map((a) => a.id));
            await tx.run(`DELETE FROM work_cache WHERE kind = 'scheduled' AND id = ?`, [
              input.scheduledId,
            ]);
            break;
          }
          await drop(
            waiting
              .filter((a) => a.state === 'pending' && a.input.kind.startsWith('scheduled.'))
              .map((a) => a.id),
          );
          await insert(input);
          break;
        }
      }
      if (input.kind === 'task.create' || input.kind === 'approval.create')
        await this.writeLocal(tx, input);
      if (input.kind === 'scheduled.create') await this.writeLocal(tx, input);
      if (input.kind === 'booking.create') await this.writeLocalBooking(tx, input);
    });
    this.events.emit('changed', { kind: kindOfCache(input.kind) });
    return result;
  }

  /** The page shown for a booking page made on this device (the server fills the defaults). */
  private async writeLocalBooking(
    tx: SqlExecutor,
    input: Extract<ActionInput, { kind: 'booking.create' }>,
  ): Promise<void> {
    const at = new Date(this.now()).toISOString();
    await tx.run(
      `INSERT OR REPLACE INTO work_cache (kind, id, conversation_id, data, updated_at) VALUES ('booking', ?, NULL, ?, ?)`,
      [
        input.localId,
        JSON.stringify(bookingFromRequest(input.localId, input.request, this.selfId, at)),
        at,
      ],
    );
  }

  /** The optimistic record shown for something created on this device. */
  private async writeLocal(
    tx: SqlExecutor,
    input: Extract<ActionInput, { kind: 'task.create' | 'approval.create' | 'scheduled.create' }>,
  ): Promise<void> {
    const at = new Date(this.now()).toISOString();
    let data: Task | Approval | ScheduledMessage;
    let conversationId: string | null;
    let kind: CacheKind;
    if (input.kind === 'task.create') {
      const r = input.request;
      kind = 'task';
      conversationId = r.conversationId ?? null;
      data = {
        taskId: input.localId,
        title: r.title,
        description: r.description ?? '',
        kind: r.kind ?? 'task',
        status: 'open',
        priority: r.priority ?? 'normal',
        assigneeIds: r.assigneeIds ?? [],
        createdBy: this.selfId,
        dueAt: r.dueAt ?? null,
        conversationId,
        sourceMessageId: r.sourceMessageId ?? null,
        sourceExcerpt: null,
        record: null,
        origin: 'connect',
        moduleSync: null,
        createdAt: at,
        updatedAt: at,
        completedAt: null,
      } satisfies Task;
    } else if (input.kind === 'approval.create') {
      const r = input.request;
      kind = 'approval';
      conversationId = r.conversationId ?? null;
      data = {
        approvalId: input.localId,
        title: r.title,
        description: r.description ?? '',
        category: r.category ?? 'general',
        amount: r.amount ?? null,
        requesterId: this.selfId,
        approverIds: r.approverIds,
        policy: r.policy ?? 'any',
        decisions: [],
        status: 'pending',
        conversationId,
        sourceMessageId: r.sourceMessageId ?? null,
        record: null,
        origin: 'connect',
        dueAt: r.dueAt ?? null,
        createdAt: at,
        decidedAt: null,
      } satisfies Approval;
    } else {
      const r = input.request;
      kind = 'scheduled';
      conversationId = input.conversationId;
      data = {
        scheduledId: input.localId,
        conversationId,
        clientMessageId: r.clientMessageId,
        content: { text: r.content.text, mentions: r.content.mentions ?? [] },
        replyToMessageId: r.replyToMessageId ?? null,
        sendAt: r.sendAt,
        status: 'scheduled',
        messageId: null,
        error: null,
        createdAt: at,
        updatedAt: at,
      } as ScheduledMessage;
    }
    await tx.run(
      `INSERT OR REPLACE INTO work_cache (kind, id, conversation_id, data, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [kind, input.localId, conversationId, JSON.stringify(data), at],
    );
  }

  /**
   * The oldest waiting action, or nothing. Strict order: a later action never overtakes an
   * earlier one, so an edit never reaches the server before the create it depends on. Actions
   * about something whose create was refused wait for the person to retry or discard it.
   */
  async next(): Promise<(QueuedAction & { due: boolean }) | undefined> {
    const r = await this.db.get<ActionRow>(
      `SELECT * FROM actions WHERE state = 'pending'
         AND target NOT IN (SELECT target FROM actions WHERE state = 'failed')
       ORDER BY enqueued_at, rowid LIMIT 1`,
    );
    return r && { ...toAction(r), due: r.next_attempt_at <= this.now() };
  }

  async nextWakeAt(): Promise<number | undefined> {
    const r = await this.db.get<{ t: number | null }>(
      `SELECT MIN(next_attempt_at) AS t FROM actions WHERE state = 'pending'`,
    );
    return r?.t ?? undefined;
  }

  async count(): Promise<number> {
    return (
      (
        await this.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM actions WHERE state != 'failed'`,
        )
      )?.n ?? 0
    );
  }

  async markSending(id: string): Promise<void> {
    await this.db.run(`UPDATE actions SET state = 'sending' WHERE id = ?`, [id]);
  }

  /**
   * Marks the action as being sent and returns it as stored now. A change queued between
   * {@link next} and this call may have merged into it (or dropped it), so the copy read by
   * `next` can be stale; sending that would lose the merged change.
   */
  async claim(id: string): Promise<QueuedAction | undefined> {
    await this.db.run(`UPDATE actions SET state = 'sending' WHERE id = ? AND state = 'pending'`, [
      id,
    ]);
    const r = await this.db.get<ActionRow>(
      `SELECT * FROM actions WHERE id = ? AND state = 'sending'`,
      [id],
    );
    return r && toAction(r);
  }

  async markRetry(a: QueuedAction, at: number, error: string): Promise<void> {
    await this.db.run(
      `UPDATE actions SET state = 'pending', attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?`,
      [at, error, a.id],
    );
  }

  /** Removes a finished (or refused, non-create) action; the server's copy shows again. */
  async complete(a: QueuedAction): Promise<void> {
    await this.db.run('DELETE FROM actions WHERE id = ?', [a.id]);
    this.events.emit('changed', { kind: kindOfCache(a.input.kind) });
  }

  /** A create the server refused: kept, with the reason, until retried or discarded. */
  async fail(a: QueuedAction, error: string): Promise<void> {
    await this.db.run(`UPDATE actions SET state = 'failed', last_error = ? WHERE id = ?`, [
      error,
      a.id,
    ]);
    this.events.emit('changed', { kind: kindOfCache(a.input.kind) });
  }

  /** After a restart, anything that was mid-flight is sent again (it is idempotent). */
  async requeueInflight(): Promise<void> {
    await this.db.run(`UPDATE actions SET state = 'pending' WHERE state = 'sending'`);
  }

  /** Try a refused create again (e.g. after fixing access). */
  async retry(localId: string, kind: LocalKind): Promise<void> {
    await this.db.run(
      `UPDATE actions SET state = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL WHERE target = ?`,
      [`${kind}:${localId}`],
    );
    this.events.emit('changed', { kind: kind === 'poll' ? 'vote' : kind });
  }

  /** Forget something created here that never reached the server. */
  async discard(localId: string, kind: LocalKind): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM actions WHERE target = ?', [`${kind}:${localId}`]);
      if (kind === 'poll')
        await tx.run('DELETE FROM messages WHERE client_id = ? AND message_id IS NULL', [localId]);
      else await tx.run('DELETE FROM work_cache WHERE kind = ? AND id = ?', [kind, localId]);
    });
    this.events.emit('changed', { kind: kind === 'poll' ? 'vote' : kind });
  }

  /** The action for a poll created on this device, if it is still waiting or was refused. */
  async pollCreate(clientMessageId: string): Promise<QueuedAction | undefined> {
    const r = await this.db.get<ActionRow>(`SELECT * FROM actions WHERE target = ?`, [
      `poll:${clientMessageId}`,
    ]);
    return r && toAction(r);
  }

  /** The server id for a record created offline (or the id itself when it is a server id). */
  async resolveId(id: string): Promise<string | null> {
    if (!isLocalId(id)) return id;
    return (
      (
        await this.db.get<{ server_id: string }>(
          'SELECT server_id FROM id_map WHERE local_id = ?',
          [id],
        )
      )?.server_id ?? null
    );
  }

  /** A create was accepted: the local record becomes the server's, and later actions follow it. */
  async settleCreate(
    a: QueuedAction,
    record:
      | { kind: 'task'; data: Task }
      | { kind: 'approval'; data: Approval }
      | { kind: 'scheduled'; data: ScheduledMessage }
      | { kind: 'booking'; data: BookingPage },
  ): Promise<void> {
    const localId = 'localId' in a.input ? a.input.localId : '';
    const serverId = this.idOf(record.kind, record.data);
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM actions WHERE id = ?', [a.id]);
      await tx.run('INSERT OR REPLACE INTO id_map (local_id, server_id) VALUES (?, ?)', [
        localId,
        serverId,
      ]);
      await tx.run('DELETE FROM work_cache WHERE kind = ? AND id = ?', [record.kind, localId]);
      await tx.run('UPDATE actions SET target = ? WHERE target = ?', [
        `${record.kind}:${serverId}`,
        `${record.kind}:${localId}`,
      ]);
      await this.upsertTx(tx, record.kind, record.data);
    });
    this.events.emit('changed', { kind: record.kind });
  }

  private async pendingFor(prefix: string): Promise<QueuedAction[]> {
    return (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target LIKE ? ORDER BY enqueued_at, rowid`,
        [`${prefix}:%`],
      )
    ).map(toAction);
  }

  // ------------------------------------------------------------------ cache writes

  private idOf(kind: CacheKind, data: unknown): string {
    const d = data as Record<string, string>;
    return kind === 'task'
      ? d.taskId!
      : kind === 'approval'
        ? d.approvalId!
        : kind === 'scheduled'
          ? d.scheduledId!
          : kind === 'booking'
            ? d.bookingPageId!
            : d.messageId!;
  }

  private async upsertTx(tx: SqlExecutor, kind: CacheKind, data: unknown): Promise<void> {
    const id = this.idOf(kind, data);
    const d = data as { updatedAt?: string; conversationId?: string | null };
    const updatedAt = d.updatedAt ?? new Date(this.now()).toISOString();
    if (d.updatedAt) {
      // An older copy (a late live event) never replaces a newer one.
      const cur = await tx.get<{ updated_at: string }>(
        'SELECT updated_at FROM work_cache WHERE kind = ? AND id = ?',
        [kind, id],
      );
      if (cur && cur.updated_at > d.updatedAt) return;
    }
    await tx.run(
      `INSERT OR REPLACE INTO work_cache (kind, id, conversation_id, data, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [kind, id, d.conversationId ?? null, JSON.stringify(data), updatedAt],
    );
  }

  /** Stores records from the server (a response or a live event from another device). */
  async upsert(kind: 'task', items: readonly Task[]): Promise<void>;
  async upsert(kind: 'approval', items: readonly Approval[]): Promise<void>;
  async upsert(kind: 'scheduled', items: readonly ScheduledMessage[]): Promise<void>;
  async upsert(kind: 'bookmark', items: readonly Bookmark[]): Promise<void>;
  async upsert(kind: 'booking', items: readonly BookingPage[]): Promise<void>;
  async upsert(kind: CacheKind, items: readonly unknown[]): Promise<void> {
    if (!items.length) return;
    await this.db.transaction(async (tx) => {
      for (const it of items) await this.upsertTx(tx, kind, it);
    });
    this.events.emit('changed', { kind });
  }

  /**
   * The server's answer for one list: rows that match the list's filter but were not in the
   * answer are gone (or out of scope) and are dropped. Records made offline stay.
   */
  async replace<T>(
    kind: 'task' | 'approval' | 'scheduled' | 'bookmark' | 'booking',
    items: readonly T[],
    inScope: (t: T) => boolean,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const keep = new Set(items.map((i) => this.idOf(kind, i)));
      const rows = await tx.all<{ id: string; data: string }>(
        'SELECT id, data FROM work_cache WHERE kind = ?',
        [kind],
      );
      for (const r of rows) {
        if (keep.has(r.id) || isLocalId(r.id)) continue;
        if (inScope(JSON.parse(r.data) as T))
          await tx.run('DELETE FROM work_cache WHERE kind = ? AND id = ?', [kind, r.id]);
      }
      for (const it of items) await this.upsertTx(tx, kind, it);
    });
    this.events.emit('changed', { kind });
  }

  /** A booking page was deleted, or you are no longer one of its hosts. */
  async removeBooking(bookingPageId: string): Promise<void> {
    await this.db.run(`DELETE FROM work_cache WHERE kind = 'booking' AND id = ?`, [bookingPageId]);
    this.events.emit('changed', { kind: 'booking' });
  }

  async removeBookmark(messageId: string): Promise<void> {
    await this.db.run(`DELETE FROM work_cache WHERE kind = 'bookmark' AND id = ?`, [messageId]);
    this.events.emit('changed', { kind: 'bookmark' });
  }

  async hasBookmark(messageId: string): Promise<boolean> {
    return !!(await this.db.get(`SELECT 1 FROM work_cache WHERE kind = 'bookmark' AND id = ?`, [
      messageId,
    ]));
  }

  /**
   * Your profile changes not on the server yet: the fields you edited, and the photo you picked
   * (a data URL) or removed (null). Refused changes are not included.
   */
  async pendingProfile(): Promise<PendingProfile> {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target IN ('profile:me', 'avatar:me', 'status:me', 'dnd:me') AND state != 'failed' ORDER BY enqueued_at, rowid`,
      )
    ).map(toAction);
    const out: PendingProfile = { patch: {} };
    for (const a of rows) {
      if (a.input.kind === 'status.set') out.status = a.input.status;
      if (a.input.kind === 'dnd.set') out.dndSchedule = a.input.schedule;
      if (a.input.kind === 'profile.update') out.patch = { ...out.patch, ...a.input.patch };
      if (a.input.kind === 'avatar.set') out.avatar = a.input.image;
      if (a.input.kind === 'avatar.remove') out.avatar = null;
    }
    return out;
  }

  /** A chat theme picked on this device and not on the server yet (undefined: none). */
  async pendingChatTheme(): Promise<{ themeId: ChatThemeId | null } | undefined> {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = 'my-chat-theme' AND state != 'failed' ORDER BY enqueued_at, rowid`,
      )
    ).map(toAction);
    const last = rows[rows.length - 1]?.input;
    return last?.kind === 'theme.set' ? { themeId: last.themeId } : undefined;
  }

  /** Edits to these minutes not on the server yet, merged per field (undefined: none). */
  async pendingMinutes(minutesId: string): Promise<MinutesPatch | undefined> {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = ? AND state != 'failed' ORDER BY enqueued_at, rowid`,
        [`minutes:${minutesId}`],
      )
    ).map(toAction);
    let out: MinutesPatch | undefined;
    for (const a of rows) if (a.input.kind === 'minutes.update') out = { ...out, ...a.input.patch };
    return out;
  }

  /** Corrections to this transcript (or translation) not on the server yet, merged. */
  async pendingTranscript(
    attachmentId: string,
    language: string | null,
  ): Promise<TranscriptPatch | undefined> {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = ? AND state != 'failed' ORDER BY enqueued_at, rowid`,
        [transcriptTarget(attachmentId, language)],
      )
    ).map(toAction);
    let out: TranscriptPatch | undefined;
    for (const a of rows)
      if (a.input.kind === 'transcript.update')
        out = out ? mergeTranscriptPatch(out, a.input.patch) : a.input.patch;
    return out;
  }

  /**
   * Forgets an image picked on this phone that hasn't started uploading. False when it is
   * already on its way (remove it once it has arrived).
   */
  async dropPendingCallBackgroundImage(localUri: string): Promise<boolean> {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = 'callbg:me' AND state = 'pending' ORDER BY enqueued_at, rowid`,
      )
    ).map(toAction);
    const hit = rows.find((a) => a.input.kind === 'callbg.image' && a.input.localUri === localUri);
    if (!hit) return false;
    await this.db.run(`DELETE FROM actions WHERE id = ?`, [hit.id]);
    this.events.emit('changed', { kind: 'profile' });
    return true;
  }

  /** SampConnect Network changes still waiting, oldest first (shown as "Queued"). */
  async pendingNetwork(): Promise<Extract<ActionInput, { kind: 'net.act' }>[]> {
    return (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = 'network' AND state != 'failed' ORDER BY enqueued_at, rowid`,
      )
    )
      .map(toAction)
      .flatMap((a) => (a.input.kind === 'net.act' ? [a.input] : []));
  }

  /** How you look on camera, changed on this device and not on the server yet. */
  async pendingCallAppearance(): Promise<CallAppearance | null> {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = 'callappearance:me' AND state != 'failed' ORDER BY enqueued_at, rowid`,
      )
    ).map(toAction);
    const last = rows[rows.length - 1]?.input;
    return last?.kind === 'callbg.appearance' ? last.appearance : null;
  }

  /** Call background changes made on this device and not on the server yet, oldest first. */
  async pendingCallBackground(): Promise<
    Extract<ActionInput, { kind: 'callbg.set' | 'callbg.image' | 'callbg.imageRemove' }>[]
  > {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = 'callbg:me' AND state != 'failed' ORDER BY enqueued_at, rowid`,
      )
    ).map(toAction);
    return rows.flatMap((a) =>
      a.input.kind === 'callbg.set' ||
      a.input.kind === 'callbg.image' ||
      a.input.kind === 'callbg.imageRemove'
        ? [a.input]
        : [],
    );
  }

  /** Working hours changed on this device and not on the server yet (null: none). */
  async pendingWorkingHours(): Promise<WorkingHours | null> {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = 'hours:me' AND state != 'failed' ORDER BY enqueued_at, rowid`,
      )
    ).map(toAction);
    const last = rows[rows.length - 1]?.input;
    return last?.kind === 'hours.set' ? last.hours : null;
  }

  /** Your recent searches changed on this device and not on the server yet (null: none). */
  async pendingRecentSearches(): Promise<string[] | null> {
    const rows = (
      await this.db.all<ActionRow>(
        `SELECT * FROM actions WHERE target = 'search:recent' AND state != 'failed' ORDER BY enqueued_at, rowid`,
      )
    ).map(toAction);
    const last = rows[rows.length - 1]?.input;
    return last?.kind === 'search.recent' ? last.recent : null;
  }

  /** Your choice in a poll as the server last told this device. */
  async setVote(messageId: string, optionIds: readonly string[]): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO work_cache (kind, id, conversation_id, data, updated_at) VALUES ('vote', ?, NULL, ?, ?)`,
      [messageId, JSON.stringify(optionIds), new Date(this.now()).toISOString()],
    );
    this.events.emit('changed', { kind: 'vote' });
  }

  async cachedVote(messageId: string): Promise<string[] | null> {
    const r = await this.db.get<{ data: string }>(
      `SELECT data FROM work_cache WHERE kind = 'vote' AND id = ?`,
      [messageId],
    );
    return r ? (JSON.parse(r.data) as string[]) : null;
  }

  /** Your queued choice in a poll, if any. */
  async pendingVote(messageId: string): Promise<string[] | null> {
    const r = await this.db.get<{ payload: string }>(
      `SELECT payload FROM actions WHERE target = ? AND state != 'failed' ORDER BY enqueued_at DESC, rowid DESC LIMIT 1`,
      [`vote:${messageId}`],
    );
    if (!r) return null;
    const a = JSON.parse(r.payload) as ActionInput;
    return a.kind === 'poll.vote' ? a.optionIds : null;
  }

  // ------------------------------------------------------------------ reads (with overlays)

  private async rows<T>(kind: CacheKind): Promise<T[]> {
    return (
      await this.db.all<{ data: string }>('SELECT data FROM work_cache WHERE kind = ?', [kind])
    ).map((r) => JSON.parse(r.data) as T);
  }

  private overlayTask(t: Task, actions: QueuedAction[]): LocalTask {
    let out: LocalTask = { ...t };
    for (const a of actions) {
      if (a.target !== `task:${t.taskId}`) continue;
      if (a.state === 'failed') out.syncError = a.lastError;
      else out.pending = true;
      if (a.input.kind === 'task.create') {
        const r = a.input.request;
        out = {
          ...out,
          title: r.title,
          description: r.description ?? '',
          priority: r.priority ?? out.priority,
          assigneeIds: r.assigneeIds ?? out.assigneeIds,
          dueAt: r.dueAt ?? null,
          local: true,
        };
      }
      if (a.input.kind === 'task.update') {
        const p = a.input.patch;
        out = {
          ...out,
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(p.status !== undefined
            ? {
                status: p.status,
                completedAt: p.status === 'done' ? new Date(a.enqueuedAt).toISOString() : null,
              }
            : {}),
          ...(p.priority !== undefined ? { priority: p.priority } : {}),
          ...(p.assigneeIds !== undefined ? { assigneeIds: p.assigneeIds } : {}),
          ...(p.dueAt !== undefined ? { dueAt: p.dueAt } : {}),
        };
      }
    }
    if (isLocalId(out.taskId)) out.local = true;
    return out;
  }

  private overlayApproval(x: Approval, actions: QueuedAction[]): LocalApproval {
    let out: LocalApproval = { ...x };
    for (const a of actions) {
      if (a.target !== `approval:${x.approvalId}`) continue;
      if (a.state === 'failed') out.syncError = a.lastError;
      else out.pending = true;
      if (a.input.kind === 'approval.decide')
        out = {
          ...out,
          ...applyDecision(out, this.selfId, a.input.request, new Date(a.enqueuedAt).toISOString()),
        };
      if (a.input.kind === 'approval.cancel' && out.status === 'pending')
        out = { ...out, status: 'cancelled', decidedAt: new Date(a.enqueuedAt).toISOString() };
    }
    if (isLocalId(out.approvalId)) out.local = true;
    return out;
  }

  private overlayScheduled(s: ScheduledMessage, actions: QueuedAction[]): LocalScheduled {
    let out: LocalScheduled = { ...s };
    for (const a of actions) {
      if (a.target !== `scheduled:${s.scheduledId}`) continue;
      if (a.state === 'failed')
        out = { ...out, syncError: a.lastError, status: 'failed', error: a.lastError };
      else out.pending = true;
      if (a.input.kind === 'scheduled.create') out = { ...out, sendAt: a.input.request.sendAt };
      if (a.input.kind === 'scheduled.update') out = { ...out, sendAt: a.input.sendAt };
      if (a.input.kind === 'scheduled.cancel') out = { ...out, status: 'cancelled' };
      if (a.input.kind === 'scheduled.sendNow') out = { ...out, status: 'sent' };
    }
    if (isLocalId(out.scheduledId)) out.local = true;
    return out;
  }

  async listTasks(q: TaskFilter): Promise<LocalTask[]> {
    const actions = await this.pendingFor('task');
    return (await this.rows<Task>('task'))
      .map((t) => this.overlayTask(t, actions))
      .filter((t) => taskMatches(t, q, this.selfId))
      .sort(
        (a, b) =>
          (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }

  async getTask(id: string): Promise<LocalTask | undefined> {
    const resolved = (await this.resolveId(id)) ?? id;
    const r =
      (await this.db.get<{ data: string }>(
        `SELECT data FROM work_cache WHERE kind = 'task' AND id IN (?, ?)`,
        [id, resolved],
      )) ?? undefined;
    return r && this.overlayTask(JSON.parse(r.data) as Task, await this.pendingFor('task'));
  }

  async listApprovals(q: ApprovalFilter): Promise<LocalApproval[]> {
    const actions = await this.pendingFor('approval');
    return (await this.rows<Approval>('approval'))
      .map((x) => this.overlayApproval(x, actions))
      .filter((x) => approvalMatches(x, q, this.selfId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getApproval(id: string): Promise<LocalApproval | undefined> {
    const resolved = (await this.resolveId(id)) ?? id;
    const r = await this.db.get<{ data: string }>(
      `SELECT data FROM work_cache WHERE kind = 'approval' AND id IN (?, ?)`,
      [id, resolved],
    );
    return (
      r && this.overlayApproval(JSON.parse(r.data) as Approval, await this.pendingFor('approval'))
    );
  }

  /** Scheduled and failed messages, soonest first. */
  async listScheduled(conversationId?: string): Promise<LocalScheduled[]> {
    const actions = await this.pendingFor('scheduled');
    return (await this.rows<ScheduledMessage>('scheduled'))
      .filter((s) => !conversationId || s.conversationId === conversationId)
      .map((s) => this.overlayScheduled(s, actions))
      .filter((s) => s.status === 'scheduled' || s.status === 'failed')
      .sort((a, b) => a.sendAt.localeCompare(b.sendAt));
  }

  /**
   * Saved messages, newest first, with saves and unsaves made here applied. A message saved
   * offline is shown from the local copy until the server's list includes it.
   */
  async listBookmarks(
    localMessage: (messageId: string) => Promise<Message | undefined>,
  ): Promise<LocalBookmark[]> {
    const rows = await this.rows<Bookmark>('bookmark');
    const intents = new Map<string, { saved: boolean; at: number; conversationId: string }>();
    for (const a of await this.pendingFor('bookmark'))
      if (a.input.kind === 'bookmark')
        intents.set(a.input.messageId, {
          saved: a.input.saved,
          at: a.enqueuedAt,
          conversationId: a.input.conversationId,
        });
    const out: LocalBookmark[] = rows
      .filter((b) => intents.get(b.messageId)?.saved !== false)
      .map((b) => (intents.has(b.messageId) ? { ...b, pending: true } : b));
    for (const [messageId, i] of intents) {
      if (!i.saved || rows.some((b) => b.messageId === messageId)) continue;
      const message = await localMessage(messageId);
      if (!message) continue;
      out.push({
        messageId,
        conversationId: i.conversationId,
        createdAt: new Date(i.at).toISOString(),
        message,
        pending: true,
      });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private overlayBooking(p: BookingPage, actions: QueuedAction[]): LocalBookingPage | null {
    let out: LocalBookingPage = { ...p };
    for (const a of actions) {
      if (a.target !== `booking:${p.bookingPageId}`) continue;
      if (a.state === 'failed') out.syncError = a.lastError;
      else out.pending = true;
      if (a.input.kind === 'booking.create')
        out = {
          ...out,
          ...bookingFromRequest(p.bookingPageId, a.input.request, this.selfId, p.createdAt),
          ...(a.state === 'failed' ? { syncError: a.lastError } : { pending: true }),
        };
      if (a.input.kind === 'booking.update') {
        const { hostIds, ...rest } = a.input.patch;
        out = {
          ...out,
          ...(Object.fromEntries(
            Object.entries(rest).filter(([, v]) => v !== undefined),
          ) as Partial<BookingPage>),
          ...(hostIds ? { hostIds: [...new Set(hostIds)] } : {}),
        };
        if (rest.slug) out.url = out.url.replace(/[^/]*$/, rest.slug.trim().toLowerCase());
      }
      if (a.input.kind === 'booking.delete' && a.state !== 'failed') return null;
    }
    if (isLocalId(out.bookingPageId)) out.local = true;
    return out;
  }

  /** Booking pages you host, newest first, with changes made here applied. */
  async listBookingPages(): Promise<LocalBookingPage[]> {
    const actions = await this.pendingFor('booking');
    return (await this.rows<BookingPage>('booking'))
      .map((p) => this.overlayBooking(p, actions))
      .filter((p): p is LocalBookingPage => !!p)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBookingPage(id: string): Promise<LocalBookingPage | undefined> {
    const resolved = (await this.resolveId(id)) ?? id;
    const r = await this.db.get<{ data: string }>(
      `SELECT data FROM work_cache WHERE kind = 'booking' AND id IN (?, ?)`,
      [id, resolved],
    );
    if (!r) return undefined;
    return (
      this.overlayBooking(JSON.parse(r.data) as BookingPage, await this.pendingFor('booking')) ??
      undefined
    );
  }

  async savedIds(): Promise<Set<string>> {
    const ids = new Set(
      (await this.db.all<{ id: string }>(`SELECT id FROM work_cache WHERE kind = 'bookmark'`)).map(
        (r) => r.id,
      ),
    );
    for (const a of await this.pendingFor('bookmark'))
      if (a.input.kind === 'bookmark') {
        if (a.input.saved) ids.add(a.input.messageId);
        else ids.delete(a.input.messageId);
      }
    return ids;
  }
}
