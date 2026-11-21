'use client';
import * as React from 'react';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
} from 'livekit-client';
import type {
  Call,
  CallJoinResponse,
  CallMedia,
  CallRingingEvent,
  CallsConfig,
} from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine } from './engine';
import { deviceOptions } from './call-devices';

/** The call this tab is in: the server's record plus the live SFU room. */
export interface CurrentCall {
  call: Call;
  room: Room;
  /** 'connecting' until the SFU accepts us; 'reconnecting' while ICE recovers. */
  phase: 'connecting' | 'connected' | 'reconnecting';
  /** Bumped on every room event so components re-read participants and tracks. */
  version: number;
  minimized: boolean;
  error: string | null;
}

interface CallsContextValue {
  config: CallsConfig | null;
  /** Live calls by conversation id (for "Join" banners). */
  live: Map<string, Call>;
  incoming: CallRingingEvent | null;
  current: CurrentCall | null;
  /** Last error from start/join, shown as a toast. */
  error: string | null;
  clearError(): void;
  start(conversationId: string, media: CallMedia): Promise<void>;
  join(callId: string, opts?: { video?: boolean }): Promise<void>;
  decline(callId: string): Promise<void>;
  leave(): Promise<void>;
  endForAll(): Promise<void>;
  setMinimized(m: boolean): void;
  toggleMic(): Promise<void>;
  toggleCamera(): Promise<void>;
  toggleScreenShare(): Promise<void>;
  toggleHand(): Promise<void>;
  /** Start or stop recording the current call (everyone sees the indicator). */
  toggleRecording(): Promise<void>;
  /** Let an external guest in from the lobby, or turn them away. */
  decideGuest(guestId: string, allow: boolean): Promise<void>;
}

const CallsContext = React.createContext<CallsContextValue | null>(null);
export function useCalls() {
  const v = React.useContext(CallsContext);
  if (!v) throw new Error('useCalls outside CallsProvider');
  return v;
}

const CONFIG_KEY = 'calls.config';

function messageOf(e: unknown): string {
  if (e instanceof ApiFailure) return e.error.message;
  if (e instanceof Error) {
    if (e.name === 'NotAllowedError')
      return 'Your browser blocked the microphone or camera. Allow access in the address bar and try again.';
    if (e.name === 'NotFoundError') return 'No microphone or camera was found on this device.';
    return e.message;
  }
  return 'Something went wrong with the call.';
}

/**
 * Owns calling for the signed-in user: the deployment's call config, live calls in their
 * conversations, incoming rings, and at most one SFU connection per tab.
 */
export function CallsProvider({ children }: { children: React.ReactNode }) {
  const { engine, db, state } = useEngine();
  const { getAccessToken, session } = useAuth();
  const me = session?.user.userId;
  const [config, setConfig] = React.useState<CallsConfig | null>(null);
  const [live, setLive] = React.useState<Map<string, Call>>(new Map());
  const [incoming, setIncoming] = React.useState<CallRingingEvent | null>(null);
  const [current, setCurrent] = React.useState<CurrentCall | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const currentRef = React.useRef<CurrentCall | null>(null);
  currentRef.current = current;
  const online = state.connectivity === 'online';

  const req = React.useCallback(
    async <T,>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body }),
    [getAccessToken],
  );

  const upsertLive = React.useCallback((call: Call) => {
    setLive((m) => {
      const next = new Map(m);
      if (call.status === 'live') next.set(call.conversationId, call);
      else if (next.get(call.conversationId)?.callId === call.callId)
        next.delete(call.conversationId);
      return next;
    });
  }, []);

  // Config (cached so the buttons render correctly offline) and the live-call snapshot.
  React.useEffect(() => {
    void db.meta.get(CONFIG_KEY).then((row) => {
      if (row) setConfig((c) => c ?? (row.value as CallsConfig));
    });
  }, [db]);
  React.useEffect(() => {
    if (!online) return;
    void (async () => {
      try {
        const cfg = await req<CallsConfig>('GET', '/v1/calls/config');
        setConfig(cfg);
        void db.meta.put({ key: CONFIG_KEY, value: cfg });
        if (!cfg.enabled) return;
        const calls = await req<Call[]>('GET', '/v1/calls/active');
        setLive(new Map(calls.map((c) => [c.conversationId, c])));
      } catch {
        /* offline or not permitted: keep what we have */
      }
    })();
  }, [online, req, db]);

  const bump = React.useCallback((patch: Partial<CurrentCall> = {}) => {
    setCurrent((c) => (c ? { ...c, ...patch, version: c.version + 1 } : c));
  }, []);

  const disconnectRoom = React.useCallback(async () => {
    const c = currentRef.current;
    currentRef.current = null;
    setCurrent(null);
    if (c) await c.room.disconnect().catch(() => undefined);
  }, []);

  const connectTo = React.useCallback(
    async (res: CallJoinResponse, video: boolean) => {
      await currentRef.current?.room.disconnect().catch(() => undefined);
      const dev = deviceOptions();
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution, ...dev.video },
        publishDefaults: { simulcast: true },
        ...(dev.audioOutput ? { audioOutput: dev.audioOutput } : {}),
        audioCaptureDefaults: {
          ...dev.audio,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const next: CurrentCall = {
        call: res.call,
        room,
        phase: 'connecting',
        version: 0,
        minimized: false,
        error: null,
      };
      currentRef.current = next;
      setCurrent(next);
      const refresh = () => bump();
      for (const ev of [
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
        RoomEvent.ConnectionQualityChanged,
      ])
        room.on(ev, refresh);
      room.on(RoomEvent.ConnectionStateChanged, (s) => {
        if (s === ConnectionState.Connected) bump({ phase: 'connected' });
        else if (s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting)
          bump({ phase: 'reconnecting' });
      });
      room.on(RoomEvent.Disconnected, () => {
        if (currentRef.current?.room === room) {
          currentRef.current = null;
          setCurrent(null);
        }
      });
      try {
        await room.connect(res.join.url, res.join.token);
        bump({ phase: 'connected' });
      } catch (e) {
        await disconnectRoom();
        void req('POST', `/v1/calls/${res.call.callId}/leave`).catch(() => undefined);
        throw new Error(
          "Couldn't reach the media server. Check that it's running and reachable from this network.",
          { cause: e },
        );
      }
      // Media is best-effort: a call without a camera (or a blocked mic) still works for listening.
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (e) {
        bump({ error: messageOf(e) });
      }
      if (video) {
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch (e) {
          bump({ error: messageOf(e) });
        }
      }
      bump();
    },
    [bump, disconnectRoom, req],
  );

  const start = React.useCallback(
    async (conversationId: string, media: CallMedia) => {
      setError(null);
      try {
        const res = await req<CallJoinResponse>(
          'POST',
          `/v1/conversations/${conversationId}/calls`,
          {
            media,
          },
        );
        upsertLive(res.call);
        await connectTo(res, media === 'video');
      } catch (e) {
        setError(messageOf(e));
      }
    },
    [req, connectTo, upsertLive],
  );

  const join = React.useCallback(
    async (callId: string, opts: { video?: boolean } = {}) => {
      setError(null);
      setIncoming((i) => (i?.call.callId === callId ? null : i));
      try {
        const res = await req<CallJoinResponse>('POST', `/v1/calls/${callId}/join`);
        upsertLive(res.call);
        await connectTo(res, opts.video ?? res.call.media === 'video');
      } catch (e) {
        setError(messageOf(e));
      }
    },
    [req, connectTo, upsertLive],
  );

  const decline = React.useCallback(
    async (callId: string) => {
      setIncoming((i) => (i?.call.callId === callId ? null : i));
      await req('POST', `/v1/calls/${callId}/decline`).catch(() => undefined);
    },
    [req],
  );

  const leave = React.useCallback(async () => {
    const c = currentRef.current;
    await disconnectRoom();
    if (c) {
      const call = await req<Call>('POST', `/v1/calls/${c.call.callId}/leave`).catch(() => null);
      if (call) upsertLive(call);
    }
  }, [disconnectRoom, req, upsertLive]);

  const endForAll = React.useCallback(async () => {
    const c = currentRef.current;
    await disconnectRoom();
    if (c) {
      const call = await req<Call>('POST', `/v1/calls/${c.call.callId}/end`).catch(() => null);
      if (call) upsertLive(call);
    }
  }, [disconnectRoom, req, upsertLive]);

  // Live events: ringing, joins/leaves, call ended.
  React.useEffect(
    () =>
      engine.onCall((e) => {
        if (e.type === 'ringing') {
          upsertLive(e.ringing.call);
          // Don't ring for a call this tab is already in (answered on this device).
          if (currentRef.current?.call.callId !== e.ringing.call.callId) setIncoming(e.ringing);
          return;
        }
        upsertLive(e.call);
        if (currentRef.current?.call.callId === e.call.callId) {
          if (e.type === 'ended') void disconnectRoom();
          else setCurrent((c) => (c ? { ...c, call: e.call } : c));
        }
        setIncoming((i) => {
          if (!i || i.call.callId !== e.call.callId) return i;
          if (e.type === 'ended') return null;
          // Answered or declined on another of my devices: stop ringing here.
          const mine = e.call.participants.find((p) => p.userId === me);
          return mine && mine.state !== 'ringing' ? null : i;
        });
      }),
    [engine, me, upsertLive, disconnectRoom],
  );

  // Stop ringing at the server's deadline even if no event arrives.
  React.useEffect(() => {
    if (!incoming) return;
    const ms = Date.parse(incoming.expiresAt) - Date.now();
    const t = setTimeout(() => setIncoming(null), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [incoming]);

  // Leaving the page leaves the call, so the others see it right away.
  React.useEffect(() => {
    const onUnload = () => {
      const c = currentRef.current;
      if (!c) return;
      void c.room.disconnect();
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);

  const toggleMic = React.useCallback(async () => {
    const lp = currentRef.current?.room.localParticipant;
    if (!lp) return;
    try {
      await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
    } catch (e) {
      bump({ error: messageOf(e) });
    }
    bump();
  }, [bump]);
  const toggleCamera = React.useCallback(async () => {
    const lp = currentRef.current?.room.localParticipant;
    if (!lp) return;
    try {
      await lp.setCameraEnabled(!lp.isCameraEnabled);
    } catch (e) {
      bump({ error: messageOf(e) });
    }
    bump();
  }, [bump]);
  const toggleScreenShare = React.useCallback(async () => {
    const lp = currentRef.current?.room.localParticipant;
    if (!lp) return;
    try {
      await lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: true });
    } catch (e) {
      // Cancelling the browser's picker is not an error worth showing.
      if (!(e instanceof Error && e.name === 'NotAllowedError')) bump({ error: messageOf(e) });
    }
    bump();
  }, [bump]);
  const toggleHand = React.useCallback(async () => {
    const lp = currentRef.current?.room.localParticipant;
    if (!lp) return;
    const raised = !!lp.attributes.hand;
    await lp.setAttributes({ hand: raised ? '' : String(Date.now()) }).catch(() => undefined);
    bump();
  }, [bump]);

  const toggleRecording = React.useCallback(async () => {
    const c = currentRef.current;
    if (!c) return;
    const action = c.call.recording ? 'stop' : 'start';
    try {
      const call = await req<Call>('POST', `/v1/calls/${c.call.callId}/recording/${action}`);
      setCurrent((x) => (x && x.call.callId === call.callId ? { ...x, call } : x));
    } catch (e) {
      bump({ error: messageOf(e) });
    }
  }, [req, bump]);

  const decideGuest = React.useCallback(
    async (guestId: string, allow: boolean) => {
      const c = currentRef.current;
      if (!c) return;
      try {
        const call = await req<Call>(
          'POST',
          `/v1/calls/${c.call.callId}/lobby/${guestId}/${allow ? 'admit' : 'deny'}`,
        );
        setCurrent((x) => (x && x.call.callId === call.callId ? { ...x, call } : x));
      } catch (e) {
        bump({ error: messageOf(e) });
      }
    },
    [req, bump],
  );

  const value: CallsContextValue = {
    config,
    live,
    incoming,
    current,
    error,
    clearError: () => setError(null),
    start,
    join,
    decline,
    leave,
    endForAll,
    setMinimized: (m) => setCurrent((c) => (c ? { ...c, minimized: m } : c)),
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleHand,
    toggleRecording,
    decideGuest,
  };
  return <CallsContext.Provider value={value}>{children}</CallsContext.Provider>;
}

export function handRaisedAt(p: Participant): number | null {
  const v = p.attributes?.hand;
  return v ? Number(v) || null : null;
}

export function cameraTrackOf(p: Participant) {
  const pub = p.getTrackPublication(Track.Source.Camera);
  return pub && !pub.isMuted && pub.track ? pub.track : null;
}
export function screenTrackOf(p: Participant) {
  const pub = p.getTrackPublication(Track.Source.ScreenShare);
  return pub && !pub.isMuted && pub.track ? pub.track : null;
}
