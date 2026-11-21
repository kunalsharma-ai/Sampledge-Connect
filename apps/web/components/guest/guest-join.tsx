'use client';
import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  CalendarPlus,
  Check,
  Clock,
  DoorOpen,
  HelpCircle,
  Mic,
  MessageSquare,
  MicOff,
  MonitorUp,
  PhoneOff,
  ScreenShareOff,
  ShieldCheck,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import {
  ConnectionState,
  Room,
  RoomEvent,
  VideoPresets,
  createLocalTracks,
  type LocalTrack,
  type Participant,
} from 'livekit-client';
import type { GuestChatResponse, GuestJoinState, GuestMeetingView } from '@sampledge/contracts';
import { Button, Input, StateView, cn } from '@sampledge/ui';
import { Wordmark } from '@/components/brand';
import { ControlButton, RemoteAudio, Tile, TrackVideo } from '@/components/workspace/calls';
import { CallChatView, type ChatLine } from '@/components/workspace/call-chat';
import { ApiFailure, apiRequest } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { screenTrackOf } from '@/lib/calls';

const POLL_MS = 3000;
const EMPTY_DIRECTORY = new Map();

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

type Phase =
  | { kind: 'details' }
  | { kind: 'asking' } // pressed Join: polling the lobby
  | { kind: 'in-call'; room: Room }
  | { kind: 'left'; reason: 'left' | 'ended' | 'removed' };

function useGuestApi(token: string) {
  return React.useMemo(() => {
    const base = `/v1/guest/${encodeURIComponent(token)}`;
    return {
      view: () => apiRequest<GuestMeetingView>('GET', base),
      rsvp: (response: 'accepted' | 'tentative' | 'declined') =>
        apiRequest<GuestMeetingView>('POST', `${base}/rsvp`, { body: { response } }),
      state: () => apiRequest<GuestJoinState>('GET', `${base}/lobby`),
      ask: (name: string) =>
        apiRequest<GuestJoinState>('POST', `${base}/lobby`, { body: { name } }),
      leave: () =>
        fetch(`${API_URL}${base}/lobby/leave`, { method: 'POST', keepalive: true }).catch(
          () => undefined,
        ),
      chat: () => apiRequest<GuestChatResponse>('GET', `${base}/chat`),
      sendChat: (text: string) =>
        apiRequest<GuestChatResponse>('POST', `${base}/chat`, { body: { text } }),
      icsUrl: `${API_URL}${base}/calendar.ics`,
    };
  }, [token]);
}

/**
 * The page a guest opens from their invite email: meeting details, RSVP, add to calendar,
 * a camera check, then the lobby and the call itself. No account, no install.
 */
export function GuestJoin({ token }: { token: string }) {
  const api = useGuestApi(token);
  const [view, setView] = React.useState<GuestMeetingView | null>(null);
  const [loadError, setLoadError] = React.useState<'missing' | 'offline' | null>(null);
  const [state, setState] = React.useState<GuestJoinState | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'details' });
  const [name, setName] = React.useState('');
  const [mic, setMic] = React.useState(true);
  const [cam, setCam] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const nameRef = React.useRef('');
  nameRef.current = name;

  React.useEffect(() => {
    let live = true;
    api
      .view()
      .then((v) => {
        if (!live) return;
        setView(v);
        setName(v.guest.name);
        setCam(v.media === 'video');
      })
      .catch(
        (e) =>
          live && setLoadError(e instanceof ApiFailure && e.status === 404 ? 'missing' : 'offline'),
      );
    return () => {
      live = false;
    };
  }, [api]);

  // Poll where we stand: on the details screen to show "live now", while asking to keep our
  // place in the lobby, and in the call to notice the end and recording.
  React.useEffect(() => {
    if (!view || phase.kind === 'left') return;
    let live = true;
    const tick = async () => {
      try {
        const s =
          phase.kind === 'asking'
            ? await api.ask(nameRef.current.trim() || view.guest.name)
            : await api.state();
        if (!live) return;
        setState(s);
        if (phase.kind === 'asking' && s.state === 'admitted' && s.join) {
          await connect(s.join);
        } else if (phase.kind === 'in-call' && s.state !== 'admitted') {
          setPhase({ kind: 'left', reason: s.state === 'denied' ? 'removed' : 'ended' });
          phase.room.disconnect();
        }
      } catch (e) {
        if (live && e instanceof ApiFailure && e.status === 404) {
          setPhase({ kind: 'left', reason: 'removed' });
          if (phase.kind === 'in-call') phase.room.disconnect();
        }
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, phase, api]);

  // Closing the tab leaves the lobby right away instead of after the server's timeout.
  React.useEffect(() => {
    if (phase.kind !== 'asking') return;
    const onHide = () => void api.leave();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [phase.kind, api]);

  async function connect(join: NonNullable<GuestJoinState['join']>) {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true },
    });
    try {
      await room.connect(join.url, join.token);
      setPhase({ kind: 'in-call', room });
      await room.localParticipant.setMicrophoneEnabled(mic).catch(() => undefined);
      if (cam) await room.localParticipant.setCameraEnabled(true).catch(() => undefined);
    } catch {
      room.disconnect();
      setError(
        "Couldn't connect to the meeting's media server. Check your connection and try again.",
      );
      setPhase({ kind: 'details' });
    }
  }

  if (loadError === 'missing')
    return (
      <Shell>
        <StateView
          state="error"
          title="This invitation link doesn’t work"
          description="It may have been withdrawn, or the address was cut off. Ask the person who invited you to send it again."
        />
      </Shell>
    );
  if (loadError === 'offline')
    return (
      <Shell>
        <StateView
          state="offline"
          title="Can’t reach the meeting service"
          description="Check your internet connection and reload this page."
          action={<Button onClick={() => location.reload()}>Reload</Button>}
        />
      </Shell>
    );
  if (!view)
    return (
      <Shell>
        <p className="py-16 text-center text-label font-normal text-text-subtle">
          Opening your invitation…
        </p>
      </Shell>
    );

  if (phase.kind === 'in-call')
    return (
      <GuestCall
        room={phase.room}
        api={api}
        title={view.title}
        recording={!!state?.recording}
        onLeave={() => {
          // Only a leave we didn't already explain (ended / removed) counts as "you left".
          setPhase((p) => (p.kind === 'in-call' ? { kind: 'left', reason: 'left' } : p));
          phase.room.disconnect();
        }}
      />
    );

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <MeetingCard view={view} api={api} onChange={setView} />
        <div className="rounded-2xl border border-border bg-surface/80 p-5 shadow-sm backdrop-blur">
          {phase.kind === 'left' ? (
            <LeftPanel
              reason={phase.reason}
              onRejoin={() => {
                setError(null);
                setPhase({ kind: 'asking' });
              }}
            />
          ) : (
            <JoinPanel
              view={view}
              state={state}
              asking={phase.kind === 'asking'}
              name={name}
              setName={setName}
              mic={mic}
              setMic={setMic}
              cam={cam}
              setCam={setCam}
              error={error}
              onJoin={() => {
                setError(null);
                setPhase({ kind: 'asking' });
              }}
              onCancel={() => {
                void api.leave();
                setPhase({ kind: 'details' });
              }}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="sc-noise relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-accent/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 right-[-120px] size-[480px] rounded-full bg-accent2/15 blur-[120px]" />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex items-center justify-between">
          <Wordmark />
          <span className="flex items-center gap-1.5 text-meta text-text-subtle">
            <ShieldCheck className="size-3.5" /> Guest access · no account needed
          </span>
        </header>
        {children}
      </div>
    </main>
  );
}

const responseText = { accepted: 'Going', tentative: 'Maybe', declined: 'Not going' } as const;

function MeetingCard({
  view: v,
  api,
  onChange,
}: {
  view: GuestMeetingView;
  api: ReturnType<typeof useGuestApi>;
  onChange: (v: GuestMeetingView) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const start = new Date(v.startsAt);
  const end = new Date(v.endsAt);
  const cancelled = v.status === 'cancelled';
  return (
    <section
      className="rounded-2xl border border-border bg-surface/80 p-6 shadow-sm backdrop-blur"
      data-testid="guest-meeting"
    >
      <p className="text-meta uppercase tracking-wide text-text-subtle">
        {v.organizationName} invited you
      </p>
      <h1
        className={cn(
          'mt-2 font-display text-h2 text-text',
          cancelled && 'line-through opacity-60',
        )}
      >
        {v.title}
      </h1>
      {cancelled ? (
        <p className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-label font-normal text-danger">
          This meeting was cancelled.
        </p>
      ) : null}
      <dl className="mt-4 space-y-2 text-label font-normal text-text-muted">
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 size-4 shrink-0 text-text-subtle" />
          <div>
            <dt className="sr-only">When</dt>
            <dd className="text-text">
              {dateFmt.format(start)} · {timeFmt.format(start)} – {timeFmt.format(end)}
            </dd>
            <dd className="text-meta text-text-subtle">
              Your time ({LOCAL_TZ})
              {v.timeZone !== LOCAL_TZ ? ` · organizer is in ${v.timeZone}` : ''}
            </dd>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Users className="size-4 shrink-0 text-text-subtle" />
          <dt className="sr-only">Organizer</dt>
          <dd>Organized by {v.organizerName}</dd>
        </div>
        <div className="flex items-center gap-2">
          {v.media === 'video' ? (
            <Video className="size-4 shrink-0 text-text-subtle" />
          ) : (
            <Mic className="size-4 shrink-0 text-text-subtle" />
          )}
          <dt className="sr-only">Type</dt>
          <dd>{v.media === 'video' ? 'Video meeting' : 'Audio meeting'} in your browser</dd>
        </div>
      </dl>
      {v.agenda ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1 text-label text-text">Agenda</p>
          <p className="whitespace-pre-wrap text-label font-normal text-text-muted">{v.agenda}</p>
        </div>
      ) : null}
      {!cancelled ? (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-label text-text">
            Will you attend, {v.guest.name.split(' ')[0]}?
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Your response">
            {(['accepted', 'tentative', 'declined'] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={v.guest.response === r ? 'primary' : 'secondary'}
                aria-pressed={v.guest.response === r}
                loading={busy === r}
                onClick={async () => {
                  setBusy(r);
                  try {
                    onChange(await api.rsvp(r));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {r === 'accepted' ? <Check /> : r === 'tentative' ? <HelpCircle /> : <X />}
                {responseText[r]}
              </Button>
            ))}
            <a
              href={api.icsUrl}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-label text-accent hover:bg-accent-soft [&_svg]:size-4"
            >
              <CalendarPlus /> Add to calendar
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CameraPreview({ on }: { on: boolean }) {
  const [track, setTrack] = React.useState<LocalTrack | null>(null);
  const [blocked, setBlocked] = React.useState(false);
  React.useEffect(() => {
    if (!on) return;
    let t: LocalTrack | null = null;
    let live = true;
    createLocalTracks({ video: { resolution: VideoPresets.h540.resolution }, audio: false })
      .then(([v]) => {
        if (!live) return v?.stop();
        t = v ?? null;
        setTrack(t);
        setBlocked(false);
      })
      .catch(() => live && setBlocked(true));
    return () => {
      live = false;
      t?.stop();
      setTrack(null);
    };
  }, [on]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-surface-sunken">
      {on && track ? (
        <TrackVideo track={track as never} mirror />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-text-subtle">
          <VideoOff className="size-6" />
          <span className="text-meta">
            {on && blocked ? 'Camera blocked. Allow it in the address bar.' : 'Camera is off'}
          </span>
        </div>
      )}
    </div>
  );
}

function JoinPanel({
  view,
  state,
  asking,
  name,
  setName,
  mic,
  setMic,
  cam,
  setCam,
  error,
  onJoin,
  onCancel,
}: {
  view: GuestMeetingView;
  state: GuestJoinState | null;
  asking: boolean;
  name: string;
  setName: (s: string) => void;
  mic: boolean;
  setMic: (b: boolean) => void;
  cam: boolean;
  setCam: (b: boolean) => void;
  error: string | null;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const reduce = useReducedMotion();
  const s = state?.state;
  const closed = s === 'cancelled' || s === 'ended' || s === 'too_early';

  if (asking && (s === 'waiting' || s === 'not_started' || s === 'admitted' || s === 'denied'))
    return (
      <div
        className="flex flex-col items-center gap-4 py-8 text-center"
        aria-live="polite"
        data-testid="guest-lobby"
      >
        {s === 'denied' ? (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
              <X className="size-6" />
            </span>
            <div>
              <p className="font-display text-h3 text-text">You weren’t let in</p>
              <p className="mt-1 text-label font-normal text-text-muted">
                Someone in the meeting declined your request. Contact {view.organizerName} if you
                think this is a mistake.
              </p>
            </div>
          </>
        ) : (
          <>
            <motion.span
              animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent"
            >
              <DoorOpen className="size-6" />
            </motion.span>
            <div>
              <p className="font-display text-h3 text-text">
                {s === 'not_started' ? 'Waiting for the meeting to start' : 'You’re in the lobby'}
              </p>
              <p className="mt-1 text-label font-normal text-text-muted">
                {s === 'not_started'
                  ? 'Nobody has started it yet. As soon as someone does, we’ll ask them to let you in.'
                  : 'Someone in the meeting will let you in soon. Keep this page open.'}
              </p>
            </div>
            {state?.recording ? (
              <p className="flex items-center gap-1.5 rounded-full bg-danger/10 px-3 py-1 text-meta font-semibold text-danger">
                <span className="size-1.5 rounded-full bg-danger" /> This meeting is being recorded
              </p>
            ) : null}
            <Button variant="ghost" onClick={onCancel}>
              Leave the lobby
            </Button>
          </>
        )}
      </div>
    );

  const opens = new Date(view.joinOpensAt);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-h3 text-text">Join the meeting</p>
        {s === 'ready' ? (
          <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-meta font-semibold text-success">
            <span className="size-1.5 rounded-full bg-success" /> Live now
          </span>
        ) : null}
      </div>
      {view.media === 'video' ? <CameraPreview on={cam && !closed} /> : null}
      <div className="flex gap-2">
        <Button
          variant={mic ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={mic}
          onClick={() => setMic(!mic)}
        >
          {mic ? <Mic /> : <MicOff />} {mic ? 'Mic on' : 'Mic off'}
        </Button>
        {view.media === 'video' ? (
          <Button
            variant={cam ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={cam}
            onClick={() => setCam(!cam)}
          >
            {cam ? <Video /> : <VideoOff />} {cam ? 'Camera on' : 'Camera off'}
          </Button>
        ) : null}
      </div>
      <label className="block">
        <span className="text-label text-text">Your name</span>
        <Input
          className="mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="How others will see you"
        />
      </label>
      {error ? <p className="text-meta text-danger">{error}</p> : null}
      <Button
        className="w-full"
        size="lg"
        disabled={closed || !name.trim()}
        onClick={onJoin}
        data-testid="guest-join"
      >
        <DoorOpen /> Ask to join
      </Button>
      <p className="text-meta text-text-subtle">
        {s === 'too_early'
          ? `You can join from ${timeFmt.format(opens)} on ${dateFmt.format(opens)}.`
          : s === 'ended'
            ? 'This meeting is over.'
            : s === 'cancelled'
              ? 'This meeting was cancelled.'
              : 'You’ll wait in the lobby until someone in the meeting lets you in. Everyone will see you as a guest.'}
      </p>
    </div>
  );
}

function LeftPanel({
  reason,
  onRejoin,
}: {
  reason: 'left' | 'ended' | 'removed';
  onRejoin: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="font-display text-h3 text-text">
        {reason === 'left'
          ? 'You left the meeting'
          : reason === 'ended'
            ? 'The meeting has ended'
            : 'You’re no longer in this meeting'}
      </p>
      <p className="text-label font-normal text-text-muted">
        {reason === 'removed'
          ? 'The organizer removed your invitation.'
          : 'You can close this page.'}
      </p>
      {reason === 'left' ? <Button onClick={onRejoin}>Rejoin</Button> : null}
    </div>
  );
}

/** The guest's call view: the room's tiles, plus mic, camera, screen share and leave. */
function GuestCall({
  room,
  api,
  title,
  recording,
  onLeave,
}: {
  room: Room;
  api: ReturnType<typeof useGuestApi>;
  title: string;
  recording: boolean;
  onLeave: () => void;
}) {
  const reduce = useReducedMotion();
  const [, setVersion] = React.useState(0);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [lines, setLines] = React.useState<ChatLine[]>([]);
  const [seen, setSeen] = React.useState(0);
  const toLines = React.useCallback(
    (r: GuestChatResponse): ChatLine[] =>
      r.messages.map((m) => ({
        id: m.messageId,
        name: m.senderName,
        guest: m.fromGuest,
        mine: m.mine,
        text: m.text,
        files: m.attachmentNames,
        at: m.createdAt,
      })),
    [],
  );
  React.useEffect(() => {
    let live = true;
    const tick = () =>
      api
        .chat()
        .then((r) => live && setLines(toLines(r)))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api, toLines]);
  const others = lines.filter((l) => !l.mine).length;
  React.useEffect(() => {
    if (chatOpen) setSeen(others);
  }, [chatOpen, others]);
  const unread = Math.max(0, others - seen);
  React.useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionStateChanged,
      RoomEvent.ParticipantAttributesChanged,
    ];
    for (const e of events) room.on(e, bump);
    room.on(RoomEvent.Disconnected, onLeave);
    return () => {
      for (const e of events) room.off(e, bump);
      room.off(RoomEvent.Disconnected, onLeave);
    };
  }, [room, onLeave]);

  const lp = room.localParticipant;
  const remotes = [...room.remoteParticipants.values()];
  const everyone: Participant[] = [lp, ...remotes];
  const speakers = new Set(room.activeSpeakers.map((s) => s.identity));
  const sharer = everyone.find((p) => screenTrackOf(p));
  const share = sharer ? screenTrackOf(sharer) : null;
  const n = everyone.length;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const cols = narrow ? (n <= 2 ? 1 : 2) : n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const reconnecting = room.state !== ConnectionState.Connected;

  return (
    <AnimatePresence>
      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 flex flex-col bg-[radial-gradient(ellipse_at_top,#16213a,#070b14_70%)] text-white"
        data-testid="guest-call"
      >
        <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-h3">{title}</p>
            <p className="flex items-center gap-2 text-meta text-white/70">
              {reconnecting ? 'Reconnecting…' : 'Connected'} <span aria-hidden>·</span>
              <Users className="size-3.5" /> {n}
            </p>
          </div>
          {recording ? (
            <span className="flex items-center gap-1.5 rounded-full bg-[#ff6b6b]/15 px-3 py-1 text-meta font-semibold text-[#ff6b6b]">
              <span className="size-1.5 rounded-full bg-[#ff6b6b]" /> Recording
            </span>
          ) : null}
          <span className="hidden rounded-full border border-white/15 px-2.5 py-1 text-meta text-white/70 sm:inline">
            You’re a guest
          </span>
        </header>
        <div className="relative flex min-h-0 flex-1 gap-3 p-3 sm:p-4">
          {share && sharer ? (
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black">
              <TrackVideo track={share} contain />
              <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-meta">
                {sharer === lp ? 'You are presenting' : `${sharer.name || 'Someone'} is presenting`}
              </span>
            </div>
          ) : (
            <div
              className="grid min-h-0 flex-1 gap-3"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridAutoRows: '1fr',
              }}
            >
              {everyone.map((p) => (
                <Tile
                  key={p.identity}
                  p={p}
                  isLocal={p === lp}
                  speaking={speakers.has(p.identity)}
                  directory={EMPTY_DIRECTORY}
                />
              ))}
            </div>
          )}
          {chatOpen ? (
            <div className="absolute inset-3 z-10 flex sm:static sm:inset-auto">
              <CallChatView
                lines={lines}
                onClose={() => setChatOpen(false)}
                note="You see messages sent during this call."
                onSend={async (t) => setLines(toLines(await api.sendChat(t)))}
              />
            </div>
          ) : null}
        </div>
        <footer className="flex flex-wrap items-center justify-center gap-3 px-4 pb-6 pt-2">
          <ControlButton
            on={lp.isMicrophoneEnabled}
            label={lp.isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
            onClick={() => void lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled)}
          >
            {lp.isMicrophoneEnabled ? <Mic /> : <MicOff />}
          </ControlButton>
          <ControlButton
            on={lp.isCameraEnabled}
            label={lp.isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            onClick={() => void lp.setCameraEnabled(!lp.isCameraEnabled)}
          >
            {lp.isCameraEnabled ? <Video /> : <VideoOff />}
          </ControlButton>
          <ControlButton
            label={lp.isScreenShareEnabled ? 'Stop presenting' : 'Share your screen'}
            onClick={() =>
              void lp
                .setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: true })
                .catch(() => undefined)
            }
            disabled={!!sharer && sharer !== lp}
          >
            {lp.isScreenShareEnabled ? <ScreenShareOff /> : <MonitorUp />}
          </ControlButton>
          <span className="relative">
            <ControlButton
              on={chatOpen ? true : undefined}
              label={chatOpen ? 'Hide chat' : 'Chat'}
              onClick={() => setChatOpen((o) => !o)}
            >
              <MessageSquare />
            </ControlButton>
            {unread && !chatOpen ? (
              <span className="pointer-events-none absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-fg">
                {unread}
              </span>
            ) : null}
          </span>
          <ControlButton tone="danger" label="Leave meeting" onClick={onLeave}>
            <PhoneOff />
          </ControlButton>
        </footer>
        <RemoteAudio participants={remotes} />
      </motion.div>
    </AnimatePresence>
  );
}
