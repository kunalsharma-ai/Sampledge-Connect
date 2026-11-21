'use client';
import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Check,
  Circle,
  CircleStop,
  DoorOpen,
  Hand,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  ScreenShareOff,
  Users,
  Video,
  VideoOff,
  WifiOff,
  X,
} from 'lucide-react';
import { Track, type Participant } from 'livekit-client';
import {
  formatCallDuration,
  type Call,
  type CallSystemMetadata,
  type Conversation,
} from '@sampledge/contracts';
import type { LocalMessage } from '@sampledge/offline';
import { Avatar, Button, Tooltip, cn } from '@sampledge/ui';
import { cameraTrackOf, handRaisedAt, screenTrackOf, useCalls } from '@/lib/calls';
import type { DirectoryEntry } from '@/lib/engine';
import { conversationTitle, formatTime, nameOf } from './helpers';

const iconBtn =
  'rounded-sm p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:pointer-events-none disabled:opacity-40';

/** Voice and video buttons for the conversation header. */
export function CallButtons({
  conversation,
  offline,
  readOnly,
}: {
  conversation: Conversation;
  offline: boolean;
  readOnly: boolean;
}) {
  const calls = useCalls();
  const enabled = calls.config?.enabled ?? false;
  const inThis = calls.current?.call.conversationId === conversation.conversationId;
  const reason = !calls.config
    ? 'Checking call setup…'
    : !enabled
      ? 'Calls aren’t set up on this server yet. An admin needs to configure the media server.'
      : offline
        ? 'Calls need a connection'
        : readOnly
          ? 'Join this conversation to call'
          : null;
  const disabled = !!reason || inThis;
  return (
    <div className="flex items-center gap-0.5">
      <Tooltip content={reason ?? 'Start a voice call'} side="bottom">
        <span>
          <button
            className={iconBtn}
            aria-label="Start a voice call"
            disabled={disabled}
            onClick={() => void calls.start(conversation.conversationId, 'audio')}
          >
            <Phone className="size-4" />
          </button>
        </span>
      </Tooltip>
      <Tooltip content={reason ?? 'Start a video call'} side="bottom">
        <span>
          <button
            className={iconBtn}
            aria-label="Start a video call"
            disabled={disabled}
            onClick={() => void calls.start(conversation.conversationId, 'video')}
          >
            <Video className="size-4" />
          </button>
        </span>
      </Tooltip>
    </div>
  );
}

function joinedOf(call: Call) {
  return call.participants.filter((p) => p.state === 'joined');
}

/** "Call in progress" strip under the header when you're not in the conversation's live call. */
export function LiveCallBanner({
  conversation,
  directory,
  offline,
}: {
  conversation: Conversation;
  directory: Map<string, DirectoryEntry>;
  offline: boolean;
}) {
  const calls = useCalls();
  const call = calls.live.get(conversation.conversationId);
  if (!call || calls.current?.call.callId === call.callId) return null;
  const joined = joinedOf(call);
  return (
    <div className="flex items-center gap-3 border-b border-success/25 bg-success/10 px-4 py-2 sm:px-6">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2.5 rounded-full bg-success" />
      </span>
      <div className="flex -space-x-2">
        {joined.slice(0, 4).map((p) => (
          <Avatar
            key={p.userId}
            name={nameOf(p.userId, directory)}
            size="xs"
            className="ring-2 ring-bg rounded-full"
          />
        ))}
      </div>
      <p className="min-w-0 flex-1 truncate text-label text-text">
        {call.media === 'video' ? 'Video' : 'Voice'} call in progress
        <span className="font-normal text-text-muted">
          {' '}
          · {joined.length} {joined.length === 1 ? 'person' : 'people'}
        </span>
      </p>
      <Button
        size="sm"
        onClick={() => void calls.join(call.callId)}
        disabled={offline}
        className="bg-success text-bg hover:bg-success/90"
      >
        {call.media === 'video' ? <Video /> : <Phone />} Join
      </Button>
    </div>
  );
}

/** A small, repeating two-tone ring made with Web Audio (no audio files to ship or license). */
function useRingtone(active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const ring = () => {
      if (!ctx || ctx.state === 'closed') return;
      const t = ctx.currentTime;
      for (const [i, f] of [440, 554].entries()) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t + i * 0.18);
        g.gain.linearRampToValueAtTime(0.06, t + i * 0.18 + 0.02);
        g.gain.linearRampToValueAtTime(0, t + i * 0.18 + 0.32);
        o.connect(g).connect(ctx.destination);
        o.start(t + i * 0.18);
        o.stop(t + i * 0.18 + 0.35);
      }
    };
    ring();
    const id = setInterval(ring, 2200);
    return () => {
      clearInterval(id);
      void ctx?.close();
    };
  }, [active]);
}

/** Incoming call card (top right). Answer with video, answer audio-only, or decline. */
export function IncomingCall({
  conversations,
  me,
  directory,
}: {
  conversations: Conversation[];
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const calls = useCalls();
  const reduce = useReducedMotion();
  const ring = calls.incoming;
  useRingtone(!!ring);
  const conv = ring ? conversations.find((c) => c.conversationId === ring.conversationId) : null;
  const caller = ring ? nameOf(ring.callerId, directory) : '';
  return (
    <AnimatePresence>
      {ring ? (
        <motion.div
          key={ring.call.callId}
          role="alertdialog"
          aria-label={`Incoming ${ring.media} call from ${caller}`}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.97 }}
          transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          className="fixed right-4 top-4 z-[80] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-strong bg-surface-glass shadow-2xl backdrop-blur-2xl"
        >
          <div className="flex items-center gap-3 p-4">
            <span className="relative">
              <span className="absolute -inset-1 animate-ping rounded-full bg-success/30 motion-reduce:animate-none" />
              <Avatar name={caller} size="lg" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-meta text-success">
                <PhoneIncoming className="size-3.5" /> Incoming{' '}
                {ring.media === 'video' ? 'video' : 'voice'} call
              </p>
              <p className="truncate font-display text-h3 text-text">{caller}</p>
              {conv && conv.kind !== 'dm' ? (
                <p className="truncate text-meta text-text-muted">
                  in {conversationTitle(conv, me, directory)}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2 border-t border-border bg-surface/50 p-3">
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              onClick={() => void calls.decline(ring.call.callId)}
            >
              <PhoneOff /> Decline
            </Button>
            {ring.media === 'video' ? (
              <Tooltip content="Answer without your camera">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Answer with audio only"
                  onClick={() => void calls.join(ring.call.callId, { video: false })}
                >
                  <Phone />
                </Button>
              </Tooltip>
            ) : null}
            <Button
              size="sm"
              className="flex-1 bg-success text-bg hover:bg-success/90"
              onClick={() => void calls.join(ring.call.callId)}
            >
              {ring.media === 'video' ? <Video /> : <Phone />} Answer
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function TrackVideo({
  track,
  mirror,
  contain,
}: {
  track: NonNullable<ReturnType<typeof cameraTrackOf>>;
  mirror?: boolean;
  contain?: boolean;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        'size-full',
        contain ? 'object-contain' : 'object-cover',
        mirror && '-scale-x-100',
      )}
    />
  );
}

/** Plays every remote microphone and screen-share audio track. */
export function RemoteAudio({ participants }: { participants: Participant[] }) {
  return (
    <>
      {participants.flatMap((p) =>
        [Track.Source.Microphone, Track.Source.ScreenShareAudio].map((src) => {
          const t = p.getTrackPublication(src)?.track;
          return t ? <AudioEl key={`${p.identity}:${src}`} track={t} /> : null;
        }),
      )}
    </>
  );
}
function AudioEl({ track }: { track: Track }) {
  const ref = React.useRef<HTMLAudioElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

export function Tile({
  p,
  isLocal,
  speaking,
  directory,
  compact,
}: {
  p: Participant;
  isLocal: boolean;
  speaking: boolean;
  directory: Map<string, DirectoryEntry>;
  compact?: boolean;
}) {
  const cam = cameraTrackOf(p);
  const name = isLocal ? 'You' : p.name || nameOf(p.identity, directory);
  const hand = handRaisedAt(p);
  const micOn = p.isMicrophoneEnabled;
  return (
    <div
      className={cn(
        'relative flex min-h-0 items-center justify-center overflow-hidden rounded-xl border bg-surface-sunken transition-[box-shadow,border-color] duration-150',
        speaking ? 'border-success shadow-[0_0_0_2px_var(--color-success)]' : 'border-border',
      )}
      data-testid="call-tile"
    >
      {cam ? (
        <TrackVideo track={cam} mirror={isLocal} />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Avatar name={p.name || nameOf(p.identity, directory)} size="lg" />
          {!compact ? <span className="text-meta text-text-subtle">Camera off</span> : null}
        </div>
      )}
      <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-meta text-white backdrop-blur">
          {micOn ? <Mic className="size-3" /> : <MicOff className="size-3 text-danger" />}
          <span className="truncate">{name}</span>
        </span>
      </div>
      {hand ? (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-warning px-2 py-1 text-meta font-semibold text-bg">
          <Hand className="size-3" /> Hand raised
        </span>
      ) : null}
    </div>
  );
}

function useElapsed(since: string) {
  const [, setN] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return formatCallDuration(Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000)));
}

export function ControlButton({
  on,
  label,
  onClick,
  children,
  tone = 'default',
  disabled,
}: {
  on?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={on}
        disabled={disabled}
        className={cn(
          'flex size-11 items-center justify-center rounded-full border transition-[background-color,transform] duration-150 hover:-translate-y-px disabled:opacity-40 [&_svg]:size-5',
          tone === 'danger'
            ? 'w-16 border-transparent bg-danger text-white hover:opacity-90'
            : on === false
              ? 'border-transparent bg-white text-[#111827]'
              : 'border-white/15 bg-white/10 text-white hover:bg-white/20',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The in-call stage: participant grid (screen share takes the main stage), controls, and a
 * minimized pill so the conversation's chat stays usable during the call.
 */
export function CallStage({
  conversations,
  me,
  directory,
  onOpenConversation,
}: {
  conversations: Conversation[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpenConversation: (conversationId: string) => void;
}) {
  const calls = useCalls();
  const reduce = useReducedMotion();
  const cur = calls.current;
  const [confirmEnd, setConfirmEnd] = React.useState(false);
  React.useEffect(() => setConfirmEnd(false), [cur?.call.callId]);
  const elapsed = useElapsed(cur?.call.startedAt ?? new Date().toISOString());
  if (!cur) return null;
  const { room, call } = cur;
  const conv = conversations.find((c) => c.conversationId === call.conversationId);
  const title = conv ? conversationTitle(conv, me, directory) : 'Call';
  const lp = room.localParticipant;
  const remotes = [...room.remoteParticipants.values()];
  const everyone: Participant[] = [lp, ...remotes];
  const speakers = new Set(room.activeSpeakers.map((s) => s.identity));
  const sharer = everyone.find((p) => screenTrackOf(p));
  const share = sharer ? screenTrackOf(sharer) : null;
  const canEndForAll =
    call.startedBy === me || conv?.myRole === 'owner' || conv?.myRole === 'moderator';
  const ringingCount = call.participants.filter((p) => p.state === 'ringing').length;
  const hands = everyone.filter((p) => handRaisedAt(p)).length;

  const statusLine =
    cur.phase === 'connecting'
      ? 'Connecting…'
      : cur.phase === 'reconnecting'
        ? 'Reconnecting…'
        : remotes.length === 0
          ? ringingCount
            ? `Ringing ${ringingCount} ${ringingCount === 1 ? 'person' : 'people'}…`
            : 'Waiting for others to join'
          : elapsed;

  if (cur.minimized) {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed bottom-20 right-4 z-[60] flex items-center gap-3 rounded-full border border-border-strong bg-[#0b1220]/95 py-2 pl-4 pr-2 text-white shadow-2xl backdrop-blur md:bottom-6"
        data-testid="call-pill"
      >
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-success" />
        </span>
        <button
          className="min-w-0 text-left"
          onClick={() => calls.setMinimized(false)}
          aria-label="Return to call"
        >
          <p className="max-w-40 truncate text-label">{title}</p>
          <p className="flex items-center gap-1.5 text-meta text-white/70">
            {call.recording ? (
              <span className="flex items-center gap-1 font-semibold text-[#ff6b6b]">
                <span className="size-1.5 rounded-full bg-[#ff6b6b]" /> REC
              </span>
            ) : null}
            {statusLine}
            {call.lobby?.length ? (
              <span className="font-semibold text-warning">· {call.lobby.length} in lobby</span>
            ) : null}
          </p>
        </button>
        <button
          onClick={() => void calls.toggleMic()}
          aria-label={lp.isMicrophoneEnabled ? 'Mute' : 'Unmute'}
          className={cn(
            'flex size-9 items-center justify-center rounded-full',
            lp.isMicrophoneEnabled ? 'bg-white/10 hover:bg-white/20' : 'bg-white text-[#111827]',
          )}
        >
          {lp.isMicrophoneEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
        </button>
        <button
          onClick={() => calls.setMinimized(false)}
          aria-label="Expand call"
          className="flex size-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <Maximize2 className="size-4" />
        </button>
        <button
          onClick={() => void calls.leave()}
          aria-label="Leave call"
          className="flex size-9 items-center justify-center rounded-full bg-danger hover:opacity-90"
        >
          <PhoneOff className="size-4" />
        </button>
        <RemoteAudio participants={remotes} />
      </motion.div>
    );
  }

  const n = everyone.length;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const cols = narrow ? (n <= 2 ? 1 : 2) : n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className="fixed inset-0 z-[60] flex flex-col bg-[radial-gradient(ellipse_at_top,#16213a,#070b14_70%)] text-white"
      role="dialog"
      aria-label={`Call in ${title}`}
      data-testid="call-stage"
    >
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-h3">{title}</p>
          <p className="flex items-center gap-2 text-meta text-white/70">
            {cur.phase !== 'connected' ? <WifiOff className="size-3.5 text-warning" /> : null}
            <span data-testid="call-status">{statusLine}</span>
            <span aria-hidden>·</span>
            <Users className="size-3.5" /> {n}
            {hands ? (
              <>
                <span aria-hidden>·</span>
                <Hand className="size-3.5 text-warning" /> {hands}
              </>
            ) : null}
          </p>
        </div>
        <RecordingBadge call={call} me={me} directory={directory} />
        <span className="hidden rounded-full border border-white/15 px-2.5 py-1 text-meta text-white/70 sm:inline">
          Self-hosted media
        </span>
        <Tooltip content="Back to chat (keep the call going)">
          <button
            onClick={() => {
              calls.setMinimized(true);
              onOpenConversation(call.conversationId);
            }}
            aria-label="Minimize call"
            className="rounded-md p-2 text-white/80 hover:bg-white/10"
          >
            <Minimize2 className="size-4" />
          </button>
        </Tooltip>
      </header>

      {cur.error ? (
        <p className="mx-4 rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-meta text-warning sm:mx-6">
          {cur.error}
        </p>
      ) : null}
      <LobbyPanel call={call} onDecide={(id, allow) => void calls.decideGuest(id, allow)} />

      <div className="flex min-h-0 flex-1 gap-3 p-3 sm:p-4">
        {share && sharer ? (
          <>
            <div className="relative min-w-0 flex-[3] overflow-hidden rounded-xl border border-white/10 bg-black">
              <TrackVideo track={share} contain />
              <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-meta">
                {sharer === lp
                  ? 'You are presenting'
                  : `${sharer.name || nameOf(sharer.identity, directory)} is presenting`}
              </span>
            </div>
            <div className="hidden w-56 flex-col gap-3 overflow-y-auto md:flex">
              {everyone.map((p) => (
                <div key={p.identity} className="aspect-video shrink-0">
                  <Tile
                    p={p}
                    isLocal={p === lp}
                    speaking={speakers.has(p.identity)}
                    directory={directory}
                    compact
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div
            className="grid min-h-0 flex-1 gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: '1fr' }}
          >
            {everyone.map((p) => (
              <Tile
                key={p.identity}
                p={p}
                isLocal={p === lp}
                speaking={speakers.has(p.identity)}
                directory={directory}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-3 px-4 pb-6 pt-2">
        <ControlButton
          on={lp.isMicrophoneEnabled}
          label={lp.isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
          onClick={() => void calls.toggleMic()}
        >
          {lp.isMicrophoneEnabled ? <Mic /> : <MicOff />}
        </ControlButton>
        <ControlButton
          on={lp.isCameraEnabled}
          label={lp.isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          onClick={() => void calls.toggleCamera()}
        >
          {lp.isCameraEnabled ? <Video /> : <VideoOff />}
        </ControlButton>
        <ControlButton
          label={lp.isScreenShareEnabled ? 'Stop presenting' : 'Share your screen'}
          onClick={() => void calls.toggleScreenShare()}
          disabled={!!sharer && sharer !== lp}
        >
          {lp.isScreenShareEnabled ? <ScreenShareOff /> : <MonitorUp />}
        </ControlButton>
        <ControlButton
          label={handRaisedAt(lp) ? 'Lower your hand' : 'Raise your hand'}
          onClick={() => void calls.toggleHand()}
        >
          <Hand className={cn(handRaisedAt(lp) && 'text-warning')} />
        </ControlButton>
        {calls.config?.recordingEnabled ? (
          <ControlButton
            label={
              call.recording?.status === 'stopping'
                ? 'Saving the recording…'
                : call.recording
                  ? 'Stop recording'
                  : 'Record this call'
            }
            onClick={() => void calls.toggleRecording()}
            disabled={call.recording?.status === 'stopping'}
          >
            {call.recording ? (
              <CircleStop className="text-[#ff6b6b]" />
            ) : (
              <Circle className="fill-[#ff6b6b] text-[#ff6b6b]" />
            )}
          </ControlButton>
        ) : null}
        <ControlButton tone="danger" label="Leave call" onClick={() => void calls.leave()}>
          <PhoneOff />
        </ControlButton>
        {canEndForAll && remotes.length > 0 ? (
          confirmEnd ? (
            <Button size="sm" variant="danger" onClick={() => void calls.endForAll()}>
              End for everyone?
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => setConfirmEnd(true)}
            >
              End for all
            </Button>
          )
        ) : null}
      </footer>
      <RemoteAudio participants={remotes} />
    </motion.div>
  );
}

/**
 * External guests waiting to be let in. Everyone in the call sees it and anyone can decide;
 * the first answer wins and the list updates for everyone.
 */
function LobbyPanel({
  call,
  onDecide,
}: {
  call: Call;
  onDecide: (guestId: string, allow: boolean) => void;
}) {
  const waiting = call.lobby ?? [];
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!waiting.length) return null;
  return (
    <section
      className="mx-4 rounded-xl border border-warning/35 bg-[#2a2210]/85 px-3 py-2.5 backdrop-blur sm:mx-6"
      aria-live="polite"
      aria-label="Lobby"
      data-testid="call-lobby"
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold text-warning">
        <DoorOpen className="size-3.5" />
        {waiting.length === 1
          ? '1 guest is waiting in the lobby'
          : `${waiting.length} guests are waiting in the lobby`}
      </p>
      <ul className="space-y-1.5">
        {waiting.map((g) => (
          <li key={g.guestId} className="flex flex-wrap items-center gap-2">
            <Avatar name={g.name} size="xs" />
            <span className="min-w-0 flex-1 truncate text-label">
              {g.name}{' '}
              <span className="font-normal text-white/60">
                · {g.email} · guest from outside your organization
              </span>
            </span>
            <Button
              size="sm"
              className="bg-success text-bg hover:bg-success/90"
              loading={busy === g.guestId}
              onClick={() => {
                setBusy(g.guestId);
                onDecide(g.guestId, true);
              }}
            >
              <Check /> Admit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-white/80 hover:bg-white/10 hover:text-white"
              disabled={busy === g.guestId}
              onClick={() => {
                setBusy(g.guestId);
                onDecide(g.guestId, false);
              }}
            >
              <X /> Deny
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Shown to everyone in the call while it is being recorded (consent indicator), with who
 * started it. Announced to screen readers when it changes.
 */
function RecordingBadge({
  call,
  me,
  directory,
}: {
  call: Call;
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const rec = call.recording;
  const elapsed = useElapsed(rec?.startedAt ?? new Date().toISOString());
  return (
    <span aria-live="polite" className="contents">
      {rec ? (
        <span
          data-testid="recording-indicator"
          className="flex items-center gap-2 rounded-full border border-[#ff6b6b]/50 bg-[#ff6b6b]/15 px-3 py-1 text-meta font-semibold text-[#ffb4b4]"
        >
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ff6b6b] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-[#ff6b6b]" />
          </span>
          {rec.status === 'stopping'
            ? 'Saving recording…'
            : rec.status === 'starting'
              ? 'Starting recording…'
              : `Recording · ${elapsed}`}
          <span className="hidden font-normal text-white/70 md:inline">
            by {rec.startedBy === me ? 'you' : nameOf(rec.startedBy, directory).split(' ')[0]}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Call card rendered in place of a bubble for system messages carrying `metadata.call`. */
export function CallCard({
  message,
  me,
  directory,
  offline,
}: {
  message: LocalMessage;
  me: string;
  directory: Map<string, DirectoryEntry>;
  offline: boolean;
}) {
  const calls = useCalls();
  const meta = message.metadata?.call as CallSystemMetadata | undefined;
  if (!meta) return null;
  const media = meta.media === 'video' ? 'Video' : 'Voice';
  const live = calls.live.get(message.conversationId);
  const isLive = meta.status === 'started' && live?.callId === meta.callId;
  const inIt = calls.current?.call.callId === meta.callId;
  const starter = meta.startedBy === me ? 'You' : nameOf(meta.startedBy, directory).split(' ')[0];
  const Icon =
    meta.status === 'missed' || meta.status === 'declined'
      ? PhoneMissed
      : meta.media === 'video'
        ? Video
        : Phone;
  const title =
    meta.status === 'started'
      ? isLive
        ? `${media} call in progress`
        : `${media} call`
      : meta.status === 'ended'
        ? `${media} call ended`
        : meta.status === 'declined'
          ? `${media} call declined`
          : `Missed ${media.toLowerCase()} call`;
  const detail =
    meta.status === 'ended'
      ? `${formatCallDuration(meta.durationSec ?? 0)} · ${meta.participantIds.length} people`
      : meta.status === 'started'
        ? `${starter} started a call at ${formatTime(meta.startedAt)}`
        : `${starter} called at ${formatTime(meta.startedAt)}`;
  return (
    <div className="my-3 flex justify-center" data-testid="call-card">
      <div
        className={cn(
          'flex w-full max-w-md items-center gap-3 rounded-xl border px-4 py-3 shadow-sm',
          isLive ? 'border-success/40 bg-success/10' : 'border-border bg-surface',
        )}
      >
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full',
            isLive
              ? 'bg-success text-bg'
              : meta.status === 'missed' || meta.status === 'declined'
                ? 'bg-danger/15 text-danger'
                : 'bg-accent-soft text-accent',
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label text-text">{title}</p>
          <p className="truncate text-meta text-text-subtle">{detail}</p>
        </div>
        {isLive && !inIt ? (
          <Button
            size="sm"
            onClick={() => void calls.join(meta.callId)}
            disabled={offline}
            className="bg-success text-bg hover:bg-success/90"
          >
            Join
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Start/join failures (blocked camera, media server down, call already ended). */
export function CallErrorToast() {
  const calls = useCalls();
  React.useEffect(() => {
    if (!calls.error) return;
    const t = setTimeout(() => calls.clearError(), 6000);
    return () => clearTimeout(t);
  }, [calls]);
  return (
    <AnimatePresence>
      {calls.error ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          role="alert"
          className="fixed bottom-20 left-1/2 z-[90] w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-danger/40 bg-surface px-4 py-3 text-label font-normal text-text shadow-xl md:bottom-6"
        >
          {calls.error}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
