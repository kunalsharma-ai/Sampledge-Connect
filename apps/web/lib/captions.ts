'use client';
import * as React from 'react';
import {
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type Room,
} from 'livekit-client';
import {
  CALL_CAPTIONS_TOPIC,
  CallCaptionPacketSchema,
  type CallCaptionPacket,
} from '@sampledge/contracts';

/** How long each clip is, and how long a caption stays on screen. */
const CLIP_MS = 4000;
const SHOW_MS = 9000;
/** Speech detection: RMS level that counts as voice, and how much of a clip must be voiced. */
const VOICE_RMS = 0.02;
const MIN_VOICED_MS = 300;

export interface CaptionLine {
  id: string;
  name: string;
  text: string;
  at: number;
}

const wants = (p: Participant) => p.attributes?.captions === '1';

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return null;
}

/**
 * Live captions for one call, shared by members and guests.
 *
 * - `on` is whether I want to see captions; it is published as my participant attribute
 *   `captions: "1"` so everyone knows captions are being made.
 * - While anyone in the call wants captions and my microphone is on, my app records short
 *   clips of my own voice (skipping silence), sends them to `transcribe` (the organization's own
 *   speech-to-text server, via the API) and shares the text with the call over the data channel.
 * - Everyone shows the lines they receive, labelled with the speaker's name.
 */
export function useLiveCaptions(
  room: Room | null,
  opts: {
    enabled: boolean;
    myName: string;
    transcribe: (clip: Blob) => Promise<string>;
  },
) {
  const [on, setOn] = React.useState(false);
  const [lines, setLines] = React.useState<CaptionLine[]>([]);
  const [active, setActive] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const transcribe = React.useRef(opts.transcribe);
  transcribe.current = opts.transcribe;
  const myName = React.useRef(opts.myName);
  myName.current = opts.myName;

  const add = React.useCallback((p: CallCaptionPacket) => {
    setLines((cur) =>
      cur.some((l) => l.id === p.id)
        ? cur
        : [...cur, { id: p.id, name: p.name, text: p.text, at: Date.now() }].slice(-4),
    );
  }, []);

  // Old lines fade out.
  React.useEffect(() => {
    if (!lines.length) return;
    const t = setTimeout(
      () => setLines((cur) => cur.filter((l) => Date.now() - l.at < SHOW_MS)),
      1000,
    );
    return () => clearTimeout(t);
  }, [lines]);

  // A new call starts with captions off.
  React.useEffect(() => {
    setOn(false);
    setLines([]);
    setError(null);
  }, [room]);

  // Receive captions from everyone (including my own, which I add locally).
  React.useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== CALL_CAPTIONS_TOPIC) return;
      try {
        const parsed = CallCaptionPacketSchema.safeParse(
          JSON.parse(new TextDecoder().decode(payload)),
        );
        if (parsed.success) add(parsed.data);
      } catch {
        /* not ours */
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, add]);

  // My preference, visible to the call.
  React.useEffect(() => {
    if (!room || !opts.enabled) return;
    void room.localParticipant.setAttributes({ captions: on ? '1' : '' }).catch(() => undefined);
  }, [room, on, opts.enabled]);

  // Whether anyone wants captions (so I should send my speech).
  React.useEffect(() => {
    if (!room) return;
    const check = () =>
      setActive(
        opts.enabled &&
          [room.localParticipant, ...room.remoteParticipants.values()].some((p) => wants(p)),
      );
    check();
    const evs = [
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
    ] as const;
    for (const e of evs) room.on(e, check);
    return () => {
      for (const e of evs) room.off(e, check);
    };
  }, [room, opts.enabled]);

  // Send my own speech while captions are active and my microphone is on.
  const [micTrack, setMicTrack] = React.useState<MediaStreamTrack | null>(null);
  React.useEffect(() => {
    if (!room) return;
    const read = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const t = pub && !pub.isMuted ? (pub.track?.mediaStreamTrack ?? null) : null;
      setMicTrack(t);
    };
    read();
    const evs = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ActiveDeviceChanged,
    ] as const;
    const onEv = (_x?: LocalTrackPublication | unknown) => read();
    for (const e of evs) room.on(e, onEv);
    return () => {
      for (const e of evs) room.off(e, onEv);
    };
  }, [room]);

  React.useEffect(() => {
    if (!room || !active || !micTrack) return;
    const mime = pickMime();
    if (!mime) {
      setError('This browser can’t send captions. You still see everyone else’s.');
      return;
    }
    let stopped = false;
    const stream = new MediaStream([micTrack]);
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let voicedMs = 0;
    const meter = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      if (Math.sqrt(sum / buf.length) > VOICE_RMS) voicedMs += 100;
    }, 100);

    let rec: MediaRecorder | null = null;
    const next = () => {
      if (stopped) return;
      const chunks: Blob[] = [];
      voicedMs = 0;
      rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const voiced = voicedMs >= MIN_VOICED_MS;
        next();
        if (!voiced || !chunks.length) return;
        const clip = new Blob(chunks, { type: mime.split(';')[0] });
        void transcribe
          .current(clip)
          .then((text) => {
            if (!text) return;
            setError(null);
            const packet: CallCaptionPacket = {
              id: `${room.localParticipant.identity}:${Date.now()}`,
              name: myName.current,
              text,
            };
            add(packet);
            void room.localParticipant
              .publishData(new TextEncoder().encode(JSON.stringify(packet)), {
                reliable: true,
                topic: CALL_CAPTIONS_TOPIC,
              })
              .catch(() => undefined);
          })
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Captions failed'));
      };
      rec.start();
      setTimeout(() => rec?.state === 'recording' && rec.stop(), CLIP_MS);
    };
    next();
    return () => {
      stopped = true;
      clearInterval(meter);
      if (rec?.state === 'recording') rec.stop();
      src.disconnect();
      void ctx.close();
    };
  }, [active, micTrack, room, add]);

  return { on, setOn, lines, active, error };
}
