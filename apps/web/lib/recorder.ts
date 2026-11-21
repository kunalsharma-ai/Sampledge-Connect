'use client';
import * as React from 'react';
import { MAX_CLIP_DURATION_MS } from '@sampledge/contracts';

export type ClipKind = 'voice' | 'video' | 'screen';

export interface RecordedClip {
  file: File;
  url: string;
  kind: ClipKind;
  mimeType: string;
  durationMs: number;
}

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'done' | 'error';

const CANDIDATES: Record<ClipKind, string[]> = {
  voice: ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'],
  video: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
  screen: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
};

export const LABEL: Record<ClipKind, string> = {
  voice: 'Voice message',
  video: 'Video message',
  screen: 'Screen recording',
};

/** Whether this browser can record clips at all (and share its screen, for screen clips). */
export function canRecord(kind: ClipKind): boolean {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return false;
  if (kind === 'screen') return !!navigator.mediaDevices?.getDisplayMedia;
  return !!navigator.mediaDevices?.getUserMedia;
}

function pickMime(kind: ClipKind): string {
  return CANDIDATES[kind].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/** "audio/webm;codecs=opus" -> "audio/webm" (the server takes a bare type). */
export const bareType = (t: string) => t.split(';')[0]!.trim().toLowerCase();

function extension(mime: string) {
  const t = bareType(mime);
  if (t === 'audio/mp4') return 'm4a';
  return t.split('/')[1] ?? 'webm';
}

function fileStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

export function friendlyMediaError(e: unknown, kind: ClipKind): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return kind === 'screen'
      ? 'Screen sharing was not allowed. Pick a screen, window or tab to record.'
      : `Allow ${kind === 'voice' ? 'microphone' : 'camera and microphone'} access in your browser to record.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return kind === 'voice' ? 'No microphone was found.' : 'No camera was found.';
  if (name === 'NotReadableError') return 'Your camera or microphone is being used by another app.';
  return 'Recording could not start in this browser.';
}

/**
 * Records a voice message, a video message (camera + mic) or a screen recording (screen,
 * its audio when the browser offers it, plus the mic) with MediaRecorder. Pause/resume,
 * a live level meter, and an automatic stop at the 30-minute clip limit.
 */
export function useClipRecorder(kind: ClipKind) {
  const [state, setState] = React.useState<RecorderState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [level, setLevel] = React.useState(0);
  const [clip, setClip] = React.useState<RecordedClip | null>(null);
  const [preview, setPreview] = React.useState<MediaStream | null>(null);

  const rec = React.useRef<MediaRecorder | null>(null);
  const streams = React.useRef<MediaStream[]>([]);
  const audioCtx = React.useRef<AudioContext | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  // Elapsed time excluding pauses.
  const clock = React.useRef({ base: 0, since: 0 });
  const raf = React.useRef<number | null>(null);

  const cleanup = React.useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setPreview(null);
    setLevel(0);
  }, []);

  React.useEffect(() => () => cleanup(), [cleanup]);
  React.useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );

  const now = () =>
    clock.current.base + (clock.current.since ? Date.now() - clock.current.since : 0);

  const stop = React.useCallback(() => {
    const r = rec.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const start = React.useCallback(async () => {
    setError(null);
    setClip(null);
    setState('requesting');
    try {
      let recordStream: MediaStream;
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const mixed = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const addAudio = (s: MediaStream) => {
        if (!s.getAudioTracks().length) return;
        const src = ctx.createMediaStreamSource(s);
        src.connect(mixed);
        src.connect(analyser);
      };
      if (kind === 'screen') {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: true,
        });
        streams.current.push(display);
        let mic: MediaStream | null = null;
        try {
          mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          streams.current.push(mic);
        } catch {
          mic = null; // record the screen without narration
        }
        addAudio(display);
        if (mic) addAudio(mic);
        recordStream = new MediaStream([
          ...display.getVideoTracks(),
          ...mixed.stream.getAudioTracks(),
        ]);
        // The browser's own "Stop sharing" button ends the clip.
        display.getVideoTracks()[0]?.addEventListener('ended', () => stop());
        setPreview(display);
      } else {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video:
            kind === 'video'
              ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
              : false,
        });
        streams.current.push(media);
        addAudio(media);
        recordStream =
          kind === 'video'
            ? new MediaStream([...media.getVideoTracks(), ...mixed.stream.getAudioTracks()])
            : mixed.stream;
        if (kind === 'video') setPreview(media);
      }

      const mimeType = pickMime(kind);
      const r = new MediaRecorder(recordStream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 96_000,
        ...(kind !== 'voice'
          ? { videoBitsPerSecond: kind === 'screen' ? 2_500_000 : 1_500_000 }
          : {}),
      });
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const durationMs = Math.max(1, Math.round(now()));
        clock.current = { base: durationMs, since: 0 };
        const type = r.mimeType || mimeType || (kind === 'voice' ? 'audio/webm' : 'video/webm');
        const blob = new Blob(chunks.current, { type: bareType(type) });
        const file = new File([blob], `${LABEL[kind]} ${fileStamp()}.${extension(type)}`, {
          type: bareType(type),
        });
        cleanup();
        setElapsed(durationMs);
        setClip({
          file,
          url: URL.createObjectURL(blob),
          kind,
          mimeType: bareType(type),
          durationMs,
        });
        setState('done');
      };
      rec.current = r;
      r.start(1000);
      clock.current = { base: 0, since: Date.now() };
      setElapsed(0);
      setState('recording');

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        const t = now();
        setElapsed(t);
        if (t >= MAX_CLIP_DURATION_MS) stop();
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      cleanup();
      setError(friendlyMediaError(e, kind));
      setState('error');
    }
  }, [kind, cleanup, stop]);

  const pause = React.useCallback(() => {
    const r = rec.current;
    if (r?.state !== 'recording') return;
    r.pause();
    clock.current = { base: now(), since: 0 };
    setState('paused');
  }, []);

  const resume = React.useCallback(() => {
    const r = rec.current;
    if (r?.state !== 'paused') return;
    r.resume();
    clock.current = { ...clock.current, since: Date.now() };
    setState('recording');
  }, []);

  /** Throws away the clip (or the recording in progress) and returns to idle. */
  const reset = React.useCallback(() => {
    const r = rec.current;
    if (r && r.state !== 'inactive') {
      r.onstop = null;
      r.stop();
    }
    rec.current = null;
    cleanup();
    setClip(null);
    setElapsed(0);
    setState('idle');
  }, [cleanup]);

  return { state, error, elapsed, level, clip, preview, start, stop, pause, resume, reset };
}

/**
 * MediaRecorder WebM files carry no duration, so browsers report Infinity until they have
 * scanned the file. Seeking far ahead once makes them compute it; `fallbackMs` covers the UI
 * meanwhile.
 */
export function fixInfiniteDuration(el: HTMLMediaElement) {
  if (el.duration !== Infinity) return;
  const restore = () => {
    el.removeEventListener('durationchange', restore);
    el.currentTime = 0;
  };
  el.addEventListener('durationchange', restore);
  el.currentTime = 1e101;
}
