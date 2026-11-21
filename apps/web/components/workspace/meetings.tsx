'use client';
import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  BellRing,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  HelpCircle,
  Mail,
  MailWarning,
  Link2,
  MessagesSquare,
  Pencil,
  Repeat,
  RotateCw,
  UserPlus,
  Settings2,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import type {
  Conversation,
  FindTimesResponse,
  GuestInput,
  Meeting,
  MeetingGuest,
  MeetingSystemMetadata,
  RecurrenceInput,
  RsvpResponse,
  SeriesScope,
  WorkingHours,
} from '@sampledge/contracts';
import type { LocalMessage } from '@sampledge/offline';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  StateView,
  Textarea,
  cn,
} from '@sampledge/ui';
import { ApiFailure } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCalls } from '@/lib/calls';
import { useEngine, type DirectoryEntry } from '@/lib/engine';
import {
  addDays,
  fmtDay,
  fmtRange,
  fmtTime,
  startOfWeek,
  queueRsvp,
  useMeetingOutbox,
  useMeetingReminder,
  useMeetings,
  useMeetingsApi,
  usePendingRsvps,
} from '@/lib/meetings';
import { avatarOf, avatarUrl, nameOf } from './helpers';
import { MeetingAiSummary } from './ai-summary-card';
import { RepeatPicker } from './repeat-picker';
import { BookingPagesDialog } from './booking-pages';

const HOUR_PX = 56;
const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const responseLabel: Record<RsvpResponse, string> = {
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Not going',
  pending: 'No response',
};

/** Joinable from 10 minutes before the start until the end. */
const joinable = (m: { startsAt: string; endsAt: string }, now = Date.now()) =>
  Date.parse(m.startsAt) - 10 * 60_000 <= now && now < Date.parse(m.endsAt);

function errorText(e: unknown) {
  return e instanceof ApiFailure ? e.error.message : 'Something went wrong. Try again.';
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function MeetingsScreen({
  me,
  directory,
  conversations,
  onOpenConversation,
  focus,
}: {
  me: string;
  directory: Map<string, DirectoryEntry>;
  conversations: Conversation[];
  onOpenConversation: (conversationId: string) => void;
  /** Open this meeting (from a chat card). */
  focus?: { meetingId: string; startsAt: string } | null;
}) {
  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(new Date()));
  React.useEffect(() => {
    if (!focus) return;
    setWeekStart(startOfWeek(new Date(focus.startsAt)));
    setSelected(focus.meetingId);
  }, [focus]);
  const weekEnd = React.useMemo(() => addDays(weekStart, 7), [weekStart]);
  const { items, upsertLocal, online, error } = useMeetings(weekStart, weekEnd);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState<null | { startsAt?: Date }>(null);
  const [hoursOpen, setHoursOpen] = React.useState(false);
  const [bookingOpen, setBookingOpen] = React.useState(false);
  const sel = items?.find((m) => m.meetingId === selected) ?? null;
  const upcoming = (items ?? []).filter((m) => Date.parse(m.endsAt) > Date.now());
  const title = `${fmtDay(weekStart)} – ${fmtDay(addDays(weekStart, 6))}`;

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" aria-label="Meetings">
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <CalendarClock className="size-5 text-accent" />
        <h1 className="mr-2 font-display text-h3 text-text">Meetings</h1>
        <div className="flex items-center gap-1">
          <button
            className="rounded-sm p-1.5 text-text-muted hover:bg-surface-raised hover:text-text"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            <ChevronLeft className="size-4" />
          </button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            Today
          </Button>
          <button
            className="rounded-sm p-1.5 text-text-muted hover:bg-surface-raised hover:text-text"
            aria-label="Next week"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <span className="hidden truncate text-label font-normal text-text-muted sm:inline">
          {title}
        </span>
        <div className="flex-1" />
        {!online ? (
          <Badge tone="warning" className="hidden sm:inline-flex">
            Offline · showing saved meetings
          </Badge>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setBookingOpen(true)}
          aria-label="Booking pages"
          disabled={!online}
        >
          <Link2 /> <span className="hidden md:inline">Booking pages</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHoursOpen(true)}
          aria-label="Working hours"
        >
          <Settings2 /> <span className="hidden md:inline">Working hours</span>
        </Button>
        <Button
          size="sm"
          onClick={() => setCreating({})}
          disabled={!online}
          aria-label="New meeting"
        >
          <CalendarPlus /> <span className="hidden sm:inline">New meeting</span>
        </Button>
      </header>
      {error && online ? (
        <p className="border-b border-danger/30 bg-danger/10 px-6 py-2 text-meta text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="hidden min-w-0 flex-1 md:flex">
          <WeekGrid
            weekStart={weekStart}
            meetings={items ?? []}
            me={me}
            selected={selected}
            onSelect={setSelected}
            onCreateAt={(d) => online && setCreating({ startsAt: d })}
          />
        </div>
        {/* Agenda list: the whole view on phones, a side column on very wide screens. */}
        <aside
          className={cn('flex min-h-0 w-full flex-col overflow-y-auto md:hidden', sel && 'hidden')}
        >
          <AgendaList meetings={upcoming} me={me} loading={items === null} onSelect={setSelected} />
        </aside>
        <AnimatePresence>
          {sel ? (
            <MeetingDetails
              key={sel.meetingId}
              meeting={sel}
              me={me}
              directory={directory}
              conversation={conversations.find((c) => c.conversationId === sel.conversationId)}
              online={online}
              onClose={() => setSelected(null)}
              onChanged={(m) => {
                upsertLocal(m);
                // Changing a series' time recreates its meetings, so follow the new one.
                setSelected(m.meetingId);
              }}
              onOpenConversation={onOpenConversation}
            />
          ) : null}
        </AnimatePresence>
      </div>

      <NewMeetingDialog
        open={!!creating}
        initialStart={creating?.startsAt}
        onOpenChange={(o) => !o && setCreating(null)}
        me={me}
        directory={directory}
        onCreated={(m) => {
          upsertLocal(m);
          setWeekStart(startOfWeek(new Date(m.startsAt)));
          setSelected(m.meetingId);
        }}
      />
      <WorkingHoursDialog open={hoursOpen} onOpenChange={setHoursOpen} />
      <BookingPagesDialog
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        me={me}
        directory={directory}
      />
    </main>
  );
}

function AgendaList({
  meetings,
  me,
  loading,
  onSelect,
}: {
  meetings: Meeting[];
  me: string;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  if (!loading && meetings.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <StateView
          state="empty"
          title="Nothing scheduled this week"
          description="Schedule a meeting and Connect will find a time that works for everyone."
        />
      </div>
    );
  let lastDay = '';
  return (
    <ul className="space-y-2 p-4">
      {meetings.map((m) => {
        const day = fmtDay(m.startsAt);
        const show = day !== lastDay;
        lastDay = day;
        const mine = m.attendees.find((a) => a.userId === me)?.response;
        return (
          <li key={m.meetingId}>
            {show ? (
              <p className="mb-1 mt-3 px-1 text-meta uppercase tracking-wide text-text-subtle">
                {day}
              </p>
            ) : null}
            <button
              onClick={() => onSelect(m.meetingId)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:border-border-strong"
            >
              <span
                className={cn('h-10 w-1 rounded-full', joinable(m) ? 'bg-success' : 'bg-accent')}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-label text-text">
                  {m.series ? (
                    <Repeat className="size-3 shrink-0 text-text-subtle" aria-label="Repeats" />
                  ) : null}
                  <span className="truncate">{m.title}</span>
                </span>
                <span className="block text-meta text-text-subtle">
                  {fmtTime(m.startsAt)} – {fmtTime(m.endsAt)} · {m.attendees.length} people
                  {mine === 'pending' ? ' · reply needed' : ''}
                </span>
              </span>
              {joinable(m) ? <Badge tone="success">Now</Badge> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function WeekGrid({
  weekStart,
  meetings,
  me,
  selected,
  onSelect,
  onCreateAt,
}: {
  weekStart: Date;
  meetings: Meeting[];
  me: string;
  selected: string | null;
  onSelect: (id: string) => void;
  onCreateAt: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const scroller = React.useRef<HTMLDivElement>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  React.useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = (8 - FIRST_HOUR) * HOUR_PX;
  }, []);
  const today = new Date().toDateString();

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        className="grid shrink-0 border-b border-border"
        style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}
      >
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className="px-2 py-2 text-center">
            <p className="text-meta uppercase tracking-wide text-text-subtle">
              {d.toLocaleDateString(undefined, { weekday: 'short' })}
            </p>
            <p
              className={cn(
                'mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full text-label',
                d.toDateString() === today ? 'bg-accent text-accent-fg' : 'text-text',
              )}
            >
              {d.getDate()}
            </p>
          </div>
        ))}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}
        >
          <div>
            {hours.map((h) => (
              <div
                key={h}
                className="relative h-14 pr-2 text-right text-meta text-text-subtle"
                style={{ height: HOUR_PX }}
              >
                <span className="relative -top-2">{fmtTime(new Date(2000, 0, 1, h))}</span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayStart = new Date(d);
            dayStart.setHours(FIRST_HOUR, 0, 0, 0);
            const dayEnd = new Date(d);
            dayEnd.setHours(LAST_HOUR, 0, 0, 0);
            const todays = meetings.filter(
              (m) =>
                Date.parse(m.startsAt) < dayEnd.getTime() &&
                Date.parse(m.endsAt) > dayStart.getTime(),
            );
            const isToday = d.toDateString() === today;
            return (
              <div
                key={d.toISOString()}
                className={cn('relative border-l border-border', isToday && 'bg-accent/[0.03]')}
              >
                {hours.map((h) => (
                  <button
                    key={h}
                    aria-label={`Schedule at ${fmtTime(new Date(2000, 0, 1, h))} on ${fmtDay(d)}`}
                    className="block w-full border-b border-border/60 hover:bg-surface-raised/50"
                    style={{ height: HOUR_PX }}
                    onClick={() => {
                      const at = new Date(d);
                      at.setHours(h, 0, 0, 0);
                      if (at.getTime() > Date.now()) onCreateAt(at);
                    }}
                  />
                ))}
                {isToday && now > dayStart.getTime() && now < dayEnd.getTime() ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger"
                    style={{ top: ((now - dayStart.getTime()) / 3_600_000) * HOUR_PX }}
                  >
                    <span className="absolute -left-1 -top-1 size-2.5 rounded-full bg-danger" />
                  </div>
                ) : null}
                {todays.map((m) => {
                  const s = Math.max(Date.parse(m.startsAt), dayStart.getTime());
                  const e = Math.min(Date.parse(m.endsAt), dayEnd.getTime());
                  const top = ((s - dayStart.getTime()) / 3_600_000) * HOUR_PX;
                  const height = Math.max(22, ((e - s) / 3_600_000) * HOUR_PX - 2);
                  const mine = m.attendees.find((a) => a.userId === me)?.response;
                  const live = joinable(m, now);
                  return (
                    <button
                      key={m.meetingId}
                      onClick={() => onSelect(m.meetingId)}
                      data-testid="calendar-event"
                      className={cn(
                        'absolute inset-x-1 z-[5] overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm transition-transform hover:-translate-y-px',
                        live
                          ? 'border-success/50 bg-success/15'
                          : mine === 'pending'
                            ? 'border-dashed border-accent/60 bg-accent/10'
                            : mine === 'declined'
                              ? 'border-border bg-surface opacity-60'
                              : 'border-accent/40 bg-accent-soft',
                        selected === m.meetingId && 'ring-2 ring-ring',
                      )}
                      style={{ top, height }}
                    >
                      <p
                        className={cn(
                          'truncate text-meta font-semibold text-text',
                          mine === 'declined' && 'line-through',
                        )}
                      >
                        {m.series ? (
                          <Repeat
                            className="mr-1 inline size-3 align-[-2px] text-text-muted"
                            aria-label="Repeats"
                          />
                        ) : null}
                        {m.title}
                      </p>
                      {height > 36 ? (
                        <p className="truncate text-[11px] text-text-muted">
                          {fmtTime(m.startsAt)} – {fmtTime(m.endsAt)}
                        </p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

function MeetingDetails({
  meeting: m,
  me,
  directory,
  conversation,
  online,
  onClose,
  onChanged,
  onOpenConversation,
}: {
  meeting: Meeting;
  me: string;
  directory: Map<string, DirectoryEntry>;
  conversation: Conversation | undefined;
  online: boolean;
  onClose: () => void;
  onChanged: (m: Meeting) => void;
  onOpenConversation: (id: string) => void;
}) {
  const api = useMeetingsApi();
  const calls = useCalls();
  const reduce = useReducedMotion();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [wholeSeries, setWholeSeries] = React.useState(false);
  const { db } = useEngine();
  const { pending } = usePendingRsvps();
  const queued = pending.some((q) => q.meetingId === m.meetingId);
  const organizer = m.organizerId === me;
  const mine = m.attendees.find((a) => a.userId === me);
  const live = calls.live.get(m.conversationId);
  const counts = { accepted: 0, tentative: 0, declined: 0, pending: 0 } as Record<
    RsvpResponse,
    number
  >;
  for (const a of m.attendees) counts[a.response]++;

  const run = async (fn: () => Promise<Meeting>) => {
    setBusy(true);
    setErr(null);
    try {
      onChanged(await fn());
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.aside
      initial={reduce ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className="flex w-full shrink-0 flex-col overflow-y-auto border-l border-border bg-surface/60 backdrop-blur-xl md:w-[380px]"
      aria-label="Meeting details"
      data-testid="meeting-details"
    >
      <div className="flex items-start gap-3 border-b border-border p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <CalendarClock className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-h3 text-text">{m.title}</h2>
          <p className="mt-0.5 text-label font-normal text-text-muted">
            {fmtRange(m.startsAt, m.endsAt)}
          </p>
          {m.series ? (
            <p
              className="mt-0.5 flex items-center gap-1 text-meta text-text-muted"
              data-testid="meeting-repeats"
            >
              <Repeat className="size-3.5" /> {m.series.summary}
              {m.series.detached ? ' · this one was changed' : ''}
            </p>
          ) : null}
          {m.timeZone !== LOCAL_TZ ? (
            <p className="text-meta text-text-subtle">Organizer’s time zone: {m.timeZone}</p>
          ) : null}
        </div>
        {organizer && m.status === 'scheduled' ? (
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit meeting"
            disabled={!online}
            className="rounded-sm p-1 text-text-subtle hover:bg-surface-raised disabled:opacity-40"
          >
            <Pencil className="size-4" />
          </button>
        ) : null}
        <button
          onClick={onClose}
          aria-label="Close details"
          className="rounded-sm p-1 text-text-subtle hover:bg-surface-raised"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              live ? void calls.join(live.callId) : void calls.start(m.conversationId, m.media)
            }
            disabled={!online || !(calls.config?.enabled ?? false)}
            className={cn(joinable(m) && 'bg-success text-bg hover:bg-success/90')}
          >
            <Video /> {live ? 'Join now' : joinable(m) ? 'Start meeting' : 'Join'}
          </Button>
          <Button variant="secondary" onClick={() => onOpenConversation(m.conversationId)}>
            <MessagesSquare /> Meeting chat
          </Button>
        </div>
        {calls.config && !calls.config.enabled ? (
          <p className="text-meta text-text-subtle">
            Calls aren’t set up on this server yet, so Join is off.
          </p>
        ) : null}

        {mine && !organizer ? (
          <div>
            <p className="mb-2 text-label text-text">Are you going?</p>
            <div className="flex gap-2" role="group" aria-label="Your response">
              {(['accepted', 'tentative', 'declined'] as const).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={mine.response === r ? 'primary' : 'secondary'}
                  disabled={busy}
                  aria-pressed={mine.response === r}
                  onClick={() => {
                    const scope = m.series && wholeSeries ? 'series' : 'occurrence';
                    if (!online) {
                      // Saved on this device and sent when the connection is back.
                      void queueRsvp(db, { meetingId: m.meetingId, response: r, scope }, me).then(
                        (changed) => changed.forEach(onChanged),
                      );
                      return;
                    }
                    void run(() => api.rsvp(m.meetingId, r, scope));
                  }}
                >
                  {r === 'accepted' ? <Check /> : r === 'tentative' ? <HelpCircle /> : <X />}
                  {responseLabel[r]}
                </Button>
              ))}
            </div>
            {queued ? (
              <p className="mt-2 text-meta text-warning" data-testid="rsvp-queued">
                You’re offline. Your answer is saved on this device and sends when you reconnect.
              </p>
            ) : null}
            {m.series ? (
              <label className="mt-2 flex items-center gap-2 text-meta text-text-muted">
                <input
                  type="checkbox"
                  checked={wholeSeries}
                  onChange={(e) => setWholeSeries(e.target.checked)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                Answer for every upcoming meeting in the series
              </label>
            ) : null}
          </div>
        ) : null}

        {m.agenda ? (
          <div>
            <p className="mb-1 text-label text-text">Agenda</p>
            <p className="whitespace-pre-wrap text-label font-normal text-text-muted">{m.agenda}</p>
          </div>
        ) : null}

        {conversation ? (
          <MeetingAiSummary meetingId={m.meetingId} me={me} directory={directory} />
        ) : null}

        <div>
          <p className="mb-2 text-label text-text">
            {m.attendees.length} people
            <span className="font-normal text-text-subtle">
              {' '}
              · {counts.accepted} going{counts.tentative ? ` · ${counts.tentative} maybe` : ''}
              {counts.declined ? ` · ${counts.declined} not going` : ''}
              {counts.pending ? ` · ${counts.pending} waiting` : ''}
            </span>
          </p>
          <ul className="space-y-2">
            {m.attendees.map((a) => (
              <li key={a.userId} className="flex items-center gap-2.5">
                <Avatar
                  name={nameOf(a.userId, directory)}
                  src={avatarOf(a.userId, directory)}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-text">
                    {a.userId === me ? 'You' : nameOf(a.userId, directory)}
                  </span>
                  <span className="block text-meta text-text-subtle">
                    {a.userId === m.organizerId
                      ? 'Organizer'
                      : a.optional
                        ? 'Optional'
                        : 'Required'}
                  </span>
                </span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-meta',
                    a.response === 'accepted'
                      ? 'bg-success/15 text-success'
                      : a.response === 'declined'
                        ? 'bg-danger/10 text-danger'
                        : a.response === 'tentative'
                          ? 'bg-warning/15 text-warning'
                          : 'bg-surface-raised text-text-subtle',
                  )}
                >
                  {responseLabel[a.response]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <GuestsSection meeting={m} organizer={organizer} online={online} onChanged={onChanged} />

        <p className="flex items-center gap-1.5 text-meta text-text-subtle">
          <BellRing className="size-3.5" />
          {m.remindMinutes.length
            ? `Reminder ${m.remindMinutes.map((x) => (x === 0 ? 'at start' : `${x} min before`)).join(', ')}`
            : 'No reminder'}
          {conversation ? ` · Chat: ${conversation.name ?? 'direct message'}` : ''}
        </p>

        {err ? <p className="text-meta text-danger">{err}</p> : null}
        {organizer && m.status === 'scheduled' ? (
          <div className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              disabled={busy || !online}
              onClick={() => void run(() => api.cancel(m.meetingId))}
            >
              {m.series ? 'Cancel this meeting' : 'Cancel meeting'}
            </Button>
            {m.series ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger/10 hover:text-danger"
                disabled={busy || !online}
                onClick={() => void run(() => api.cancel(m.meetingId, 'series'))}
              >
                Cancel the series
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <NewMeetingDialog
        open={editing}
        onOpenChange={setEditing}
        me={me}
        directory={directory}
        editing={m}
        onCreated={onChanged}
      />
    </motion.aside>
  );
}

// ---------------------------------------------------------------------------
// New meeting
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function nextHalfHour() {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

export function NewMeetingDialog({
  open,
  onOpenChange,
  initialStart,
  me,
  directory,
  onCreated,
  conversationId,
  presetAttendees,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialStart?: Date;
  me: string;
  directory: Map<string, DirectoryEntry>;
  onCreated: (m: Meeting) => void;
  /** Schedule inside this conversation (its members are invited). */
  conversationId?: string;
  presetAttendees?: string[];
  /** Edit this meeting instead of creating one (organizer). */
  editing?: Meeting;
}) {
  const api = useMeetingsApi();
  const [recurrence, setRecurrence] = React.useState<RecurrenceInput | null>(null);
  const [scope, setScope] = React.useState<SeriesScope>('occurrence');
  const [title, setTitle] = React.useState('');
  const [agenda, setAgenda] = React.useState('');
  const [date, setDate] = React.useState('');
  const [time, setTime] = React.useState('');
  const [duration, setDuration] = React.useState(30);
  const [remind, setRemind] = React.useState(10);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [guests, setGuests] = React.useState<GuestInput[]>([]);
  const [q, setQ] = React.useState('');
  const [slots, setSlots] = React.useState<FindTimesResponse | null>(null);
  const [finding, setFinding] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const start = editing ? new Date(editing.startsAt) : (initialStart ?? nextHalfHour());
    setTitle(editing?.title ?? '');
    setAgenda(editing?.agenda ?? '');
    setDate(toDateInput(start));
    setTime(toTimeInput(start));
    setDuration(
      editing ? (Date.parse(editing.endsAt) - Date.parse(editing.startsAt)) / 60_000 : 30,
    );
    setRemind(editing ? (editing.remindMinutes.at(-1) ?? -1) : 10);
    setPicked(
      editing
        ? editing.attendees.map((a) => a.userId).filter((id) => id !== me)
        : (presetAttendees ?? []),
    );
    setGuests([]);
    setQ('');
    setSlots(null);
    setError(null);
    setRecurrence(editing?.series?.recurrence ?? null);
    setScope('occurrence');
  }, [open, initialStart, presetAttendees, editing, me]);

  // Suggested times for the chosen day (re-run when people, day or length change).
  React.useEffect(() => {
    if (!open || !date) return;
    const day = new Date(`${date}T00:00`);
    if (Number.isNaN(day.getTime())) return;
    let live = true;
    setFinding(true);
    const h = setTimeout(() => {
      void api
        .findTimes({
          attendeeIds: picked,
          durationMinutes: duration,
          from: day.toISOString(),
          to: addDays(day, 1).toISOString(),
          stepMinutes: 30,
          limit: 8,
          ...(editing ? { ignoreMeetingId: editing.meetingId } : {}),
        })
        .then((r) => live && setSlots(r))
        .catch(() => live && setSlots(null))
        .finally(() => live && setFinding(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [open, date, duration, picked, api, editing]);

  const people = [...directory.values()].filter(
    (u) =>
      u.userId !== me &&
      u.status === 'active' &&
      !picked.includes(u.userId) &&
      (!q || u.displayName.toLowerCase().includes(q.toLowerCase())),
  );
  const start = new Date(`${date}T${time || '00:00'}`);
  const end = new Date(start.getTime() + duration * 60_000);
  const conflicts = slots
    ? [me, ...picked].filter((id) =>
        (slots.busy[id] ?? []).some(
          (b) => Date.parse(b.startsAt) < end.getTime() && Date.parse(b.endsAt) > start.getTime(),
        ),
      )
    : [];
  const valid =
    title.trim().length > 0 &&
    !Number.isNaN(start.getTime()) &&
    end.getTime() > Date.now() &&
    (picked.length > 0 || guests.length > 0 || !!conversationId || !!editing);
  const existing = new Set(editing?.attendees.map((a) => a.userId) ?? []);
  const seriesEdit = !!editing?.series && scope === 'series';

  async function submit() {
    setPending(true);
    setError(null);
    try {
      if (editing) {
        const ruleChanged =
          seriesEdit &&
          recurrence &&
          JSON.stringify(recurrence) !== JSON.stringify(editing.series!.recurrence);
        const m = await api.update(editing.meetingId, {
          scope,
          title: title.trim(),
          agenda: agenda.trim(),
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          remindMinutes: remind < 0 ? [] : [remind],
          addAttendeeIds: picked.filter((id) => !existing.has(id)),
          ...(ruleChanged ? { recurrence: recurrence! } : {}),
        });
        onCreated(m);
        onOpenChange(false);
        return;
      }
      const m = await api.create({
        title: title.trim(),
        agenda: agenda.trim(),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        timeZone: LOCAL_TZ,
        attendeeIds: picked,
        guests,
        remindMinutes: remind < 0 ? [] : [remind],
        ...(conversationId ? { conversationId } : {}),
        ...(recurrence ? { recurrence } : {}),
      });
      onCreated(m);
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit meeting' : 'New meeting'}
        description={
          editing
            ? 'Changing the time asks everyone to answer again.'
            : 'Pick people and Connect suggests times when everyone is free and inside their working hours.'
        }
        className="w-[min(640px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="space-y-4">
          {editing?.series ? (
            <div
              role="radiogroup"
              aria-label="What to change"
              className="flex gap-1 rounded-lg border border-border bg-surface-sunken p-1"
              data-testid="edit-scope"
            >
              {(
                [
                  ['occurrence', 'This meeting'],
                  ['series', 'All upcoming meetings in the series'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={scope === v}
                  onClick={() => setScope(v)}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-label transition-colors',
                    scope === v
                      ? 'bg-surface text-text shadow-sm'
                      : 'font-normal text-text-muted hover:text-text',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <Field label="Title" htmlFor="mt-title">
            <Input
              id="mt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Wave 3 quota review"
              maxLength={120}
            />
          </Field>

          <div>
            <label htmlFor="mt-people" className="text-label text-text">
              People
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {picked.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised py-0.5 pl-1 pr-2 text-meta text-text"
                >
                  <Avatar name={nameOf(id, directory)} src={avatarOf(id, directory)} size="xs" />
                  {nameOf(id, directory)}
                  {conflicts.includes(id) ? <span className="text-warning">· busy</span> : null}
                  {existing.has(id) ? null : (
                    <button
                      aria-label={`Remove ${nameOf(id, directory)}`}
                      onClick={() => setPicked((p) => p.filter((x) => x !== id))}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <Input
              id="mt-people"
              className="mt-2"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Add people by name"
            />
            {q ? (
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface">
                {people.slice(0, 6).map((u) => (
                  <li key={u.userId}>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised"
                      onClick={() => {
                        setPicked((p) => [...p, u.userId]);
                        setQ('');
                      }}
                    >
                      <Avatar name={u.displayName} src={avatarUrl(u.avatarUrl)} size="xs" />
                      <span className="text-label text-text">{u.displayName}</span>
                      {u.title ? (
                        <span className="text-meta text-text-subtle">{u.title}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
                {people.length === 0 ? (
                  <li className="px-3 py-2 text-meta text-text-subtle">No one matches</li>
                ) : null}
              </ul>
            ) : null}
          </div>

          {editing ? null : <GuestPicker guests={guests} onChange={setGuests} />}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Date" htmlFor="mt-date">
              <Input
                id="mt-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Start" htmlFor="mt-time">
              <Input
                id="mt-time"
                type="time"
                step={300}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
            <Field label="Length" htmlFor="mt-dur">
              <select
                id="mt-dur"
                className="h-10 w-full rounded-md border border-border bg-surface-sunken px-2 text-body text-text"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {[...new Set([15, 30, 45, 60, 90, 120, duration])]
                  .sort((a, b) => a - b)
                  .map((d) => (
                    <option key={d} value={d}>
                      {d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60}` : ''}`}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Reminder" htmlFor="mt-rem">
              <select
                id="mt-rem"
                className="h-10 w-full rounded-md border border-border bg-surface-sunken px-2 text-body text-text"
                value={remind}
                onChange={(e) => setRemind(Number(e.target.value))}
              >
                <option value={-1}>None</option>
                <option value={0}>At start</option>
                <option value={5}>5 min before</option>
                <option value={10}>10 min before</option>
                <option value={15}>15 min before</option>
                <option value={30}>30 min before</option>
                <option value={60}>1 h before</option>
              </select>
            </Field>
          </div>

          {!editing || seriesEdit ? (
            <RepeatPicker
              start={start}
              timeZone={editing?.timeZone ?? LOCAL_TZ}
              value={recurrence}
              onChange={(r) => (editing && !r ? undefined : setRecurrence(r))}
            />
          ) : null}

          <div
            className="rounded-lg border border-border bg-surface-sunken/60 p-3"
            data-testid="suggested-times"
          >
            <p className="mb-2 flex items-center gap-1.5 text-label text-text">
              <Sparkles className="size-4 text-accent" /> Times that work for everyone
              {finding ? (
                <span className="text-meta font-normal text-text-subtle">· checking…</span>
              ) : null}
            </p>
            {slots && slots.slots.length ? (
              <div className="flex flex-wrap gap-1.5">
                {slots.slots.map((s) => {
                  const on = new Date(s.startsAt).getTime() === start.getTime();
                  return (
                    <button
                      key={s.startsAt}
                      onClick={() => setTime(toTimeInput(new Date(s.startsAt)))}
                      aria-pressed={on}
                      className={cn(
                        'rounded-full border px-3 py-1 text-meta transition-colors',
                        on
                          ? 'border-accent bg-accent text-accent-fg'
                          : 'border-border bg-surface text-text hover:border-accent',
                      )}
                    >
                      {fmtTime(s.startsAt)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-meta text-text-subtle">
                {finding
                  ? ' '
                  : 'No shared free time on this day inside everyone’s working hours. Try another day.'}
              </p>
            )}
            {conflicts.length ? (
              <p className="mt-2 flex items-center gap-1.5 text-meta text-warning">
                <Clock className="size-3.5" />
                {conflicts
                  .map((id) => (id === me ? 'You' : nameOf(id, directory).split(' ')[0]))
                  .join(', ')}{' '}
                {conflicts.length === 1 && conflicts[0] !== me ? 'is' : 'are'} busy at{' '}
                {fmtTime(start)}
              </p>
            ) : null}
          </div>

          <Field label="Agenda (optional)" htmlFor="mt-agenda">
            <Textarea
              id="mt-agenda"
              rows={3}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
            />
          </Field>

          {error ? <p className="text-meta text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!valid} loading={pending}>
              {editing ? (
                <>
                  <Check /> Save
                </>
              ) : (
                <>
                  <CalendarPlus /> Schedule
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// External guests
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Splits "Anna Schmidt <anna@x.com>, bo@y.com" into guests. Returns what couldn't be read. */
function parseGuests(text: string): { found: GuestInput[]; bad: string[] } {
  const found: GuestInput[] = [];
  const bad: string[] = [];
  for (const raw of text
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(raw);
    const email = (m ? m[2]! : raw).trim().toLowerCase();
    const name = m?.[1]?.replace(/^"|"$/g, '').trim();
    if (EMAIL_RE.test(email)) found.push(name ? { email, name } : { email });
    else bad.push(raw);
  }
  return { found, bad };
}

/** Email entry for people outside the organization (paste a list, press Enter or comma). */
function GuestPicker({
  guests,
  onChange,
  label = 'Guests from outside your organization',
}: {
  guests: GuestInput[];
  onChange: (g: GuestInput[]) => void;
  label?: string;
}) {
  const [text, setText] = React.useState('');
  const [bad, setBad] = React.useState<string[]>([]);
  const commit = (value = text) => {
    const { found, bad } = parseGuests(value);
    const known = new Set(guests.map((g) => g.email));
    onChange([...guests, ...found.filter((g) => !known.has(g.email))]);
    setBad(bad);
    setText(bad.join(', '));
  };
  return (
    <div>
      <label htmlFor="mt-guests" className="text-label text-text">
        {label}
      </label>
      <p className="text-meta text-text-subtle">
        They get an email with a calendar invite and a join link. No account needed; they wait in
        the lobby until someone lets them in.
      </p>
      {guests.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="guest-chips">
          {guests.map((g) => (
            <span
              key={g.email}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-strong bg-surface-raised py-0.5 pl-2 pr-2 text-meta text-text"
            >
              <Mail className="size-3 text-text-subtle" />
              {g.name ? `${g.name} · ` : ''}
              {g.email}
              <button
                aria-label={`Remove ${g.email}`}
                onClick={() => onChange(guests.filter((x) => x.email !== g.email))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <Input
          id="mt-guests"
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;\n]$/.test(v)) commit(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          onPaste={(e) => {
            const v = e.clipboardData.getData('text');
            if (/[,;\n]/.test(v)) {
              e.preventDefault();
              commit(`${text}${v}`);
            }
          }}
          onBlur={() => text.trim() && commit()}
          placeholder="name@company.com"
          inputMode="email"
          autoComplete="off"
        />
        <Button variant="secondary" onClick={() => commit()} disabled={!text.trim()}>
          <UserPlus /> Add
        </Button>
      </div>
      {bad.length ? (
        <p className="mt-1 text-meta text-danger">
          {bad.length === 1 ? 'This isn’t' : 'These aren’t'} an email address: {bad.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

const inviteLabel: Record<MeetingGuest['invite']['status'], string> = {
  sending: 'Sending invite…',
  sent: 'Invite emailed',
  failed: 'Email failed',
  not_configured: 'Not emailed (email isn’t set up)',
};

function GuestsSection({
  meeting: m,
  organizer,
  online,
  onChanged,
}: {
  meeting: Meeting;
  organizer: boolean;
  online: boolean;
  onChanged: (m: Meeting) => void;
}) {
  const api = useMeetingsApi();
  const [adding, setAdding] = React.useState<GuestInput[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const guests = m.guests ?? [];
  if (!guests.length && !organizer) return null;
  const cancelled = m.status === 'cancelled';

  const act = async (key: string, fn: () => Promise<Meeting | void>) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await fn();
      if (r) onChanged(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const copy = (g: MeetingGuest) =>
    act(`copy:${g.guestId}`, async () => {
      const { url } = await api.guestLink(m.meetingId, g.guestId);
      await navigator.clipboard.writeText(url);
      setCopied(g.guestId);
      setTimeout(() => setCopied((c) => (c === g.guestId ? null : c)), 2000);
    });

  return (
    <div data-testid="meeting-guests">
      <p className="mb-2 text-label text-text">
        {guests.length} {guests.length === 1 ? 'guest' : 'guests'}
        <span className="font-normal text-text-subtle"> · outside your organization</span>
      </p>
      <ul className="space-y-2.5">
        {guests.map((g) => (
          <li key={g.guestId} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-text-subtle">
              <Mail className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label text-text">{g.name}</span>
              <span className="block truncate text-meta text-text-subtle">{g.email}</span>
              <span
                className={cn(
                  'mt-0.5 flex items-center gap-1 text-meta',
                  g.invite.status === 'failed'
                    ? 'text-danger'
                    : g.invite.status === 'not_configured'
                      ? 'text-warning'
                      : 'text-text-subtle',
                )}
                title={g.invite.error ?? undefined}
              >
                {g.invite.status === 'failed' || g.invite.status === 'not_configured' ? (
                  <MailWarning className="size-3" />
                ) : null}
                {inviteLabel[g.invite.status]}
                {g.invite.status === 'failed' && g.invite.error ? `: ${g.invite.error}` : ''}
              </span>
              {organizer && !cancelled ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    disabled={!online}
                    loading={busy === `copy:${g.guestId}`}
                    onClick={() => void copy(g)}
                  >
                    {copied === g.guestId ? <Check /> : <Copy />}
                    {copied === g.guestId ? 'Copied' : 'Copy link'}
                  </Button>
                  {g.invite.status === 'failed' || g.invite.status === 'sent' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={!online}
                      loading={busy === `resend:${g.guestId}`}
                      onClick={() =>
                        void act(`resend:${g.guestId}`, () =>
                          api.resendGuest(m.meetingId, g.guestId),
                        )
                      }
                    >
                      <RotateCw /> Resend
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-danger hover:bg-danger/10 hover:text-danger"
                    disabled={!online}
                    loading={busy === `remove:${g.guestId}`}
                    onClick={() =>
                      void act(`remove:${g.guestId}`, () =>
                        api.update(m.meetingId, {
                          removeGuestIds: [g.guestId],
                          ...(m.series ? { scope: 'series' as const } : {}),
                        }),
                      )
                    }
                  >
                    <X /> Remove
                  </Button>
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-meta',
                g.response === 'accepted'
                  ? 'bg-success/15 text-success'
                  : g.response === 'declined'
                    ? 'bg-danger/10 text-danger'
                    : g.response === 'tentative'
                      ? 'bg-warning/15 text-warning'
                      : 'bg-surface-raised text-text-subtle',
              )}
            >
              {responseLabel[g.response]}
            </span>
          </li>
        ))}
      </ul>
      {organizer && !cancelled ? (
        <div className="mt-3 space-y-2">
          <GuestPicker guests={adding} onChange={setAdding} label="Invite more guests" />
          {adding.length ? (
            <Button
              size="sm"
              disabled={!online}
              loading={busy === 'add'}
              onClick={() =>
                void act('add', async () => {
                  const r = await api.update(m.meetingId, {
                    addGuests: adding,
                    ...(m.series ? { scope: 'series' as const } : {}),
                  });
                  setAdding([]);
                  return r;
                })
              }
            >
              <Mail /> Send {adding.length === 1 ? 'invite' : `${adding.length} invites`}
            </Button>
          ) : null}
        </div>
      ) : null}
      {err ? <p className="mt-2 text-meta text-danger">{err}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WorkingHoursDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const api = useMeetingsApi();
  const [wh, setWh] = React.useState<WorkingHours | null>(null);
  const [start, setStart] = React.useState('09:00');
  const [end, setEnd] = React.useState('17:30');
  const [days, setDays] = React.useState<number[]>([1, 2, 3, 4, 5]);
  const [tz, setTz] = React.useState(LOCAL_TZ);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    void api.getWorkingHours().then(
      (w) => {
        setWh(w);
        setTz(w.timeZone === 'UTC' ? LOCAL_TZ : w.timeZone);
        if (w.days[0]) {
          setStart(w.days[0].start);
          setEnd(w.days[0].end);
        }
        setDays([...new Set(w.days.map((d) => d.day))]);
      },
      (e) => setError(errorText(e)),
    );
  }, [open, api]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      setWh(
        await api.setWorkingHours({
          timeZone: tz,
          days: days.sort().map((day) => ({ day, start, end })),
        }),
      );
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Working hours"
        description="People scheduling with you only get suggested times inside these hours."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">
            {DAY_NAMES.map((n, i) => (
              <button
                key={n}
                aria-pressed={days.includes(i)}
                onClick={() =>
                  setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))
                }
                className={cn(
                  'h-9 w-12 rounded-md border text-label',
                  days.includes(i)
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border bg-surface text-text-muted',
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="wh-start">
              <Input
                id="wh-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="To" htmlFor="wh-end">
              <Input id="wh-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Time zone" htmlFor="wh-tz" hint={wh ? undefined : 'Loading…'}>
            <Input id="wh-tz" value={tz} onChange={(e) => setTz(e.target.value)} />
          </Field>
          {error ? <p className="text-meta text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              loading={saving}
              disabled={!days.length || end <= start}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Chat card and reminder
// ---------------------------------------------------------------------------

/** Card for the system message a meeting posts in its chat. */
export function MeetingCard({
  message,
  me,
  directory,
  onOpen,
}: {
  message: LocalMessage;
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpen?: (meetingId: string) => void;
}) {
  const meta = message.metadata?.meeting as MeetingSystemMetadata | undefined;
  if (!meta) return null;
  const cancelled = meta.status === 'cancelled';
  const who = meta.organizerId === me ? 'You' : nameOf(meta.organizerId, directory).split(' ')[0];
  return (
    <div className="my-3 flex justify-center" data-testid="meeting-card">
      <button
        onClick={() => onOpen?.(meta.meetingId)}
        className={cn(
          'flex w-full max-w-md items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left shadow-sm hover:border-border-strong',
          cancelled ? 'border-border opacity-70' : 'border-accent/30',
        )}
      >
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full',
            cancelled ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-accent',
          )}
        >
          <CalendarClock className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-label text-text', cancelled && 'line-through')}>
            {meta.title}
          </span>
          <span className="block truncate text-meta text-text-subtle">
            {cancelled ? 'Cancelled' : fmtRange(meta.startsAt, meta.endsAt)} · {who}{' '}
            {meta.status === 'updated' ? 'updated' : cancelled ? 'cancelled' : 'scheduled'}
          </span>
          {meta.recurrence && !cancelled ? (
            <span className="flex items-center gap-1 truncate text-meta text-text-muted">
              <Repeat className="size-3" /> {meta.recurrence}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}

export function MeetingReminderToast({
  onOpenConversation,
}: {
  onOpenConversation: (id: string) => void;
}) {
  useMeetingOutbox();
  const [r, dismiss] = useMeetingReminder();
  const calls = useCalls();
  const { state } = useEngine();
  useAuth();
  return (
    <AnimatePresence>
      {r ? (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          role="status"
          className="fixed right-4 top-4 z-[75] flex w-[min(380px,calc(100vw-2rem))] items-center gap-3 rounded-xl border border-border-strong bg-surface-glass p-4 shadow-2xl backdrop-blur-2xl"
          data-testid="meeting-reminder"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <BellRing className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-label text-text">{r.meeting.title}</p>
            <p className="text-meta text-text-subtle">
              {r.minutesBefore === 0 ? 'Starting now' : `Starts in ${r.minutesBefore} min`} ·{' '}
              {fmtTime(r.meeting.startsAt)}
            </p>
          </div>
          <Button
            size="sm"
            disabled={state.connectivity !== 'online'}
            onClick={() => {
              const live = calls.live.get(r.meeting.conversationId);
              if (live) void calls.join(live.callId);
              else onOpenConversation(r.meeting.conversationId);
              dismiss();
            }}
          >
            {calls.live.get(r.meeting.conversationId) ? 'Join' : 'Open'}
          </Button>
          <button
            onClick={dismiss}
            aria-label="Dismiss reminder"
            className="rounded-sm p-1 text-text-subtle hover:bg-surface-raised"
          >
            <X className="size-4" />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
