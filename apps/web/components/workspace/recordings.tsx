'use client';
import * as React from 'react';
import {
  CircleStop,
  Download,
  Film,
  Mic,
  MonitorUp,
  Pause,
  Play,
  RotateCcw,
  SendHorizontal,
  Video,
} from 'lucide-react';
import {
  formatClipDuration,
  isAudioAttachment,
  type Attachment,
  type RecordingKind,
  type RecordingSystemMetadata,
} from '@sampledge/contracts';
import type { LocalMessage } from '@sampledge/offline';
import { Button, Dialog, DialogContent, cn } from '@sampledge/ui';
import { useAuth } from '@/lib/auth';
import {
  LABEL,
  canRecord,
  fixInfiniteDuration,
  useClipRecorder,
  type ClipKind,
  type RecordedClip,
} from '@/lib/recorder';
import { formatBytes, useAttachmentUrl } from '@/lib/uploads';
import type { DirectoryEntry } from '@/lib/engine';
import { formatTime, nameOf } from './helpers';
import { TranscriptToggle } from './transcript';

export const KIND_ICON: Record<RecordingKind, typeof Mic> = {
  voice: Mic,
  video: Video,
  screen: MonitorUp,
  call: Film,
};
export const KIND_LABEL: Record<RecordingKind, string> = {
  voice: 'Voice message',
  video: 'Video message',
  screen: 'Screen recording',
  call: 'Call recording',
};

const downloadUrl = (url: string) => url + (url.includes('?') ? '&' : '?') + 'download=1';

// ---------- recording a clip ----------

/**
 * Record a voice message, a video message or a screen recording, review it, then send it
 * straight away or add it to the message being written.
 */
export function RecordClipDialog({
  kind,
  open,
  onOpenChange,
  onDone,
}: {
  kind: ClipKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (clip: RecordedClip, sendNow: boolean) => void;
}) {
  const r = useClipRecorder(kind);
  const video = React.useRef<HTMLVideoElement>(null);
  const supported = canRecord(kind);

  React.useEffect(() => {
    if (video.current) video.current.srcObject = r.preview;
  }, [r.preview]);

  // Voice and video start as soon as the dialog opens; screen recording waits for a click
  // because the browser asks which screen to share.
  React.useEffect(() => {
    if (open && supported && kind !== 'screen' && r.state === 'idle') void r.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (o: boolean) => {
    if (!o) r.reset();
    onOpenChange(o);
  };
  const finish = (sendNow: boolean) => {
    if (!r.clip) return;
    onDone(r.clip, sendNow);
    onOpenChange(false);
  };
  const live = r.state === 'recording' || r.state === 'paused';
  const Icon = KIND_ICON[kind];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={LABEL[kind]}
        description={
          kind === 'screen'
            ? 'Records the screen, window or tab you choose, with your microphone.'
            : kind === 'video'
              ? 'Records your camera and microphone.'
              : 'Records your microphone.'
        }
        className="w-[min(560px,calc(100vw-2rem))]"
      >
        <div data-testid="clip-recorder" data-state={r.state} className="flex flex-col gap-4">
          {!supported ? (
            <p className="rounded-lg border border-border bg-surface-raised p-4 text-label font-normal text-text-muted">
              {kind === 'screen'
                ? 'This browser cannot record the screen. Try Chrome, Edge or Firefox on a computer.'
                : 'This browser cannot record audio or video.'}
            </p>
          ) : null}

          {kind !== 'voice' && r.state !== 'done' ? (
            <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                className={cn('size-full object-contain', kind === 'video' && 'scale-x-[-1]')}
              />
              {!r.preview ? (
                <span className="absolute inset-0 flex items-center justify-center text-label text-white/70">
                  <Icon className="mr-2 size-4" />
                  {r.state === 'requesting'
                    ? kind === 'screen'
                      ? 'Choose what to share…'
                      : 'Starting camera…'
                    : kind === 'screen'
                      ? 'Press Start to choose a screen'
                      : ''}
                </span>
              ) : null}
            </div>
          ) : null}

          {kind === 'voice' && r.state !== 'done' ? (
            <LevelBars level={r.level} active={r.state === 'recording'} />
          ) : null}

          {r.state === 'done' && r.clip ? (
            r.clip.kind === 'voice' ? (
              <VoicePlayer src={r.clip.url} durationMs={r.clip.durationMs} />
            ) : (
              <video
                src={r.clip.url}
                controls
                playsInline
                onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)}
                className="aspect-video w-full rounded-lg border border-border bg-black"
              />
            )
          ) : null}

          {r.error ? (
            <p role="alert" className="text-label font-normal text-danger">
              {r.error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={cn(
                'flex items-center gap-2 font-mono text-label tabular-nums',
                r.state === 'recording' ? 'text-danger' : 'text-text-muted',
              )}
              aria-live="off"
            >
              {r.state === 'recording' ? (
                <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
              ) : null}
              {formatClipDuration(r.elapsed)}
              {r.state === 'paused' ? <span className="font-sans text-meta">Paused</span> : null}
              {r.state === 'done' && r.clip ? (
                <span className="font-sans text-meta text-text-subtle">
                  {formatBytes(r.clip.file.size)}
                </span>
              ) : null}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {r.state === 'idle' || r.state === 'error' ? (
                <Button onClick={() => void r.start()} disabled={!supported}>
                  <Icon /> Start recording
                </Button>
              ) : null}
              {live ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={r.state === 'paused' ? r.resume : r.pause}
                    aria-label={r.state === 'paused' ? 'Resume recording' : 'Pause recording'}
                  >
                    {r.state === 'paused' ? <Play /> : <Pause />}
                    {r.state === 'paused' ? 'Resume' : 'Pause'}
                  </Button>
                  <Button variant="danger" onClick={r.stop}>
                    <CircleStop /> Stop
                  </Button>
                </>
              ) : null}
              {r.state === 'done' ? (
                <>
                  <Button variant="ghost" onClick={r.reset}>
                    <RotateCcw /> Record again
                  </Button>
                  <Button variant="secondary" onClick={() => finish(false)}>
                    Add to message
                  </Button>
                  <Button onClick={() => finish(true)}>
                    <SendHorizontal /> Send
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LevelBars({ level, active }: { level: number; active: boolean }) {
  const [history, setHistory] = React.useState<number[]>(() => Array(40).fill(0));
  React.useEffect(() => {
    if (active) setHistory((h) => [...h.slice(1), level]);
  }, [level, active]);
  return (
    <div
      className="flex h-20 items-center justify-center gap-[3px] rounded-lg border border-border bg-surface-raised px-4"
      aria-hidden
    >
      {history.map((v, i) => (
        <span
          key={i}
          className={cn('w-1 rounded-full', active ? 'bg-accent' : 'bg-border-strong')}
          style={{ height: `${Math.max(6, v * 100)}%` }}
        />
      ))}
    </div>
  );
}

// ---------- playback ----------

/** A compact audio player: play/pause, scrubber, time and speed. */
export function VoicePlayer({
  src,
  durationMs,
  own,
  label = 'Voice message',
}: {
  src: string | null;
  durationMs: number | null | undefined;
  own?: boolean;
  label?: string;
}) {
  const audio = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [t, setT] = React.useState(0);
  const [dur, setDur] = React.useState((durationMs ?? 0) / 1000);
  const [rate, setRate] = React.useState(1);
  const total = Number.isFinite(dur) && dur > 0 ? dur : (durationMs ?? 0) / 1000;
  const pct = total ? Math.min(100, (t / total) * 100) : 0;

  return (
    <div
      className={cn(
        'flex w-72 max-w-full items-center gap-3 rounded-full border px-2 py-1.5',
        own ? 'border-accent/30 bg-accent-soft' : 'border-border bg-surface-raised',
      )}
      data-testid="voice-player"
    >
      <button
        type="button"
        disabled={!src}
        aria-label={playing ? `Pause ${label.toLowerCase()}` : `Play ${label.toLowerCase()}`}
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) void a.play();
          else a.pause();
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm transition-transform hover:scale-105 disabled:opacity-40"
      >
        {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
      </button>
      <input
        type="range"
        min={0}
        max={total || 1}
        step={0.05}
        value={Math.min(t, total || 1)}
        aria-label="Seek"
        onChange={(e) => {
          const a = audio.current;
          if (a) a.currentTime = Number(e.target.value);
          setT(Number(e.target.value));
        }}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--sc-accent)]"
        style={{
          background: `linear-gradient(to right, var(--sc-accent) ${pct}%, var(--sc-border-strong) ${pct}%)`,
        }}
      />
      <span className="w-10 shrink-0 text-right font-mono text-meta tabular-nums text-text-muted">
        {formatClipDuration((playing || t > 0 ? t : total) * 1000)}
      </span>
      <button
        type="button"
        onClick={() => {
          const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
          setRate(next);
          if (audio.current) audio.current.playbackRate = next;
        }}
        aria-label={`Playback speed ${rate}x`}
        className="w-9 shrink-0 rounded-full px-1 text-meta font-semibold text-text-muted hover:bg-surface hover:text-text"
      >
        {rate}x
      </button>
      {src ? (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => {
            fixInfiniteDuration(e.currentTarget);
            if (Number.isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration);
          }}
          onDurationChange={(e) =>
            Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)
          }
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setT(0);
          }}
        />
      ) : null}
    </div>
  );
}

function DeletedRecording({ kind }: { kind: RecordingKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex w-72 max-w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-meta text-text-subtle">
      <Icon className="size-4" />
      {KIND_LABEL[kind]} deleted
    </div>
  );
}

/** A recorded clip or call recording on a message. */
export function RecordingAttachment({ a, own }: { a: Attachment; own: boolean }) {
  const { getAccessToken } = useAuth();
  const kind = a.recording ?? (isAudioAttachment(a) ? 'voice' : 'video');
  const deleted = !!a.deletedAt;
  const { url } = useAttachmentUrl(deleted ? null : a.attachmentId, getAccessToken);
  if (deleted) return <DeletedRecording kind={kind} />;
  if (isAudioAttachment(a))
    return (
      <div>
        <div className="flex items-center gap-1.5">
          <VoicePlayer src={url} durationMs={a.durationMs} own={own} label={KIND_LABEL[kind]} />
          {url && kind !== 'voice' ? <DownloadButton url={url} name={a.fileName} /> : null}
        </div>
        <TranscriptToggle a={a} compact />
      </div>
    );
  const Icon = KIND_ICON[kind];
  return (
    <figure
      className="w-80 max-w-full overflow-hidden rounded-lg border border-border bg-surface-raised"
      data-testid="video-clip"
    >
      {url ? (
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)}
          className="aspect-video w-full bg-black"
        />
      ) : (
        <div className="aspect-video w-full animate-pulse bg-surface" />
      )}
      <figcaption className="flex items-center gap-2 px-3 py-2 text-meta text-text-muted">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {KIND_LABEL[kind]}
          {a.durationMs ? ` · ${formatClipDuration(a.durationMs)}` : ''}
        </span>
        {url ? <DownloadButton url={url} name={a.fileName} /> : null}
      </figcaption>
      <div className="px-2 pb-2">
        <TranscriptToggle a={a} compact />
      </div>
    </figure>
  );
}

function DownloadButton({ url, name }: { url: string; name: string }) {
  return (
    <a
      href={downloadUrl(url)}
      download={name}
      aria-label={`Download ${name}`}
      className="rounded-sm p-1 text-text-subtle hover:bg-surface hover:text-text"
    >
      <Download className="size-3.5" />
    </a>
  );
}

/** The system message that delivers a finished call or meeting recording. */
export function CallRecordingCard({
  message,
  me,
  directory,
}: {
  message: LocalMessage;
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const meta = message.metadata?.recording as RecordingSystemMetadata | undefined;
  if (!meta) return null;
  const file = message.attachments?.[0];
  const who = meta.startedBy === me ? 'You' : nameOf(meta.startedBy, directory).split(' ')[0];
  return (
    <div className="my-3 flex justify-center" data-testid="recording-card">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="mb-2 flex items-center gap-2.5 px-1">
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-full',
              meta.failed ? 'bg-danger/15 text-danger' : 'bg-danger text-bg',
            )}
          >
            <Film className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-label text-text">
              {meta.failed ? 'Call recording failed' : 'Call recording'}
            </span>
            <span className="block text-meta text-text-subtle">
              {who} started recording at {formatTime(meta.startedAt)}
              {meta.failed ? '' : ` · ${formatClipDuration(meta.durationMs)}`}
            </span>
          </span>
        </div>
        {file && !meta.failed ? <RecordingAttachment a={file} own={false} /> : null}
      </div>
    </div>
  );
}
