import { CALL_CAPTIONS_TOPIC, type CallCaptionPacket } from '@sampledge/contracts';
import {
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type Room,
} from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIP_MS,
  MIN_VOICED_MS,
  VOICE_RMS,
  addCaption,
  anyoneWantsCaptions,
  freshCaptions,
  readCaptionPacket,
  rms,
  type CaptionLine,
} from '../lib/captions';

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') return null;
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return null;
}

/**
 * Live captions for the call you are in, the same protocol as the web app (docs/calls.md).
 *
 * - `on` is whether I want to see captions; it is my participant attribute `captions: "1"`, so
 *   everyone in the call knows speech is being transcribed.
 * - Everyone's app shows the caption lines shared on the data channel (topic `captions`).
 * - While anyone wants captions, my app records short clips of my own microphone (skipping
 *   silence), has the organization's speech-to-text server transcribe them through the API, and
 *   shares the text. That needs MediaRecorder: the web build has it; the native WebRTC module
 *   does not yet, so a phone shows everyone else's captions but doesn't send its own (`canSend`).
 */
export function useLiveCaptions(
  room: Room | null,
  opts: { enabled: boolean; myName: string; transcribe: (clip: Blob) => Promise<string> },
) {
  const [on, setOn] = useState(false);
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null);
  const transcribe = useRef(opts.transcribe);
  transcribe.current = opts.transcribe;
  const myName = useRef(opts.myName);
  myName.current = opts.myName;
  const mime = pickMime();
  const canSend = !!mime;

  const add = useCallback((p: CallCaptionPacket) => {
    setLines((cur) => addCaption(cur, p, Date.now()));
  }, []);

  // Old lines fade out.
  useEffect(() => {
    if (!lines.length) return;
    const t = setTimeout(() => setLines((cur) => freshCaptions(cur, Date.now())), 1000);
    return () => clearTimeout(t);
  }, [lines]);

  // A new call starts with captions off.
  useEffect(() => {
    setOn(false);
    setLines([]);
    setError(null);
  }, [room]);

  // Captions from everyone else.
  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== CALL_CAPTIONS_TOPIC) return;
      const p = readCaptionPacket(payload);
      if (p) add(p);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, add]);

  // My preference, visible to the call.
  useEffect(() => {
    if (!room || !opts.enabled) return;
    void room.localParticipant.setAttributes({ captions: on ? '1' : '' }).catch(() => undefined);
  }, [room, on, opts.enabled]);

  // Whether anyone wants captions.
  useEffect(() => {
    if (!room) return;
    const check = () => {
      const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
      setActive(opts.enabled && anyoneWantsCaptions(all.map((p) => p.attributes)));
    };
    check();
    const evs = [
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.Connected,
    ] as const;
    for (const e of evs) room.on(e, check);
    return () => {
      for (const e of evs) room.off(e, check);
    };
  }, [room, opts.enabled]);

  // My microphone, while it is on.
  useEffect(() => {
    if (!room) return;
    const read = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      setMicTrack(pub && !pub.isMuted ? (pub.track?.mediaStreamTrack ?? null) : null);
    };
    read();
    const evs = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ActiveDeviceChanged,
    ] as const;
    for (const e of evs) room.on(e, read);
    return () => {
      for (const e of evs) room.off(e, read);
    };
  }, [room]);

  // Send my own speech while captions are active.
  useEffect(() => {
    if (!room || !active || !micTrack || !mime) return;
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
      if (rms(buf) > VOICE_RMS) voicedMs += 100;
    }, 100);

    let rec: MediaRecorder | null = null;
    const next = () => {
      if (stopped) return;
      const chunks: Blob[] = [];
      voicedMs = 0;
      rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
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
              name: myName.current.slice(0, 80),
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
  }, [active, micTrack, room, add, mime]);

  return { on, setOn, lines, active, error, canSend };
}
