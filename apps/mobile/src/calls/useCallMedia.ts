import type { CallJoin, CallMedia } from '@sampledge/contracts';
import {
  ConnectionState,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type TrackPublication,
} from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultOutput, type AudioOutput } from '../lib/audioRoute';
import {
  hasRoutePicker,
  listAudioOutputs,
  selectAudioOutput,
  setupCallMedia,
  showRoutePicker,
  startCallAudio,
  stopCallAudio,
} from './mediaSetup';

export interface CallTile {
  /** The member's userId (the SFU identity). */
  userId: string;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
  camOn: boolean;
  /** Raised hand (the `hand` participant attribute). */
  handUp: boolean;
  /** The camera track to render, when on. */
  video: { participant: Participant; publication: TrackPublication } | null;
}

export type MediaStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

/**
 * Connects to the self-hosted SFU with the API's join token and exposes who is in the room.
 * The same livekit-client code runs in the web preview and, with the native WebRTC module,
 * on iOS and Android.
 */
export function useCallMedia(
  join: CallJoin | null,
  media: CallMedia,
  opts: { onTokenExpired?: () => Promise<CallJoin | null> } = {},
) {
  const roomRef = useRef<Room | null>(null);
  /** The room, for features that listen to it (captions). */
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<MediaStatus>('connecting');
  const [tiles, setTiles] = useState<CallTile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(media === 'video');
  const [handUp, setHandUp] = useState(false);
  /** Which camera is sending: front ("user") or back ("environment"). */
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [outputs, setOutputs] = useState<AudioOutput[]>([]);
  const [output, setOutput] = useState<string | null>(null);
  const onTokenExpired = useRef(opts.onTokenExpired);
  onTokenExpired.current = opts.onTokenExpired;

  useEffect(() => {
    if (!join) return;
    setupCallMedia();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setRoom(room);
    let cancelled = false;

    const snapshot = () => {
      const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
      setTiles(
        all.map((p) => {
          const cam = p.getTrackPublication(Track.Source.Camera);
          const mic = p.getTrackPublication(Track.Source.Microphone);
          const camLive = !!cam && !cam.isMuted && !!cam.track;
          return {
            userId: p.identity,
            isLocal: p === room.localParticipant,
            speaking: p.isSpeaking,
            micOn: !!mic && !mic.isMuted,
            camOn: camLive,
            handUp: !!p.attributes?.hand,
            video: camLive ? { participant: p, publication: cam } : null,
          };
        }),
      );
    };
    const onState = (s: ConnectionState) => {
      setStatus(
        s === ConnectionState.Connected
          ? 'connected'
          : s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting
            ? 'reconnecting'
            : s === ConnectionState.Connecting
              ? 'connecting'
              : 'disconnected',
      );
      snapshot();
    };
    for (const e of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ParticipantAttributesChanged,
    ])
      room.on(e, snapshot);
    room.on(RoomEvent.ConnectionStateChanged, onState);

    void (async () => {
      try {
        await startCallAudio();
        await room.connect(join.url, join.token);
        if (cancelled) return;
        snapshot();
        // Devices can be missing or refused; the call still works for listening.
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => setMicOn(false));
        if (media === 'video')
          await room.localParticipant.setCameraEnabled(true).catch(() => setCamOn(false));
        snapshot();
        // Video calls start on the speaker, voice calls on the earpiece (a headset wins).
        const outs = await listAudioOutputs().catch(() => []);
        if (cancelled) return;
        setOutputs(outs);
        const first = defaultOutput(outs, media === 'video');
        if (first)
          await selectAudioOutput(room, first).then(
            () => setOutput(first),
            () => {},
          );
      } catch (err) {
        if (cancelled) return;
        // A token that expired before connecting: ask the API for a fresh one once.
        const fresh = await onTokenExpired.current?.().catch(() => null);
        if (fresh && !cancelled) {
          try {
            await room.connect(fresh.url, fresh.token);
            await room.localParticipant.setMicrophoneEnabled(true).catch(() => setMicOn(false));
            snapshot();
            return;
          } catch {
            // fall through
          }
        }
        setStatus('failed');
        setError(err instanceof Error ? err.message : 'Could not connect to the call');
      }
    })();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      void room.disconnect();
      void stopCallAudio();
      roomRef.current = null;
      setRoom(null);
    };
  }, [join, media]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next).then(
      () => setMicOn(next),
      () => setError('Microphone is not available'),
    );
  }, [micOn]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !camOn;
    await room.localParticipant.setCameraEnabled(next).then(
      () => setCamOn(next),
      () => setError('Camera is not available'),
    );
  }, [camOn]);

  /** Front to back camera and back, without leaving the call. */
  const flipCamera = useCallback(async () => {
    const room = roomRef.current;
    const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (!(track instanceof LocalVideoTrack)) return;
    const next = facing === 'user' ? 'environment' : 'user';
    await track.restartTrack({ facingMode: next }).then(
      () => setFacing(next),
      () => setError('Could not switch camera'),
    );
  }, [facing]);

  /** Re-reads where audio can go (a headset or Bluetooth device may have connected). */
  const refreshOutputs = useCallback(async () => {
    const outs = await listAudioOutputs().catch(() => []);
    setOutputs(outs);
    return outs;
  }, []);

  const chooseOutput = useCallback(async (id: string) => {
    await selectAudioOutput(roomRef.current, id).then(
      () => setOutput(id),
      () => setError('Could not switch audio'),
    );
  }, []);

  const toggleHand = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !handUp;
    await room.localParticipant
      .setAttributes({ hand: next ? new Date().toISOString() : '' })
      .then(() => setHandUp(next))
      .catch(() => setError('Could not raise your hand'));
  }, [handUp]);

  return {
    room,
    status,
    tiles,
    error,
    micOn,
    camOn,
    handUp,
    facing,
    outputs,
    output,
    hasRoutePicker,
    toggleMic,
    toggleCamera,
    toggleHand,
    flipCamera,
    refreshOutputs,
    chooseOutput,
    showRoutePicker,
  };
}
